import type { Knex } from 'knex';
import { computeShiftAccountability, roundMoney, shiftReconciliationBasis, sumMoney } from './shiftAccountability';
import { effectiveOpeningFromLines, snapshotFigures } from './shiftSnapshot';

type Conn = Knex | Knex.Transaction;

export type ShiftFinancialView = {
  current: ReturnType<typeof computeShiftAccountability>;
  original: ReturnType<typeof snapshotFigures> | null;
  original_snapshot: any | null;
  collections: any | null;
  collection_count_recorded: boolean;
  shiftCredits: any[];
  creditReceipts: any[];
  invoiceConsumption: any[];
  expenses: any[];
  payrollPayments: any[];
  fundsMovements: any[];
  fundsMovementHistory: any[];
  reconciliation_wage: number;
  actual_wage_paid: number;
  wage_deduction: number;
  drawer_payroll_paid: number;
  invoice_petrol_litres: number;
  invoice_diesel_litres: number;
};

const active = (row: any) => !row.deleted_at;
const activeFuel = (row: any) => active(row) && (!row.entry_status || row.entry_status === 'active');
const posted = (row: any) => active(row) && row.status === 'posted';

// A balance count is custody evidence, not a channel-by-channel receipt list.
// Aggregate those holdings under explicit names instead of calling them sales.
export function summarizeShiftFinancials(views: ShiftFinancialView[]) {
  const balances = views.filter(view => view.current.reconciliation_basis === 'balances_v1');
  const countedBalances = balances.filter(view => view.collection_count_recorded);
  const countedViews = views.filter(view => view.current.reconciliation_basis === 'legacy' || view.collection_count_recorded);
  const hasBalances = balances.length > 0;
  const amount = (key: keyof ShiftFinancialView['current']) => sumMoney(views, view => view.current[key]);
  const countedAmount = (key: keyof ShiftFinancialView['current']) => sumMoney(countedViews, view => view.current[key]);
  return {
    collection_basis: hasBalances ? balances.length === views.length ? 'balances_v1' : 'mixed' : 'legacy',
    has_balance_shifts: hasBalances,
    balance_shift_count: balances.length,
    legacy_shift_count: views.length - balances.length,
    uncounted_balance_shifts: balances.length - countedBalances.length,
    total_cash: hasBalances ? null : amount('total_cash'),
    total_mpesa: hasBalances ? null : amount('total_mpesa'),
    closing_cash: countedAmount('total_cash'),
    closing_mpesa: countedAmount('total_mpesa'),
    closing_total: countedAmount('closing_total'),
    opening_cash_amount: hasBalances ? sumMoney(balances, view => view.current.opening_cash_amount) : null,
    opening_mpesa_amount: hasBalances ? sumMoney(balances, view => view.current.opening_mpesa_amount) : null,
    opening_total: hasBalances ? sumMoney(balances, view => view.current.opening_total) : null,
    funds_added_total: amount('funds_added_total'),
    funds_removed_total: amount('funds_removed_total'),
    drawer_business_payouts: hasBalances ? sumMoney(views, view => view.current.reconciliation_basis === 'balances_v1'
      ? view.current.drawer_business_payouts
      : roundMoney(view.current.total_expenses + view.actual_wage_paid + view.drawer_payroll_paid)) : amount('drawer_business_payouts'),
    expected_closing: amount('expected_closing'),
    inferred_collections: hasBalances ? sumMoney(countedViews, view => view.current.reconciliation_basis === 'balances_v1'
      ? view.current.inferred_collections
      : roundMoney(view.current.drawer_total + view.current.total_expenses + view.actual_wage_paid + view.drawer_payroll_paid)) : countedAmount('inferred_collections'),
    balance_inferred_collections: sumMoney(countedBalances, view => view.current.inferred_collections),
    expected_receipts: amount('expected_receipts'),
    sales_cash: hasBalances ? null : amount('sales_cash'),
    sales_mpesa: hasBalances ? null : amount('sales_mpesa'),
    sales_collections: countedAmount('sales_collections'),
  };
}

function byShift(rows: any[]) {
  const grouped = new Map<number, any[]>();
  for (const row of rows) {
    const id = Number(row.shift_id);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(row);
  }
  return grouped;
}

// Read current financial facts in bounded batches. This never posts, updates
// balances, changes a saved close or replays stock. Liability-only movements
// and invoice notes do not supply money to a shift's drawer.
export async function readShiftFinancials(
  conn: Conn,
  shiftsOrIds: any[],
): Promise<Map<number, ShiftFinancialView>> {
  const result = new Map<number, ShiftFinancialView>();
  if (!shiftsOrIds.length) return result;
  // One consistent read while another device may post a correction. Reuse
  // an existing transaction instead of opening a second SQLite connection.
  if (!(conn as Knex.Transaction).isTransaction) {
    return (conn as Knex).transaction(trx => readShiftFinancials(trx, shiftsOrIds));
  }
  const supplied = new Map<number, any>();
  for (const value of shiftsOrIds) {
    if (typeof value === 'object' && value !== null) supplied.set(Number(value.id), value);
  }
  const ids = [...new Set(shiftsOrIds.map(value => Number(typeof value === 'object' ? value.id : value)))];
  const tables = [
    'shift_close_reconciliations', 'shift_collections', 'shift_credits',
    'credit_payments', 'invoice_consumption', 'shift_expenses',
    'payroll_payments', 'wage_deductions', 'pump_readings', 'correction_lines', 'shift_funds_movements',
  ];
  const availability = new Map(await Promise.all(tables.map(async table => [table, await conn.schema.hasTable(table)] as const)));
  const hasEmployees = await conn.schema.hasTable('employees');

  for (let start = 0; start < ids.length; start += 500) {
    const batch = ids.slice(start, start + 500);
    let shifts: any[];
    if (batch.every(id => supplied.has(id))) shifts = batch.map(id => supplied.get(id));
    else {
      const query = conn('shifts as s').whereIn('s.id', batch).select('s.*');
      if (hasEmployees) query.leftJoin('employees as e', 's.employee_id', 'e.id').select('e.daily_wage as employee_wage');
      shifts = await query;
    }
    const rows = await Promise.all(tables.map(table => availability.get(table)
      ? conn(table).whereIn('shift_id', batch).select('*')
      : Promise.resolve([])));
    const groups = new Map(tables.map((table, index) => [table, byShift(rows[index])]));
    const get = (table: string, id: number) => groups.get(table)?.get(id) || [];

    for (const shift of shifts) {
      const id = Number(shift.id);
      const snapshot = shift.status === 'closed' ? get('shift_close_reconciliations', id)[0] || null : null;
      const original = snapshot ? snapshotFigures(snapshot) : null;
      const stored = get('shift_collections', id)[0];
      const recordedCredits = get('shift_credits', id);
      const shiftCredits = recordedCredits.filter(active);
      const creditReceipts = get('credit_payments', id).filter(posted);
      const invoiceConsumption = get('invoice_consumption', id).filter(activeFuel);
      const expenses = get('shift_expenses', id).filter(active);
      const payrollPayments = get('payroll_payments', id).filter(row => posted(row) && !String(row.reference || '').startsWith('SHIFT-WAGE:'));
      const deductions = get('wage_deductions', id).filter(active).sort((a, b) => Number(a.id) - Number(b.id));
      const deduction = deductions[deductions.length - 1];
      const wageDeduction = roundMoney(Number(deduction?.deduction_amount || 0));
      const correctionLines = get('correction_lines', id);
      const fundsMovements = get('shift_funds_movements', id).filter(row => active(row) && !row.reversed_by_record_correction_id);
      const basis = shiftReconciliationBasis(shift);
      const opening = effectiveOpeningFromLines(shift, correctionLines);
      let cash = Number(original?.total_cash ?? stored?.cash_amount ?? 0);
      let mpesa = Number(original?.total_mpesa ?? stored?.mpesa_amount ?? 0);
      for (const line of correctionLines) {
        if (line.record_type !== 'collection') continue;
        const change = Number(line.amount || 0) * (line.action === 'reverse' ? -1 : 1);
        if (line.method === 'cash') cash += change;
        if (line.method === 'mpesa') mpesa += change;
      }
      // Very old imports can have only the recorded credit total. Retain that
      // evidence until an actual credit correction supplies a changed source;
      // never replace valid fully-paid credit sales with their unpaid balances.
      const correctedCredit = correctionLines.some(line => line.record_type === 'credit_sale');
      const creditAmount = recordedCredits.length || correctedCredit
        ? sumMoney(shiftCredits, row => row.amount)
        : roundMoney(Number(original?.total_credits ?? stored?.credits_amount ?? 0));
      const collections = stored || snapshot || shiftCredits.length || correctionLines.some(line => line.record_type === 'collection')
        ? { ...stored, shift_id: id, cash_amount: roundMoney(cash), mpesa_amount: roundMoney(mpesa),
          credits_amount: creditAmount, total_collected: roundMoney(cash + mpesa + creditAmount) }
        : null;
      if (collections) {
        delete collections.mpesa_fee;
        delete collections.mpesa_net;
      }
      const reconciliationWage = shift.status === 'closed'
        ? Number(original?.employee_wage ?? shift.direct_wage_cash_amount ?? shift.wage_paid ?? shift.employee_wage ?? shift.daily_wage ?? 0)
        : 0;
      const actualWage = shift.status === 'closed'
        ? Number(shift.direct_wage_cash_amount ?? Math.max(0, Number(shift.wage_paid || 0) - wageDeduction))
        : 0;
      const readings = original
        ? [{ amount_sold: original.expected_sales }]
        : get('pump_readings', id);
      const current = computeShiftAccountability({
        readings, collections,
        shiftCredits: [{ amount: creditAmount }], creditReceipts, invoiceConsumption,
        expenses, employee_wage: reconciliationWage, payrollPayments,
        reconciliation_basis: basis, ...opening, actual_wage_paid: actualWage, fundsMovements,
      });
      result.set(id, {
        current, original, original_snapshot: snapshot, collections,
        collection_count_recorded: Boolean(snapshot) || (Boolean(stored) && (basis === 'legacy' || Number(shift.collections_revision || 0) > 0)),
        shiftCredits, creditReceipts, invoiceConsumption, expenses, payrollPayments, fundsMovements,
        fundsMovementHistory: get('shift_funds_movements', id),
        reconciliation_wage: roundMoney(reconciliationWage),
        actual_wage_paid: roundMoney(actualWage), wage_deduction: wageDeduction,
        drawer_payroll_paid: sumMoney(payrollPayments.filter(row => ['cash', 'mpesa'].includes(row.payment_method)), row => row.amount),
        invoice_petrol_litres: invoiceConsumption.filter(row => row.fuel_type === 'petrol').reduce((total, row) => total + Number(row.litres || 0), 0),
        invoice_diesel_litres: invoiceConsumption.filter(row => row.fuel_type === 'diesel').reduce((total, row) => total + Number(row.litres || 0), 0),
      });
    }
  }
  return result;
}
