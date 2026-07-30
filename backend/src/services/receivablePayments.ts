import type { Knex } from 'knex';
import { recomputeAccountBalance } from './accountBalance';

type DbConnection = Knex | Knex.Transaction;

export type MoneyPaymentInput = {
  accountId: number;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  notes?: string | null;
  shiftId?: number | null;
};

export type InvoicePaymentInput = {
  accountId: number;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  reference?: string | null;
  notes?: string | null;
};

export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function toCents(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100);
}

function fromCents(value: number): number {
  return value / 100;
}

function httpError(message: string, http: number, code?: string): Error {
  return Object.assign(new Error(message), { http, code });
}

function validatePositiveMoney(amount: number): number {
  const normalized = roundMoney(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw httpError('Amount must be a positive number', 400, 'INVALID_PAYMENT_AMOUNT');
  }
  return normalized;
}

export async function recomputeInvoiceTotals(
  invoiceId: number,
  trx: DbConnection,
): Promise<void> {
  const linesRow = await trx('invoice_lines')
    .where({ invoice_id: invoiceId })
    .sum('line_total as total')
    .first();
  const totalCents = toCents(Number((linesRow as any)?.total || 0));

  const paidRow = await trx('invoice_payment_allocations')
    .where({ invoice_id: invoiceId })
    .sum('amount_applied as total')
    .first();
  const paidCents = toCents(Number((paidRow as any)?.total || 0));

  if (paidCents > totalCents) {
    throw httpError(
      `Invoice ${invoiceId} has payments exceeding its total. Run the receivables integrity audit before continuing.`,
      409,
      'INVOICE_OVERALLOCATED',
    );
  }

  const current = await trx('customer_invoices').where({ id: invoiceId }).first();
  if (!current) {
    throw httpError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
  }

  const balanceCents = totalCents - paidCents;
  let nextStatus = current.status;
  if (current.status !== 'draft' && current.status !== 'void') {
    if (paidCents === totalCents && totalCents > 0) nextStatus = 'paid';
    else if (paidCents > 0) nextStatus = 'partial';
    else nextStatus = 'issued';
  }

  await trx('customer_invoices').where({ id: invoiceId }).update({
    total_amount: fromCents(totalCents),
    balance: fromCents(balanceCents),
    status: nextStatus,
  });
}

async function getOpenInvoiceRows(accountId: number, trx: DbConnection): Promise<any[]> {
  return trx('customer_invoices')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .whereIn('status', ['issued', 'partial'])
    .where('balance', '>', 0)
    .orderBy('issue_date', 'asc')
    .orderBy('id', 'asc')
    .select('id', 'invoice_number', 'balance');
}

export async function getInvoiceOutstandingBalance(
  accountId: number,
  trx: DbConnection,
): Promise<number> {
  const row = await trx('customer_invoices')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .whereIn('status', ['issued', 'partial'])
    .sum('balance as total')
    .first();
  return fromCents(toCents(Number((row as any)?.total || 0)));
}

async function allocateInvoicePayment(
  trx: Knex.Transaction,
  paymentId: number,
  invoiceRows: any[],
  amount: number,
) {
  let remainingCents = toCents(amount);
  const allocations: Array<{
    invoice_id: number;
    invoice_number: string;
    amount_applied: number;
  }> = [];

  for (const invoice of invoiceRows) {
    if (remainingCents === 0) break;
    const balanceCents = toCents(Number(invoice.balance || 0));
    if (balanceCents <= 0) continue;

    const appliedCents = Math.min(remainingCents, balanceCents);
    const amountApplied = fromCents(appliedCents);
    await trx('invoice_payment_allocations').insert({
      payment_id: paymentId,
      invoice_id: invoice.id,
      amount_applied: amountApplied,
    });
    await recomputeInvoiceTotals(invoice.id, trx);
    allocations.push({
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      amount_applied: amountApplied,
    });
    remainingCents -= appliedCents;
  }

  if (remainingCents !== 0) {
    throw httpError(
      'The payment could not be allocated completely. Refresh the account and try again.',
      409,
      'PAYMENT_ALLOCATION_INCOMPLETE',
    );
  }

  return allocations;
}

export async function recordInvoicePayment(conn: Knex, input: InvoicePaymentInput) {
  const amount = validatePositiveMoney(input.amount);

  return conn.transaction(async (trx) => {
    const account = await trx('credit_accounts')
      .where({ id: input.accountId })
      .whereNull('deleted_at')
      .first();
    if (!account) throw httpError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
    if (account.type !== 'customer' || account.billing_mode !== 'invoice') {
      throw httpError(
        `Account "${account.name}" is not an invoice customer.`,
        400,
        'WRONG_BILLING_MODE',
      );
    }

    const invoices = await getOpenInvoiceRows(input.accountId, trx);
    const outstandingCents = invoices.reduce(
      (sum, invoice) => sum + toCents(Number(invoice.balance || 0)),
      0,
    );
    const amountCents = toCents(amount);
    if (outstandingCents <= 0) {
      throw httpError('This customer has no outstanding issued invoices.', 400, 'NOTHING_TO_PAY');
    }
    if (amountCents > outstandingCents) {
      throw httpError(
        `Payment KES ${amount.toFixed(2)} exceeds the outstanding invoice balance of KES ${fromCents(outstandingCents).toFixed(2)}.`,
        400,
        'PAYMENT_EXCEEDS_BALANCE',
      );
    }

    const [paymentId] = await trx('invoice_payments').insert({
      account_id: input.accountId,
      amount,
      payment_method: input.paymentMethod,
      payment_date: input.paymentDate,
      reference: input.reference || null,
      notes: input.notes || null,
    });

    const allocations = await allocateInvoicePayment(trx, paymentId, invoices, amount);
    await recomputeAccountBalance(input.accountId, trx);

    const payment = await trx('invoice_payments').where({ id: paymentId }).first();
    const accountBalance = await getInvoiceOutstandingBalance(input.accountId, trx);
    return { payment, allocations, outstanding_balance: accountBalance };
  });
}

export async function getEligibleMoneyCredits(
  accountId: number,
  trx: DbConnection,
): Promise<any[]> {
  return trx('credits')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .whereNot('status', 'paid')
    .where('balance', '>', 0)
    .where(function (this: any) {
      this.whereNull('shift_id')
        .orWhereNotIn('shift_id', trx('shifts').select('id').where({ status: 'open' }));
    })
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc');
}

async function allocateMoneyCredits(
  trx: Knex.Transaction,
  credits: any[],
  amount: number,
): Promise<void> {
  let remainingCents = toCents(amount);

  for (const credit of credits) {
    if (remainingCents === 0) break;
    const creditBalanceCents = toCents(Number(credit.balance || 0));
    if (creditBalanceCents <= 0) continue;

    const appliedCents = Math.min(remainingCents, creditBalanceCents);
    const newBalanceCents = creditBalanceCents - appliedCents;
    await trx('credits').where({ id: credit.id }).update({
      balance: fromCents(newBalanceCents),
      status: newBalanceCents === 0 ? 'paid' : 'partial',
    });
    remainingCents -= appliedCents;
  }

  if (remainingCents !== 0) {
    throw httpError(
      'The payment could not be allocated completely. Refresh the account and try again.',
      409,
      'PAYMENT_ALLOCATION_INCOMPLETE',
    );
  }
}

export async function recordMoneyAccountPayment(conn: Knex, input: MoneyPaymentInput) {
  const amount = validatePositiveMoney(input.amount);

  return conn.transaction(async (trx) => {
    const account = await trx('credit_accounts')
      .where({ id: input.accountId })
      .whereNull('deleted_at')
      .first();
    if (!account) throw httpError('Credit account not found', 404, 'ACCOUNT_NOT_FOUND');
    if (account.type !== 'customer') {
      throw httpError('Payments can only be recorded against customer accounts', 400, 'WRONG_ACCOUNT_TYPE');
    }
    if ((account.billing_mode || 'money') !== 'money') {
      throw httpError(
        `Account "${account.name}" is invoice-mode. Use customer invoice payments instead.`,
        400,
        'WRONG_BILLING_MODE',
      );
    }

    if (input.shiftId) {
      const receivingShift = await trx('shifts').where({ id: input.shiftId }).select('status').first();
      if (!receivingShift) throw httpError('Shift not found', 404, 'SHIFT_NOT_FOUND');
      if (receivingShift.status !== 'open') {
        throw httpError('Debt receipts can only be recorded in an open shift.', 400, 'SHIFT_CLOSED');
      }
    }

    const credits = await getEligibleMoneyCredits(input.accountId, trx);
    const eligibleCents = credits.reduce(
      (sum, credit) => sum + toCents(Number(credit.balance || 0)),
      0,
    );
    const amountCents = toCents(amount);
    if (eligibleCents <= 0) {
      throw httpError(
        'No closed-shift debt is available for payment.',
        400,
        'NOTHING_TO_PAY',
      );
    }
    if (amountCents > eligibleCents) {
      throw httpError(
        `Payment KES ${amount.toFixed(2)} exceeds the payable balance of KES ${fromCents(eligibleCents).toFixed(2)}. Credits from open shifts become payable after those shifts close.`,
        400,
        'PAYMENT_EXCEEDS_BALANCE',
      );
    }

    const [paymentId] = await trx('credit_payments').insert({
      credit_id: null,
      account_id: input.accountId,
      amount,
      payment_method: input.paymentMethod,
      payment_type: 'account',
      date: input.paymentDate,
      notes: input.notes || null,
      ...(input.shiftId ? { shift_id: input.shiftId } : {}),
    });

    await allocateMoneyCredits(trx, credits, amount);
    await recomputeAccountBalance(input.accountId, trx);

    const payment = await trx('credit_payments').where({ id: paymentId }).first();
    const updatedAccount = await trx('credit_accounts').where({ id: input.accountId }).first();
    return { payment, account: updatedAccount };
  });
}

export function paymentHttpStatus(err: any): number {
  if (err?.http) return err.http;
  if (err?.code === 'SQLITE_BUSY' || String(err?.message || '').includes('SQLITE_BUSY')) return 409;
  return 500;
}
