import assert from 'assert';
import knex from 'knex';
import {
  getCombinedDebtorAging,
  getCurrentReceivableTotals,
  getDirectReceivableCashInflows,
  getReceivableActivity,
  getReceivablePositionAsOf,
  previousBusinessDate,
} from '../src/services/receivableReporting';

function money(value: unknown) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function run() {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  try {
    await db.schema.createTable('credit_accounts', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('phone').nullable();
      table.string('type').notNullable();
      table.string('billing_mode').nullable();
      table.timestamp('deleted_at').nullable();
    });
    await db.schema.createTable('credits', (table) => {
      table.increments('id').primary();
      table.integer('account_id').notNullable();
      table.decimal('amount', 14, 2).notNullable();
      table.decimal('balance', 14, 2).notNullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('deleted_at').nullable();
    });
    await db.schema.createTable('credit_payments', (table) => {
      table.increments('id').primary();
      table.integer('credit_id').nullable();
      table.integer('account_id').nullable();
      table.integer('shift_id').nullable();
      table.decimal('amount', 14, 2).notNullable();
      table.string('payment_method').notNullable();
      table.date('date').notNullable();
      table.timestamp('deleted_at').nullable();
    });
    await db.schema.createTable('customer_invoices', (table) => {
      table.increments('id').primary();
      table.integer('account_id').notNullable();
      table.string('status').notNullable();
      table.date('issue_date').notNullable();
      table.date('due_date').nullable();
      table.decimal('balance', 14, 2).notNullable();
      table.timestamp('deleted_at').nullable();
    });
    await db.schema.createTable('invoice_accounting_events', (table) => {
      table.increments('id').primary();
      table.integer('account_id').notNullable();
      table.string('event_type').notNullable();
      table.date('posting_date').notNullable();
      table.decimal('receivable_delta', 14, 2).notNullable();
      table.decimal('cash_delta', 14, 2).notNullable().defaultTo(0);
      table.string('receiving_account').nullable();
    });

    await db('credit_accounts').insert([
      { id: 1, name: 'Money Customer', phone: '0700000001', type: 'customer', billing_mode: 'money' },
      { id: 2, name: 'Invoice Customer', phone: '0700000002', type: 'customer', billing_mode: 'invoice' },
    ]);
    await db('credits').insert({
      id: 1,
      account_id: 1,
      amount: 1000,
      balance: 500,
      created_at: '2026-07-01T08:00:00.000Z',
    });
    await db('credit_payments').insert([
      {
        id: 1,
        credit_id: 1,
        account_id: 1,
        shift_id: null,
        amount: 300,
        payment_method: 'cash',
        date: '2026-07-15',
      },
      {
        id: 2,
        credit_id: 1,
        account_id: 1,
        shift_id: 9,
        amount: 200,
        payment_method: 'mpesa',
        date: '2026-07-20',
      },
    ]);
    await db('customer_invoices').insert({
      id: 1,
      account_id: 2,
      status: 'partial',
      issue_date: '2026-07-05',
      due_date: '2026-08-04',
      balance: 1900,
    });
    await db('invoice_accounting_events').insert([
      {
        account_id: 2,
        event_type: 'invoice_issue',
        posting_date: '2026-07-05',
        receivable_delta: 2000,
        cash_delta: 0,
      },
      {
        account_id: 2,
        event_type: 'invoice_payment',
        posting_date: '2026-07-10',
        receivable_delta: -500,
        cash_delta: 500,
        receiving_account: 'cash',
      },
      {
        account_id: 2,
        event_type: 'credit_note',
        posting_date: '2026-07-20',
        receivable_delta: -100,
        cash_delta: 0,
      },
      {
        account_id: 2,
        event_type: 'invoice_payment_reversal',
        posting_date: '2026-08-02',
        receivable_delta: 500,
        cash_delta: -500,
        receiving_account: 'cash',
      },
    ]);

    assert.equal(previousBusinessDate('2026-07-01'), '2026-06-30');
    const opening = await getReceivablePositionAsOf(db, '2026-06-30');
    assert.equal(opening.total_receivables, 0);
    const midMonth = await getReceivablePositionAsOf(db, '2026-07-10');
    assert.equal(midMonth.money_receivables, 1000);
    assert.equal(midMonth.invoice_receivables, 1500);
    const julyClose = await getReceivablePositionAsOf(db, '2026-07-31');
    assert.equal(julyClose.money_receivables, 500);
    assert.equal(julyClose.invoice_receivables, 1400);
    assert.equal(julyClose.total_receivables, 1900);
    const augustPosition = await getReceivablePositionAsOf(db, '2026-08-02');
    assert.equal(augustPosition.total_receivables, 2400);

    const current = await getCurrentReceivableTotals(db);
    assert.deepEqual(current, {
      money_receivables: 500,
      invoice_receivables: 1900,
      total_receivables: 2400,
    });

    const activity = await getReceivableActivity(db, '2026-07-01', '2026-07-31');
    assert.equal(activity.money_credits_issued, 1000);
    assert.equal(activity.invoice_receivables_issued, 2000);
    assert.equal(activity.invoice_adjustments, -100);
    assert.equal(activity.money_payments_received, 500);
    assert.equal(activity.invoice_payments_received, 500);
    assert.equal(activity.total_payments_received, 1000);

    const julyCash = await getDirectReceivableCashInflows(db, '2026-07-01', '2026-07-31');
    assert.equal(julyCash.money_credit_payments, 300);
    assert.deepEqual(julyCash.money_credit_payments_by_method, { cash: 300 });
    assert.equal(julyCash.invoice_payments, 500);
    assert.deepEqual(julyCash.invoice_payments_by_account, { cash: 500 });
    assert.equal(julyCash.total_direct_receivable_cash, 800);
    const augustCash = await getDirectReceivableCashInflows(db, '2026-08-02', '2026-08-02');
    assert.equal(augustCash.money_credit_payments, 0);
    assert.equal(augustCash.invoice_payments, -500);
    assert.equal(augustCash.total_direct_receivable_cash, -500);

    const aging = await getCombinedDebtorAging(db, '2026-08-02');
    assert.equal(aging.summary.total_outstanding, 2400);
    assert.equal(aging.summary.not_due, 1900);
    assert.equal(aging.summary.days_31_60, 500);
    const invoiceCustomer = aging.accounts.find((account) => account.account_id === 2);
    assert.equal(invoiceCustomer.billing_mode, 'invoice');
    assert.equal(invoiceCustomer.not_due, 1900);
    assert.equal(invoiceCustomer.oldest_due_date, '2026-08-04');

    const netInvoiceCash = await db('invoice_accounting_events')
      .whereIn('event_type', ['invoice_payment', 'invoice_payment_reversal'])
      .whereBetween('posting_date', ['2026-07-01', '2026-08-31'])
      .sum({ total: 'cash_delta' })
      .first();
    assert.equal(money(netInvoiceCash?.total), 0);

    console.log('PASS mixed-mode receivable positions are reconstructed as of each date');
    console.log('PASS receivable activity separates issues, adjustments, and payments');
    console.log('PASS direct cash excludes shift-linked receipts and nets reversals');
    console.log('PASS due-date aging combines money and invoice customers');
  } finally {
    await db.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
