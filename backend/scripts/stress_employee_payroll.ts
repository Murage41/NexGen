import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import knexFactory from 'knex';
import { up as migrateCompensation } from '../migrations/20260728_032_employee_compensation_plans';
import { up as migrateEarnings } from '../migrations/20260728_033_employee_earnings';
import { up as migratePayroll } from '../migrations/20260728_034_payroll_ledger';
import {
  approvePayrollRun,
  calculatePayrollRun,
  getPayrollRun,
} from '../src/services/payroll';

const EMPLOYEE_COUNT = 500;
const EXPECTED_GROSS_PER_EMPLOYEE = 35000;

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

    await db('employees').insert(Array.from({ length: EMPLOYEE_COUNT }, (_, index) => ({
      name: `Stress Employee ${String(index + 1).padStart(4, '0')}`,
      daily_wage: 0,
      role: index === 0 ? 'admin' : 'attendant',
      pin: '0000',
    })));
    await migrateCompensation(db);
    await migrateEarnings(db);
    await migratePayroll(db);

    await db('employee_compensation_plans').update({
      name: 'Stress monthly plan',
      pay_schedule: 'monthly',
      effective_from: '2026-07-01',
      proration_method: 'calendar_days',
    });
    await db('employee_compensation_components').update({
      component_type: 'fixed_periodic',
      amount: 30000,
    });
    const plans = await db('employee_compensation_plans').select('id');
    await db('employee_compensation_components').insert(plans.map((plan) => ({
      plan_id: plan.id,
      component_type: 'fixed_periodic',
      amount: 5000,
    })));

    const calculateStarted = performance.now();
    const runId = await calculatePayrollRun({
      name: 'July 2026 stress payroll',
      pay_schedule: 'monthly',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
    }, db);
    const calculateMs = performance.now() - calculateStarted;

    const runRow = await db('payroll_runs').where({ id: runId }).first();
    const lines = await db('payroll_lines').where({ run_id: runId });
    const earningCount = Number((await db('employee_earnings').count('* as count').first())?.count || 0);
    assert.equal(lines.length, EMPLOYEE_COUNT);
    assert.equal(earningCount, EMPLOYEE_COUNT * 2);
    assert.equal(Number(runRow.gross_total), EMPLOYEE_COUNT * EXPECTED_GROSS_PER_EMPLOYEE);
    assert.equal(
      Number((await db('employee_earnings').where({ status: 'calculated' }).count('* as count').first())?.count || 0),
      EMPLOYEE_COUNT * 2,
    );

    const detailStarted = performance.now();
    const detail = await getPayrollRun(runId, db);
    const detailMs = performance.now() - detailStarted;
    assert.equal(detail.lines.length, EMPLOYEE_COUNT);
    assert.ok(detail.lines.every((line: any) => line.earnings.length === 2));

    await approvePayrollRun(runId, null, db);
    assert.equal((await db('payroll_runs').where({ id: runId }).first()).status, 'approved');
    assert.equal(
      Number((await db('employee_earnings').where({ status: 'approved' }).count('* as count').first())?.count || 0),
      EMPLOYEE_COUNT * 2,
    );
    await assert.rejects(
      () => calculatePayrollRun({
        name: 'Duplicate stress payroll',
        pay_schedule: 'monthly',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
      }, db),
      (error: any) => error.code === 'PAYROLL_PERIOD_EXISTS',
    );

    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    assert.ok(calculateMs < 15000, `Payroll calculation took ${calculateMs.toFixed(0)} ms`);
    assert.ok(detailMs < 5000, `Payroll detail read took ${detailMs.toFixed(0)} ms`);
    assert.ok(heapMb < 256, `Payroll stress test used ${heapMb.toFixed(1)} MB heap`);

    console.log(`PASS ${EMPLOYEE_COUNT} employees, ${earningCount} earnings, ${lines.length} payroll lines`);
    console.log(`PASS calculation ${calculateMs.toFixed(0)} ms, detail read ${detailMs.toFixed(0)} ms, heap ${heapMb.toFixed(1)} MB`);
    console.log('PASS approval and duplicate-period protection under load');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL employee payroll stress test');
  console.error(error);
  process.exit(1);
});
