import type { Knex } from 'knex';
import db from '../database';

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isShiftWageMirror(payment: { reference?: string | null }): boolean {
  return String(payment.reference || '').startsWith('SHIFT-WAGE:');
}

export async function getPayrollExpense(
  from: string,
  to: string,
  database: Knex = db,
): Promise<number> {
  const row = await database('employee_earnings')
    .whereNull('reversed_at')
    .whereIn('status', ['approved', 'posted'])
    .whereBetween('earning_date', [from, to])
    .sum('gross_amount as total')
    .first();
  return money(Number(row?.total || 0));
}

export async function getPayrollCashPaid(
  from: string,
  to: string,
  database: Knex = db,
): Promise<number> {
  const row = await database('payroll_payments')
    .where({ status: 'posted' })
    .whereBetween('payment_date', [from, to])
    .sum('amount as total')
    .first();
  return money(Number(row?.total || 0));
}

export async function getUnmirroredShiftWagesPaid(
  from: string,
  to: string,
  database: Knex = db,
): Promise<number> {
  const shifts = await database('shifts')
    .where({ status: 'closed' })
    .whereBetween('shift_date', [from, to])
    .select('id', 'wage_paid');
  if (shifts.length === 0) return 0;

  const shiftIds = shifts.map((shift) => Number(shift.id));
  const deductions = await database('wage_deductions')
    .whereIn('shift_id', shiftIds)
    .whereNull('deleted_at')
    .select('id', 'shift_id', 'deduction_amount', 'final_wage')
    .orderBy('id');
  const deductionByShift = new Map<number, any>();
  for (const deduction of deductions) {
    deductionByShift.set(Number(deduction.shift_id), deduction);
  }

  const references = shifts.map((shift) => `SHIFT-WAGE:${shift.id}`);
  const mirrors = await database('payroll_payments')
    .where({ status: 'posted' })
    .whereIn('reference', references)
    .select('reference');
  const mirrored = new Set(mirrors.map((payment) => String(payment.reference)));

  return money(shifts.reduce((sum, shift) => {
    if (mirrored.has(`SHIFT-WAGE:${shift.id}`)) return sum;
    const deduction = deductionByShift.get(Number(shift.id));
    return sum + Number(
      deduction?.final_wage
        ?? Math.max(0, Number(shift.wage_paid || 0) - Number(deduction?.deduction_amount || 0)),
    );
  }, 0));
}

export async function getTotalPayrollCashOutflow(
  from: string,
  to: string,
  database: Knex = db,
): Promise<number> {
  const [payrollPayments, unmirroredShiftWages] = await Promise.all([
    getPayrollCashPaid(from, to, database),
    getUnmirroredShiftWagesPaid(from, to, database),
  ]);
  return money(payrollPayments + unmirroredShiftWages);
}
