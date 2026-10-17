// What a shift must account for and what it did account for. Shared by the
// shift routes (live view and close) and by closed-shift corrections, so a
// correction changes a shift's variance by exactly what the close formula says.

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sumMoney(rows: any[], selector: (row: any) => any): number {
  return rows.reduce((cents: number, row: any) => cents + Math.round(Number(selector(row) || 0) * 100), 0) / 100;
}

export type ShiftReconciliationBasis = 'legacy' | 'balances_v1';

export function shiftReconciliationBasis(shift: any): ShiftReconciliationBasis {
  return shift?.reconciliation_basis === 'balances_v1' ? 'balances_v1' : 'legacy';
}

export function splitCreditReceipts(creditReceipts: any[]) {
  const credit_receipts_cash = sumMoney(
    creditReceipts.filter((receipt: any) => (receipt.payment_method || 'cash') !== 'mpesa'),
    (receipt: any) => receipt.amount,
  );
  const credit_receipts_mpesa = sumMoney(
    creditReceipts.filter((receipt: any) => receipt.payment_method === 'mpesa'),
    (receipt: any) => receipt.amount,
  );
  const total_credit_receipts = roundMoney(credit_receipts_cash + credit_receipts_mpesa);

  return {
    credit_receipts_cash,
    credit_receipts_mpesa,
    total_credit_receipts,
  };
}

export function computeShiftAccountability({
  readings,
  collections,
  shiftCredits,
  invoiceConsumption,
  creditReceipts,
  expenses,
  employee_wage,
  payrollPayments = [],
  reconciliation_basis = 'legacy',
  opening_cash_amount = null,
  opening_mpesa_amount = null,
  actual_wage_paid,
  fundsMovements = [],
}: {
  readings: any[];
  collections: any;
  shiftCredits: any[];
  invoiceConsumption: any[];
  creditReceipts: any[];
  expenses: any[];
  employee_wage: number;
  payrollPayments?: any[];
  reconciliation_basis?: ShiftReconciliationBasis;
  opening_cash_amount?: number | null;
  opening_mpesa_amount?: number | null;
  actual_wage_paid?: number;
  fundsMovements?: any[];
}) {
  const balances = reconciliation_basis === 'balances_v1';
  const expected_sales = sumMoney(readings, (reading: any) => reading.amount_sold);
  const total_cash = roundMoney(collections ? Number(collections.cash_amount || 0) : 0);
  const total_mpesa = roundMoney(collections ? Number(collections.mpesa_amount || 0) : 0);
  const total_credits = sumMoney(shiftCredits, (credit: any) => credit.amount);
  const total_invoice_consumption = sumMoney(invoiceConsumption, (entry: any) => entry.retail_amount);
  const total_expenses = sumMoney(expenses, (expense: any) => expense.amount);
  const total_payroll_payments = sumMoney(
    balances ? payrollPayments.filter(payment => ['cash', 'mpesa'].includes(payment.payment_method)) : payrollPayments,
    (payment: any) => payment.amount,
  );
  const normalized_wage = roundMoney(Number((balances ? actual_wage_paid ?? employee_wage : employee_wage) || 0));
  const { credit_receipts_cash, credit_receipts_mpesa, total_credit_receipts } = splitCreditReceipts(creditReceipts);

  const opening_cash = balances ? roundMoney(Number(opening_cash_amount || 0)) : null;
  const opening_mpesa = balances ? roundMoney(Number(opening_mpesa_amount || 0)) : null;
  const opening_total = balances ? roundMoney(opening_cash! + opening_mpesa!) : null;
  const movements = balances ? fundsMovements.filter(row => !row.deleted_at && !row.reversed_by_record_correction_id) : [];
  const movementAmount = (direction: string, method: string) => sumMoney(
    movements.filter(row => row.direction === direction && row.method === method), row => row.amount,
  );
  const funds_added_cash = movementAmount('added', 'cash');
  const funds_added_mpesa = movementAmount('added', 'mpesa');
  const funds_removed_cash = movementAmount('removed', 'cash');
  const funds_removed_mpesa = movementAmount('removed', 'mpesa');
  const funds_added_total = roundMoney(funds_added_cash + funds_added_mpesa);
  const funds_removed_total = roundMoney(funds_removed_cash + funds_removed_mpesa);
  const drawer_business_payouts = roundMoney(total_expenses + normalized_wage + total_payroll_payments);
  const drawer_cash = total_cash;
  const drawer_mpesa = total_mpesa;
  const drawer_total = roundMoney(drawer_cash + drawer_mpesa);
  const inferred_collections = balances
    ? roundMoney(drawer_total + drawer_business_payouts + funds_removed_total - opening_total! - funds_added_total)
    : roundMoney(drawer_total + drawer_business_payouts);
  const expected_receipts = roundMoney(expected_sales - total_credits - total_invoice_consumption + total_credit_receipts);
  const sales_cash = balances ? null : roundMoney(total_cash - credit_receipts_cash);
  const sales_mpesa = balances ? null : roundMoney(total_mpesa - credit_receipts_mpesa);
  const sales_collections = balances
    ? roundMoney(inferred_collections - total_credit_receipts)
    : roundMoney(sales_cash! + sales_mpesa!);
  const sales_accounted = roundMoney(
    sales_collections
      + total_credits
      + total_invoice_consumption
      + (balances ? 0 : drawer_business_payouts),
  );
  const sales_variance = roundMoney(sales_accounted - expected_sales);
  const expected_shift_total = roundMoney(expected_sales + total_credit_receipts + Number(opening_total || 0) + funds_added_total);
  const total_accounted = roundMoney(
    drawer_total
      + total_credits
      + total_invoice_consumption
      + total_expenses
      + normalized_wage
      + total_payroll_payments
      + funds_removed_total,
  );
  const variance = roundMoney(total_accounted - expected_shift_total);

  return {
    reconciliation_basis,
    opening_cash_amount: opening_cash,
    opening_mpesa_amount: opening_mpesa,
    opening_total,
    closing_cash: total_cash,
    closing_mpesa: total_mpesa,
    closing_total: drawer_total,
    funds_added_cash,
    funds_added_mpesa,
    funds_added_total,
    funds_removed_cash,
    funds_removed_mpesa,
    funds_removed_total,
    drawer_business_payouts,
    expected_closing: roundMoney(expected_shift_total - total_credits - total_invoice_consumption - drawer_business_payouts - funds_removed_total),
    inferred_collections,
    expected_receipts,
    expected_sales,
    expected_shift_total,
    total_cash,
    total_mpesa,
    expected_cash: balances ? null : drawer_cash,
    expected_mpesa: balances ? null : drawer_mpesa,
    expected_total_received: drawer_total,
    drawer_total,
    credit_receipts_cash,
    credit_receipts_mpesa,
    total_credit_receipts,
    sales_cash,
    sales_mpesa,
    sales_collections,
    drawer_cash,
    drawer_mpesa,
    total_credits,
    total_invoice_consumption,
    total_expenses,
    total_payroll_payments,
    employee_wage: normalized_wage,
    sales_accounted,
    sales_variance,
    total_accounted,
    variance,
  };
}
