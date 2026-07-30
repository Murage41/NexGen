import fs from 'fs';
import os from 'os';
import path from 'path';
import knex, { type Knex } from 'knex';
import {
  paymentHttpStatus,
  recordInvoicePayment,
  recordMoneyAccountPayment,
} from '../src/services/receivablePayments';
import { auditReceivableIntegrity } from '../src/services/receivableIntegrity';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function money(value: unknown): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function createSchema(db: Knex) {
  await db.schema.createTable('credit_accounts', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('type').notNullable();
    t.string('billing_mode').notNullable();
    t.decimal('balance', 14, 2).notNullable().defaultTo(0);
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('shifts', (t) => {
    t.increments('id').primary();
    t.string('status').notNullable();
  });
  await db.schema.createTable('credits', (t) => {
    t.increments('id').primary();
    t.integer('account_id').nullable();
    t.integer('shift_id').nullable();
    t.decimal('amount', 14, 2).notNullable();
    t.decimal('balance', 14, 2).notNullable();
    t.string('status').notNullable();
    t.timestamp('deleted_at').nullable();
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  await db.schema.createTable('credit_payments', (t) => {
    t.increments('id').primary();
    t.integer('credit_id').nullable();
    t.integer('account_id').nullable();
    t.integer('shift_id').nullable();
    t.decimal('amount', 14, 2).notNullable();
    t.string('payment_method').notNullable();
    t.string('payment_type').notNullable();
    t.string('date').notNullable();
    t.text('notes').nullable();
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('customer_invoices', (t) => {
    t.increments('id').primary();
    t.integer('account_id').notNullable();
    t.string('invoice_number').notNullable();
    t.string('issue_date').nullable();
    t.string('status').notNullable();
    t.decimal('total_amount', 14, 2).notNullable();
    t.decimal('balance', 14, 2).notNullable();
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('invoice_lines', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id').notNullable();
    t.decimal('line_total', 14, 2).notNullable();
  });
  await db.schema.createTable('invoice_payments', (t) => {
    t.increments('id').primary();
    t.integer('account_id').notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.string('payment_method').notNullable();
    t.string('payment_date').notNullable();
    t.string('reference').nullable();
    t.text('notes').nullable();
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('invoice_payment_allocations', (t) => {
    t.increments('id').primary();
    t.integer('payment_id').notNullable();
    t.integer('invoice_id').notNullable();
    t.decimal('amount_applied', 14, 2).notNullable();
  });
}

async function expectRejected(action: () => Promise<unknown>, expectedStatus = 400) {
  try {
    await action();
  } catch (err: any) {
    assert(paymentHttpStatus(err) === expectedStatus, `Expected HTTP ${expectedStatus}, got ${paymentHttpStatus(err)}: ${err.message}`);
    return;
  }
  throw new Error('Expected the operation to be rejected');
}

async function testInvoicePayments(db: Knex) {
  const [accountId] = await db('credit_accounts').insert({
    name: 'Invoice Customer',
    type: 'customer',
    billing_mode: 'invoice',
    balance: 15000,
  });
  const [invoiceA] = await db('customer_invoices').insert({
    account_id: accountId,
    invoice_number: 'INV-A',
    issue_date: '2026-07-01',
    status: 'issued',
    total_amount: 10000,
    balance: 10000,
  });
  const [invoiceB] = await db('customer_invoices').insert({
    account_id: accountId,
    invoice_number: 'INV-B',
    issue_date: '2026-07-02',
    status: 'issued',
    total_amount: 5000,
    balance: 5000,
  });
  await db('invoice_lines').insert([
    { invoice_id: invoiceA, line_total: 10000 },
    { invoice_id: invoiceB, line_total: 5000 },
  ]);

  const first = await recordInvoicePayment(db, {
    accountId,
    amount: 6000,
    paymentMethod: 'mpesa',
    paymentDate: '2026-07-03',
  });
  assert(first.allocations.length === 1, 'First payment should allocate only to the oldest invoice');
  assert(first.allocations[0].invoice_id === invoiceA, 'Invoice FIFO order is incorrect');
  assert(money(first.outstanding_balance) === 9000, 'Invoice outstanding balance after partial payment is wrong');

  await expectRejected(() => recordInvoicePayment(db, {
    accountId,
    amount: 9000.01,
    paymentMethod: 'cash',
    paymentDate: '2026-07-03',
  }));
  assert(Number(await db('invoice_payments').where({ account_id: accountId }).count('* as c').first().then((r: any) => r.c)) === 1,
    'Rejected invoice overpayment created a payment row');

  const final = await recordInvoicePayment(db, {
    accountId,
    amount: 9000,
    paymentMethod: 'bank_transfer',
    paymentDate: '2026-07-04',
  });
  assert(final.allocations.length === 2, 'Final invoice payment should finish two invoices');
  assert(money(final.outstanding_balance) === 0, 'Fully paid invoice account should have zero balance');
  const paidInvoices = await db('customer_invoices').whereIn('id', [invoiceA, invoiceB]).orderBy('id');
  assert(paidInvoices.every((invoice: any) => invoice.status === 'paid' && money(invoice.balance) === 0),
    'Invoice statuses did not become paid');
}

async function testMoneyPayments(db: Knex) {
  const [closedShift] = await db('shifts').insert({ status: 'closed' });
  const [openShift] = await db('shifts').insert({ status: 'open' });
  const [receivingShift] = await db('shifts').insert({ status: 'open' });
  const [accountId] = await db('credit_accounts').insert({
    name: 'Money Customer',
    type: 'customer',
    billing_mode: 'money',
    balance: 2300,
  });
  const [creditA] = await db('credits').insert({
    account_id: accountId,
    shift_id: closedShift,
    amount: 1000,
    balance: 1000,
    status: 'outstanding',
    created_at: '2026-07-01 08:00:00',
  });
  const [creditB] = await db('credits').insert({
    account_id: accountId,
    shift_id: null,
    amount: 500,
    balance: 500,
    status: 'outstanding',
    created_at: '2026-07-02 08:00:00',
  });
  const [openCredit] = await db('credits').insert({
    account_id: accountId,
    shift_id: openShift,
    amount: 800,
    balance: 800,
    status: 'outstanding',
    created_at: '2026-07-03 08:00:00',
  });

  await recordMoneyAccountPayment(db, {
    accountId,
    amount: 1200,
    paymentMethod: 'cash',
    paymentDate: '2026-07-04',
  });
  const afterA = await db('credits').where({ id: creditA }).first();
  const afterB = await db('credits').where({ id: creditB }).first();
  const afterOpen = await db('credits').where({ id: openCredit }).first();
  assert(afterA.status === 'paid' && money(afterA.balance) === 0, 'Oldest money credit was not settled first');
  assert(afterB.status === 'partial' && money(afterB.balance) === 300, 'Second money credit balance is wrong');
  assert(money(afterOpen.balance) === 800, 'Open-shift credit was incorrectly paid');

  await expectRejected(() => recordMoneyAccountPayment(db, {
    accountId,
    amount: 300.01,
    paymentMethod: 'cash',
    paymentDate: '2026-07-04',
  }));

  await recordMoneyAccountPayment(db, {
    accountId,
    amount: 300,
    paymentMethod: 'mpesa',
    paymentDate: '2026-07-04',
    shiftId: receivingShift,
  });
  const account = await db('credit_accounts').where({ id: accountId }).first();
  assert(money(account.balance) === 800, 'Account cache should retain only the open-shift credit');
  await expectRejected(() => recordMoneyAccountPayment(db, {
    accountId,
    amount: 1,
    paymentMethod: 'cash',
    paymentDate: '2026-07-04',
  }));
}

async function testIntegrityAudit(db: Knex) {
  const [accountId] = await db('credit_accounts').insert({
    name: 'Legacy Invoice Customer',
    type: 'customer',
    billing_mode: 'invoice',
    balance: 100,
  });
  const [invoiceId] = await db('customer_invoices').insert({
    account_id: accountId,
    invoice_number: 'LEGACY-INV',
    issue_date: '2026-07-01',
    status: 'partial',
    total_amount: 200,
    balance: 100,
  });
  await db('invoice_lines').insert({ invoice_id: invoiceId, line_total: 200 });
  const [paymentId] = await db('invoice_payments').insert({
    account_id: accountId,
    amount: 150,
    payment_method: 'cash',
    payment_date: '2026-07-02',
  });
  await db('invoice_payment_allocations').insert({
    payment_id: paymentId,
    invoice_id: invoiceId,
    amount_applied: 100,
  });

  const report = await auditReceivableIntegrity(db);
  assert(!report.ok, 'Integrity audit should flag a legacy unallocated payment');
  assert(report.counts.invoice_payment_unallocated === 1, 'Unallocated invoice payment count is wrong');
  assert(report.issues.some((issue) => issue.record_id === paymentId), 'Audit did not identify the payment row');
}

async function testConcurrentInvoicePayments(dbFile: string, setupDb: Knex) {
  const [accountId] = await setupDb('credit_accounts').insert({
    name: 'Concurrent Customer',
    type: 'customer',
    billing_mode: 'invoice',
    balance: 100,
  });
  const [invoiceId] = await setupDb('customer_invoices').insert({
    account_id: accountId,
    invoice_number: 'CONCURRENT-INV',
    issue_date: '2026-07-01',
    status: 'issued',
    total_amount: 100,
    balance: 100,
  });
  await setupDb('invoice_lines').insert({ invoice_id: invoiceId, line_total: 100 });

  const createClient = () => knex({
    client: 'sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(conn: any, done: (err: Error | null, conn?: any) => void) {
        conn.run('PRAGMA busy_timeout = 1000', (err: Error | null) => done(err, conn));
      },
    },
  });
  const first = createClient();
  const second = createClient();
  try {
    const attempts = await Promise.allSettled([
      recordInvoicePayment(first, {
        accountId,
        amount: 60,
        paymentMethod: 'cash',
        paymentDate: '2026-07-03',
      }),
      recordInvoicePayment(second, {
        accountId,
        amount: 60,
        paymentMethod: 'mpesa',
        paymentDate: '2026-07-03',
      }),
    ]);
    assert(attempts.some((attempt) => attempt.status === 'fulfilled'), 'Both concurrent payments failed');

    const paymentTotal = await setupDb('invoice_payments')
      .where({ account_id: accountId })
      .whereNull('deleted_at')
      .sum('amount as total')
      .first();
    const allocationTotal = await setupDb('invoice_payment_allocations')
      .where({ invoice_id: invoiceId })
      .sum('amount_applied as total')
      .first();
    assert(money((paymentTotal as any)?.total) <= 100, 'Concurrent requests overpaid the invoice');
    assert(money((paymentTotal as any)?.total) === money((allocationTotal as any)?.total),
      'Concurrent requests left an unallocated payment');
  } finally {
    await first.destroy();
    await second.destroy();
  }
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `nexgen-receivable-integrity-${Date.now()}.db`);
  const db = knex({
    client: 'sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });

  try {
    await createSchema(db);
    await testInvoicePayments(db);
    await testMoneyPayments(db);
    await testIntegrityAudit(db);
    await testConcurrentInvoicePayments(dbFile, db);
    console.log('PASS invoice payments allocate fully and reject overpayment');
    console.log('PASS money credits exclude open shifts and reject overpayment');
    console.log('PASS legacy inconsistencies are detected without mutation');
    console.log('PASS concurrent payment attempts cannot exceed invoice balance');
  } finally {
    await db.destroy();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbFile}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
