import assert from 'node:assert/strict';
import knexFactory from 'knex';
import { up as migrateCompensation } from '../migrations/20260728_032_employee_compensation_plans';
import { up as migrateEarnings } from '../migrations/20260728_033_employee_earnings';
import { up as migratePayroll } from '../migrations/20260728_034_payroll_ledger';
import {
  approvePayrollRun,
  calculatePayrollRun,
  refreshPayrollLine,
  refreshPayrollRun,
  voidPayrollRun,
} from '../src/services/payroll';

async function main() {
  const db = knexFactory({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  try {
    await db.raw('PRAGMA foreign_keys = ON');
    await db.schema.createTable('employees', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.decimal('daily_wage', 10, 2).notNullable().defaultTo(0);
      table.string('phone');
      table.boolean('active').notNullable().defaultTo(true);
      table.string('role').notNullable().defaultTo('attendant');
      table.string('pin');
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    await db.schema.createTable('shifts', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').notNullable().references('id').inTable('employees');
      table.date('shift_date');
      table.timestamp('start_time');
      table.timestamp('end_time');
      table.string('status');
      table.decimal('wage_paid', 14, 2).defaultTo(0);
    });
    await db.schema.createTable('wage_deductions', (table) => {
      table.increments('id').primary();
      table.integer('shift_id');
      table.decimal('original_wage', 14, 2);
      table.decimal('deduction_amount', 14, 2);
      table.timestamp('deleted_at');
    });
    await db.schema.createTable('staff_debts', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').notNullable().references('id').inTable('employees');
      table.integer('shift_id').notNullable().references('id').inTable('shifts');
      table.decimal('original_deficit', 14, 2).notNullable();
      table.decimal('deducted_from_wage', 14, 2).notNullable().defaultTo(0);
      table.decimal('carried_forward', 14, 2).notNullable();
      table.decimal('balance', 14, 2).notNullable();
      table.string('status').notNullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    await db.schema.createTable('credit_accounts', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('type').notNullable();
      table.integer('employee_id');
      table.decimal('balance', 14, 2).notNullable().defaultTo(0);
    });

    const [employeeId] = await db('employees').insert({ name: 'Monthly Employee', daily_wage: 0 });
    await migrateCompensation(db);
    await migrateEarnings(db);
    await migratePayroll(db);

    await db('employee_compensation_plans').where({ employee_id: employeeId }).update({
      effective_to: '2026-07-15',
      status: 'ended',
    });
    const [monthlyPlanId] = await db('employee_compensation_plans').insert({
      employee_id: employeeId,
      name: 'Monthly plus commission',
      pay_schedule: 'monthly',
      proration_method: 'calendar_days',
      effective_from: '2026-07-16',
      status: 'active',
      version: 2,
      currency: 'KES',
    });
    const [salaryComponentId] = await db('employee_compensation_components').insert({
      plan_id: monthlyPlanId,
      component_type: 'fixed_periodic',
      amount: 30000,
    });
    await db('employee_earnings').insert({
      employee_id: employeeId,
      plan_id: monthlyPlanId,
      source_type: 'shift',
      source_key: 'shift:commission:test',
      earning_date: '2026-07-20',
      gross_amount: 1000,
      status: 'approved',
    });
    const [debtShiftId] = await db('shifts').insert({
      employee_id: employeeId,
      compensation_plan_id: monthlyPlanId,
      shift_date: '2026-07-20',
      start_time: '2026-07-20 08:00:00',
      end_time: '2026-07-21 08:00:00',
      status: 'closed',
      wage_paid: 0,
    });
    const [debtId] = await db('staff_debts').insert({
      employee_id: employeeId,
      shift_id: debtShiftId,
      original_deficit: 2000,
      carried_forward: 2000,
      balance: 2000,
      status: 'outstanding',
    });
    await db('credit_accounts').insert({
      name: 'Monthly Employee',
      type: 'employee',
      employee_id: employeeId,
      balance: 2000,
    });

    const runId = await calculatePayrollRun({
      name: 'July 2026',
      pay_schedule: 'monthly',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
    }, db);
    const line = await db('payroll_lines').where({ run_id: runId, employee_id: employeeId }).first();
    assert.equal(Number(line.gross_earnings), 16483.87);

    const [deductionId] = await db('payroll_deductions').insert({
      payroll_line_id: line.id,
      employee_id: employeeId,
      deduction_type: 'staff_debt',
      amount: 1000,
      authorization_reference: 'AUTH-001',
      status: 'draft',
    });
    await db.transaction(async (trx) => {
      await refreshPayrollLine(line.id, trx);
      await refreshPayrollRun(runId, trx);
    });
    await approvePayrollRun(runId, null, db);

    assert.equal(Number((await db('staff_debts').where({ id: debtId }).first()).balance), 1000);
    assert.equal(Number((await db('credit_accounts').where({ employee_id: employeeId }).first()).balance), 1000);
    assert.equal(
      Number((await db('payroll_debt_allocations').where({ deduction_id: deductionId }).first()).amount),
      1000,
    );

    const [paymentId] = await db('payroll_payments').insert({
      payroll_line_id: line.id,
      employee_id: employeeId,
      amount: 5000,
      payment_method: 'bank_transfer',
      payment_date: '2026-08-01',
      status: 'posted',
    });
    await db.transaction(async (trx) => {
      await refreshPayrollLine(line.id, trx);
      await refreshPayrollRun(runId, trx);
    });
    assert.equal(Number((await db('payroll_lines').where({ id: line.id }).first()).paid_amount), 5000);
    await assert.rejects(() => voidPayrollRun(runId, 'Incorrect period', db), /Reverse all payroll payments/);

    await db('payroll_payments').where({ id: paymentId }).update({ status: 'reversed', reversed_at: db.fn.now() });
    await db.transaction(async (trx) => {
      await refreshPayrollLine(line.id, trx);
      await refreshPayrollRun(runId, trx);
    });
    await voidPayrollRun(runId, 'Incorrect period', db);
    assert.equal(Number((await db('staff_debts').where({ id: debtId }).first()).balance), 2000);
    assert.equal(Number((await db('credit_accounts').where({ employee_id: employeeId }).first()).balance), 2000);

    const periodicEarning = await db('employee_earnings')
      .where({ component_id: salaryComponentId, source_type: 'pay_period' })
      .first();
    assert.ok(periodicEarning.reversed_at);

    const rerunId = await calculatePayrollRun({
      name: 'July 2026 corrected',
      pay_schedule: 'monthly',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
    }, db);
    const rerunLine = await db('payroll_lines').where({ run_id: rerunId, employee_id: employeeId }).first();
    assert.equal(Number(rerunLine.gross_earnings), 16483.87);

    console.log('PASS payroll proration, earnings aggregation, and duplicate-period protection');
    console.log('PASS debt allocation, payment tracking, reversal guard, void, and corrected rerun');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL payroll ledger tests');
  console.error(error);
  process.exit(1);
});
