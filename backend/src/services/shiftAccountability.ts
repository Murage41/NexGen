// What a shift must account for and what it did account for. Shared by the
// shift routes (live view and close) and by closed-shift corrections, so a
// correction changes a shift's variance by exactly what the close formula says.

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sumMoney(rows: any[], selector: (row: any) => any): number {
  return roundMoney(rows.reduce((sum: number, row: any) => sum + Number(selector(row) || 0), 0));
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
}: {
  readings: any[];
  collections: any;
  shiftCredits: any[];
  invoiceConsumption: any[];
  creditReceipts: any[];
  expenses: any[];
  employee_wage: number;
  payrollPayments?: any[];
}) {
  const expected_sales = sumMoney(readings, (reading: any) => reading.amount_sold);
  const total_cash = roundMoney(collections ? Number(collections.cash_amount || 0) : 0);
  const total_mpesa = roundMoney(collections ? Number(collections.mpesa_amount || 0) : 0);
  const total_credits = sumMoney(shiftCredits, (credit: any) => credit.amount);
  const total_invoice_consumption = sumMoney(invoiceConsumption, (entry: any) => entry.retail_amount);
  const total_expenses = sumMoney(expenses, (expense: any) => expense.amount);
  const total_payroll_payments = sumMoney(payrollPayments, (payment: any) => payment.amount);
  const normalized_wage = roundMoney(Number(employee_wage || 0));
  const { credit_receipts_cash, credit_receipts_mpesa, total_credit_receipts } = splitCreditReceipts(creditReceipts);

  const sales_cash = roundMoney(total_cash - credit_receipts_cash);
  const sales_mpesa = roundMoney(total_mpesa - credit_receipts_mpesa);
  const sales_collections = roundMoney(sales_cash + sales_mpesa);
  const drawer_cash = total_cash;
  const drawer_mpesa = total_mpesa;
  const drawer_total = roundMoney(drawer_cash + drawer_mpesa);
  const sales_accounted = roundMoney(
    sales_collections
      + total_credits
      + total_invoice_consumption
      + total_expenses
      + normalized_wage
      + total_payroll_payments,
  );
  const sales_variance = roundMoney(sales_accounted - expected_sales);
  const expected_shift_total = roundMoney(expected_sales + total_credit_receipts);
  const total_accounted = roundMoney(
    drawer_total
      + total_credits
      + total_invoice_consumption
      + total_expenses
      + normalized_wage
      + total_payroll_payments,
  );
  const variance = roundMoney(total_accounted - expected_shift_total);

  return {
    expected_sales,
    expected_shift_total,
    total_cash,
    total_mpesa,
    expected_cash: drawer_cash,
    expected_mpesa: drawer_mpesa,
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
