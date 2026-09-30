import type { Knex } from 'knex';
import { computeShiftAccountability } from './shiftAccountability';

// A closed shift's figures come from its close snapshot
// (shift_close_reconciliations), never from recalculating its rows: records are
// corrected after close by corrections (services/corrections.ts), and the
// shift must keep showing what it closed with.
//
// Shifts closed before snapshots existed (2026-08-17) were given one from their
// rows as they stood, marked backfilled (migration 053).

type Conn = Knex | Knex.Transaction;

// The accountability of a shift from its rows, gathered exactly as the shift
// screen gathered them before snapshots were read.
export async function accountabilityFromRows(conn: Conn, shiftId: number) {
  const shift = await conn('shifts as s')
    .join('employees as e', 's.employee_id', 'e.id')
    .where('s.id', shiftId)
    .first('s.*', 'e.daily_wage as employee_wage');
  const readings = await conn('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .where('pump_readings.shift_id', shiftId)
    .where('pumps.active', true)
    .select('pump_readings.*');
  const collections = await conn('shift_collections').where({ shift_id: shiftId }).first();
  const expenses = await conn('shift_expenses').where({ shift_id: shiftId }).whereNull('deleted_at');
  const shiftCredits = await conn('shift_credits').where({ shift_id: shiftId }).whereNull('deleted_at');
  const invoiceConsumption = await conn('invoice_consumption').where({ shift_id: shiftId }).whereNull('deleted_at');
  const payrollPayments = await conn('payroll_payments')
    .where({ shift_id: shiftId, status: 'posted' })
    .where((q) => q.whereNull('reference').orWhere('reference', 'not like', 'SHIFT-WAGE:%'));
  const creditReceipts = await conn('credit_payments')
    .where({ shift_id: shiftId, status: 'posted' })
    .whereNull('deleted_at');
  return computeShiftAccountability({
    readings,
    collections,
    shiftCredits,
    invoiceConsumption,
    creditReceipts,
    expenses,
    employee_wage: Number(shift?.wage_paid ?? shift?.employee_wage ?? 0),
    payrollPayments,
  });
}

// The snapshot's figures in the names the shift screen uses.
export function snapshotFigures(snapshot: any) {
  return {
    expected_sales: Number(snapshot.expected_sales),
    expected_shift_total: Number(snapshot.expected_shift_total),
    total_cash: Number(snapshot.cash_received),
    total_mpesa: Number(snapshot.mpesa_received),
    total_credit_receipts: Number(snapshot.credit_receipts),
    total_credits: Number(snapshot.credits_issued),
    total_invoice_consumption: Number(snapshot.invoice_consumption),
    total_expenses: Number(snapshot.expenses),
    employee_wage: Number(snapshot.direct_wage_payment),
    total_payroll_payments: Number(snapshot.payroll_payments),
    total_accounted: Number(snapshot.total_accounted),
    sales_accounted: Math.round((Number(snapshot.total_accounted) - Number(snapshot.credit_receipts)) * 100) / 100,
    variance: Number(snapshot.variance),
    sales_variance: Number(snapshot.variance),
  };
}

// A closed shift's fuel on account as its snapshot counted it: without entries
// a correction added since, with the ones it reversed. A snapshot taken at
// close also undoes the closed-shift corrections of before 23 Sep 2026
// (services/shiftCorrections.ts); a backfilled one was taken from the rows as
// they stood after those, so it keeps them.
export function asRecordedConsumption(query: any, table: string, backfilled: boolean) {
  const column = (name: string) => (table ? `${table}.${name}` : name);
  query.whereNull(column('created_by_record_correction_id'));
  if (!backfilled) query.whereNull(column('created_by_correction_id'));
  return query.where((q: any) => {
    q.whereNull(column('deleted_at')).orWhereNotNull(column('reversed_by_record_correction_id'));
    if (!backfilled) q.orWhereNotNull(column('reversed_by_correction_id'));
  });
}
