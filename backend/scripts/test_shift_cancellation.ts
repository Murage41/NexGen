import fs from 'fs';
import os from 'os';
import path from 'path';
import knex, { type Knex } from 'knex';
import { recordMoneyAccountPayment } from '../src/services/receivablePayments';
import { cancelOpenShift, previewShiftCancellation } from '../src/services/shiftCancellation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function money(value: unknown) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function createSchema(db: Knex) {
  await db.schema.createTable('employees', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
  });
  await db.schema.createTable('shifts', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable();
    t.string('status').notNullable();
    t.string('end_time').nullable();
    t.string('cancelled_at').nullable();
    t.integer('cancelled_by_employee_id').nullable();
    t.text('cancellation_reason').nullable();
  });
  await db.schema.createTable('credit_accounts', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('type').notNullable();
    t.string('billing_mode').nullable();
    t.integer('employee_id').nullable();
    t.decimal('balance', 14, 2).notNullable().defaultTo(0);
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('credits', (t) => {
    t.increments('id').primary();
    t.integer('account_id').nullable();
    t.integer('shift_id').nullable();
    t.decimal('amount', 14, 2).notNullable();
    t.decimal('balance', 14, 2).notNullable();
    t.string('status').notNullable();
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('shift_credits', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.integer('credit_id').nullable();
    t.decimal('amount', 14, 2).notNullable();
    t.timestamp('deleted_at').nullable();
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
    t.string('status').notNullable().defaultTo('posted');
    t.text('notes').nullable();
    t.timestamp('deleted_at').nullable();
    t.timestamp('reversed_at').nullable();
    t.integer('reversed_by_employee_id').nullable();
    t.text('reversal_reason').nullable();
  });
  await db.schema.createTable('credit_payment_allocations', (t) => {
    t.increments('id').primary();
    t.integer('payment_id').notNullable();
    t.integer('credit_id').notNullable();
    t.decimal('amount_applied', 14, 2).notNullable();
    t.timestamp('reversed_at').nullable();
  });
  await db.schema.createTable('invoice_consumption', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.integer('invoice_line_id').nullable();
    t.string('entry_status').notNullable().defaultTo('active');
    t.timestamp('deleted_at').nullable();
    t.timestamp('updated_at').nullable();
  });
  await db.schema.createTable('shift_expenses', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('staff_debts', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable();
    t.decimal('balance', 14, 2).notNullable();
    t.string('status').notNullable();
  });
  await db.schema.createTable('wage_deductions', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.decimal('deduction_amount', 14, 2).notNullable();
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('shift_staff_debt_allocations', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.integer('staff_debt_id').notNullable();
    t.integer('wage_deduction_id').nullable();
    t.decimal('amount', 14, 2).notNullable();
    t.timestamp('reversed_at').nullable();
  });
  await db.schema.createTable('payroll_lines', (t) => {
    t.increments('id').primary();
    t.integer('run_id').notNullable();
  });
  await db.schema.createTable('payroll_payments', (t) => {
    t.increments('id').primary();
    t.integer('payroll_line_id').notNullable();
    t.integer('shift_id').nullable();
    t.string('status').notNullable();
    t.timestamp('reversed_at').nullable();
    t.text('reversal_reason').nullable();
  });
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-shift-cancel-'));
  const database = knex({
    client: 'sqlite3',
    connection: { filename: path.join(tempDir, 'test.db') },
    useNullAsDefault: true,
  });

  try {
    await createSchema(database);
    const [employeeId] = await database('employees').insert({ name: 'Test Attendant' });
    const [closedShiftId] = await database('shifts').insert({ employee_id: employeeId, status: 'closed' });
    const [openShiftId] = await database('shifts').insert({ employee_id: employeeId, status: 'open' });
    const [accountId] = await database('credit_accounts').insert({
      name: 'Test Customer',
      type: 'customer',
      billing_mode: 'money',
      balance: 1400,
    });
    const [oldCreditId] = await database('credits').insert({
      account_id: accountId,
      shift_id: closedShiftId,
      amount: 1000,
      balance: 1000,
      status: 'outstanding',
      created_at: '2026-08-01 08:00:00',
    });
    const [shiftCreditId] = await database('credits').insert({
      account_id: accountId,
      shift_id: openShiftId,
      amount: 400,
      balance: 400,
      status: 'outstanding',
      created_at: '2026-08-02 08:00:00',
    });
    await database('shift_credits').insert({
      shift_id: openShiftId,
      credit_id: shiftCreditId,
      amount: 400,
    });

    const receipt = await recordMoneyAccountPayment(database, {
      accountId,
      amount: 300,
      paymentMethod: 'cash',
      paymentDate: '2026-08-02',
      shiftId: openShiftId,
    });
    await database('invoice_consumption').insert({ shift_id: openShiftId });
    await database('shift_expenses').insert({ shift_id: openShiftId, amount: 50 });

    const preview = await previewShiftCancellation(openShiftId, database);
    assert(preview.credit_entries_to_void === 1, 'Cancellation preview missed the shift credit');
    assert(preview.credit_payments_to_reverse === 1, 'Cancellation preview missed the shift payment');
    assert(preview.invoice_consumption_to_release === 1, 'Cancellation preview missed invoice consumption');
    assert(preview.expenses_to_void === 1, 'Cancellation preview missed the expense');

    const result = await cancelOpenShift(openShiftId, {
      reason: 'Employee did not take up this shift',
      actorId: employeeId,
    }, database);
    assert(result.status === 'cancelled', 'Cancellation did not return cancelled status');

    const shift = await database('shifts').where({ id: openShiftId }).first();
    const oldCredit = await database('credits').where({ id: oldCreditId }).first();
    const shiftCredit = await database('credits').where({ id: shiftCreditId }).first();
    const payment = await database('credit_payments').where({ id: receipt.payment.id }).first();
    const account = await database('credit_accounts').where({ id: accountId }).first();
    const consumption = await database('invoice_consumption').where({ shift_id: openShiftId }).first();
    const expense = await database('shift_expenses').where({ shift_id: openShiftId }).first();

    assert(shift.status === 'cancelled' && shift.cancellation_reason, 'Shift audit fields were not retained');
    assert(money(oldCredit.balance) === 1000 && oldCredit.status === 'outstanding', 'Debt payment was not reversed');
    assert(shiftCredit.status === 'cancelled' && shiftCredit.deleted_at, 'Shift credit was not voided');
    assert(payment.status === 'reversed' && payment.reversal_reason, 'Shift payment was not marked reversed');
    assert(money(account.balance) === 1000, 'Customer account cache was not rebuilt after cancellation');
    assert(consumption.entry_status === 'cancelled' && consumption.deleted_at, 'Invoice consumption was not released');
    assert(expense.deleted_at, 'Shift expense was not voided');

    let duplicateRejected = false;
    try {
      await cancelOpenShift(openShiftId, { reason: 'Repeat cancellation' }, database);
    } catch (error: any) {
      duplicateRejected = error.code === 'SHIFT_NOT_OPEN';
    }
    assert(duplicateRejected, 'Repeated cancellation was not rejected');

    await database('shifts').insert({ employee_id: employeeId, status: 'open' });
    const activeCount = await database('shifts').where({ status: 'open' }).count('* as count').first();
    assert(Number(activeCount?.count || 0) === 1, 'A fresh shift could not be opened after cancellation');

    console.log('PASS open-shift cancellation reverses credits, payments, expenses, and consumption');
    console.log('PASS customer balances, audit metadata, repeat protection, and reopening');
  } finally {
    await database.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
