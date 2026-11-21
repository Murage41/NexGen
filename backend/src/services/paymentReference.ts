import type { Knex } from 'knex';

// Transaction codes on payments (update #28). A payment by M-Pesa, bank or
// cheque carries the code from the M-Pesa message or bank slip: it is what the
// owner matches against the statement, and the same code twice is the usual
// sign of one payment entered twice. Cash needs none. One rule for every
// payment table, so each form behaves the same.

type Conn = Knex | Knex.Transaction;

const httpError = (message: string, http: number, code: string) => Object.assign(new Error(message), { http, code });

const CODE_METHODS: Record<string, string> = {
  mpesa: 'M-Pesa code',
  bank: 'bank reference',
  bank_transfer: 'bank reference',
  cheque: 'cheque number',
};

export const needsCode = (method: unknown) => Object.prototype.hasOwnProperty.call(CODE_METHODS, String(method || ''));

// The code to store: capitals, no spaces. Required for M-Pesa, bank and
// cheque; an M-Pesa code is 10 letters and digits. Cash keeps no code.
export function paymentCode(method: unknown, reference: unknown): string | null {
  const code = String(reference ?? '').replace(/\s+/g, '').toUpperCase();
  if (!needsCode(method)) return null;
  const label = CODE_METHODS[String(method)];
  if (!code) throw httpError(`Enter the ${label}.`, 400, 'PAYMENT_CODE_REQUIRED');
  if (method === 'mpesa' && !/^[A-Z0-9]{10}$/.test(code)) {
    throw httpError('An M-Pesa code is 10 letters and digits, like SKL4ABCD12.', 400, 'PAYMENT_CODE_INVALID');
  }
  if (code.length > 60) throw httpError(`That ${label} is too long.`, 400, 'PAYMENT_CODE_INVALID');
  return code;
}

// Live payments in every table that holds a code. A reversed or removed
// payment frees its code, so a corrected re-entry can use it.
export const PAYMENT_TABLES = {
  credit_payments: { method: 'payment_method', live: (q: Knex.QueryBuilder) => q.whereNull('deleted_at').where((w) => w.whereNull('status').orWhere('status', 'posted')) },
  invoice_payments: { method: 'payment_method', live: (q: Knex.QueryBuilder) => q.whereNull('deleted_at').where((w) => w.whereNull('status').orWhere('status', 'posted')) },
  supplier_payments: { method: 'payment_method', live: (q: Knex.QueryBuilder) => q.whereNull('deleted_at') },
  payroll_payments: { method: 'payment_method', live: (q: Knex.QueryBuilder) => q.where((w) => w.whereNull('status').orWhere('status', 'posted')) },
  customer_refunds: { method: 'method', live: (q: Knex.QueryBuilder) => q.where((w) => w.whereNull('status').orWhere('status', 'posted')) },
} as const;
export type PaymentTable = keyof typeof PAYMENT_TABLES;

export async function assertCodeUnused(conn: Conn, code: string | null, except?: { table: PaymentTable; id: number }) {
  if (!code) return;
  for (const [table, spec] of Object.entries(PAYMENT_TABLES) as Array<[PaymentTable, (typeof PAYMENT_TABLES)[PaymentTable]]>) {
    if (!(await conn.schema.hasTable(table))) continue; // a test database built with fewer tables
    const query = spec.live(conn(table).whereRaw('UPPER(REPLACE(reference, \' \', \'\')) = ?', [code]));
    if (except && except.table === table) query.whereNot('id', except.id);
    const used = await query.first('id');
    if (used) throw httpError(`Code ${code} is already on another payment. Check it was not entered twice.`, 409, 'PAYMENT_CODE_USED');
  }
}

// Both checks, for a payment about to be recorded.
export async function checkedPaymentCode(conn: Conn, method: unknown, reference: unknown) {
  const code = paymentCode(method, reference);
  await assertCodeUnused(conn, code);
  return code;
}

// An older M-Pesa, bank or cheque payment recorded without a code gets one,
// once. Only the code is written: the amount, date and shift never change.
export async function addMissingCode(conn: Knex, table: PaymentTable, id: number, reference: unknown) {
  const spec = PAYMENT_TABLES[table];
  if (!spec) throw httpError('Unknown payment.', 400, 'PAYMENT_NOT_FOUND');
  return conn.transaction(async (trx) => {
    const payment = await spec.live(trx(table).where({ id })).first();
    if (!payment) throw httpError('Payment not found.', 404, 'PAYMENT_NOT_FOUND');
    const method = payment[spec.method];
    if (!needsCode(method)) throw httpError('A cash payment has no code.', 400, 'PAYMENT_CODE_NOT_NEEDED');
    if (String(payment.reference || '').trim()) throw httpError('This payment already has its code.', 409, 'PAYMENT_CODE_SET');
    const code = paymentCode(method, reference)!;
    await assertCodeUnused(trx, code, { table, id });
    await trx(table).where({ id }).update({ reference: code });
    return { table, id, reference: code };
  });
}
