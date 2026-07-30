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

export async function getReceivablePositionAsOf(db: Knex, asOfDate: string) {
  const moneyCreditsRow = await db('credits as credit')
    .join('credit_accounts as account', 'credit.account_id', 'account.id')
    .whereNull('credit.deleted_at')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    })
    .whereRaw("date(credit.created_at, '+3 hours') <= ?", [asOfDate])
    .sum({ total: 'credit.amount' })
    .first();
  const moneyPaymentsRow = await db('credit_payments as payment')
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
    })
    .where('payment.date', '<=', asOfDate)
    .sum({ total: 'payment.amount' })
    .first();
  const invoiceEventsRow = await db('invoice_accounting_events as event')
    .join('credit_accounts as account', 'event.account_id', 'account.id')
    .whereNull('account.deleted_at')
    .where('account.type', 'customer')
    .where('account.billing_mode', 'invoice')
    .where('event.posting_date', '<=', asOfDate)
    .sum({ total: 'event.receivable_delta' })
    .first();

  const moneyCredits = roundMoney(Number((moneyCreditsRow as any)?.total || 0));
  const moneyPayments = roundMoney(Number((moneyPaymentsRow as any)?.total || 0));
  const moneyReceivables = roundMoney(Math.max(0, moneyCredits - moneyPayments));
  const invoiceReceivables = roundMoney(Number((invoiceEventsRow as any)?.total || 0));
  return {
    as_of_date: asOfDate,
    money_receivables: moneyReceivables,
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
  const moneyReceivables = roundMoney(Number((moneyRow as any)?.total || 0));
  const invoiceReceivables = roundMoney(Number((invoiceRow as any)?.total || 0));
  return {
    money_receivables: moneyReceivables,
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
    .where('account.type', 'customer')
    .where(function (this: any) {
      this.whereNull('account.billing_mode').orWhere('account.billing_mode', 'money');
    })
    .whereBetween('payment.date', [from, to])
    .sum({ total: 'payment.amount' })
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

  const moneyCreditsIssued = roundMoney(Number((moneyCreditsRow as any)?.total || 0));
  const moneyPaymentsReceived = roundMoney(Number((moneyPaymentsRow as any)?.total || 0));
  const invoiceIssued = roundMoney(Number((invoiceIssueRow as any)?.total || 0));
  const invoicePaymentsReceived = roundMoney(Number((invoicePaymentRow as any)?.cash || 0));
  const invoiceAdjustments = roundMoney(Number((invoiceAdjustmentRow as any)?.total || 0));
  return {
    money_credits_issued: moneyCreditsIssued,
    invoice_receivables_issued: invoiceIssued,
    invoice_adjustments: invoiceAdjustments,
    total_receivables_issued: roundMoney(moneyCreditsIssued + invoiceIssued + invoiceAdjustments),
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

  return {
    money_credit_payments: moneyTotal,
    money_credit_payments_by_method: directMoneyByMethod,
    invoice_payments: invoiceTotal,
    invoice_payments_by_account: invoiceByAccount,
    total_direct_receivable_cash: roundMoney(moneyTotal + invoiceTotal),
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
