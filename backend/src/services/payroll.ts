import type { Knex } from 'knex';
import Decimal, { Numeric } from 'decimal.js-light';
import db from '../database';
import {
  PaySchedule,
  PayrollPeriodError,
  validatePayrollPeriod,
} from './payrollPeriods';

interface PayrollRunInput {
  name: string;
  pay_schedule: PaySchedule;
  period_start: string;
  period_end: string;
  created_by_employee_id?: number | null;
}

interface PayrollPeriod {
  id?: number;
  pay_schedule: PaySchedule;
  period_start: string;
  period_end: string;
}

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

async function insertRowsInChunks(
  trx: Knex.Transaction,
  table: string,
  rows: any[],
  chunkSize = 250,
): Promise<void> {
  for (let index = 0; index < rows.length; index += chunkSize) {
    await trx(table).insert(rows.slice(index, index + chunkSize));
  }
}

async function buildPeriodicEarningRows(
  period: PayrollPeriod,
  trx: Knex.Transaction | Knex,
): Promise<any[]> {
  const plans = await trx('employee_compensation_plans')
    .where({ pay_schedule: period.pay_schedule })
    .where('effective_from', '<=', period.period_end)
    .where((query) => {
      query.whereNull('effective_to').orWhere('effective_to', '>=', period.period_start);
    })
    .orderBy('employee_id')
    .orderBy('effective_from');
  if (plans.length === 0) return [];

  const components = await trx('employee_compensation_components')
    .whereIn('plan_id', plans.map((plan) => plan.id))
    .where({ component_type: 'fixed_periodic' })
    .orderBy('id');
  const componentsByPlan = new Map<number, any[]>();
  for (const component of components) {
    const planComponents = componentsByPlan.get(Number(component.plan_id)) || [];
    planComponents.push(component);
    componentsByPlan.set(Number(component.plan_id), planComponents);
  }

  const periodDays = inclusiveDays(period.period_start, period.period_end);
  const earningRows: any[] = [];

  for (const planRow of plans) {
    const overlapStart = laterDate(period.period_start, String(planRow.effective_from).slice(0, 10));
    const overlapEnd = earlierDate(
      period.period_end,
      planRow.effective_to ? String(planRow.effective_to).slice(0, 10) : period.period_end,
    );
    if (overlapStart > overlapEnd) continue;
    const overlapDays = inclusiveDays(overlapStart, overlapEnd);

    for (const component of componentsByPlan.get(Number(planRow.id)) || []) {
      const sourceKey = `payroll-period:${period.id}:plan:${planRow.id}:component:${component.id}`;
      const fullAmount = new Decimal(component.amount || 0);
      const gross = planRow.proration_method === 'none'
        ? fullAmount
        : fullAmount.mul(overlapDays).div(periodDays);
      earningRows.push({
        employee_id: planRow.employee_id,
        plan_id: planRow.id,
        component_id: component.id || null,
        source_type: 'pay_period',
        source_key: sourceKey,
        earning_date: period.period_end,
        basis_quantity: overlapDays,
        rate: money(component.amount || 0),
        gross_amount: money(gross),
        status: 'calculated',
        description: `${planRow.pay_schedule} fixed compensation (${overlapDays}/${periodDays} days)`,
      });
    }
  }

  return earningRows;
}

export async function generatePeriodicEarnings(
  period: PayrollPeriod & { id: number },
  trx: Knex.Transaction,
): Promise<void> {
  const earningRows = await buildPeriodicEarningRows(period, trx);
  if (earningRows.length === 0) return;
  const existingRows = await trx('employee_earnings')
    .whereIn('source_key', earningRows.map((row) => row.source_key))
    .select('source_key');
  const existingKeys = new Set(existingRows.map((row) => row.source_key));
  const pendingRows = earningRows.filter((row) => !existingKeys.has(row.source_key));
  if (pendingRows.length > 0) {
    await insertRowsInChunks(trx, 'employee_earnings', pendingRows);
  }
}

async function assertPayrollPeriodAvailable(
  input: PayrollPeriod,
  database: Knex.Transaction | Knex,
  asOfDate?: string,
): Promise<void> {
  validatePayrollPeriod(input, asOfDate);

  const overlap = await database('payroll_periods')
    .where({ pay_schedule: input.pay_schedule })
    .whereNot({ status: 'void' })
    .where('period_start', '<=', input.period_end)
    .where('period_end', '>=', input.period_start)
    .orderBy('period_start')
    .first();
  if (overlap) {
    throw new PayrollPeriodError(
      'PAYROLL_PERIOD_OVERLAP',
      `${input.pay_schedule} payroll already covers ${overlap.period_start} to ${overlap.period_end}.`,
    );
  }

  const openShifts = await database('shifts')
    .join(
      'employee_compensation_plans as plan',
      'shifts.compensation_plan_id',
      'plan.id',
    )
    .where({ 'shifts.status': 'open', 'plan.pay_schedule': input.pay_schedule })
    .whereRaw(
      'COALESCE(shifts.shift_date, DATE(shifts.start_time)) BETWEEN ? AND ?',
      [input.period_start, input.period_end],
    )
    .select('shifts.id')
    .orderBy('shifts.id');
  if (openShifts.length > 0) {
    const ids = openShifts.slice(0, 5).map((shift) => `#${shift.id}`).join(', ');
    throw new PayrollPeriodError(
      'PAYROLL_OPEN_SHIFTS',
      `Close ${input.pay_schedule} shift${openShifts.length === 1 ? '' : 's'} ${ids} before calculating this payroll period.`,
    );
  }
}

async function getAvailableEarnings(
  input: PayrollPeriod,
  database: Knex.Transaction | Knex,
): Promise<any[]> {
  return database('employee_earnings as earning')
    .join('employee_compensation_plans as plan', 'earning.plan_id', 'plan.id')
    .leftJoin('payroll_line_earnings as link', function joinUnreleased() {
      this.on('link.earning_id', '=', 'earning.id').andOnNull('link.released_at');
    })
    .whereNull('link.id')
    .whereNull('earning.reversed_at')
    .where({ 'plan.pay_schedule': input.pay_schedule })
    .whereNot({ 'earning.source_type': 'legacy_shift' })
    .whereIn('earning.status', ['approved', 'calculated'])
    .whereBetween('earning.earning_date', [input.period_start, input.period_end])
    .select('earning.*')
    .orderBy('earning.employee_id')
    .orderBy('earning.earning_date')
    .orderBy('earning.id');
}

async function getShiftSettlements(
  earnings: any[],
  database: Knex.Transaction | Knex,
): Promise<Array<{
  employee_id: number;
  shift_id: number;
  payment_date: string;
  direct_paid: number;
  deduction: number;
  deduction_id: number | null;
}>> {
  const shiftIds = [...new Set(
    earnings
      .filter((earning) => earning.source_type === 'shift' && earning.shift_id)
      .map((earning) => Number(earning.shift_id)),
  )];
  if (shiftIds.length === 0) return [];

  const [shifts, deductions] = await Promise.all([
    database('shifts')
      .whereIn('id', shiftIds)
      .select('id', 'employee_id', 'shift_date', 'start_time', 'wage_paid'),
    database('wage_deductions')
      .whereIn('shift_id', shiftIds)
      .whereNull('deleted_at')
      .select('id', 'shift_id', 'deduction_amount', 'final_wage')
      .orderBy('id'),
  ]);
  const deductionByShift = new Map(
    deductions.map((deduction) => [Number(deduction.shift_id), deduction]),
  );

  return shifts.map((shift) => {
    const deduction = deductionByShift.get(Number(shift.id));
    return {
      employee_id: Number(shift.employee_id),
      shift_id: Number(shift.id),
      payment_date: String(shift.shift_date || shift.start_time).slice(0, 10),
      direct_paid: money(
        deduction?.final_wage
          ?? Math.max(0, Number(shift.wage_paid || 0) - Number(deduction?.deduction_amount || 0)),
      ),
      deduction: money(deduction?.deduction_amount || 0),
      deduction_id: deduction ? Number(deduction.id) : null,
    };
  });
}

export async function previewPayrollRun(
  input: Omit<PayrollRunInput, 'name' | 'created_by_employee_id'>,
  database: Knex = db,
  asOfDate?: string,
): Promise<any> {
  await assertPayrollPeriodAvailable(input, database, asOfDate);
  const [approvedEarnings, periodicEarnings] = await Promise.all([
    getAvailableEarnings(input, database),
    buildPeriodicEarningRows(input, database),
  ]);
  const earnings = [...approvedEarnings, ...periodicEarnings];
  const settlements = await getShiftSettlements(earnings, database);
  const employeeIds = [...new Set(earnings.map((earning) => Number(earning.employee_id)))];
  const employees = employeeIds.length > 0
    ? await database('employees').whereIn('id', employeeIds).select('id', 'name')
    : [];
  const employeeName = new Map(employees.map((employee) => [Number(employee.id), employee.name]));
  const settlementByEmployee = new Map<number, { paid: number; deductions: number }>();
  for (const settlement of settlements) {
    const totals = settlementByEmployee.get(settlement.employee_id) || { paid: 0, deductions: 0 };
    totals.paid = money(totals.paid + settlement.direct_paid);
    totals.deductions = money(totals.deductions + settlement.deduction);
    settlementByEmployee.set(settlement.employee_id, totals);
  }

  const earningsByEmployee = new Map<number, any[]>();
  for (const earning of earnings) {
    const employeeId = Number(earning.employee_id);
    const rows = earningsByEmployee.get(employeeId) || [];
    rows.push(earning);
    earningsByEmployee.set(employeeId, rows);
  }
  const lines = Array.from(earningsByEmployee.entries()).map(([employeeId, rows]) => {
    const gross = money(rows.reduce((sum, earning) => sum + Number(earning.gross_amount || 0), 0));
    const settlement = settlementByEmployee.get(employeeId) || { paid: 0, deductions: 0 };
    const deductions = money(Math.min(gross, settlement.deductions));
    const net = money(Math.max(0, gross - deductions));
    const paid = money(Math.min(net, settlement.paid));
    return {
      employee_id: employeeId,
      employee_name: employeeName.get(employeeId) || `Employee ${employeeId}`,
      earning_count: rows.length,
      gross_earnings: gross,
      prior_shift_deductions: deductions,
      prior_shift_payments: paid,
      balance_due: money(net - paid),
    };
  });

  return {
    pay_schedule: input.pay_schedule,
    period_start: input.period_start,
    period_end: input.period_end,
    employee_count: lines.length,
    earning_count: earnings.length,
    gross_total: money(lines.reduce((sum, line) => sum + line.gross_earnings, 0)),
    deduction_total: money(lines.reduce((sum, line) => sum + line.prior_shift_deductions, 0)),
    prior_paid_total: money(lines.reduce((sum, line) => sum + line.prior_shift_payments, 0)),
    balance_due: money(lines.reduce((sum, line) => sum + line.balance_due, 0)),
    lines,
  };
}

async function importShiftSettlements(
  earnings: any[],
  lineIdByEmployee: Map<number, number>,
  trx: Knex.Transaction,
): Promise<void> {
  const settlements = await getShiftSettlements(earnings, trx);
  const lineRows = await trx('payroll_lines')
    .whereIn('id', [...lineIdByEmployee.values()])
    .select('id', 'employee_id', 'gross_earnings');
  const grossByEmployee = new Map(
    lineRows.map((line) => [Number(line.employee_id), money(line.gross_earnings || 0)]),
  );
  const deductedByEmployee = new Map<number, number>();
  const paidByEmployee = new Map<number, number>();

  for (const settlement of settlements.sort((a, b) => a.shift_id - b.shift_id)) {
    const lineId = lineIdByEmployee.get(settlement.employee_id);
    if (!lineId) continue;
    const gross = grossByEmployee.get(settlement.employee_id) || 0;
    const alreadyDeducted = deductedByEmployee.get(settlement.employee_id) || 0;
    const deductionAmount = money(Math.min(
      settlement.deduction,
      Math.max(0, gross - alreadyDeducted),
    ));
    if (deductionAmount > 0) {
      await trx('payroll_deductions').insert({
        payroll_line_id: lineId,
        employee_id: settlement.employee_id,
        deduction_type: 'manual',
        amount: deductionAmount,
        authorization_reference: `SHIFT-WAGE-DEDUCTION:${settlement.deduction_id}`,
        notes: `Wage deduction already applied when shift #${settlement.shift_id} closed.`,
        status: 'approved',
        approved_at: trx.fn.now(),
      });
      deductedByEmployee.set(
        settlement.employee_id,
        money(alreadyDeducted + deductionAmount),
      );
    }

    const deductions = deductedByEmployee.get(settlement.employee_id) || 0;
    const net = money(Math.max(0, gross - deductions));
    const alreadyPaid = paidByEmployee.get(settlement.employee_id) || 0;
    const paymentAmount = money(Math.min(
      settlement.direct_paid,
      Math.max(0, net - alreadyPaid),
    ));
    if (paymentAmount > 0) {
      await trx('payroll_payments').insert({
        payroll_line_id: lineId,
        employee_id: settlement.employee_id,
        shift_id: settlement.shift_id,
        amount: paymentAmount,
        payment_method: 'cash',
        payment_date: settlement.payment_date,
        reference: `SHIFT-WAGE:${settlement.shift_id}`,
        notes: `Direct wage already paid from shift #${settlement.shift_id}.`,
        status: 'posted',
      });
      paidByEmployee.set(settlement.employee_id, money(alreadyPaid + paymentAmount));
    }
  }

  for (const lineId of lineIdByEmployee.values()) {
    await refreshPayrollLine(lineId, trx);
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
  input: PayrollRunInput,
  database: Knex = db,
  asOfDate?: string,
): Promise<number> {
  return database.transaction(async (trx) => {
    await assertPayrollPeriodAvailable(input, trx, asOfDate);

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

    const earnings = await getAvailableEarnings(input, trx);
    if (earnings.length === 0) {
      throw new PayrollPeriodError(
        'PAYROLL_NO_EARNINGS',
        `No unprocessed ${input.pay_schedule} earnings are available for this period.`,
      );
    }

    const byEmployee = new Map<number, any[]>();
    for (const earning of earnings) {
      const employeeId = Number(earning.employee_id);
      const rows = byEmployee.get(employeeId) || [];
      rows.push(earning);
      byEmployee.set(employeeId, rows);
    }

    const lineRows: any[] = [];
    for (const [employeeId, rows] of byEmployee) {
      const gross = money(rows.reduce((sum, earning) => sum + Number(earning.gross_amount || 0), 0));
      lineRows.push({
        run_id: runId,
        employee_id: employeeId,
        gross_earnings: gross,
        net_pay: gross,
        balance_due: gross,
        status: gross > 0 ? 'unpaid' : 'paid',
      });
    }
    if (lineRows.length > 0) {
      await insertRowsInChunks(trx, 'payroll_lines', lineRows);
      const insertedLines = await trx('payroll_lines')
        .where({ run_id: runId })
        .select('id', 'employee_id');
      const lineIdByEmployee = new Map(
        insertedLines.map((line) => [Number(line.employee_id), Number(line.id)]),
      );
      const earningLinks = Array.from(byEmployee.entries()).flatMap(([employeeId, rows]) => {
        const lineId = lineIdByEmployee.get(employeeId);
        if (!lineId) throw new Error(`Payroll line missing for employee ${employeeId}`);
        return rows.map((earning) => ({
          payroll_line_id: lineId,
          earning_id: earning.id,
        }));
      });
      await insertRowsInChunks(trx, 'payroll_line_earnings', earningLinks);
      await importShiftSettlements(earnings, lineIdByEmployee, trx);
    }

    await refreshPayrollRun(runId, trx);
    return runId;
  });
}

export async function getPayrollRun(runId: number, database: Knex = db): Promise<any | null> {
  const run = await database('payroll_runs')
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
  const lines = await database('payroll_lines')
    .join('employees', 'payroll_lines.employee_id', 'employees.id')
    .where('payroll_lines.run_id', runId)
    .select('payroll_lines.*', 'employees.name as employee_name')
    .orderBy('employees.name');
  if (lines.length === 0) return { ...run, lines };

  const lineIds = lines.map((line) => Number(line.id));
  const [earnings, deductions, payments] = await Promise.all([
    database('payroll_line_earnings')
      .join('employee_earnings', 'payroll_line_earnings.earning_id', 'employee_earnings.id')
      .whereIn('payroll_line_earnings.payroll_line_id', lineIds)
      .whereNull('payroll_line_earnings.released_at')
      .select(
        'payroll_line_earnings.payroll_line_id as payroll_line_id',
        'employee_earnings.*',
      )
      .orderBy('employee_earnings.earning_date'),
    database('payroll_deductions')
      .whereIn('payroll_line_id', lineIds)
      .orderBy('created_at'),
    database('payroll_payments')
      .whereIn('payroll_line_id', lineIds)
      .orderBy('payment_date')
      .orderBy('id'),
  ]);
  const grouped = <T extends { payroll_line_id: number }>(rows: T[]) => {
    const values = new Map<number, T[]>();
    for (const row of rows) {
      const lineId = Number(row.payroll_line_id);
      const lineRows = values.get(lineId) || [];
      lineRows.push(row);
      values.set(lineId, lineRows);
    }
    return values;
  };
  const earningsByLine = grouped(earnings);
  const deductionsByLine = grouped(deductions);
  const paymentsByLine = grouped(payments);
  for (const line of lines) {
    const lineId = Number(line.id);
    line.earnings = earningsByLine.get(lineId) || [];
    line.deductions = deductionsByLine.get(lineId) || [];
    line.payments = paymentsByLine.get(lineId) || [];
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
    const runEarningIds = trx('payroll_line_earnings')
      .join('payroll_lines', 'payroll_line_earnings.payroll_line_id', 'payroll_lines.id')
      .where({ 'payroll_lines.run_id': runId })
      .whereNull('payroll_line_earnings.released_at')
      .select('payroll_line_earnings.earning_id');
    await trx('employee_earnings')
      .whereIn('id', runEarningIds)
      .where({ status: 'calculated' })
      .update({
        status: 'approved',
        approved_at: trx.fn.now(),
      });
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
      .where((query) => {
        query
          .whereNull('payroll_payments.reference')
          .orWhere('payroll_payments.reference', 'not like', 'SHIFT-WAGE:%');
      })
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
    await trx('payroll_payments')
      .whereIn('payroll_line_id', trx('payroll_lines').where({ run_id: runId }).select('id'))
      .where({ status: 'posted' })
      .where('reference', 'like', 'SHIFT-WAGE:%')
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
