import type { Knex } from 'knex';
import { getKenyaDate } from '../utils/timezone';
import { recomputeAccountBalance, readAccountBalance } from './accountBalance';
import { allocateMoneyCredits, applyCustomerCredit, getEligibleMoneyCredits } from './receivablePayments';
import { syncVarianceAccount } from './employeeVariances';
import type { Approver } from './approval';

// Balance moves: how a mistake found on a closed shift is fixed, since the
// shift itself never changes. All of a shift's money is in the drawer (counted,
// final), a customer's balance, or the attendant's shortage, so a later mistake
// always means money sits on the wrong account. A move takes an amount off one
// account ("from": owes less) and puts it on another ("to": owes more), like a
// journal entry: the two sides always match. For customers the station is an
// account too: it writes a balance off (to) or raises one (from). Employees are
// never written off: they pay their shortages (owner decision 2026-09-24).
//
// Each side is posted as its own ledger's row, pointing back at the move:
//   customer owes more -> a credits row, dated today but aged from the shift
//   customer owes less -> a non-cash payment row (payment_type 'adjustment'),
//                         settling the named shift's credits first, then the
//                         oldest; anything beyond what they owe is credit on
//                         their account (they paid it)
//   employee, own shift named -> a correction of that shift's shortage, so
//                         what paid it is worked out again: money they paid
//                         for it becomes their credit for the next shortage
//   employee, otherwise -> an entry of its own: owed, or, off them, money they
//                         paid that was recorded on another employee (their
//                         credit)
// A move between a customer and an employee always names the shift, and the
// employee must be its attendant: it corrects what that drawer was short.
// No money moves: cash reports leave moves out. A move is never edited; a
// wrong one is moved back.

type Trx = Knex.Transaction;
type Conn = Knex | Knex.Transaction;
export type PartyKind = 'customer' | 'employee' | 'station';
type Party = { kind: PartyKind; id: number | null; name: string };
type ShiftRef = { id: number; employee_id: number; shift_date: string } | null;

const cents = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const money = (value: number) => value / 100;
const kes = (value: number) => `KES ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function moveError(message: string, http = 400, code = 'INVALID_BALANCE_MOVE') {
  return Object.assign(new Error(message), { http, code });
}

async function resolveParty(trx: Conn, kind: unknown, id: unknown, side: string): Promise<Party> {
  if (kind === 'station') return { kind: 'station', id: null, name: 'Station' };
  const partyId = Number(id);
  if (!(partyId > 0)) throw moveError(`Choose who the amount moves ${side}.`);
  if (kind === 'customer') {
    const account = await trx('credit_accounts').where({ id: partyId }).whereNull('deleted_at').first();
    if (!account || account.type !== 'customer') throw moveError('Customer not found.', 404);
    if ((account.billing_mode || 'money') !== 'money') {
      throw moveError(
        `${account.name} is an invoice customer: correct their fuel with a credit or debit note on the invoice.`,
      );
    }
    return { kind: 'customer', id: partyId, name: account.name };
  }
  if (kind === 'employee') {
    const employee = await trx('employees').where({ id: partyId }).first('id', 'name');
    if (!employee) throw moveError('Employee not found.', 404);
    return { kind: 'employee', id: partyId, name: employee.name };
  }
  throw moveError(`Choose who the amount moves ${side}.`);
}

export async function parseMove(trx: Conn, body: any) {
  if (!Number.isFinite(Number(body?.amount)) || !(cents(body?.amount) > 0)) throw moveError('Enter an amount above zero.');
  const amount = money(cents(body.amount));
  const reason = String(body?.reason || '').trim();
  if (reason.length < 3) throw moveError('Say why the amount is moved.');
  const from = await resolveParty(trx, body?.from_kind, body?.from_id, 'from');
  const to = await resolveParty(trx, body?.to_kind, body?.to_id, 'to');
  if (from.kind === 'station' && to.kind === 'station') throw moveError('Choose a customer or an employee.');
  if ([from.kind, to.kind].includes('station') && [from.kind, to.kind].includes('employee')) {
    throw moveError('An employee pays their shortages: the station neither writes them off nor adds to them.');
  }
  if (from.kind === to.kind && from.id === to.id) throw moveError('Choose two different accounts.');

  let shift: ShiftRef = null;
  if (body?.shift_id) {
    const row = await trx('shifts').where({ id: Number(body.shift_id) }).first('id', 'status', 'employee_id', 'shift_date');
    if (!row) throw moveError(`Shift #${body.shift_id} not found.`, 404);
    if (row.status !== 'closed') {
      throw moveError(`Shift #${row.id} is not closed: remove the entry on the shift instead.`, 409, 'SHIFT_NOT_CLOSED');
    }
    shift = { id: Number(row.id), employee_id: Number(row.employee_id), shift_date: String(row.shift_date).slice(0, 10) };
  }
  // Between a customer and an employee the money was in that employee's drawer
  // on a shift, so the move corrects that shift: it must be named and theirs.
  const employee = [from, to].find((p) => p.kind === 'employee');
  if (employee && [from, to].some((p) => p.kind === 'customer')) {
    if (!shift) throw moveError('Enter the shift number: a move between a customer and an employee corrects that shift.');
    if (shift.employee_id !== employee.id) {
      throw moveError(`Shift #${shift.id} was not ${employee.name}'s shift. Name the shift they worked.`);
    }
  }
  return { amount, reason: reason.slice(0, 500), from, to, shift };
}

const ownShift = (party: Party, shift: ShiftRef) => Boolean(shift && party.kind === 'employee' && shift.employee_id === party.id);

// What the station may write off for a customer: never more than they owe.
async function writableOff(trx: Trx, party: Party) {
  const credits = await getEligibleMoneyCredits(Number(party.id), trx);
  return money(credits.reduce((sum, c) => sum + cents(c.balance), 0));
}

async function customerOwesMore(trx: Trx, party: Party, amount: number, moveId: number, label: string, originDate: string) {
  const account = await trx('credit_accounts').where({ id: party.id }).first('name', 'phone');
  await trx('credits').insert({
    customer_name: account.name,
    customer_phone: account.phone || null,
    amount,
    balance: amount,
    shift_id: null,
    description: label,
    status: 'outstanding',
    account_id: party.id,
    move_id: moveId,
    origin_date: originDate,
  });
  // Credit they hold on account pays it at once, as at a shift close.
  await applyCustomerCredit(trx, Number(party.id));
  await recomputeAccountBalance(Number(party.id), trx);
}

async function customerOwesLess(
  trx: Trx,
  party: Party,
  amount: number,
  move: { id: number; date: string; label: string },
  shift: ShiftRef,
) {
  const credits = await getEligibleMoneyCredits(Number(party.id), trx);
  // The named shift's credits first (the entry that was wrong), then oldest
  // first. Array sort is stable, so each group keeps its order.
  if (shift) credits.sort((a, b) => Number(Number(b.shift_id) === shift.id) - Number(Number(a.shift_id) === shift.id));
  const payable = credits.reduce((sum, c) => sum + cents(c.balance), 0);
  const applied = Math.min(payable, cents(amount));
  const [paymentId] = await trx('credit_payments').insert({
    credit_id: null,
    account_id: party.id,
    amount,
    payment_method: 'adjustment',
    payment_type: 'adjustment',
    date: move.date,
    notes: move.label,
    status: 'posted',
    unapplied_amount: money(cents(amount) - applied),
    move_id: move.id,
  });
  if (applied > 0) {
    const allocations = await allocateMoneyCredits(trx, credits, money(applied));
    await trx('credit_payment_allocations').insert(
      allocations.map((a) => ({ payment_id: paymentId, credit_id: a.credit_id, amount_applied: a.amount_applied })),
    );
  }
  await recomputeAccountBalance(Number(party.id), trx);
}

async function employeeSide(
  trx: Trx,
  party: Party,
  signedAmount: number,
  counterparty: Party,
  shift: ShiftRef,
  move: { id: number; date: string; label: string; approver: Approver; actorId: number | null },
) {
  const own = ownShift(party, shift);
  const entry = own
    ? { entry_type: 'correction', shift_id: shift!.id, refundable: false }
    : { entry_type: 'move', shift_id: shift?.id ?? null, refundable: signedAmount < 0 };
  await trx('employee_variance_entries').insert({
    employee_id: party.id,
    ...entry,
    entry_date: move.date,
    amount: signedAmount,
    reason: move.label,
    approved_by_employee_id: move.approver.id,
    approved_by_name: move.approver.name,
    created_by_employee_id: move.actorId,
    move_id: move.id,
  });
  await syncVarianceAccount(trx, Number(party.id));
}

export async function postBalanceMove(trx: Trx, body: any, approver: Approver, actorId: number | null) {
  const { amount, reason, from, to, shift } = await parseMove(trx, body);
  if (to.kind === 'station') {
    const owed = await writableOff(trx, from);
    if (cents(amount) > cents(owed)) {
      throw moveError(
        owed > 0
          ? `${from.name} owes ${kes(owed)}, so the station can write off no more than that.`
          : `${from.name} owes nothing for the station to write off.`,
        409,
        'MOVE_EXCEEDS_OWED',
      );
    }
  }
  const date = getKenyaDate();
  const [moveId] = await trx('balance_moves').insert({
    amount,
    posting_date: date,
    reason,
    shift_id: shift?.id ?? null,
    from_kind: from.kind,
    from_id: from.id,
    from_name: from.name,
    to_kind: to.kind,
    to_id: to.id,
    to_name: to.name,
    approved_by_employee_id: approver.id,
    approved_by_name: approver.name,
    created_by_employee_id: actorId,
  });
  const label = `Move #${moveId} from ${from.name} to ${to.name}: ${reason}${shift ? ` (shift #${shift.id})` : ''}`;
  const move = { id: Number(moveId), date, label, approver, actorId };

  if (from.kind === 'customer') await customerOwesLess(trx, from, amount, move, shift);
  if (from.kind === 'employee') await employeeSide(trx, from, -amount, to, shift, move);
  if (to.kind === 'customer') await customerOwesMore(trx, to, amount, move.id, label, shift?.shift_date || date);
  if (to.kind === 'employee') await employeeSide(trx, to, amount, from, shift, move);

  return trx('balance_moves').where({ id: moveId }).first();
}

export async function listBalanceMoves(conn: Conn, filter: { from?: string; to?: string; shiftId?: number } = {}) {
  const query = conn('balance_moves').orderBy('id', 'desc');
  if (filter.shiftId) query.where({ shift_id: filter.shiftId });
  if (filter.from) query.where('posting_date', '>=', filter.from);
  if (filter.to) query.where('posting_date', '<=', filter.to);
  return query;
}

// Everyone a move can name: money customers with what they owe, and employees
// (current ones, and former ones who still have variances).
export async function listMoveParties(conn: Conn) {
  const customers = await conn('credit_accounts')
    .where({ type: 'customer' })
    .whereNull('deleted_at')
    .where((q) => q.whereNull('billing_mode').orWhere('billing_mode', 'money'))
    .orderBy('name')
    .select('id', 'name');
  const employees = await conn('employees')
    .where((q) => q.where('active', true).orWhereIn('id', conn('employee_variance_entries').distinct('employee_id')))
    .orderBy('name')
    .select('id', 'name', 'active');
  return {
    customers: await Promise.all(customers.map(async (c: any) => ({ ...c, owes: await readAccountBalance(Number(c.id), conn as Knex) }))),
    employees: employees.map((e: any) => ({ ...e, active: Boolean(e.active) })),
  };
}

// Customer balances the station wrote off or raised by moves in a period.
// Employees' write-offs are in their variances (written off).
export async function stationMoveTotals(conn: Conn, from: string, to: string) {
  const row = await conn('balance_moves')
    .whereBetween('posting_date', [from, to])
    .select(
      conn.raw("COALESCE(SUM(CASE WHEN from_kind = 'customer' AND to_kind = 'station' THEN amount END), 0) as written_off"),
      conn.raw("COALESCE(SUM(CASE WHEN from_kind = 'station' AND to_kind = 'customer' THEN amount END), 0) as raised"),
    )
    .first();
  return {
    customers_written_off: money(cents((row as any)?.written_off)),
    customers_raised: money(cents((row as any)?.raised)),
  };
}
