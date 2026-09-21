import type { Knex } from 'knex';

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function dateDiffDays(from: string, to: string) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00.000Z`).getTime();
  const end = new Date(`${to.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86400000);
}

export function previousBusinessDate(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

// Closed-shift corrections (services/shiftCorrections.ts) reverse a credit or
// payment on the day they are posted. Until then it counted, so positions and
// activity for earlier dates keep it; the reversal lands on its own date.
function moneyCustomer(query: any) {
  return query
    .join('credit_accounts as account', 'credit.account_id', 'account.id')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    });
}

function moneyCustomerPayment(db: Knex) {
  return db('credit_payments as payment')
    .leftJoin('credits as source_credit', 'payment.credit_id', 'source_credit.id')
    .join(
      'credit_accounts as account',
      db.raw('account.id = COALESCE(payment.account_id, source_credit.account_id)'),
    )
    .whereNull('payment.deleted_at')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    });
}

const reversedOn = (table: string) => `date(${table}.reversed_at, '+3 hours')`;

// What each money customer owed on a date: credits less payments, plus credit
// on account paid back to them. A customer can be in credit after a closed-shift
// correction (receivablePayments.ts); that is money the station owes them, so it
// is reported on its own instead of being netted against other customers' debt.
async function moneyNetByAccount(db: Knex, asOfDate: string) {
  const net = new Map<number, number>();
  const add = (rows: any[], sign: number) => {
    for (const row of rows) {
      const id = Number(row.account_id);
      net.set(id, (net.get(id) || 0) + sign * Number(row.total || 0));
    }
  };
  add(await moneyCustomer(db('credits as credit'))
    .whereNull('credit.deleted_at')
    .whereRaw("date(credit.created_at, '+3 hours') <= ?", [asOfDate])
    .groupBy('account.id')
    .select('account.id as account_id')
    .sum({ total: 'credit.amount' }), 1);
  // Credits and payments a later correction reversed still stood on this date.
  add(await moneyCustomer(db('credits as credit'))
    .whereNotNull('credit.reversed_by_correction_id')
    .whereRaw("date(credit.created_at, '+3 hours') <= ?", [asOfDate])
    .whereRaw(`${reversedOn('credit')} > ?`, [asOfDate])
    .groupBy('account.id')
    .select('account.id as account_id')
    .sum({ total: 'credit.amount' }), 1);
  add(await moneyCustomerPayment(db)
    .where('payment.status', 'posted')
    .where('payment.date', '<=', asOfDate)
    .groupBy('account.id')
    .select('account.id as account_id')
    .sum({ total: 'payment.amount' }), -1);
  add(await moneyCustomerPayment(db)
    .whereNotNull('payment.reversed_by_correction_id')
    .where('payment.date', '<=', asOfDate)
    .whereRaw(`${reversedOn('payment')} > ?`, [asOfDate])
    .groupBy('account.id')
    .select('account.id as account_id')
    .sum({ total: 'payment.amount' }), -1);
  add(await db('customer_refunds as refund')
    .join('credit_accounts as account', 'refund.account_id', 'account.id')
    .whereNull('account.deleted_at')
    .where('refund.status', 'posted')
    .where('refund.refund_date', '<=', asOfDate)
    .groupBy('account.id')
    .select('account.id as account_id')
    .sum({ total: 'refund.amount' }), 1);
  return net;
}

export async function getReceivablePositionAsOf(db: Knex, asOfDate: string) {
  const net = await moneyNetByAccount(db, asOfDate);
  let owedCents = 0;
  let creditCents = 0;
  for (const value of net.values()) {
    const cents = Math.round(value * 100);
    if (cents > 0) owedCents += cents;
    else creditCents -= cents;
  }
  const invoiceEventsRow = await db('invoice_accounting_events as event')
    .join('credit_accounts as account', 'event.account_id', 'account.id')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where('account.billing_mode', 'invoice')
    .where('event.posting_date', '<=', asOfDate)
    .sum({ total: 'event.receivable_delta' })
    .first();

  const moneyReceivables = roundMoney(owedCents / 100);
  const invoiceReceivables = roundMoney(Number((invoiceEventsRow as any)?.total || 0));
  return {
    as_of_date: asOfDate,
    money_receivables: moneyReceivables,
    money_customer_credits: roundMoney(creditCents / 100),
    invoice_receivables: invoiceReceivables,
    total_receivables: roundMoney(moneyReceivables + invoiceReceivables),
  };
}

export async function getCurrentReceivableTotals(db: Knex) {
  const moneyRow = await db('credits as credit')
    .join('credit_accounts as account', 'credit.account_id', 'account.id')
    .whereNull('credit.deleted_at')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    })
    .where('credit.balance', '>', 0)
    .sum({ total: 'credit.balance' })
    .first();
  const invoiceRow = await db('customer_invoices as invoice')
    .join('credit_accounts as account', 'invoice.account_id', 'account.id')
    .whereNull('invoice.deleted_at')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where('account.billing_mode', 'invoice')
    .whereIn('invoice.status', ['issued', 'partial'])
    .where('invoice.balance', '>', 0)
    .sum({ total: 'invoice.balance' })
    .first();
  const heldRow = await db('credit_payments as payment')
    .join('credit_accounts as account', 'payment.account_id', 'account.id')
    .whereNull('account.deleted_at')
    .whereNull('payment.deleted_at')
    .where('payment.status', 'posted')
    .where('payment.unapplied_amount', '>', 0)
    .sum({ total: 'payment.unapplied_amount' })
    .first();
  const moneyReceivables = roundMoney(Number((moneyRow as any)?.total || 0));
  const invoiceReceivables = roundMoney(Number((invoiceRow as any)?.total || 0));
  return {
    money_receivables: moneyReceivables,
    money_customer_credits: roundMoney(Number((heldRow as any)?.total || 0)),
    invoice_receivables: invoiceReceivables,
    total_receivables: roundMoney(moneyReceivables + invoiceReceivables),
  };
}

export async function getReceivableActivity(db: Knex, from: string, to: string) {
  const moneyCreditsRow = await db('credits as credit')
    .join('credit_accounts as account', 'credit.account_id', 'account.id')
    .whereNull('credit.deleted_at')
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    })
    .whereRaw("date(credit.created_at, '+3 hours') BETWEEN ? AND ?", [from, to])
    .sum({ total: 'credit.amount' })
    .first();
  const moneyPaymentsRow = await db('credit_payments as payment')
    .leftJoin('credits as source_credit', 'payment.credit_id', 'source_credit.id')
    .join(
      'credit_accounts as account',
      db.raw('account.id = COALESCE(payment.account_id, source_credit.account_id)'),
    )
    .whereNull('payment.deleted_at')
    .where('payment.status', 'posted')
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    })
    .whereBetween('payment.date', [from, to])
    .sum({ total: 'payment.amount' })
    .first();
  // Gross: credits issued and payments received in the period count even if a
  // later correction reversed them; that correction is its own line.
  const correctedIssuedRow = await moneyCustomer(db('credits as credit'))
    .whereNotNull('credit.reversed_by_correction_id')
    .whereRaw("date(credit.created_at, '+3 hours') BETWEEN ? AND ?", [from, to])
    .sum({ total: 'credit.amount' })
    .first();
  const correctedReceivedRow = await moneyCustomerPayment(db)
    .whereNotNull('payment.reversed_by_correction_id')
    .whereBetween('payment.date', [from, to])
    .sum({ total: 'payment.amount' })
    .first();
  const creditCorrectionsRow = await moneyCustomer(db('credits as credit'))
    .whereNotNull('credit.reversed_by_correction_id')
    .whereRaw(`${reversedOn('credit')} BETWEEN ? AND ?`, [from, to])
    .sum({ total: 'credit.amount' })
    .first();
  const paymentReversalsRow = await moneyCustomerPayment(db)
    .whereNotNull('payment.reversed_by_correction_id')
    .whereRaw(`${reversedOn('payment')} BETWEEN ? AND ?`, [from, to])
    .sum({ total: 'payment.amount' })
    .first();
  const refundsRow = await db('customer_refunds')
    .where({ status: 'posted' })
    .whereBetween('refund_date', [from, to])
    .sum({ total: 'amount' })
    .first();
  const invoiceIssueRow = await db('invoice_accounting_events')
    .where({ event_type: 'invoice_issue' })
    .whereBetween('posting_date', [from, to])
    .sum({ total: 'receivable_delta' })
    .first();
  const invoicePaymentRow = await db('invoice_accounting_events')
    .whereIn('event_type', ['invoice_payment', 'invoice_payment_reversal'])
    .whereBetween('posting_date', [from, to])
    .sum({ cash: 'cash_delta', receivable: 'receivable_delta' })
    .first();
  const invoiceAdjustmentRow = await db('invoice_accounting_events')
    .whereIn('event_type', [
      'credit_note',
      'debit_note',
      'credit_note_reversal',
      'debit_note_reversal',
      'invoice_void',
    ])
    .whereBetween('posting_date', [from, to])
    .sum({ total: 'receivable_delta' })
    .first();

  const moneyCreditsIssued = roundMoney(
    Number((moneyCreditsRow as any)?.total || 0) + Number((correctedIssuedRow as any)?.total || 0),
  );
  const moneyPaymentsReceived = roundMoney(
    Number((moneyPaymentsRow as any)?.total || 0) + Number((correctedReceivedRow as any)?.total || 0),
  );
  // Credits a correction reversed in the period (owed less), and payments it
  // reversed (owed again).
  const moneyCreditCorrections = roundMoney(-Number((creditCorrectionsRow as any)?.total || 0));
  const moneyPaymentReversals = roundMoney(Number((paymentReversalsRow as any)?.total || 0));
  // Credit on account paid back to customers in the period.
  const moneyRefunds = roundMoney(Number((refundsRow as any)?.total || 0));
  const invoiceIssued = roundMoney(Number((invoiceIssueRow as any)?.total || 0));
  const invoicePaymentsReceived = roundMoney(Number((invoicePaymentRow as any)?.cash || 0));
  const invoiceAdjustments = roundMoney(Number((invoiceAdjustmentRow as any)?.total || 0));
  return {
    money_credits_issued: moneyCreditsIssued,
    money_credit_corrections: moneyCreditCorrections,
    money_payment_reversals: moneyPaymentReversals,
    money_refunds: moneyRefunds,
    invoice_receivables_issued: invoiceIssued,
    invoice_adjustments: invoiceAdjustments,
    total_receivables_issued: roundMoney(
      moneyCreditsIssued + moneyCreditCorrections + moneyPaymentReversals + invoiceIssued + invoiceAdjustments,
    ),
    money_payments_received: moneyPaymentsReceived,
    invoice_payments_received: invoicePaymentsReceived,
    total_payments_received: roundMoney(moneyPaymentsReceived + invoicePaymentsReceived),
  };
}

export async function getDirectReceivableCashInflows(db: Knex, from: string, to: string) {
  const directMoneyPayments = await db('credit_payments as payment')
    .leftJoin('credits as source_credit', 'payment.credit_id', 'source_credit.id')
    .join(
      'credit_accounts as account',
      db.raw('account.id = COALESCE(payment.account_id, source_credit.account_id)'),
    )
    .whereNull('payment.deleted_at')
    .where('payment.status', 'posted')
    .whereNull('payment.shift_id')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    })
    .whereBetween('payment.date', [from, to])
    .select('payment.payment_method')
    .sum({ total: 'payment.amount' })
    .groupBy('payment.payment_method');
  const directMoneyByMethod: Record<string, number> = {};
  for (const payment of directMoneyPayments as any[]) {
    directMoneyByMethod[payment.payment_method || 'other'] = roundMoney(payment.total);
  }
  const moneyTotal = roundMoney(
    (directMoneyPayments as any[])
      .reduce((sum, payment) => sum + Number(payment.total || 0), 0),
  );

  const invoicePaymentEvents = await db('invoice_accounting_events as event')
    .join('credit_accounts as account', 'event.account_id', 'account.id')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where('account.billing_mode', 'invoice')
    .whereIn('event_type', ['invoice_payment', 'invoice_payment_reversal'])
    .whereBetween('event.posting_date', [from, to])
    .select('event.receiving_account')
    .sum({ total: 'event.cash_delta' })
    .groupBy('event.receiving_account');
  const invoiceByAccount: Record<string, number> = {};
  for (const event of invoicePaymentEvents as any[]) {
    invoiceByAccount[event.receiving_account || 'other'] = roundMoney(event.total);
  }
  const invoiceTotal = roundMoney(
    (invoicePaymentEvents as any[])
      .reduce((sum, event) => sum + Number(event.total || 0), 0),
  );

  const staffReceipts = await db('credit_payments as payment').join('credit_accounts as account', 'payment.account_id', 'account.id')
    .where({ 'account.type': 'employee', 'payment.payment_type': 'staff_debt', 'payment.status': 'posted' }).whereNull('payment.deleted_at').whereNull('payment.shift_id')
    .whereBetween('payment.date', [from, to]).sum('payment.amount as total').first();
  const staffTotal = roundMoney(Number(staffReceipts?.total || 0));
  return {
    money_credit_payments: moneyTotal,
    money_credit_payments_by_method: directMoneyByMethod,
    invoice_payments: invoiceTotal,
    invoice_payments_by_account: invoiceByAccount,
    employee_debt_repayments: staffTotal,
    total_direct_receivable_cash: roundMoney(moneyTotal + invoiceTotal + staffTotal),
  };
}

type AgingBucket = {
  not_due: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
};

function emptyBucket(): AgingBucket {
  return { not_due: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
}

function addToBucket(bucket: AgingBucket, balance: number, dueDate: string, asOfDate: string) {
  const overdueDays = dateDiffDays(dueDate, asOfDate);
  if (overdueDays <= 0) bucket.not_due += balance;
  else if (overdueDays <= 30) bucket.days_1_30 += balance;
  else if (overdueDays <= 60) bucket.days_31_60 += balance;
  else if (overdueDays <= 90) bucket.days_61_90 += balance;
  else bucket.days_90_plus += balance;
}

export async function getCombinedDebtorAging(db: Knex, asOfDate: string) {
  const accounts = await db('credit_accounts')
    .where({ type: 'customer' })
    .whereNull('deleted_at')
    .select('id', 'name', 'phone', 'billing_mode');
  const accountMap = new Map<number, any>(
    (accounts as any[]).map((account) => [
      Number(account.id),
      {
        account_id: Number(account.id),
        name: account.name,
        phone: account.phone,
        billing_mode: account.billing_mode || 'money',
        document_count: 0,
        oldest_due_date: null as string | null,
        bucket: emptyBucket(),
      },
    ]),
  );
  const moneyDocuments = await db('credits as credit')
    .join('credit_accounts as account', 'credit.account_id', 'account.id')
    .whereNull('credit.deleted_at')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    })
    .where('credit.balance', '>', 0)
    .select(
      'credit.account_id',
      'credit.balance',
      db.raw("date(credit.created_at, '+3 hours') as due_date"),
    );
  const invoiceDocuments = await db('customer_invoices as invoice')
    .join('credit_accounts as account', 'invoice.account_id', 'account.id')
    .whereNull('invoice.deleted_at')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where('account.billing_mode', 'invoice')
    .whereIn('invoice.status', ['issued', 'partial'])
    .where('invoice.balance', '>', 0)
    .select('invoice.account_id', 'invoice.balance', 'invoice.due_date', 'invoice.issue_date');

  function ageDocument(accountId: number, balance: unknown, dueDateValue: unknown) {
    const account = accountMap.get(accountId);
    if (!account) return;
    const dueDate = String(dueDateValue).slice(0, 10);
    addToBucket(account.bucket, Number(balance), dueDate, asOfDate);
    if (account.oldest_due_date === null || dueDate.localeCompare(account.oldest_due_date) < 0) {
      account.oldest_due_date = dueDate;
    }
    account.document_count += 1;
  }

  for (const credit of moneyDocuments as any[]) {
    ageDocument(Number(credit.account_id), credit.balance, credit.due_date);
  }
  for (const invoice of invoiceDocuments as any[]) {
    ageDocument(
      Number(invoice.account_id),
      invoice.balance,
      invoice.due_date || invoice.issue_date,
    );
  }

  const rows: any[] = [];
  const summary = emptyBucket();
  for (const account of accountMap.values()) {
    const bucket = account.bucket as AgingBucket;
    const total = roundMoney(
      bucket.not_due
      + bucket.days_1_30
      + bucket.days_31_60
      + bucket.days_61_90
      + bucket.days_90_plus,
    );
    if (total <= 0) continue;
    for (const key of Object.keys(summary) as Array<keyof AgingBucket>) {
      summary[key] = roundMoney(summary[key] + bucket[key]);
      bucket[key] = roundMoney(bucket[key]);
    }
    rows.push({
      account_id: account.account_id,
      name: account.name,
      phone: account.phone,
      billing_mode: account.billing_mode,
      document_count: account.document_count,
      oldest_due_date: account.oldest_due_date,
      total_outstanding: total,
      ...bucket,
      current_0_30: roundMoney(bucket.not_due + bucket.days_1_30),
    });
  }
  rows.sort((a, b) => b.total_outstanding - a.total_outstanding);
  const totalOutstanding = roundMoney(
    summary.not_due
    + summary.days_1_30
    + summary.days_31_60
    + summary.days_61_90
    + summary.days_90_plus,
  );
  return {
    as_of_date: asOfDate,
    accounts: rows,
    summary: {
      ...summary,
      current_0_30: roundMoney(summary.not_due + summary.days_1_30),
      total_outstanding: totalOutstanding,
    },
  };
}
