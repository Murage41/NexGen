import type { Knex } from 'knex';
import {
  getCompensationPlan,
  getCompensationPlanById,
  calculateShiftEarnings,
} from './compensation';
import {
  money,
  recoveryPreview,
  validateRecoveryDecision,
  allocateEmployeeDebt,
  settlementError,
  syncEmployeeDebt,
} from './employeeDebt';

// Shift-close debt recovery is always a repayment, never wage withholding: the
// employee is paid their full earnings (whatever is entered as wage_paid on
// close), and any recovery confirmed here is a *separate*, personal cash
// transaction between employee and owner that reduces their outstanding staff
// debt - not cash that was counted as part of this shift's drawer. It must
// never touch wage_paid/direct_wage_cash_amount, and it must have zero effect
// on this shift's variance: no shift_id is set on the credit_payments row, so
// it is intentionally excluded from this (or any) shift's own credit_receipts
// calculation. This is deliberately different from "Collect Payment" taken
// mid-shift (recordEmployeeDebtReceipt in employeePay.ts), which *does* set
// shift_id because that cash is documented to be counted into the shift's
// recorded collections - that symmetric (credit_receipts) treatment is
// correct there and is unchanged by this file.
//
// This replaced a wage-withholding design (reducing wage_paid, tracked via
// wage_deductions/shift_staff_debt_allocations) that corrupted the closing
// shift's own variance whenever the real-world transaction was actually a
// repayment rather than a withholding - confirmed on shifts 103 and 105
// (2026-09-10 investigation): the withheld amount was silently subtracted from
// variance a second time, and when the corrupted variance went negative it
// triggered creation of a brand-new staff debt for a shortfall that never
// existed. See docs/RECOVERY-MECHANISM-CORRECTION.md for the full writeup.

export async function shiftRecoveryPreview(
  shift: any,
  readings: any[],
  db: Knex | Knex.Transaction,
) {
  const plan = shift.compensation_plan_id
    ? await getCompensationPlanById(Number(shift.compensation_plan_id), db)
    : await getCompensationPlan(
        Number(shift.employee_id),
        shift.shift_date,
        db,
      );
  if (!plan) throw settlementError('No compensation plan for this shift.');
  const gross = money(
    calculateShiftEarnings(plan, readings).reduce(
      (s, e) => s + e.gross_amount,
      0,
    ),
  );
  // "available" caps recovery against this shift's own earned activity, as an
  // existing per-employee pacing policy (recovery_limit_percent) - it is not a
  // wage-withholding capacity check, since wage is never touched here.
  const preview = await recoveryPreview(Number(shift.employee_id), gross, db, {
    shift: shift.id,
    gross,
  });
  const proposed = money(
    Math.min(preview.recoverable, (preview.available * preview.limit_percent) / 100),
  );
  return {
    ...preview,
    proposed,
    gross,
    pay_schedule: plan.pay_schedule,
  };
}

export async function postShiftRecovery(
  shift: any,
  readings: any[],
  decision: any,
  db: Knex.Transaction,
  actorId: number | null = null,
) {
  const preview = await shiftRecoveryPreview(shift, readings, db);
  let recovery = 0;
  if (preview.recoverable > 0 || decision) {
    recovery = validateRecoveryDecision(preview, decision);
  }
  if (recovery > 0) {
    // Ensure the employee's credit_accounts mirror exists (same pattern as the
    // standalone "Collect Payment" receipt flow in employeePay.ts).
    await syncEmployeeDebt(Number(shift.employee_id), db);
    const account = await db('credit_accounts')
      .where({ employee_id: shift.employee_id, type: 'employee' })
      .first();
    if (!account) throw settlementError('There is no employee debt to repay.');
    const reference = String(decision.authorization_reference || '').trim();
    const [paymentId] = await db('credit_payments').insert({
      account_id: account.id,
      credit_id: null,
      amount: recovery,
      payment_method: 'cash',
      payment_type: 'staff_debt',
      date: shift.shift_date,
      // Intentionally no shift_id - see the file-level comment above. This is
      // a personal repayment decided at close, not drawer cash for this shift.
      notes: reference
        ? `Shift #${shift.id} close recovery: ${reference}`
        : `Shift #${shift.id} close recovery`,
      status: 'posted',
      created_by_employee_id: actorId,
    });
    await allocateEmployeeDebt(
      Number(shift.employee_id),
      recovery,
      { table: 'staff_debt_receipt_allocations', fields: { payment_id: paymentId } },
      db,
    );
  }
  await syncEmployeeDebt(Number(shift.employee_id), db);
  await db('shifts')
    .where({ id: shift.id })
    .update({
      recovery_review: decision
        ? JSON.stringify({
            ...decision,
            outstanding_before: preview.outstanding,
            approved_by: actorId,
            approved_at: new Date().toISOString(),
          })
        : null,
    });
  return preview;
}
