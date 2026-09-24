import type { Knex } from 'knex';
import { getKenyaDate } from '../utils/timezone';
import { positiveMoney, settlementError } from './employeeDebt';

// Attendant shortages (owner decision 2026-09-24): an employee owes the
// shortages of the shifts they ran and pays them. That is all.
// See docs/ATTENDANT-VARIANCES.md.
//
// - A shift's shortage is owed. A shift's surplus is recorded (the report
//   shows it) but belongs to the station: it never pays a shortage.
// - The employee pays in money (cash, M-Pesa, bank), oldest shortage first.
//   There are no write-offs and no paying back.
// - If a shortage later turns out smaller (a balance move on their own shift)
//   after they paid it, what they paid is their credit: it pays their next
//   shortage automatically.
// - Entries (employee_variance_entries) are never edited; a mistaken payment
//   is marked reversed. Nothing stores a balance: computeVarianceStatement
//   derives it from the entries on every read. Write-offs and paybacks made
//   before this decision stay in the history and still count.

type Conn = Knex | Knex.Transaction;
type Trx = Knex.Transaction;

export const VARIANCE_REPAYMENT_METHODS = ['cash', 'mpesa', 'bank_transfer'] as const;

export type VarianceEntry = {
  id: number;
  employee_id: number;
  entry_type: string;
  entry_date: string;
  amount: number;
  refundable?: boolean | number | null;
  shift_id?: number | null;
  shift_date?: string | null;
  payment_id?: number | null;
  correction_id?: number | null;
  method?: string | null;
  reference?: string | null;
  reason?: string | null;
  details?: any;
  legacy_source?: string | null;
  approved_by_name?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
  status?: string | null;
};

const toCents = (value: unknown) => Math.round(Number(value || 0) * 100);
const toMoney = (cents: number) => cents / 100;
const kes = (value: number) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// What paid a shortage, in cents while computing.
type Covered = {
  repaid: number; // money the employee paid (cash, M-Pesa, bank)
  moved: number; // moved off them by a balance move
  recovered_before: number; // old system: recovered before the ledger started
  cleared_before: number; // old system: cleared before the ledger started
  waived: number; // written off before write-offs were removed (history)
};
const emptyCovered = (): Covered => ({ repaid: 0, moved: 0, recovered_before: 0, cleared_before: 0, waived: 0 });

type Owner = { covered: Covered; charges: Charge[] };
type Charge = { owner: Owner; remaining: number };
type RowState = Owner & {
  shift_id: number;
  date: string;
  seq: number;
  amount: number;
  closed: number;
  entries: VarianceEntry[];
  legacy: EventState[];
};
type EventState = Owner & { entry: VarianceEntry; applied: number; unused: number };
// The employee's money that pays nothing yet (paid more than a shortage turned
// out to be): it pays their next shortage automatically.
type CreditItem = { owner: EventState; remaining: number; kind: 'repaid' | 'recovered_before' | 'moved' };

export type VarianceRow = ReturnType<typeof rowView>;
export type VarianceStatement = ReturnType<typeof computeVarianceStatement>;

function rowView(row: RowState) {
  const owed = row.charges.reduce((sum, c) => sum + c.remaining, 0);
  const covered = row.covered;
  const paid = covered.repaid + covered.moved + covered.recovered_before + covered.cleared_before + covered.waived;
  const corrections = row.entries.filter((e) => e.entry_type === 'correction');
  return {
    shift_id: row.shift_id,
    date: row.date,
    // The shortage on the shift (after any correction), and as it closed.
    shortage: toMoney(Math.max(0, row.amount)),
    closed_shortage: toMoney(Math.max(0, row.closed)),
    corrected: corrections.length > 0,
    corrections: corrections.map((e) => ({
      id: e.id,
      correction_id: e.correction_id ?? null,
      date: e.entry_date,
      change: toMoney(toCents(e.amount)),
      reason: e.reason || null,
    })),
    paid: toMoney(paid),
    paid_by: {
      repaid: toMoney(covered.repaid),
      moved: toMoney(covered.moved),
      recovered_before: toMoney(covered.recovered_before),
      cleared_before: toMoney(covered.cleared_before),
      waived: toMoney(covered.waived),
    },
    owed: toMoney(owed),
    status: owed > 0 ? 'open' : 'settled',
    before_ledger: row.legacy.length > 0 || row.entries.some((e) => Boolean(e.legacy_source)),
    legacy: row.legacy.map((ev) => ({
      id: ev.entry.id,
      amount: toMoney(toCents(ev.entry.amount)),
      reason: ev.entry.reason || null,
      details: ev.entry.details ?? null,
    })),
  };
}

function eventView(ev: EventState) {
  const e = ev.entry;
  const owed = ev.charges.reduce((sum, c) => sum + c.remaining, 0);
  return {
    id: e.id,
    type: e.entry_type,
    date: e.entry_date,
    amount: Math.abs(toMoney(toCents(e.amount))),
    shift_id: e.shift_id ?? null,
    payment_id: e.payment_id ?? null,
    method: e.method || null,
    reference: e.reference || null,
    reason: e.reason || null,
    approved_by_name: e.approved_by_name || null,
    created_by_name: e.created_by_name || null,
    created_at: e.created_at || null,
    // Payments: how much of it paid shortages, and what it paid nothing of.
    applied: toMoney(ev.applied),
    unused: toMoney(ev.unused),
    // Amounts owed that are not a shift (a move onto them): what is still owed.
    owed: toMoney(owed),
  };
}

// Pure: one employee's shortages and payments as of a date. Entries of other
// employees must not be passed in.
export function computeVarianceStatement(input: VarianceEntry[], asOf: string) {
  const rows = new Map<number, RowState>();
  const events: EventState[] = [];
  const newEvent = (entry: VarianceEntry): EventState => ({
    entry, applied: 0, unused: 0, covered: emptyCovered(), charges: [],
  });
  const rowFor = (entry: VarianceEntry) => {
    const id = Number(entry.shift_id);
    let row = rows.get(id);
    if (!row) {
      row = {
        shift_id: id,
        date: String(entry.shift_date || entry.entry_date).slice(0, 10),
        seq: Number(entry.id),
        amount: 0,
        closed: 0,
        entries: [],
        legacy: [],
        covered: emptyCovered(),
        charges: [],
      };
      rows.set(id, row);
    }
    row.seq = Math.min(row.seq, Number(entry.id));
    return row;
  };

  for (const entry of input) {
    if ((entry.status || 'posted') !== 'posted') continue;
    if ((entry.entry_type === 'shift' || entry.entry_type === 'correction') && entry.shift_id) {
      const row = rowFor(entry);
      row.amount += toCents(entry.amount);
      if (entry.entry_type === 'shift') row.closed += toCents(entry.amount);
      row.entries.push(entry);
    } else if (entry.entry_type === 'legacy_kept') {
      // A surplus the old system kept: surpluses are the station's anyway.
    } else if (entry.entry_type === 'legacy_settlement' && entry.shift_id) {
      rowFor(entry).legacy.push(newEvent(entry));
    } else {
      events.push(newEvent(entry));
    }
  }

  const charges: Charge[] = [];
  let credit: CreditItem[] = [];
  const prune = () => {
    for (let i = charges.length - 1; i >= 0; i -= 1) if (charges[i].remaining <= 0) charges.splice(i, 1);
    credit = credit.filter((item) => item.remaining > 0);
  };
  // Pays charges oldest first; returns what it paid.
  const payCharges = (targets: Charge[], amount: number, kind: keyof Covered) => {
    let left = amount;
    for (const charge of targets) {
      if (left <= 0) break;
      const take = Math.min(charge.remaining, left);
      if (take <= 0) continue;
      charge.remaining -= take;
      charge.owner.covered[kind] += take;
      left -= take;
    }
    prune();
    return amount - left;
  };
  // Something is owed: the employee's credit pays it first; the rest is owed.
  const addCharge = (owner: Owner, amount: number) => {
    let left = amount;
    for (const item of credit) {
      if (left <= 0) break;
      const take = Math.min(item.remaining, left);
      item.remaining -= take;
      item.owner.applied += take;
      owner.covered[item.kind] += take;
      left -= take;
    }
    prune();
    if (left > 0) {
      const charge = { owner, remaining: left };
      charges.push(charge);
      owner.charges.push(charge);
    }
  };
  // A payment pays charges; what is left of money the employee handed over is
  // their credit. Anything else left simply pays nothing.
  const pay = (ev: EventState, targets: Charge[], amount: number, kind: keyof Covered, money: boolean) => {
    const used = payCharges(targets, amount, kind);
    ev.applied += used;
    const left = amount - used;
    if (left <= 0) return;
    if (money && kind !== 'cleared_before' && kind !== 'waived') credit.push({ owner: ev, remaining: left, kind });
    else ev.unused += left;
  };

  // Oldest first by business date; on the same date, in the order recorded.
  type Item = { date: string; seq: number; row?: RowState; event?: EventState };
  const items: Item[] = [
    ...[...rows.values()].map((row) => ({ date: row.date, seq: row.seq, row })),
    ...events.map((event) => ({ date: String(event.entry.entry_date).slice(0, 10), seq: Number(event.entry.id), event })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);

  for (const item of items) {
    if (item.row) {
      const row = item.row;
      // A shortage is owed. A surplus is the station's and pays nothing.
      if (row.amount > 0) addCharge(row, row.amount);
      // What the old debt system did about this shift: what it cleared, what
      // the employee handed over, then anything it still charged.
      const order = (ev: EventState) => (toCents(ev.entry.amount) > 0 ? 3 : ev.entry.refundable ? 2 : 1);
      for (const ev of [...row.legacy].sort((a, b) => order(a) - order(b) || a.entry.id - b.entry.id)) {
        const amount = toCents(ev.entry.amount);
        if (amount < 0) {
          const money = Boolean(ev.entry.refundable);
          pay(ev, row.charges, -amount, money ? 'recovered_before' : 'cleared_before', money);
        } else if (amount > 0) {
          addCharge(row, amount);
        }
      }
      continue;
    }

    const ev = item.event!;
    const amount = toCents(ev.entry.amount);
    switch (ev.entry.entry_type) {
      case 'repayment':
      case 'legacy_owed_back':
        pay(ev, charges, -amount, 'repaid', true);
        break;
      case 'move':
        // A balance move between employees (services/balanceMoves.ts). Onto
        // them: owed. Off them: money they paid, recorded on someone else.
        if (amount > 0) addCharge(ev, amount);
        else if (amount < 0) pay(ev, charges, -amount, 'moved', Boolean(ev.entry.refundable));
        break;
      case 'waiver': {
        // History: a write-off recorded before write-offs were removed.
        const target = ev.entry.shift_id ? rows.get(Number(ev.entry.shift_id)) : null;
        pay(ev, target ? target.charges : charges, -amount, 'waived', false);
        break;
      }
      default:
        // History (money paid back, an old repayment reversed), and anything
        // newer this code doesn't know: an amount owed is owed, a credit pays.
        if (amount > 0) addCharge(ev, amount);
        else if (amount < 0) pay(ev, charges, -amount, 'waived', false);
    }
  }

  const owes = charges.reduce((sum, c) => sum + c.remaining, 0);
  const creditLeft = credit.reduce((sum, item) => sum + item.remaining, 0);
  // Only shifts that had a shortage are the employee's; a surplus is the station's.
  const rowViews = [...rows.values()]
    .filter((row) => row.amount > 0 || row.closed > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq)
    .map(rowView);
  return {
    as_of: asOf,
    rows: rowViews,
    events: events
      .sort((a, b) => String(b.entry.entry_date).localeCompare(String(a.entry.entry_date)) || b.entry.id - a.entry.id)
      .map(eventView),
    totals: {
      owes: toMoney(owes),
      // Money they paid that pays nothing yet: it pays their next shortage.
      credit: toMoney(creditLeft),
      // Positive: the employee owes this. Negative: their credit.
      net: toMoney(owes - creditLeft),
    },
  };
}

// ---------------------------------------------------------------- reading --

function hydrate(row: any): VarianceEntry {
  let details = row.details;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      details = null;
    }
  }
  return {
    ...row,
    amount: Number(row.amount),
    refundable: Boolean(row.refundable),
    details,
    shift_date: row.shift_date ? String(row.shift_date).slice(0, 10) : null,
    entry_date: String(row.entry_date).slice(0, 10),
  };
}

// Posted entries, or as they stood at the end of asOf: entries dated after it
// left out, and entries reversed after it counted as posted.
export async function loadVarianceEntries(conn: Conn, filter: { employeeId?: number; asOf?: string } = {}) {
  let query = conn('employee_variance_entries as v')
    .leftJoin('shifts as s', 'v.shift_id', 's.id')
    .leftJoin('employees as creator', 'v.created_by_employee_id', 'creator.id')
    .select('v.*', 's.shift_date', 'creator.name as created_by_name');
  if (filter.employeeId) query = query.where('v.employee_id', filter.employeeId);
  if (filter.asOf) {
    const asOf = filter.asOf;
    query = query
      .where('v.entry_date', '<=', asOf)
      .where((q) => {
        q.where('v.status', 'posted').orWhere((r) => {
          r.where('v.status', 'reversed').whereRaw("date(v.reversed_at, '+3 hours') > ?", [asOf]);
        });
      });
  } else {
    query = query.where('v.status', 'posted');
  }
  const rows = await query.orderBy('v.id');
  return rows.map((row: any) => hydrate({ ...row, status: 'posted' }));
}

export async function varianceStartDate(conn: Conn): Promise<string | null> {
  if (!(await conn.schema.hasTable('operational_settings'))) return null;
  const row = await conn('operational_settings').where({ key: 'variance_ledger_started_on' }).first('value');
  return row?.value || null;
}

export async function getVarianceStatement(conn: Conn, employeeId: number, options: { asOf?: string } = {}) {
  const employee = await conn('employees').where({ id: employeeId }).first('id', 'name', 'active');
  if (!employee) throw settlementError('Employee not found.', 404);
  const asOf = options.asOf || getKenyaDate();
  const entries = await loadVarianceEntries(conn, { employeeId, asOf: options.asOf });
  return {
    employee: { id: Number(employee.id), name: employee.name, active: Boolean(employee.active) },
    started_on: await varianceStartDate(conn),
    ...computeVarianceStatement(entries, asOf),
  };
}

// Totals for every employee with entries, as of a date (default today).
export async function getVarianceTotals(conn: Conn, options: { asOf?: string } = {}) {
  const asOf = options.asOf || getKenyaDate();
  const entries = await loadVarianceEntries(conn, { asOf: options.asOf });
  const byEmployee = new Map<number, VarianceEntry[]>();
  for (const entry of entries) {
    const id = Number(entry.employee_id);
    byEmployee.set(id, [...(byEmployee.get(id) || []), entry]);
  }
  const totals = new Map<number, VarianceStatement['totals']>();
  for (const [id, list] of byEmployee) totals.set(id, computeVarianceStatement(list, asOf).totals);
  return totals;
}

export async function totalOwedByAttendants(conn: Conn, options: { asOf?: string } = {}) {
  let owes = 0;
  for (const totals of (await getVarianceTotals(conn, options)).values()) owes += toCents(totals.owes);
  return toMoney(owes);
}

// Shortages still owed on the given shifts, as of today (daily and monthly
// "unrecovered losses").
export async function owedOnShifts(conn: Conn, shiftIds: number[]) {
  if (!shiftIds.length) return 0;
  const employeeIds = await conn('employee_variance_entries')
    .whereIn('shift_id', shiftIds)
    .distinct('employee_id')
    .pluck('employee_id');
  const wanted = new Set(shiftIds.map(Number));
  let owed = 0;
  for (const employeeId of employeeIds) {
    const statement = computeVarianceStatement(await loadVarianceEntries(conn, { employeeId: Number(employeeId) }), getKenyaDate());
    for (const row of statement.rows) if (wanted.has(row.shift_id)) owed += toCents(row.owed);
  }
  return toMoney(owed);
}

// Activity in a period for reports: shortages of shifts in it (surpluses too,
// for the station), corrections, moves and payments posted in it, old
// write-offs and paybacks (history), and what attendants owed at its end.
export async function varianceActivity(conn: Conn, from: string, to: string) {
  const entries = await loadVarianceEntries(conn, { asOf: to });
  const inPeriod = (date: string | null | undefined) => Boolean(date) && String(date) >= from && String(date) <= to;
  let shortages = 0;
  let surpluses = 0;
  let corrections = 0;
  let moved = 0;
  let repaid = 0;
  let waived = 0;
  let refunded = 0;
  for (const e of entries) {
    const amount = toCents(e.amount);
    if (!inPeriod(e.entry_date)) continue;
    if (e.entry_type === 'shift' && !e.legacy_source) {
      if (amount > 0) shortages += amount;
      else surpluses -= amount;
    }
    if (e.entry_type === 'correction') corrections += amount;
    if (e.entry_type === 'move') moved += amount;
    if (e.entry_type === 'repayment') repaid -= amount;
    if (e.entry_type === 'waiver') waived -= amount;
    if (e.entry_type === 'refund') refunded += amount;
  }
  const byEmployee = new Map<number, VarianceEntry[]>();
  for (const entry of entries) {
    byEmployee.set(Number(entry.employee_id), [...(byEmployee.get(Number(entry.employee_id)) || []), entry]);
  }
  let owedAtEnd = 0;
  for (const list of byEmployee.values()) owedAtEnd += toCents(computeVarianceStatement(list, to).totals.owes);
  return {
    shortages: toMoney(shortages),
    // Surpluses belong to the station; they never pay a shortage.
    surpluses: toMoney(surpluses),
    // Positive: corrections and moves on their own shifts added to what is owed.
    corrections: toMoney(corrections),
    // Other balance moves onto employees (services/balanceMoves.ts); negative: off them.
    moved: toMoney(moved),
    repaid: toMoney(repaid),
    // History only: write-offs and paybacks recorded before 24 Sep 2026.
    waived: toMoney(waived),
    refunded: toMoney(refunded),
    owed_at_end: toMoney(owedAtEnd),
  };
}

// Refunds paid to employees in a period, by method (cash flow).
export async function varianceRefundsPaid(conn: Conn, from: string, to: string) {
  const rows = await conn('employee_variance_entries')
    .where({ entry_type: 'refund', status: 'posted' })
    .whereBetween('entry_date', [from, to])
    .select('method')
    .sum({ total: 'amount' })
    .groupBy('method');
  const byMethod: Record<string, number> = {};
  let total = 0;
  for (const row of rows as any[]) {
    byMethod[row.method || 'cash'] = toMoney(toCents(row.total));
    total += toCents(row.total);
  }
  return { total: toMoney(total), by_method: byMethod };
}

// ---------------------------------------------------------------- writing --

// The account a repayment's cash record is kept against. Employees are not
// customers: these accounts never appear on Credits.
export async function ensureRepaymentAccount(trx: Trx, employeeId: number) {
  const existing = await trx('credit_accounts').where({ employee_id: employeeId, type: 'employee' }).first();
  if (existing) return existing;
  const employee = await trx('employees').where({ id: employeeId }).first('name');
  if (!employee) throw settlementError('Employee not found.', 404);
  const [id] = await trx('credit_accounts').insert({
    employee_id: employeeId,
    type: 'employee',
    name: employee.name,
    balance: 0,
  });
  return trx('credit_accounts').where({ id }).first();
}

// Keeps the old account figure equal to what is owed, for anything still
// reading it.
export async function syncVarianceAccount(trx: Conn, employeeId: number) {
  const statement = computeVarianceStatement(await loadVarianceEntries(trx, { employeeId }), getKenyaDate());
  await trx('credit_accounts')
    .where({ employee_id: employeeId, type: 'employee' })
    .update({ balance: statement.totals.owes });
  return statement.totals;
}

export async function postShiftVariance(
  trx: Trx,
  shift: { id: number; employee_id: number; shift_date: string },
  variance: number,
  actorId: number | null,
) {
  if (toCents(variance) === 0) return null;
  const [id] = await trx('employee_variance_entries').insert({
    employee_id: shift.employee_id,
    entry_type: 'shift',
    entry_date: String(shift.shift_date).slice(0, 10),
    amount: toMoney(-toCents(variance)),
    shift_id: shift.id,
    reason: 'Variance when the shift closed',
    created_by_employee_id: actorId,
  });
  await syncVarianceAccount(trx, shift.employee_id);
  return Number(id);
}

function validDate(value: unknown) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw settlementError('Enter a valid date.', 400);
  }
  if (date > getKenyaDate()) throw settlementError('The date cannot be in the future.', 400);
  return date;
}

// A repayment's cash record (credit_payments, counted by the drawer when taken
// on an open shift, and by cash flow otherwise) plus its variance entry.
export async function recordVarianceRepayment(
  trx: Trx,
  employeeId: number,
  input: {
    amount: unknown;
    payment_method: unknown;
    date: unknown;
    reference?: unknown;
    notes?: unknown;
    shift_id?: unknown;
  },
  actorId: number | null,
  links: { correctionOfId?: number | null; correctionId?: number | null; allowBeyondOwed?: boolean } = {},
) {
  const amount = positiveMoney(input.amount);
  const method = String(input.payment_method || '');
  if (!(VARIANCE_REPAYMENT_METHODS as readonly string[]).includes(method)) {
    throw settlementError('Choose cash, M-Pesa or bank transfer.', 400);
  }
  const date = validDate(input.date);
  const reference = String(input.reference || '').trim().slice(0, 100);
  // A correction's replacement keeps the original's notes instead.
  if (method !== 'cash' && !reference && !links.correctionId) {
    throw settlementError('Enter the M-Pesa or bank reference.', 400);
  }
  const notes = String(input.notes || '').trim().slice(0, 500);
  const shiftId = input.shift_id ? Number(input.shift_id) : null;
  if (shiftId && !links.correctionId) {
    const shift = await trx('shifts').where({ id: shiftId, status: 'open' }).first();
    if (!shift || !['cash', 'mpesa'].includes(method)) {
      throw settlementError('Money taken into a drawer needs an open shift and cash or M-Pesa.');
    }
    if (String(shift.shift_date).slice(0, 10) !== date) {
      throw settlementError('The repayment date must be the date of the shift receiving it.');
    }
  }
  const statement = await getVarianceStatement(trx, employeeId);
  if (!links.allowBeyondOwed && toCents(amount) > toCents(statement.totals.owes)) {
    throw settlementError(
      statement.totals.owes > 0
        ? `${statement.employee.name} owes ${kes(statement.totals.owes)}. A repayment can't be more than that.`
        : `${statement.employee.name} owes nothing.`,
      409,
    );
  }
  const account = await ensureRepaymentAccount(trx, employeeId);
  const [paymentId] = await trx('credit_payments').insert({
    account_id: account.id,
    credit_id: null,
    amount,
    payment_method: method,
    payment_type: 'staff_debt',
    date,
    shift_id: shiftId,
    notes: [reference, notes].filter(Boolean).join(': ') || null,
    status: 'posted',
    created_by_employee_id: actorId,
    ...(links.correctionOfId ? { correction_of_id: links.correctionOfId } : {}),
    ...(links.correctionId ? { created_by_correction_id: links.correctionId } : {}),
  });
  await trx('employee_variance_entries').insert({
    employee_id: employeeId,
    entry_type: 'repayment',
    entry_date: date,
    amount: toMoney(-toCents(amount)),
    refundable: true,
    shift_id: shiftId,
    payment_id: paymentId,
    method,
    reference: reference || null,
    reason: notes || null,
    created_by_employee_id: actorId,
  });
  await syncVarianceAccount(trx, employeeId);
  return trx('credit_payments').where({ id: paymentId }).first();
}

// Reverses a repayment's cash record and its variance entry. A repayment made
// before variances started has no entry of its own (it is inside the carried-
// over balances), so undoing it is charged back as a new entry.
export async function reverseVarianceRepayment(
  trx: Trx,
  paymentId: number,
  input: { reason: string; actorId: number | null; correctionId?: number | null },
) {
  const payment = await trx('credit_payments').where({ id: paymentId, payment_type: 'staff_debt' }).first();
  if (!payment || (payment.status || 'posted') !== 'posted') {
    throw settlementError('Repayment is missing or already reversed.');
  }
  const account = await trx('credit_accounts').where({ id: payment.account_id }).first();
  const employeeId = Number(account?.employee_id);
  if (!employeeId) throw settlementError('This repayment has no employee.', 409);
  const now = new Date().toISOString();
  await trx('credit_payments').where({ id: paymentId }).update({
    status: 'reversed',
    reversed_at: now,
    reversal_reason: input.reason,
    reversed_by_employee_id: input.actorId,
    ...(input.correctionId ? { reversed_by_correction_id: input.correctionId } : {}),
  });
  const entry = await trx('employee_variance_entries')
    .where({ payment_id: paymentId, entry_type: 'repayment', status: 'posted' })
    .first();
  if (entry) {
    await trx('employee_variance_entries').where({ id: entry.id }).update({
      status: 'reversed',
      reversed_at: now,
      reversed_by_employee_id: input.actorId,
      reversal_reason: input.reason,
      reversed_by_correction_id: input.correctionId ?? null,
    });
  } else {
    await trx('employee_variance_entries').insert({
      employee_id: employeeId,
      entry_type: 'legacy_reversal',
      entry_date: getKenyaDate(),
      amount: Number(payment.amount),
      payment_id: paymentId,
      shift_id: payment.shift_id || null,
      correction_id: input.correctionId ?? null,
      reason: `Repayment of ${kes(Number(payment.amount))} on ${String(payment.date).slice(0, 10)} reversed: ${input.reason}`,
      created_by_employee_id: input.actorId,
    });
  }
  await syncVarianceAccount(trx, employeeId);
  return { employee_id: employeeId };
}

// Old-system recoveries undone after variances started (a voided payroll
// deduction, a cancelled shift's wage recovery): owed again, as a new entry.
export async function chargeLegacyReversal(
  trx: Trx,
  input: { employeeId: number; amount: number; reason: string; shiftId?: number | null; actorId?: number | null; source: string },
) {
  if (toCents(input.amount) <= 0) return null;
  const [id] = await trx('employee_variance_entries').insert({
    employee_id: input.employeeId,
    entry_type: 'legacy_reversal',
    entry_date: getKenyaDate(),
    amount: toMoney(toCents(input.amount)),
    shift_id: input.shiftId ?? null,
    reason: input.reason,
    legacy_source: input.source,
    created_by_employee_id: input.actorId ?? null,
  });
  await syncVarianceAccount(trx, input.employeeId);
  return Number(id);
}
