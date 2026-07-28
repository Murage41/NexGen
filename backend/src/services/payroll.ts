import type { Knex } from 'knex';
import Decimal, { Numeric } from 'decimal.js-light';
import db from '../database';
import { getCompensationPlanById } from './compensation';

function money(value: Numeric): number {
  return new Decimal(value || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function dateValue(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function inclusiveDays(start: string, end: string): number {
  return Math.floor((dateValue(end) - dateValue(start)) / 86400000) + 1;
}

function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

function earlierDate(a: string, b: string): string {
  return a < b ? a : b;
}

export async function generatePeriodicEarnings(
  period: {
    id: number;
    pay_schedule: string;
    period_start: string;
    period_end: string;
  },
  trx: Knex.Transaction,
): Promise<void> {
  const plans = await trx('employee_compensation_plans')
    .where({ pay_schedule: period.pay_schedule })
    .where('effective_from', '<=', period.period_end)
    .where((query) => {
      query.whereNull('effective_to').orWhere('effective_to', '>=', period.period_start);
    })
    .orderBy('employee_id')
    .orderBy('effective_from');
  const periodDays = inclusiveDays(period.period_start, period.period_end);

  for (const planRow of plans) {
    const plan = await getCompensationPlanById(Number(planRow.id), trx);
    if (!plan) continue;
    const overlapStart = laterDate(period.period_start, String(plan.effective_from).slice(0, 10));
    const overlapEnd = earlierDate(
      period.period_end,
      plan.effective_to ? String(plan.effective_to).slice(0, 10) : period.period_end,
    );
    if (overlapStart > overlapEnd) continue;
    const overlapDays = inclusiveDays(overlapStart, overlapEnd);

    for (const component of plan.components.filter((row) => row.component_type === 'fixed_periodic')) {
      const sourceKey = `payroll-period:${period.id}:plan:${plan.id}:component:${component.id}`;
      if (await trx('employee_earnings').where({ source_key: sourceKey }).first()) continue;
      const fullAmount = new Decimal(component.amount || 0);
      const gross = plan.proration_method === 'none'
        ? fullAmount
        : fullAmount.mul(overlapDays).div(periodDays);
      await trx('employee_earnings').insert({
        employee_id: plan.employee_id,
        plan_id: plan.id,
        component_id: component.id || null,
        source_type: 'pay_period',
        source_key: sourceKey,
        earning_date: period.period_end,
        basis_quantity: overlapDays,
        rate: money(component.amount || 0),
        gross_amount: money(gross),
        status: 'approved',
        description: `${plan.pay_schedule} fixed compensation (${overlapDays}/${periodDays} days)`,
        approved_at: trx.fn.now(),
      });
    }
  }
}

export async function refreshPayrollLine(
  lineId: number,
  trx: Knex.Transaction | Knex = db,
): Promise<any> {
  const line = await trx('payroll_lines').where({ id: lineId }).first();
  if (!line) throw new Error('Payroll line not found');
  const deductionRow = await trx('payroll_deductions')
    .where({ payroll_line_id: lineId })
    .whereNot({ status: 'reversed' })
    .sum('amount as total')
    .first();
  const paymentRow = await trx('payroll_payments')
    .where({ payroll_line_id: lineId, status: 'posted' })
    .sum('amount as total')
    .first();
  const deductions = money(deductionRow?.total || 0);
  const net = money(new Decimal(line.gross_earnings || 0).minus(deductions));
  const paid = money(paymentRow?.total || 0);
  const balance = money(Math.max(0, net - paid));
  const status = balance <= 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid';
  await trx('payroll_lines').where({ id: lineId }).update({
    total_deductions: deductions,
    net_pay: net,
    paid_amount: paid,
    balance_due: balance,
    status,
    updated_at: trx.fn.now(),
  });
  return trx('payroll_lines').where({ id: lineId }).first();
}

export async function refreshPayrollRun(
  runId: number,
  trx: Knex.Transaction | Knex = db,
): Promise<any> {
  const totals = await trx('payroll_lines')
    .where({ run_id: runId })
    .sum({
      gross: 'gross_earnings',
      deductions: 'total_deductions',
      net: 'net_pay',
      paid: 'paid_amount',
      due: 'balance_due',
    })
    .first();
  const run = await trx('payroll_runs').where({ id: runId }).first();
  if (!run) throw new Error('Payroll run not found');
  let status = run.status;
  if (run.status === 'approved' || run.status === 'partially_paid' || run.status === 'paid') {
    status = Number(totals?.due || 0) <= 0
      ? 'paid'
      : Number(totals?.paid || 0) > 0
        ? 'partially_paid'
        : 'approved';
  }
  await trx('payroll_runs').where({ id: runId }).update({
    gross_total: money(totals?.gross || 0),
    deduction_total: money(totals?.deductions || 0),
    net_total: money(totals?.net || 0),
    paid_total: money(totals?.paid || 0),
    status,
    updated_at: trx.fn.now(),
  });
  await trx('payroll_periods').where({ id: run.period_id }).update({
    status,
    updated_at: trx.fn.now(),
  });
  return trx('payroll_runs').where({ id: runId }).first();
}

export async function calculatePayrollRun(
  input: {
    name: string;
    pay_schedule: string;
    period_start: string;
    period_end: string;
    created_by_employee_id?: number | null;
  },
  database: Knex = db,
): Promise<number> {
  return database.transaction(async (trx) => {
    const existingPeriod = await trx('payroll_periods')
      .where({
        pay_schedule: input.pay_schedule,
        period_start: input.period_start,
        period_end: input.period_end,
      })
      .whereNot({ status: 'void' })
      .first();
    if (existingPeriod) {
      const error: any = new Error('A payroll run already exists for this schedule and period.');
      error.code = 'PAYROLL_PERIOD_EXISTS';
      throw error;
    }

    const [periodId] = await trx('payroll_periods').insert({
      name: input.name,
      pay_schedule: input.pay_schedule,
      period_start: input.period_start,
      period_end: input.period_end,
      status: 'calculated',
    });
    const [runId] = await trx('payroll_runs').insert({
      period_id: periodId,
      status: 'calculated',
      created_by_employee_id: input.created_by_employee_id || null,
    });

    await generatePeriodicEarnings({
      id: periodId,
      pay_schedule: input.pay_schedule,
      period_start: input.period_start,
      period_end: input.period_end,
    }, trx);

    const earnings = await trx('employee_earnings as earning')
      .leftJoin('payroll_line_earnings as link', function joinUnreleased() {
        this.on('link.earning_id', '=', 'earning.id').andOnNull('link.released_at');
      })
      .whereNull('link.id')
      .whereNull('earning.reversed_at')
      .where({ 'earning.status': 'approved' })
      .whereBetween('earning.earning_date', [input.period_start, input.period_end])
      .select('earning.*')
      .orderBy('earning.employee_id')
      .orderBy('earning.earning_date');

    const byEmployee = new Map<number, any[]>();
    for (const earning of earnings) {
      const employeeId = Number(earning.employee_id);
      const rows = byEmployee.get(employeeId) || [];
      rows.push(earning);
      byEmployee.set(employeeId, rows);
    }

    for (const [employeeId, rows] of byEmployee) {
      const gross = money(rows.reduce((sum, earning) => sum + Number(earning.gross_amount || 0), 0));
      const [lineId] = await trx('payroll_lines').insert({
        run_id: runId,
        employee_id: employeeId,
        gross_earnings: gross,
        net_pay: gross,
        balance_due: gross,
        status: gross > 0 ? 'unpaid' : 'paid',
      });
      await trx('payroll_line_earnings').insert(
        rows.map((earning) => ({ payroll_line_id: lineId, earning_id: earning.id })),
      );
    }

    await refreshPayrollRun(runId, trx);
    return runId;
  });
}

export async function getPayrollRun(runId: number): Promise<any | null> {
  const run = await db('payroll_runs')
    .join('payroll_periods', 'payroll_runs.period_id', 'payroll_periods.id')
    .where('payroll_runs.id', runId)
    .select(
      'payroll_runs.*',
      'payroll_periods.name',
      'payroll_periods.pay_schedule',
      'payroll_periods.period_start',
      'payroll_periods.period_end',
    )
    .first();
  if (!run) return null;
  const lines = await db('payroll_lines')
    .join('employees', 'payroll_lines.employee_id', 'employees.id')
    .where('payroll_lines.run_id', runId)
    .select('payroll_lines.*', 'employees.name as employee_name')
    .orderBy('employees.name');
  for (const line of lines) {
    line.earnings = await db('payroll_line_earnings')
      .join('employee_earnings', 'payroll_line_earnings.earning_id', 'employee_earnings.id')
      .where({ 'payroll_line_earnings.payroll_line_id': line.id })
      .whereNull('payroll_line_earnings.released_at')
      .select('employee_earnings.*')
      .orderBy('employee_earnings.earning_date');
    line.deductions = await db('payroll_deductions')
      .where({ payroll_line_id: line.id })
      .orderBy('created_at');
    line.payments = await db('payroll_payments')
      .where({ payroll_line_id: line.id })
      .orderBy('payment_date')
      .orderBy('id');
  }
  return { ...run, lines };
}

export async function applyStaffDebtDeduction(
  deduction: any,
  trx: Knex.Transaction,
): Promise<void> {
  let remaining = Number(deduction.amount || 0);
  const debts = await trx('staff_debts')
    .where({ employee_id: deduction.employee_id, status: 'outstanding' })
    .orderBy('created_at')
    .orderBy('id');
  const outstanding = debts.reduce((sum, debt) => sum + Number(debt.balance || 0), 0);
  if (remaining > outstanding) {
    throw new Error(
      `Staff debt deduction of KES ${remaining.toFixed(2)} exceeds outstanding debt of KES ${outstanding.toFixed(2)}`,
    );
  }

  for (const debt of debts) {
    if (remaining <= 0) break;
    const amount = money(Math.min(remaining, Number(debt.balance || 0)));
    const balance = money(Number(debt.balance || 0) - amount);
    await trx('staff_debts').where({ id: debt.id }).update({
      balance,
      status: balance <= 0 ? 'cleared' : 'outstanding',
    });
    await trx('payroll_debt_allocations').insert({
      deduction_id: deduction.id,
      staff_debt_id: debt.id,
      amount,
    });
    remaining = money(remaining - amount);
  }

  const account = await trx('credit_accounts')
    .where({ employee_id: deduction.employee_id, type: 'employee' })
    .first();
  if (account) {
    await trx('credit_accounts').where({ id: account.id }).update({
      balance: money(Math.max(0, Number(account.balance || 0) - Number(deduction.amount || 0))),
    });
  }
}

export async function approvePayrollRun(
  runId: number,
  approvedByEmployeeId?: number | null,
  database: Knex = db,
): Promise<void> {
  await database.transaction(async (trx) => {
    const run = await trx('payroll_runs').where({ id: runId }).first();
    if (!run) throw new Error('Payroll run not found');
    if (run.status !== 'calculated') throw new Error('Only a calculated payroll run can be approved');

    const deductions = await trx('payroll_deductions')
      .join('payroll_lines', 'payroll_deductions.payroll_line_id', 'payroll_lines.id')
      .where({ 'payroll_lines.run_id': runId, 'payroll_deductions.status': 'draft' })
      .select('payroll_deductions.*');
    for (const deduction of deductions) {
      if (deduction.deduction_type === 'staff_debt') {
        await applyStaffDebtDeduction(deduction, trx);
      }
      await trx('payroll_deductions').where({ id: deduction.id }).update({
        status: 'approved',
        approved_at: trx.fn.now(),
      });
    }
    await trx('payroll_runs').where({ id: runId }).update({
      status: 'approved',
      approved_by_employee_id: approvedByEmployeeId || null,
      approved_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    await trx('payroll_periods').where({ id: run.period_id }).update({
      status: 'approved',
      updated_at: trx.fn.now(),
    });
    await refreshPayrollRun(runId, trx);
  });
}

export async function voidPayrollRun(
  runId: number,
  reason: string,
  database: Knex = db,
): Promise<void> {
  await database.transaction(async (trx) => {
    const run = await trx('payroll_runs').where({ id: runId }).first();
    if (!run) throw new Error('Payroll run not found');
    if (run.status === 'void') throw new Error('Payroll run is already void');

    const activePayment = await trx('payroll_payments')
      .join('payroll_lines', 'payroll_payments.payroll_line_id', 'payroll_lines.id')
      .where({ 'payroll_lines.run_id': runId, 'payroll_payments.status': 'posted' })
      .first();
    if (activePayment) throw new Error('Reverse all payroll payments before voiding this run');

    const allocations = await trx('payroll_debt_allocations')
      .join('payroll_deductions', 'payroll_debt_allocations.deduction_id', 'payroll_deductions.id')
      .join('payroll_lines', 'payroll_deductions.payroll_line_id', 'payroll_lines.id')
      .where({ 'payroll_lines.run_id': runId })
      .whereNull('payroll_debt_allocations.reversed_at')
      .select(
        'payroll_debt_allocations.*',
        'payroll_deductions.employee_id',
      );
    const restoredByEmployee = new Map<number, number>();
    for (const allocation of allocations) {
      const debt = await trx('staff_debts').where({ id: allocation.staff_debt_id }).first();
      if (debt) {
        await trx('staff_debts').where({ id: debt.id }).update({
          balance: money(Number(debt.balance || 0) + Number(allocation.amount || 0)),
          status: 'outstanding',
        });
      }
      await trx('payroll_debt_allocations').where({ id: allocation.id }).update({
        reversed_at: trx.fn.now(),
      });
      const employeeId = Number(allocation.employee_id);
      restoredByEmployee.set(
        employeeId,
        money((restoredByEmployee.get(employeeId) || 0) + Number(allocation.amount || 0)),
      );
    }
    for (const [employeeId, amount] of restoredByEmployee) {
      const account = await trx('credit_accounts').where({ employee_id: employeeId, type: 'employee' }).first();
      if (account) {
        await trx('credit_accounts').where({ id: account.id }).update({
          balance: money(Number(account.balance || 0) + amount),
        });
      }
    }

    const links = await trx('payroll_line_earnings')
      .join('payroll_lines', 'payroll_line_earnings.payroll_line_id', 'payroll_lines.id')
      .where({ 'payroll_lines.run_id': runId })
      .whereNull('payroll_line_earnings.released_at')
      .select('payroll_line_earnings.id', 'payroll_line_earnings.earning_id');
    if (links.length > 0) {
      await trx('payroll_line_earnings')
        .whereIn('id', links.map((link) => link.id))
        .update({ released_at: trx.fn.now() });
      await trx('employee_earnings')
        .whereIn('id', links.map((link) => link.earning_id))
        .where({ source_type: 'pay_period' })
        .update({ status: 'reversed', reversed_at: trx.fn.now() });
    }

    await trx('payroll_deductions')
      .whereIn('payroll_line_id', trx('payroll_lines').where({ run_id: runId }).select('id'))
      .whereNot({ status: 'reversed' })
      .update({ status: 'reversed', reversed_at: trx.fn.now() });
    await trx('payroll_lines').where({ run_id: runId }).update({
      status: 'void',
      balance_due: 0,
      updated_at: trx.fn.now(),
    });
    await trx('payroll_runs').where({ id: runId }).update({
      status: 'void',
      voided_at: trx.fn.now(),
      void_reason: reason,
      updated_at: trx.fn.now(),
    });
    await trx('payroll_periods').where({ id: run.period_id }).update({
      status: 'void',
      updated_at: trx.fn.now(),
    });
  });
}
