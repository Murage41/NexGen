import type { Knex } from 'knex';
import {
  money,
  positiveMoney,
  settlementError,
} from './employeeDebt';
import { refreshPayrollLine, refreshPayrollRun } from './payroll';
import { approvalBindings, resolveApprover } from './approval';

export async function editablePayrollLine(
  runId: number,
  lineId: number,
  db: Knex.Transaction,
) {
  const run = await db('payroll_runs').where({ id: runId }).first();
  const line = await db('payroll_lines')
    .where({ id: lineId, run_id: runId })
    .first();
  if (!run || !line) throw settlementError('Payroll line not found.', 404);
  if (run.status !== 'calculated')
    throw settlementError('Deductions can only be changed before approval.');
  return line;
}

export async function addPayrollDeduction(
  runId: number,
  lineId: number,
  input: any,
  actorId: number | null,
  db: Knex.Transaction,
) {
  const line = await editablePayrollLine(runId, lineId, db);
  // Pay is never reduced for variances: employees repay them separately.
  if (input.deduction_type === 'staff_debt')
    throw settlementError(
      'Variances are not deducted from pay. Record repayments under Employees, Variances.',
      400,
    );
  await refreshPayrollLine(lineId, db);
  const current = await db('payroll_lines').where({ id: lineId }).first();
  const amount = positiveMoney(input.amount);
  if (
    amount >
    money(
      Number(current.gross_earnings) -
        Number(current.total_deductions) -
        Number(current.paid_amount),
    )
  )
    throw settlementError(
      'Deduction exceeds remaining unpaid compensation.',
      400,
    );
  // The token is a credential, not a column: keep it out of the insert.
  const { approval_token: approvalToken, ...fields } = input;
  const approver = await resolveApprover(
    actorId,
    approvalToken,
    // Bind the amount exactly as submitted, the same value the PIN prompt saw.
    approvalBindings.deduction({
      payroll_line_id: lineId,
      deduction_type: fields.deduction_type,
      amount: input.amount,
    }),
    db,
  );
  const [id] = await db('payroll_deductions').insert({
    ...fields,
    amount,
    payroll_line_id: lineId,
    employee_id: line.employee_id,
    status: 'draft',
    authorization_reference: `Approved by ${approver.name}`,
    created_by_employee_id: approver.id,
  });
  await db('payroll_lines')
    .where({ id: lineId })
    .update({ recovery_review: null });
  await refreshPayrollLine(lineId, db);
  await refreshPayrollRun(runId, db);
  return db('payroll_deductions').where({ id }).first();
}

export async function recordPayrollPayment(
  lineId: number,
  input: any,
  actorId: number | null,
  db: Knex.Transaction,
) {
  const line = await db('payroll_lines').where({ id: lineId }).first();
  if (!line) throw settlementError('Payroll line not found.', 404);
  const run = await db('payroll_runs').where({ id: line.run_id }).first();
  if (!['approved', 'partially_paid'].includes(run.status))
    throw settlementError('Approve the payroll before recording payment.');
  const current = await refreshPayrollLine(lineId, db);
  const amount = positiveMoney(input.amount);
  if (amount > money(current.balance_due))
    throw settlementError(
      `Payment exceeds KES ${money(current.balance_due).toFixed(2)} remaining.`,
      400,
    );
  if (String(input.reference || '').startsWith('SHIFT-WAGE:'))
    throw settlementError(
      'This reference prefix is reserved for recorded shift payments.',
      400,
    );
  if (input.shift_id) {
    const shift = await db('shifts')
      .where({ id: input.shift_id, status: 'open' })
      .first();
    if (!shift || !['cash', 'mpesa'].includes(input.payment_method))
      throw settlementError(
        'Drawer payments require an open shift and cash or M-Pesa.',
      );
    if (String(shift.shift_date).slice(0, 10) !== input.payment_date)
      throw settlementError(
        'A drawer payment date must match its receiving shift work date.',
      );
  }
  const [id] = await db('payroll_payments').insert({
    ...input,
    amount,
    payroll_line_id: lineId,
    employee_id: line.employee_id,
    status: 'posted',
    created_by_employee_id: actorId,
  });
  await refreshPayrollLine(lineId, db);
  await refreshPayrollRun(line.run_id, db);
  return db('payroll_payments').where({ id }).first();
}
