import type { Knex } from 'knex';
import { employeeDebtSummary, money, settlementError, syncEmployeeDebt } from './employeeDebt';
import type { Approver } from './approval';
import { getKenyaDate } from '../utils/timezone';

// Money owed back to an employee after a closed-shift correction reduced a
// shortage they had already repaid (services/shiftCorrections.ts records it as
// an 'employee_credit_review' adjustment awaiting settlement).
//
// It is settled in full, one of two ways:
// - paid to them in cash or M-Pesa (a cash outflow in the cash-flow report), or
// - set off against what they owe now, when that covers it.
// Never through payroll: payroll carries earned wages, and returning money that
// was wrongly recovered is not a wage cost.

export type RefundMethod = 'cash' | 'mpesa' | 'offset';

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function owedRefund(trx: Knex | Knex.Transaction, adjustmentId: number) {
  const row = await trx('staff_debt_adjustments')
    .where({ id: adjustmentId, adjustment_type: 'employee_credit_review' })
    .first();
  if (!row) throw settlementError('That refund was not found.', 404);
  if (row.status !== 'review_required') throw settlementError('This refund has already been settled.', 409);
  const employeeId = Number(
    row.employee_id || (await trx('shifts').where({ id: row.shift_id }).first('employee_id'))?.employee_id,
  );
  return { row, employeeId, amount: money(row.amount) };
}

export async function settleEmployeeRefund(
  trx: Knex.Transaction,
  input: {
    adjustmentId: number;
    method: RefundMethod;
    date?: string | null;
    reference?: string | null;
    approver: Approver;
  },
) {
  const { row, employeeId, amount } = await owedRefund(trx, input.adjustmentId);
  const now = new Date().toISOString();
  const today = getKenyaDate();

  if (input.method === 'offset') {
    const summary = await employeeDebtSummary(employeeId, trx);
    if (summary.recoverable < amount) {
      throw settlementError(
        `They owe ${kes(summary.recoverable)} now, less than the ${kes(amount)} owed to them, so it can't be set off in full. Pay it to them instead.`,
        409,
      );
    }
    let remaining = amount;
    for (const debt of summary.eligible) {
      if (remaining <= 0) break;
      const before = money(debt.balance);
      const applied = money(Math.min(remaining, before));
      const after = money(before - applied);
      // Compare-and-swap, as every other debt allocation does.
      const updated = await trx('staff_debts')
        .where({ id: debt.id, balance: debt.balance })
        .update({ balance: after, status: after === 0 ? 'cleared' : 'outstanding' });
      if (updated !== 1) throw settlementError('This debt was changed by another operation. Refresh and try again.');
      await trx('staff_debt_adjustments').insert({
        shift_id: debt.shift_id,
        employee_id: employeeId,
        staff_debt_id: debt.id,
        accountability_adjustment_id: row.accountability_adjustment_id,
        adjustment_type: 'decrease',
        amount: applied,
        balance_before: before,
        balance_after: after,
        status: 'posted',
        reason: `Set off against ${kes(amount)} owed back to them after correction #${row.accountability_adjustment_id}.`,
        created_by_employee_id: input.approver.id,
      });
      remaining = money(remaining - applied);
    }
    await syncEmployeeDebt(employeeId, trx);
  } else {
    const date = input.date || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) {
      throw settlementError('Enter the date it was paid (not in the future).', 400);
    }
    input.date = date;
  }

  await trx('staff_debt_adjustments').where({ id: row.id }).update({
    status: 'settled',
    settled_at: now,
    settlement_date: input.method === 'offset' ? today : input.date,
    settlement_method: input.method,
    settlement_reference: String(input.reference || '').trim().slice(0, 100) || null,
    settled_by_employee_id: input.approver.id,
    settled_by_name: input.approver.name,
  });
  return trx('staff_debt_adjustments').where({ id: row.id }).first();
}
