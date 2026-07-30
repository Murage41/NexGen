import assert from 'node:assert/strict';
import knexFactory from 'knex';
import { up as migrateCompensation } from '../migrations/20260728_032_employee_compensation_plans';
import { up as migrateEarnings } from '../migrations/20260728_033_employee_earnings';
import { up as migratePayroll } from '../migrations/20260728_034_payroll_ledger';
import {
  approvePayrollRun,
  calculatePayrollRun,
  previewPayrollRun,
  voidPayrollRun,
} from '../src/services/payroll';
import {
  getPayrollCashPaid,
  getPayrollExpense,
  getTotalPayrollCashOutflow,
  getUnmirroredShiftWagesPaid,
} from '../src/services/payrollAccounting';
import {
  suggestedPayrollPeriod,
  validatePayrollPeriod,
} from '../src/services/payrollPeriods';

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
      table.decimal('daily_wage', 14, 2).notNullable().defaultTo(0);
      table.boolean('active').notNullable().defaultTo(true);
    });
    await db.schema.createTable('shifts', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').notNullable().references('id').inTable('employees');
      table.date('shift_date');
      table.timestamp('start_time');
      table.timestamp('end_time');
      table.string('status').notNullable();
      table.decimal('wage_paid', 14, 2).notNullable().defaultTo(0);
    });
    await db.schema.createTable('wage_deductions', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').notNullable().references('id').inTable('shifts');
      table.decimal('original_wage', 14, 2);
      table.decimal('deduction_amount', 14, 2);
      table.decimal('final_wage', 14, 2);
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
    });
    await db.schema.createTable('credit_accounts', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('type').notNullable();
      table.integer('employee_id');
      table.decimal('balance', 14, 2).notNullable().defaultTo(0);
    });

    await migrateCompensation(db);
    await migrateEarnings(db);
    await migratePayroll(db);

    const [dailyA] = await db('employees').insert({ name: 'Daily A', daily_wage: 800 });
    const [dailyB] = await db('employees').insert({ name: 'Daily B', daily_wage: 800 });
    const [monthly] = await db('employees').insert({ name: 'Monthly C', daily_wage: 800 });
    const employeeIds = [dailyA, dailyB, monthly];

    const planIds: number[] = [];
    for (const [index, employeeId] of employeeIds.entries()) {
      const schedule = index < 2 ? 'daily' : 'monthly';
      const [planId] = await db('employee_compensation_plans').insert({
        employee_id: employeeId,
        name: `${schedule} per-shift plan`,
        pay_schedule: schedule,
        proration_method: 'calendar_days',
        effective_from: '2026-07-01',
        status: 'active',
        version: 1,
        currency: 'KES',
      });
      await db('employee_compensation_components').insert({
        plan_id: planId,
        component_type: 'fixed_per_shift',
        amount: 800,
      });
      planIds.push(planId);
    }

    async function addShift(
      employeeId: number,
      planId: number,
      date: string,
      wagePaid: number,
      sourceKey: string,
    ) {
      const [shiftId] = await db('shifts').insert({
        employee_id: employeeId,
        compensation_plan_id: planId,
        shift_date: date,
        start_time: `${date} 08:00:00`,
        end_time: `${date} 20:00:00`,
        status: 'closed',
        wage_paid: wagePaid,
        earnings_generated_at: `${date} 20:00:00`,
      });
      await db('employee_earnings').insert({
        employee_id: employeeId,
        shift_id: shiftId,
        plan_id: planId,
        source_type: 'shift',
        source_key: sourceKey,
        earning_date: date,
        gross_amount: 800,
        status: 'approved',
      });
      return shiftId;
    }

    const dailyAShift = await addShift(dailyA, planIds[0], '2026-07-01', 800, 'daily-a:1');
    const dailyBShift = await addShift(dailyB, planIds[1], '2026-07-01', 800, 'daily-b:1');
    await db('wage_deductions').insert({
      shift_id: dailyBShift,
      original_wage: 800,
      deduction_amount: 100,
      final_wage: 700,
    });
    // Historical databases do not enforce one deduction row per shift.
    await db('wage_deductions').insert({
      shift_id: dailyBShift,
      original_wage: 800,
      deduction_amount: 100,
      final_wage: 700,
    });
    await addShift(monthly, planIds[2], '2026-07-01', 0, 'monthly-c:1');
    await addShift(monthly, planIds[2], '2026-07-02', 0, 'monthly-c:2');
    await addShift(monthly, planIds[2], '2026-07-03', 0, 'monthly-c:3');
    await db('employee_earnings').insert({
      employee_id: dailyA,
      plan_id: planIds[0],
      source_type: 'legacy_shift',
      source_key: 'legacy-paid-before-payroll',
      earning_date: '2026-07-01',
      gross_amount: 999,
      status: 'approved',
    });

    assert.deepEqual(suggestedPayrollPeriod('daily', '2026-07-15'), {
      start: '2026-07-15',
      end: '2026-07-15',
    });
    assert.deepEqual(suggestedPayrollPeriod('monthly', '2026-07-15'), {
      start: '2026-06-01',
      end: '2026-06-30',
    });
    assert.throws(
      () => validatePayrollPeriod({
        pay_schedule: 'daily',
        period_start: '2026-07-01',
        period_end: '2026-07-02',
      }, '2026-08-01'),
      /exactly one work date/,
    );
    assert.throws(
      () => validatePayrollPeriod({
        pay_schedule: 'monthly',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
      }, '2026-07-30'),
      /before that work date is complete/,
    );
    assert.doesNotThrow(
      () => validatePayrollPeriod({
        pay_schedule: 'weekly',
        period_start: '2026-07-01',
        period_end: '2026-07-07',
      }, '2026-08-01'),
    );

    assert.equal(await getUnmirroredShiftWagesPaid('2026-07-01', '2026-07-01', db), 1500);
    assert.equal(await getPayrollCashPaid('2026-07-01', '2026-07-01', db), 0);

    const dailyPreview = await previewPayrollRun({
      pay_schedule: 'daily',
      period_start: '2026-07-01',
      period_end: '2026-07-01',
    }, db, '2026-08-01');
    assert.equal(dailyPreview.employee_count, 2);
    assert.equal(dailyPreview.gross_total, 1600);
    assert.equal(dailyPreview.deduction_total, 100);
    assert.equal(dailyPreview.prior_paid_total, 1500);
    assert.equal(dailyPreview.balance_due, 0);

    const dailyRunId = await calculatePayrollRun({
      name: 'Daily payroll 2026-07-01',
      pay_schedule: 'daily',
      period_start: '2026-07-01',
      period_end: '2026-07-01',
    }, db, '2026-08-01');
    const dailyLines = await db('payroll_lines').where({ run_id: dailyRunId }).orderBy('employee_id');
    assert.equal(dailyLines.length, 2);
    assert.equal(Number(dailyLines[0].paid_amount), 800);
    assert.equal(Number(dailyLines[0].balance_due), 0);
    assert.equal(Number(dailyLines[1].total_deductions), 100);
    assert.equal(Number(dailyLines[1].paid_amount), 700);
    assert.equal(Number(dailyLines[1].balance_due), 0);
    assert.equal(
      Number((await db('payroll_payments').where({ shift_id: dailyAShift }).first()).amount),
      800,
    );
    assert.equal(await getUnmirroredShiftWagesPaid('2026-07-01', '2026-07-01', db), 0);
    assert.equal(await getPayrollCashPaid('2026-07-01', '2026-07-01', db), 1500);
    assert.equal(await getTotalPayrollCashOutflow('2026-07-01', '2026-07-01', db), 1500);

    await approvePayrollRun(dailyRunId, null, db);
    assert.equal((await db('payroll_runs').where({ id: dailyRunId }).first()).status, 'paid');
    await assert.rejects(
      () => calculatePayrollRun({
        name: 'Overlapping daily payroll',
        pay_schedule: 'daily',
        period_start: '2026-07-01',
        period_end: '2026-07-01',
      }, db, '2026-08-01'),
      /already covers/,
    );
    const emptyDailyPreview = await previewPayrollRun({
      pay_schedule: 'daily',
      period_start: '2026-07-02',
      period_end: '2026-07-02',
    }, db, '2026-08-01');
    assert.equal(emptyDailyPreview.employee_count, 0);
    await assert.rejects(
      () => calculatePayrollRun({
        name: 'Empty daily payroll',
        pay_schedule: 'daily',
        period_start: '2026-07-02',
        period_end: '2026-07-02',
      }, db, '2026-08-01'),
      /No unprocessed daily earnings/,
    );

    const [openMonthlyShift] = await db('shifts').insert({
      employee_id: monthly,
      compensation_plan_id: planIds[2],
      shift_date: '2026-07-31',
      start_time: '2026-07-31 08:00:00',
      status: 'open',
      wage_paid: 0,
    });
    await assert.rejects(
      () => previewPayrollRun({
        pay_schedule: 'monthly',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
      }, db, '2026-08-01'),
      /Close monthly shift/,
    );
    await db('shifts').where({ id: openMonthlyShift }).delete();

    const monthlyPreview = await previewPayrollRun({
      pay_schedule: 'monthly',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
    }, db, '2026-08-01');
    assert.equal(monthlyPreview.employee_count, 1);
    assert.equal(monthlyPreview.gross_total, 2400);
    assert.equal(monthlyPreview.prior_paid_total, 0);
    assert.equal(monthlyPreview.balance_due, 2400);

    const monthlyRunId = await calculatePayrollRun({
      name: 'July monthly payroll',
      pay_schedule: 'monthly',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
    }, db, '2026-08-01');
    const monthlyLines = await db('payroll_lines').where({ run_id: monthlyRunId });
    assert.equal(monthlyLines.length, 1);
    assert.equal(Number(monthlyLines[0].employee_id), monthly);
    assert.equal(Number(monthlyLines[0].gross_earnings), 2400);
    assert.equal(Number(monthlyLines[0].balance_due), 2400);

    assert.equal(await getPayrollExpense('2026-07-01', '2026-07-01', db), 3399);
    await voidPayrollRun(dailyRunId, 'Verify direct-wage reconciliation rerun', db);
    assert.equal(await getPayrollCashPaid('2026-07-01', '2026-07-01', db), 0);
    assert.equal(await getUnmirroredShiftWagesPaid('2026-07-01', '2026-07-01', db), 1500);
    assert.equal(await getTotalPayrollCashOutflow('2026-07-01', '2026-07-01', db), 1500);

    const correctedDailyRunId = await calculatePayrollRun({
      name: 'Corrected daily payroll 2026-07-01',
      pay_schedule: 'daily',
      period_start: '2026-07-01',
      period_end: '2026-07-01',
    }, db, '2026-08-01');
    assert.notEqual(correctedDailyRunId, dailyRunId);
    assert.equal(
      await db('payroll_payments')
        .where({ status: 'posted' })
        .where('reference', 'like', 'SHIFT-WAGE:%')
        .count<{ total: number }[]>({ total: '*' })
        .first()
        .then((row) => Number(row?.total || 0)),
      2,
    );
    assert.equal(await getTotalPayrollCashOutflow('2026-07-01', '2026-07-01', db), 1500);
    console.log('PASS schedule periods, mixed daily/monthly isolation, and open-shift guard');
    console.log('PASS direct wage reconciliation, void/rerun, cash outflow, and accrual expense');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL payroll schedule tests');
  console.error(error);
  process.exit(1);
});
