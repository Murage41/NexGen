import type { Knex } from 'knex';
import db from '../database';
import { recomputeAccountBalance } from './accountBalance';
import { refreshPayrollLine, refreshPayrollRun } from './payroll';
import { reverseMoneyAccountPaymentInTransaction } from './receivablePayments';

type DbConnection = Knex | Knex.Transaction;

function httpError(message: string, http: number, code?: string): Error {
  return Object.assign(new Error(message), { http, code });
}

export async function previewShiftCancellation(
  shiftId: number,
  database: DbConnection = db,
) {
  const shift = await database('shifts').where({ id: shiftId }).first();
  if (!shift) throw httpError('Shift not found', 404, 'SHIFT_NOT_FOUND');
  if (shift.status !== 'open') {
    throw httpError('Only an open shift can be cancelled.', 409, 'SHIFT_NOT_OPEN');
  }

  const [creditEntries, creditPayments, invoiceConsumption, expenses, payrollPayments, debtAllocations] = await Promise.all([
    database('shift_credits').where({ shift_id: shiftId }).whereNull('deleted_at').count('* as count').first(),
    database('credit_payments').where({ shift_id: shiftId, status: 'posted' }).whereNull('deleted_at').count('* as count').first(),
    database('invoice_consumption').where({ shift_id: shiftId }).whereNull('deleted_at').count('* as count').first(),
    database('shift_expenses').where({ shift_id: shiftId }).whereNull('deleted_at').count('* as count').first(),
    database('payroll_payments').where({ shift_id: shiftId, status: 'posted' }).count('* as count').first(),
    database('shift_staff_debt_allocations').where({ shift_id: shiftId }).whereNull('reversed_at').count('* as count').first(),
  ]);

  return {
    shift_id: shiftId,
    credit_entries_to_void: Number(creditEntries?.count || 0),
    credit_payments_to_reverse: Number(creditPayments?.count || 0),
    invoice_consumption_to_release: Number(invoiceConsumption?.count || 0),
    expenses_to_void: Number(expenses?.count || 0),
    payroll_payments_to_reverse: Number(payrollPayments?.count || 0),
    staff_debt_allocations_to_reverse: Number(debtAllocations?.count || 0),
  };
}

async function restoreStaffDebtAllocations(
  trx: Knex.Transaction,
  shiftId: number,
  reversedAt: string,
) {
  const allocations = await trx('shift_staff_debt_allocations')
    .where({ shift_id: shiftId })
    .whereNull('reversed_at')
    .orderBy('id', 'desc');

  for (const allocation of allocations) {
    const debt = await trx('staff_debts').where({ id: allocation.staff_debt_id }).first();
    if (!debt) throw httpError('A staff debt allocation is missing its debt record.', 409);
    const restored = Number(debt.balance || 0) + Number(allocation.amount || 0);
    await trx('staff_debts').where({ id: debt.id }).update({
      balance: restored,
      status: 'outstanding',
    });
  }

  if (allocations.length > 0) {
    await trx('shift_staff_debt_allocations')
      .where({ shift_id: shiftId })
      .whereNull('reversed_at')
      .update({ reversed_at: reversedAt });
  }
  return allocations.length;
}

async function refreshEmployeeDebtAccount(trx: Knex.Transaction, employeeId: number) {
  const total = await trx('staff_debts')
    .where({ employee_id: employeeId, status: 'outstanding' })
    .sum('balance as total')
    .first();
  await trx('credit_accounts')
    .where({ employee_id: employeeId, type: 'employee' })
    .whereNull('deleted_at')
    .update({ balance: Number(total?.total || 0) });
}

export async function cancelOpenShift(
  shiftId: number,
  input: { reason: string; actorId?: number | null },
  database: Knex = db,
) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) {
    throw httpError('A cancellation reason is required.', 400, 'CANCELLATION_REASON_REQUIRED');
  }

  return database.transaction(async (trx) => {
    const shift = await trx('shifts').where({ id: shiftId }).first();
    if (!shift) throw httpError('Shift not found', 404, 'SHIFT_NOT_FOUND');
    if (shift.status !== 'open') {
      throw httpError('Only an open shift can be cancelled.', 409, 'SHIFT_NOT_OPEN');
    }

    const summary = await previewShiftCancellation(shiftId, trx);
    const reversedAt = new Date().toISOString();
    const actorId = Number(input.actorId || 0) > 0 ? input.actorId : null;

    const shiftCredits = await trx('shift_credits')
      .where({ shift_id: shiftId })
      .whereNull('deleted_at')
      .orderBy('id');
    const affectedCustomerAccounts = new Set<number>();
    for (const shiftCredit of shiftCredits) {
      if (!shiftCredit.credit_id) continue;
      const credit = await trx('credits').where({ id: shiftCredit.credit_id }).first();
      if (!credit) continue;
      const activeAllocations = await trx('credit_payment_allocations')
        .where({ credit_id: credit.id })
        .whereNull('reversed_at')
        .first();
      if (activeAllocations) {
        throw httpError(
          `Credit ${credit.id} has a posted payment and cannot be cancelled safely. Reverse the payment first.`,
          409,
          'SHIFT_CREDIT_HAS_PAYMENT',
        );
      }
      await trx('credits').where({ id: credit.id }).update({
        deleted_at: reversedAt,
        status: 'cancelled',
      });
      if (credit.account_id) affectedCustomerAccounts.add(Number(credit.account_id));
    }
    if (shiftCredits.length > 0) {
      await trx('shift_credits')
        .where({ shift_id: shiftId })
        .whereNull('deleted_at')
        .update({ deleted_at: reversedAt });
    }

    const creditPayments = await trx('credit_payments')
      .where({ shift_id: shiftId, status: 'posted' })
      .whereNull('deleted_at')
      .orderBy('id');
    for (const payment of creditPayments) {
      await reverseMoneyAccountPaymentInTransaction(trx, {
        paymentId: Number(payment.id),
        reason: `Shift #${shiftId} cancelled: ${reason}`,
        actorId,
      });
      if (payment.account_id) affectedCustomerAccounts.add(Number(payment.account_id));
    }

    for (const accountId of affectedCustomerAccounts) {
      await recomputeAccountBalance(accountId, trx);
    }

    const reservedConsumption = await trx('invoice_consumption')
      .where({ shift_id: shiftId })
      .whereNull('deleted_at')
      .whereNotNull('invoice_line_id')
      .first();
    if (reservedConsumption) {
      throw httpError(
        'Invoice consumption is already reserved by an invoice and cannot be cancelled.',
        409,
        'SHIFT_CONSUMPTION_RESERVED',
      );
    }
    await trx('invoice_consumption')
      .where({ shift_id: shiftId })
      .whereNull('deleted_at')
      .update({
        deleted_at: reversedAt,
        updated_at: reversedAt,
        entry_status: 'cancelled',
      });
    await trx('shift_expenses')
      .where({ shift_id: shiftId })
      .whereNull('deleted_at')
      .update({ deleted_at: reversedAt });

    const debtAllocationCount = await restoreStaffDebtAllocations(trx, shiftId, reversedAt);
    const activeDeduction = await trx('wage_deductions')
      .where({ shift_id: shiftId })
      .whereNull('deleted_at')
      .first();
    if (activeDeduction && Number(activeDeduction.deduction_amount || 0) > 0 && debtAllocationCount === 0) {
      throw httpError(
        'This shift has a legacy staff-debt deduction without allocation history. Remove it before cancelling.',
        409,
        'SHIFT_DEBT_ALLOCATION_MISSING',
      );
    }
    await trx('wage_deductions')
      .where({ shift_id: shiftId })
      .whereNull('deleted_at')
      .update({ deleted_at: reversedAt });
    if (debtAllocationCount > 0) await refreshEmployeeDebtAccount(trx, Number(shift.employee_id));

    const payrollPayments = await trx('payroll_payments')
      .join('payroll_lines', 'payroll_payments.payroll_line_id', 'payroll_lines.id')
      .where({ 'payroll_payments.shift_id': shiftId, 'payroll_payments.status': 'posted' })
      .select('payroll_payments.*', 'payroll_lines.run_id');
    const payrollLines = new Set<number>();
    const payrollRuns = new Set<number>();
    for (const payment of payrollPayments) {
      await trx('payroll_payments').where({ id: payment.id }).update({
        status: 'reversed',
        reversed_at: reversedAt,
        reversal_reason: `Shift #${shiftId} cancelled: ${reason}`,
      });
      payrollLines.add(Number(payment.payroll_line_id));
      payrollRuns.add(Number(payment.run_id));
    }
    for (const lineId of payrollLines) await refreshPayrollLine(lineId, trx);
    for (const runId of payrollRuns) await refreshPayrollRun(runId, trx);

    await trx('shifts').where({ id: shiftId }).update({
      status: 'cancelled',
      end_time: reversedAt,
      cancelled_at: reversedAt,
      cancelled_by_employee_id: actorId,
      cancellation_reason: reason,
    });

    return {
      ...summary,
      status: 'cancelled',
      cancelled_at: reversedAt,
      cancellation_reason: reason,
    };
  });
}
