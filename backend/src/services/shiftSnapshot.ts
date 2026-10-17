import type { Knex } from 'knex';
import { computeShiftAccountability, roundMoney, shiftReconciliationBasis } from './shiftAccountability';

// Original figures come from the immutable close snapshot. The separate
// current reader applies later corrections without changing that saved close.
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
  const balances = shiftReconciliationBasis(shift) === 'balances_v1';
  const opening = await effectiveShiftOpening(conn, shift);
  const fundsMovements = balances && await conn.schema.hasTable('shift_funds_movements')
    ? await conn('shift_funds_movements').where({ shift_id: shiftId }).whereNull('deleted_at').whereNull('reversed_by_record_correction_id')
    : [];
  const deduction = balances && await conn.schema.hasTable('wage_deductions')
    ? await conn('wage_deductions').where({ shift_id: shiftId }).whereNull('deleted_at').orderBy('id', 'desc').first()
    : null;
  return computeShiftAccountability({
    readings,
    collections,
    shiftCredits,
    invoiceConsumption,
    creditReceipts,
    expenses,
    employee_wage: Number(shift?.wage_paid ?? shift?.employee_wage ?? 0),
    payrollPayments,
    reconciliation_basis: shiftReconciliationBasis(shift),
    ...opening,
    actual_wage_paid: Number(shift?.direct_wage_cash_amount ?? Math.max(0, Number(shift?.wage_paid || 0) - Number(deduction?.deduction_amount || 0))),
    fundsMovements,
  });
}

// Start with the signed declaration, never the close snapshot: that snapshot
// already includes any opening corrections made before close.
export async function effectiveShiftOpening(conn: Conn, shift: any) {
  const lines = shiftReconciliationBasis(shift) === 'balances_v1' && await conn.schema.hasTable('correction_lines')
    ? await conn('correction_lines').where({ shift_id: shift.id, record_type: 'opening_funds' })
    : [];
  return effectiveOpeningFromLines(shift, lines);
}

export function effectiveOpeningFromLines(shift: any, lines: any[]) {
  if (shiftReconciliationBasis(shift) !== 'balances_v1') {
    return { opening_cash_amount: null, opening_mpesa_amount: null };
  }
  let cash = Math.round(Number(shift.opening_cash_amount || 0) * 100);
  let mpesa = Math.round(Number(shift.opening_mpesa_amount || 0) * 100);
  for (const line of lines) {
    if (line.record_type !== 'opening_funds') continue;
    const delta = Math.round(Number(line.amount || 0) * 100) * (line.action === 'reverse' ? -1 : 1);
    if (line.method === 'cash') cash += delta;
    if (line.method === 'mpesa') mpesa += delta;
  }
  return { opening_cash_amount: cash / 100, opening_mpesa_amount: mpesa / 100 };
}

// Extra columns added by the float migration; spread these into the ordinary
// close insert so the original custody calculation stays frozen.
export function snapshotFinancialFields(figures: ReturnType<typeof computeShiftAccountability>) {
  return {
    reconciliation_basis: figures.reconciliation_basis,
    opening_cash_amount: figures.opening_cash_amount,
    opening_mpesa_amount: figures.opening_mpesa_amount,
    funds_added_cash: figures.funds_added_cash,
    funds_added_mpesa: figures.funds_added_mpesa,
    funds_added_total: figures.funds_added_total,
    funds_removed_cash: figures.funds_removed_cash,
    funds_removed_mpesa: figures.funds_removed_mpesa,
    funds_removed_total: figures.funds_removed_total,
    drawer_business_payouts: figures.drawer_business_payouts,
    expected_closing: figures.expected_closing,
    inferred_collections: figures.inferred_collections,
    expected_receipts: figures.expected_receipts,
  };
}

// The snapshot's figures in the names the shift screen uses.
export function snapshotFigures(snapshot: any) {
  const basis = shiftReconciliationBasis(snapshot);
  const openingCash = basis === 'balances_v1' ? Number(snapshot.opening_cash_amount || 0) : null;
  const openingMpesa = basis === 'balances_v1' ? Number(snapshot.opening_mpesa_amount || 0) : null;
  const closingCash = Number(snapshot.cash_received);
  const closingMpesa = Number(snapshot.mpesa_received);
  const payouts = Number(snapshot.drawer_business_payouts ?? roundMoney(Number(snapshot.expenses) + Number(snapshot.direct_wage_payment) + Number(snapshot.payroll_payments)));
  const inferred = Number(snapshot.inferred_collections ?? roundMoney(closingCash + closingMpesa + payouts));
  return {
    reconciliation_basis: basis,
    opening_cash_amount: openingCash,
    opening_mpesa_amount: openingMpesa,
    opening_total: basis === 'balances_v1' ? roundMoney(openingCash! + openingMpesa!) : null,
    closing_cash: closingCash,
    closing_mpesa: closingMpesa,
    closing_total: roundMoney(closingCash + closingMpesa),
    drawer_cash: closingCash,
    drawer_mpesa: closingMpesa,
    drawer_total: roundMoney(closingCash + closingMpesa),
    expected_total_received: roundMoney(closingCash + closingMpesa),
    ...(basis === 'balances_v1' ? { sales_cash: null, sales_mpesa: null, expected_cash: null, expected_mpesa: null } : {}),
    sales_collections: roundMoney((basis === 'balances_v1' ? inferred : closingCash + closingMpesa) - Number(snapshot.credit_receipts)),
    funds_added_cash: Number(snapshot.funds_added_cash || 0),
    funds_added_mpesa: Number(snapshot.funds_added_mpesa || 0),
    funds_added_total: Number(snapshot.funds_added_total || 0),
    funds_removed_cash: Number(snapshot.funds_removed_cash || 0),
    funds_removed_mpesa: Number(snapshot.funds_removed_mpesa || 0),
    funds_removed_total: Number(snapshot.funds_removed_total || 0),
    drawer_business_payouts: payouts,
    expected_closing: Number(snapshot.expected_closing ?? roundMoney(Number(snapshot.expected_shift_total) - Number(snapshot.credits_issued) - Number(snapshot.invoice_consumption) - payouts)),
    inferred_collections: inferred,
    expected_receipts: Number(snapshot.expected_receipts ?? roundMoney(Number(snapshot.expected_sales) - Number(snapshot.credits_issued) - Number(snapshot.invoice_consumption) + Number(snapshot.credit_receipts))),
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
    sales_accounted: roundMoney(Number(snapshot.total_accounted) - Number(snapshot.credit_receipts) - (basis === 'balances_v1' ? Number(openingCash) + Number(openingMpesa) + Number(snapshot.funds_added_total || 0) : 0)),
    variance: Number(snapshot.variance),
    sales_variance: Number(snapshot.variance),
  };
}

// A closed shift's fuel on account as its snapshot counted it: without entries
// a correction added since, with the ones it reversed. A snapshot taken at
// close also undoes the closed-shift corrections of before 23 Sep 2026
// (services/shiftCorrections.ts); a backfilled one was taken from the rows as
// they stood after those, so it keeps them.
// Its credit sales and drawer expenses: a row a correction reversed is
// soft-deleted and marked, and still counts; one it added does not.
export function asRecordedRows(query: any, table: string) {
  const column = (name: string) => `${table}.${name}`;
  return query
    .whereNull(column('created_by_record_correction_id'))
    .where((q: any) => q.whereNull(column('deleted_at')).orWhereNotNull(column('reversed_by_record_correction_id')));
}

// Its debt receipts: a reversed payment is marked, never deleted. As with fuel
// on account, a snapshot taken at close also undoes the closed-shift
// corrections of before 23 Sep 2026.
export function asRecordedReceipts(query: any, table: string, backfilled: boolean) {
  const column = (name: string) => `${table}.${name}`;
  query.whereNull(column('deleted_at')).whereNull(column('created_by_record_correction_id'));
  if (!backfilled) query.whereNull(column('created_by_correction_id'));
  return query.where((q: any) => {
    q.where(column('status'), 'posted').orWhereNotNull(column('reversed_by_record_correction_id'));
    if (!backfilled) q.orWhereNotNull(column('reversed_by_correction_id'));
  });
}

export function asRecordedConsumption(query: any, table: string, backfilled: boolean) {
  const column = (name: string) => (table ? `${table}.${name}` : name);
  query.whereNull(column('created_by_record_correction_id'));
  if (!backfilled) query.whereNull(column('created_by_correction_id'));
  return query.where((q: any) => {
    q.whereNull(column('deleted_at')).orWhereNotNull(column('reversed_by_record_correction_id'));
    if (!backfilled) q.orWhereNotNull(column('reversed_by_correction_id'));
  });
}
