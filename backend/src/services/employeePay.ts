import type { Knex } from 'knex';
import {
  employeeDebtSummary,
  settlementError,
  money,
} from './employeeDebt';
import { listCompensationPlans } from './compensation';
import { getPayrollRun } from './payroll';
import {
  getVarianceStatement,
  recordVarianceRepayment,
  reverseVarianceRepayment,
} from './employeeVariances';

// The staff-debt records from before variances started (migration 047): kept
// as history and shown under Earlier records. What an employee owes now comes
// from their variances.

export async function employeeDebtHistory(
  employeeId: number,
  db: Knex | Knex.Transaction,
) {
  const summary = await employeeDebtSummary(employeeId, db);
  const debtIds = summary.debts.map((d) => d.id);
  const history: any[] = [];
  if (debtIds.length) {
    for (const [table, label, sourceColumn] of [
      ['payroll_debt_allocations', 'Payroll recovery', 'deduction_id'],
      ['shift_staff_debt_allocations', 'Shift wage recovery', 'shift_id'],
      ['staff_debt_receipt_allocations', 'Direct repayment', 'payment_id'],
    ]) {
      const rows = await db(table)
        .whereIn('staff_debt_id', debtIds)
        .orderBy('id');
      history.push(
        ...rows.map((r) => ({
          ...r,
          type: label,
          source_id: r[sourceColumn],
          origin_shift_id: summary.debts.find((d) => d.id === r.staff_debt_id)
            ?.shift_id,
        })),
      );
    }
  }
  // Closed-shift corrections that added to or reduced a shortage, and money
  // owed back to the employee (services/shiftCorrections.ts).
  const adjustments = await db('staff_debt_adjustments as a')
    .leftJoin('shift_accountability_adjustments as c', 'a.accountability_adjustment_id', 'c.id')
    .where((q) => {
      q.where('a.employee_id', employeeId);
      if (debtIds.length) q.orWhereIn('a.staff_debt_id', debtIds);
    })
    .select(
      'a.*',
      'c.reason as correction_reason',
      'c.posting_date as correction_posting_date',
      'c.approved_by_name as correction_approved_by',
    )
    .orderBy('a.id');
  const corrections = adjustments.filter((a) => ['increase', 'decrease'].includes(a.adjustment_type));
  const refunds = adjustments.filter((a) => a.adjustment_type === 'employee_credit_review');
  for (const debt of summary.debts) {
    const recovered = money(
      history
        .filter((r) => r.staff_debt_id === debt.id && !r.reversed_at)
        .reduce((s, r) => s + Number(r.amount), 0),
    );
    const corrected = money(
      corrections
        .filter((a) => a.staff_debt_id === debt.id && a.adjustment_type === 'decrease' && a.status === 'posted')
        .reduce((s, a) => s + Number(a.amount), 0),
    );
    debt.allocated_repayments = recovered;
    debt.corrected = corrected;
    debt.created_by_correction_id = corrections.find(
      (a) => a.staff_debt_id === debt.id && a.adjustment_type === 'increase',
    )?.accountability_adjustment_id ?? null;
    // Legacy balances include corrections and repayments that predate allocation tracking.
    debt.historical_adjustment = money(
      Number(debt.balance) - (Number(debt.carried_forward) - recovered - corrected),
    );
  }
  // Repayments recorded before variances started; later ones are variance
  // entries of their own.
  const receipts = await db('credit_payments as p')
    .join('credit_accounts as a', 'p.account_id', 'a.id')
    .where({
      'a.employee_id': employeeId,
      'a.type': 'employee',
      'p.payment_type': 'staff_debt',
    })
    .whereNotExists(function () {
      this.select(1)
        .from('employee_variance_entries as v')
        .whereRaw('v.payment_id = p.id')
        .where('v.entry_type', 'repayment');
    })
    .select('p.*')
    .orderBy('p.id', 'desc');
  const reviews = debtIds.length
    ? await db('staff_debt_reviews')
        .whereIn('staff_debt_id', debtIds)
        .orderBy('id')
    : [];
  const owedToEmployee = money(
    refunds.filter((r) => r.status === 'review_required').reduce((s, r) => s + Number(r.amount), 0),
  );
  return { ...summary, history, receipts, reviews, corrections, refunds, owed_to_employee: owedToEmployee };
}

export async function employeePayStatement(employeeId: number, db: Knex) {
  const employee = await db('employees')
    .where({ id: employeeId })
    .select('id', 'name', 'recovery_limit_percent')
    .first();
  if (!employee) throw settlementError('Employee not found.', 404);
  const plans = await listCompensationPlans(employeeId, db);
  const runIds = await db('payroll_lines')
    .where({ employee_id: employeeId })
    .orderBy('id', 'desc')
    .pluck('run_id');
  const runs = [];
  for (const runId of [...new Set(runIds)]) {
    const run = await getPayrollRun(Number(runId), db);
    if (run)
      runs.push({
        id: run.id,
        name: run.name,
        status: run.status,
        pay_schedule: run.pay_schedule,
        period_start: run.period_start,
        period_end: run.period_end,
        lines: run.lines.filter(
          (l: any) => Number(l.employee_id) === employeeId,
        ),
      });
  }
  const accrued = await db('employee_earnings as e')
    .leftJoin('payroll_line_earnings as l', function () {
      this.on('e.id', '=', 'l.earning_id').andOnNull('l.released_at');
    })
    .where({ 'e.employee_id': employeeId })
    .whereNull('e.reversed_at')
    .whereNull('l.id')
    .whereNot({ 'e.source_type': 'legacy_shift' })
    .select('e.*')
    .orderBy('e.earning_date')
    .orderBy('e.id');
  for (const earning of accrued)
    earning.plan = plans.find((p) => p.id === earning.plan_id);
  const accruedGroups = new Map<string, any>();
  for (const earning of accrued) {
    const key = earning.shift_id
      ? `shift:${earning.shift_id}`
      : `period:${earning.plan_id}`;
    const row = accruedGroups.get(key) || {
      key,
      shift_id: earning.shift_id,
      date: earning.earning_date,
      plan: earning.plan,
      components: [],
      gross: 0,
    };
    row.components.push(earning);
    row.gross = money(row.gross + Number(earning.gross_amount));
    accruedGroups.set(key, row);
  }
  for (const row of accruedGroups.values()) {
    const shift = row.shift_id
      ? await db('shifts').where({ id: row.shift_id }).first()
      : null;
    const deduction = row.shift_id
      ? await db('wage_deductions')
          .where({ shift_id: row.shift_id })
          .whereNull('deleted_at')
          .first()
      : null;
    row.deductions = money(deduction?.deduction_amount || 0);
    row.paid = money(
      shift?.direct_wage_cash_amount ??
        Math.max(0, Number(shift?.wage_paid || 0) - row.deductions),
    );
    row.remaining = money(Math.max(0, row.gross - row.paid - row.deductions));
  }
  return {
    employee,
    plans,
    runs,
    accrued,
    accrued_shift_details: [...accruedGroups.values()],
    variances: await getVarianceStatement(db, employeeId),
    debt: await employeeDebtHistory(employeeId, db),
  };
}

// A repayment of what the employee owes on their variances: into an open
// shift's drawer (shift_id), or received directly.
export async function recordEmployeeDebtReceipt(
  employeeId: number,
  input: any,
  actorId: number | null,
  db: Knex.Transaction,
) {
  return recordVarianceRepayment(db, employeeId, input, actorId);
}

export async function reverseEmployeeDebtReceipt(
  paymentId: number,
  reason: string,
  db: Knex.Transaction,
  actorId: number | null = null,
) {
  const payment = await db('credit_payments')
    .where({ id: paymentId, payment_type: 'staff_debt' })
    .first();
  if (!payment || payment.status !== 'posted')
    throw settlementError('Receipt is missing or already reversed.');
  if (String(reason || '').trim().length < 3)
    throw settlementError('A reversal reason is required.', 400);
  if (payment.shift_id) {
    const shift = await db('shifts').where({ id: payment.shift_id }).first();
    if (!shift || shift.status !== 'open')
      throw settlementError(
        'This receipt is on a closed shift. Use Correct next to it on the shift instead.',
      );
  }
  await reverseVarianceRepayment(db, paymentId, { reason: String(reason).trim(), actorId });
}
