import fs from 'fs';
import os from 'os';
import path from 'path';
import knex, { type Knex } from 'knex';
import defaultDb from '../src/database';
import { up as migrateConsumptionControls } from '../migrations/20260730_035_invoice_consumption_controls';
import {
  buildConsumptionCorrectionPreview,
  postConsumptionCorrection,
} from '../src/routes/shifts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function money(value: unknown): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function expectError(action: () => Promise<unknown>, expected: string, status?: number) {
  try {
    await action();
  } catch (err: any) {
    assert(String(err.message).includes(expected), `Expected "${expected}", got "${err.message}"`);
    if (status) assert(err.http === status || err.httpStatus === status, `Expected status ${status}`);
    return;
  }
  throw new Error(`Expected operation to fail with "${expected}"`);
}

async function createSchema(db: Knex) {
  await db.schema.createTable('employees', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
  });
  await db.schema.createTable('tanks', (t) => {
    t.increments('id').primary();
    t.string('label').notNullable();
    t.string('fuel_type').notNullable();
  });
  await db.schema.createTable('pumps', (t) => {
    t.increments('id').primary();
    t.string('label').notNullable();
    t.string('nozzle_label').notNullable();
    t.string('fuel_type').notNullable();
    t.integer('tank_id').nullable();
    t.boolean('active').notNullable().defaultTo(true);
  });
  await db.schema.createTable('shifts', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable();
    t.string('shift_date').notNullable();
    t.string('status').notNullable();
    t.decimal('wage_paid', 14, 2).notNullable().defaultTo(0);
  });
  await db.schema.createTable('pump_readings', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.integer('pump_id').notNullable();
    t.decimal('litres_sold', 14, 2).notNullable();
    t.decimal('amount_sold', 14, 2).notNullable();
  });
  await db.schema.createTable('shift_collections', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.decimal('cash_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('mpesa_amount', 14, 2).notNullable().defaultTo(0);
  });
  await db.schema.createTable('shift_expenses', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('shift_credits', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('credit_payments', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').nullable();
    t.decimal('amount', 14, 2).notNullable();
    t.string('payment_method').notNullable();
    t.string('status').notNullable().defaultTo('posted');
    t.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('payroll_payments', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').nullable();
    t.decimal('amount', 14, 2).notNullable();
    t.string('status').notNullable();
    t.string('reference').nullable();
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
  await db.schema.createTable('staff_debts', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').notNullable();
    t.integer('shift_id').notNullable();
    t.decimal('original_deficit', 14, 2).notNullable();
    t.decimal('deducted_from_wage', 14, 2).notNullable().defaultTo(0);
    t.decimal('carried_forward', 14, 2).notNullable().defaultTo(0);
    t.decimal('balance', 14, 2).notNullable().defaultTo(0);
    t.string('status').notNullable();
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  await db.schema.createTable('invoice_consumption', (t) => {
    t.increments('id').primary();
    t.integer('account_id').notNullable();
    t.integer('shift_id').notNullable();
    t.integer('tank_id').nullable();
    t.string('fuel_type').notNullable();
    t.decimal('litres', 12, 2).notNullable();
    t.decimal('retail_price_at_time', 10, 2).notNullable();
    t.decimal('retail_amount', 14, 2).notNullable();
    t.integer('invoice_line_id').nullable();
    t.timestamp('deleted_at').nullable();
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  await migrateConsumptionControls(db);
}

async function createBalancedShift(db: Knex, employeeId: number, accountId: number, pumpId: number, tankId: number) {
  const [shiftId] = await db('shifts').insert({
    employee_id: employeeId,
    shift_date: '2026-07-30',
    status: 'closed',
    wage_paid: 0,
  });
  await db('pump_readings').insert({
    shift_id: shiftId,
    pump_id: pumpId,
    litres_sold: 100,
    amount_sold: 20000,
  });
  await db('shift_collections').insert({
    shift_id: shiftId,
    cash_amount: 10000,
    mpesa_amount: 0,
  });
  const [entryId] = await db('invoice_consumption').insert({
    account_id: accountId,
    shift_id: shiftId,
    pump_id: pumpId,
    tank_id: tankId,
    fuel_type: 'petrol',
    litres: 50,
    retail_price_at_time: 200,
    retail_amount: 10000,
    entry_status: 'active',
  });
  return { shiftId, entryId };
}

async function preview(db: Knex, shiftId: number, entryId: number, litres: number, pumpId: number, tankId: number) {
  return db.transaction((trx) => buildConsumptionCorrectionPreview(
    trx,
    shiftId,
    entryId,
    { litres, pump_id: pumpId, tank_id: tankId },
  ));
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `nexgen-consumption-correction-${Date.now()}.db`);
  const db = knex({
    client: 'sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(conn: any, done: (err: Error | null, conn?: any) => void) {
        conn.run('PRAGMA foreign_keys = ON', (err: Error | null) => done(err, conn));
      },
    },
  });

  try {
    await createSchema(db);
    const [employeeId] = await db('employees').insert({ name: 'Attendant' });
    const [adminId] = await db('employees').insert({ name: 'Manager' });
    const [accountId] = await db('credit_accounts').insert({
      name: 'Invoice Customer',
      type: 'customer',
      billing_mode: 'invoice',
      balance: 0,
    });
    const [tankId] = await db('tanks').insert({ label: 'Petrol Main', fuel_type: 'petrol' });
    const [pumpId] = await db('pumps').insert({
      label: 'Pump 1',
      nozzle_label: 'P1',
      fuel_type: 'petrol',
      tank_id: tankId,
      active: true,
    });

    const firstShift = await createBalancedShift(db, employeeId, accountId, pumpId, tankId);
    const stalePreview = await preview(db, firstShift.shiftId, firstShift.entryId, 40, pumpId, tankId);
    assert(stalePreview.before.variance === 0, 'Balanced shift preview should start at zero variance');
    assert(stalePreview.after.variance === -2000, 'Reducing attributed consumption should create a KES 2,000 deficit');
    assert(stalePreview.deficit_change === 2000, 'Deficit increase was calculated incorrectly');

    const [interveningId] = await db('invoice_consumption').insert({
      account_id: accountId,
      shift_id: firstShift.shiftId,
      pump_id: pumpId,
      tank_id: tankId,
      fuel_type: 'petrol',
      litres: 1,
      retail_price_at_time: 200,
      retail_amount: 200,
      entry_status: 'active',
    });
    await expectError(
      () => postConsumptionCorrection(db, {
        shiftId: firstShift.shiftId,
        entryId: firstShift.entryId,
        litres: 40,
        pumpId,
        tankId,
        reason: 'Correct customer docket total',
        confirmationToken: stalePreview.confirmation_token,
        actorId: adminId,
      }),
      'changed after the preview',
      409,
    );
    await db('invoice_consumption').where({ id: interveningId }).delete();

    const freshPreview = await preview(db, firstShift.shiftId, firstShift.entryId, 40, pumpId, tankId);
    const posted = await postConsumptionCorrection(db, {
      shiftId: firstShift.shiftId,
      entryId: firstShift.entryId,
      litres: 40,
      pumpId,
      tankId,
      reason: 'Correct customer docket total',
      confirmationToken: freshPreview.confirmation_token,
      actorId: adminId,
    });
    assert(posted.deficit_change === 2000, 'Posted correction deficit change is wrong');
    assert(posted.debt_impact.review_required_amount === 0, 'New deficit should post directly to employee debt');
    const reversed = await db('invoice_consumption').where({ id: firstShift.entryId }).first();
    assert(reversed.entry_status === 'reversed' && reversed.deleted_at, 'Original entry was not preserved as reversed');
    assert(Number(posted.replacement.correction_of_id) === firstShift.entryId, 'Replacement does not link to original');
    const debt = await db('staff_debts').where({ shift_id: firstShift.shiftId }).first();
    assert(money(debt.balance) === 2000, 'Correction did not create the employee deficit');
    const employeeAccount = await db('credit_accounts').where({ employee_id: employeeId, type: 'employee' }).first();
    assert(money(employeeAccount.balance) === 2000, 'Employee debt account cache is wrong');

    const reliefPreview = await preview(
      db,
      firstShift.shiftId,
      posted.replacement.id,
      50,
      pumpId,
      tankId,
    );
    const relieved = await postConsumptionCorrection(db, {
      shiftId: firstShift.shiftId,
      entryId: posted.replacement.id,
      litres: 50,
      pumpId,
      tankId,
      reason: 'Restore verified customer docket',
      confirmationToken: reliefPreview.confirmation_token,
      actorId: adminId,
    });
    assert(relieved.deficit_change === -2000, 'Debt relief amount is wrong');
    assert(relieved.debt_impact.review_required_amount === 0, 'Outstanding debt relief should post automatically');
    const clearedDebt = await db('staff_debts').where({ id: debt.id }).first();
    assert(money(clearedDebt.balance) === 0 && clearedDebt.status === 'cleared', 'Debt was not cleared by the correction');

    const secondShift = await createBalancedShift(db, employeeId, accountId, pumpId, tankId);
    const deficitPreview = await preview(db, secondShift.shiftId, secondShift.entryId, 40, pumpId, tankId);
    const deficitPosted = await postConsumptionCorrection(db, {
      shiftId: secondShift.shiftId,
      entryId: secondShift.entryId,
      litres: 40,
      pumpId,
      tankId,
      reason: 'Correct second customer docket',
      confirmationToken: deficitPreview.confirmation_token,
      actorId: adminId,
    });
    const secondDebt = await db('staff_debts').where({ shift_id: secondShift.shiftId }).first();
    await db('staff_debts').where({ id: secondDebt.id }).update({ balance: 0, status: 'cleared' });
    await db('credit_accounts').where({ employee_id: employeeId, type: 'employee' }).update({ balance: 0 });

    const settledReliefPreview = await preview(
      db,
      secondShift.shiftId,
      deficitPosted.replacement.id,
      50,
      pumpId,
      tankId,
    );
    const settledRelief = await postConsumptionCorrection(db, {
      shiftId: secondShift.shiftId,
      entryId: deficitPosted.replacement.id,
      litres: 50,
      pumpId,
      tankId,
      reason: 'Restore settled customer docket',
      confirmationToken: settledReliefPreview.confirmation_token,
      actorId: adminId,
    });
    assert(settledRelief.debt_impact.review_required_amount === 2000,
      'Settled debt relief should require manager review');
    const reviewRow = await db('staff_debt_adjustments')
      .where({ shift_id: secondShift.shiftId, status: 'review_required' })
      .first();
    assert(reviewRow && money(reviewRow.amount) === 2000, 'Review-required adjustment was not recorded');

    await expectError(
      () => preview(db, secondShift.shiftId, settledRelief.replacement.id, 100.02, pumpId, tankId),
      'sold only 100.00 L',
      400,
    );

    console.log('PASS correction preview and stale-token protection');
    console.log('PASS reversal/replacement audit trail and increased employee deficit');
    console.log('PASS outstanding debt relief and settled-debt manager review');
    console.log('PASS corrected litres remain bounded by shift pump sales');
  } finally {
    await db.destroy();
    await defaultDb.destroy();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbFile}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  await defaultDb.destroy();
  process.exit(1);
});
