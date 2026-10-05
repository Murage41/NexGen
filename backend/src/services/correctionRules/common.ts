import type { Knex } from 'knex';
import { customerCreditBalance, getEligibleMoneyCredits, roundMoney } from '../receivablePayments';

// Shared by the correction rules (services/corrections.ts).

export type Conn = Knex | Knex.Transaction;
export type ShiftRef = { id: number; date: string };

export const httpError = (message: string, http: number, code: string) => Object.assign(new Error(message), { http, code });
export const cents = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
export const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const methodName = (method: unknown) => (method === 'mpesa' ? 'M-Pesa' : 'cash');

// A shift a correction may touch: only a closed one; an open shift's records
// are fixed on the shift itself.
export async function closedShift(conn: Conn, shiftId: unknown, what: string): Promise<ShiftRef> {
  if (!Number(shiftId)) throw httpError('Choose the shift.', 400, 'SHIFT_REQUIRED');
  const shift = await conn('shifts').where({ id: Number(shiftId) }).first('id', 'status', 'shift_date');
  if (!shift) throw httpError(`Shift #${shiftId} not found.`, 404, 'SHIFT_NOT_FOUND');
  if (shift.status !== 'closed') {
    throw httpError(`Shift #${shift.id} is still open: ${what} on the shift itself.`, 409, 'SHIFT_OPEN');
  }
  return { id: Number(shift.id), date: String(shift.shift_date).slice(0, 10) };
}

export const earliest = (...dates: string[]) => [...dates].sort()[0];

export function positiveAmount(value: unknown, message: string) {
  const amount = roundMoney(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(message, 400, 'INVALID_AMOUNT');
  return amount;
}

// A customer who buys on credit and pays money (not an invoice customer).
export async function moneyCustomer(conn: Conn, accountId: unknown) {
  const account = Number(accountId)
    ? await conn('credit_accounts').where({ id: Number(accountId) }).whereNull('deleted_at').first()
    : null;
  if (!account || account.type !== 'customer' || (account.billing_mode || 'money') !== 'money') {
    throw httpError('Choose a credit customer.', 400, 'NOT_MONEY_CUSTOMER');
  }
  return account;
}

type CustomerChange =
  | { removeCredit: any }
  | { addCredit: number }
  | { removePayment: any }
  | { addPayment: number };

// What a credit customer owes and holds as credit now, and after a correction,
// worked out the way posting it will (services/receivablePayments.ts): a
// removed sale lets go of the money that paid it; a removed payment's money
// comes off the sales it paid; then credit held pays what is payable, oldest
// first.
export async function customerOutlook(conn: Conn, accountId: number, changes: CustomerChange[]) {
  const owedRow: any = await conn('credits')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .where('balance', '>', 0)
    .sum({ total: 'balance' })
    .first();
  const owedBefore = cents(owedRow?.total);
  const heldBefore = cents(await customerCreditBalance(accountId, conn));
  let owed = owedBefore;
  let held = heldBefore;
  let payable = (await getEligibleMoneyCredits(accountId, conn)).reduce((sum, c) => sum + cents(c.balance), 0);
  for (const change of changes) {
    if ('removeCredit' in change) {
      const paid: any = await conn('credit_payment_allocations')
        .where({ credit_id: change.removeCredit.id })
        .whereNull('reversed_at')
        .sum({ total: 'amount_applied' })
        .first();
      owed -= cents(change.removeCredit.balance);
      payable -= cents(change.removeCredit.balance);
      held += cents(paid?.total);
    } else if ('addCredit' in change) {
      owed += cents(change.addCredit);
      payable += cents(change.addCredit);
    } else if ('removePayment' in change) {
      const applied: any = await conn('credit_payment_allocations')
        .where({ payment_id: change.removePayment.id })
        .whereNull('reversed_at')
        .sum({ total: 'amount_applied' })
        .first();
      owed += cents(applied?.total);
      payable += cents(applied?.total);
      held -= cents(change.removePayment.unapplied_amount);
    } else {
      held += cents(change.addPayment);
    }
  }
  const settled = Math.max(0, Math.min(held, payable));
  return {
    owed_before: owedBefore / 100,
    held_before: heldBefore / 100,
    owed: (owed - settled) / 100,
    held: (held - settled) / 100,
  };
}

export function outlookText(name: string, outlook: Awaited<ReturnType<typeof customerOutlook>>) {
  const held = (value: number) => (value > 0 ? ` (holding ${kes(value)} as credit)` : '');
  return `${name} owes ${kes(outlook.owed_before)}${held(outlook.held_before)} now; ${kes(outlook.owed)}${held(outlook.held)} after this correction.`;
}

// A sale removed by a correction lets go of the money that paid it: that money
// becomes credit held on the payments it came from, to pay the customer's other
// debts (applyCustomerCredit).
export async function releaseCreditAllocations(trx: Knex.Transaction, creditId: number, at: string) {
  const allocations = await trx('credit_payment_allocations').where({ credit_id: creditId }).whereNull('reversed_at');
  for (const allocation of allocations) {
    await trx('credit_payment_allocations').where({ id: allocation.id }).update({ reversed_at: at });
    const payment = await trx('credit_payments').where({ id: allocation.payment_id }).first('unapplied_amount');
    await trx('credit_payments')
      .where({ id: allocation.payment_id })
      .update({ unapplied_amount: roundMoney(Number(payment?.unapplied_amount || 0) + Number(allocation.amount_applied)) });
  }
}

// The correction that later changed a record a correction made, for messages.
export async function laterCorrection(conn: Conn, correctionId: unknown) {
  if (!correctionId) return '';
  const later = await conn('corrections').where({ id: Number(correctionId) }).first('number');
  return later ? ` by ${later.number}` : '';
}
