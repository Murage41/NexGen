import type { Knex } from 'knex';
import {
  getCompensationPlan,
  getCompensationPlanById,
  calculateShiftEarnings,
} from './compensation';
import {
  money,
  positiveMoney,
  recoveryPreview,
  validateRecoveryDecision,
  allocateEmployeeDebt,
  settlementError,
  syncEmployeeDebt,
} from './employeeDebt';

export async function shiftRecoveryPreview(
  shift: any,
  readings: any[],
  actualCash: number,
  variance: number,
  db: Knex | Knex.Transaction,
) {
  actualCash = positiveMoney(actualCash, true);
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
  const existing = await db('wage_deductions')
    .where({ shift_id: shift.id })
    .whereNull('deleted_at')
    .first();
  const deducted = money(existing?.deduction_amount || 0);
  if (actualCash + deducted > gross + 0.005)
    throw settlementError(
      'Cash paid plus existing deductions exceeds shift earnings.',
    );
  const shortage = money(Math.max(0, -variance));
  const preview = await recoveryPreview(
    Number(shift.employee_id),
    money(gross - actualCash - deducted),
    db,
    {
      shift: shift.id,
      gross,
      cash: actualCash,
      variance: money(variance),
      deduction: existing ? [existing.id, deducted] : null,
    },
  );
  const proposed = money(
    Math.min(
      preview.recoverable + shortage,
      (preview.available * preview.limit_percent) / 100,
    ),
  );
  return {
    ...preview,
    proposed,
    shortage,
    gross,
    existing_deductions: deducted,
    actual_cash: actualCash,
    pay_schedule: plan.pay_schedule,
    outstanding: money(preview.outstanding + shortage),
    recoverable: money(preview.recoverable + shortage),
    debts: [
      ...preview.debts,
      ...(shortage > 0
        ? [
            {
              id: 'current',
              shift_id: shift.id,
              balance: shortage,
              recovery_status: 'confirmed',
              status: 'outstanding',
            },
          ]
        : []),
    ],
  };
}

export async function postShiftRecovery(
  shift: any,
  readings: any[],
  actualCash: number,
  variance: number,
  decision: any,
  reason: string,
  db: Knex.Transaction,
  actorId: number | null = null,
) {
  const preview = await shiftRecoveryPreview(
    shift,
    readings,
    actualCash,
    variance,
    db,
  );
  let recovery = 0;
  if (preview.pay_schedule === 'daily' && (preview.recoverable > 0 || decision))
    recovery = validateRecoveryDecision(preview, decision);
  if (preview.pay_schedule !== 'daily' && decision?.amount > 0)
    throw settlementError('This compensation is recovered through payroll.');
  if (preview.shortage > 0)
    await db('staff_debts').insert({
      employee_id: shift.employee_id,
      shift_id: shift.id,
      original_deficit: preview.shortage,
      deducted_from_wage: 0,
      carried_forward: preview.shortage,
      balance: preview.shortage,
      status: 'outstanding',
      recovery_status: 'confirmed',
    });
  if (recovery > 0) {
    const existing = await db('wage_deductions')
      .where({ shift_id: shift.id })
      .whereNull('deleted_at')
      .first();
    const total = money(preview.existing_deductions + recovery);
    const values = {
      original_wage: preview.gross,
      deduction_amount: total,
      final_wage: money(preview.gross - total),
      reason: `Debt recovery: ${decision.authorization_reference}`,
    };
    let deductionId = existing?.id;
    if (existing)
      await db('wage_deductions').where({ id: deductionId }).update(values);
    else
      [deductionId] = await db('wage_deductions').insert({
        ...values,
        employee_id: shift.employee_id,
        shift_id: shift.id,
      });
    await allocateEmployeeDebt(
      Number(shift.employee_id),
      recovery,
      {
        table: 'shift_staff_debt_allocations',
        fields: { shift_id: shift.id, wage_deduction_id: deductionId },
      },
      db,
    );
  }
  await syncEmployeeDebt(Number(shift.employee_id), db);
  await db('shifts')
    .where({ id: shift.id })
    .update({
      direct_wage_cash_amount: actualCash,
      recovery_review: decision
        ? JSON.stringify({
            ...decision,
            outstanding_before: preview.outstanding,
            variance_reason: reason,
            approved_by: actorId,
            approved_at: new Date().toISOString(),
          })
        : null,
    });
  return preview;
}
