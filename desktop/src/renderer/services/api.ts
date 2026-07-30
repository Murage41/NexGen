import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL ||
  localStorage.getItem('nexgen_api_url') ||
  'http://localhost:3001/api';
const desktopKey = import.meta.env.VITE_DESKTOP_KEY ||
  (!import.meta.env.PROD ? 'nexgen-desktop-2026' : '');

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: desktopKey ? { 'x-desktop-key': desktopKey } : undefined,
});

// ============ Employees ============
export const getEmployees = () => api.get('/employees');
export const getActiveEmployees = () => api.get('/employees/active');
export const getEmployee = (id: number) => api.get(`/employees/${id}`);
export const createEmployee = (data: any) => api.post('/employees', data);
export const updateEmployee = (id: number, data: any) => api.put(`/employees/${id}`, data);
export const deleteEmployee = (id: number) => api.delete(`/employees/${id}`);
export const getCompensationPlans = (id: number) => api.get(`/employees/${id}/compensation-plans`);
export const createCompensationPlan = (id: number, data: any) =>
  api.post(`/employees/${id}/compensation-plans`, data);

// ============ Payroll ============
export const getPayrollRuns = (params?: any) => api.get('/payroll/runs', { params });
export const getPayrollRun = (id: number) => api.get(`/payroll/runs/${id}`);
export const previewPayrollRun = (params: any) => api.get('/payroll/runs/preview', { params });
export const calculatePayrollRun = (data: any) => api.post('/payroll/runs/calculate', data);
export const addPayrollDeduction = (runId: number, lineId: number, data: any) =>
  api.post(`/payroll/runs/${runId}/lines/${lineId}/deductions`, data);
export const deletePayrollDeduction = (runId: number, deductionId: number) =>
  api.delete(`/payroll/runs/${runId}/deductions/${deductionId}`);
export const approvePayrollRun = (id: number) => api.post(`/payroll/runs/${id}/approve`);
export const addPayrollPayment = (lineId: number, data: any) =>
  api.post(`/payroll/lines/${lineId}/payments`, data);
export const reversePayrollPayment = (id: number, reason: string) =>
  api.post(`/payroll/payments/${id}/reverse`, { reason });
export const voidPayrollRun = (id: number, reason: string) =>
  api.post(`/payroll/runs/${id}/void`, { reason });

// ============ Pumps ============
export const getPumps = () => api.get('/pumps');
export const getActivePumps = () => api.get('/pumps/active');
export const createPump = (data: any) => api.post('/pumps', data);
export const updatePump = (id: number, data: any) => api.put(`/pumps/${id}`, data);
export const deletePump = (id: number) => api.delete(`/pumps/${id}`);

// ============ Tanks ============
export const getTanks = () => api.get('/tanks');
export const getTank = (id: number) => api.get(`/tanks/${id}`);
export const createTank = (data: any) => api.post('/tanks', data);
export const updateTank = (id: number, data: any) => api.put(`/tanks/${id}`, data);
export const deleteTank = (id: number) => api.delete(`/tanks/${id}`);
export const getTankStockSummary = (id: number) => api.get(`/tanks/${id}/stock-summary`);
export const getTankAdjustments = (tankId: number) => api.get(`/tanks/${tankId}/adjustments`);
export const createTankAdjustment = (tankId: number, data: any) => api.post(`/tanks/${tankId}/adjustments`, data);

// ============ Shifts ============
export const getShifts = (params?: any) => api.get('/shifts', { params });
export const getCurrentShift = () => api.get('/shifts/current');
export const getShift = (id: number) => api.get(`/shifts/${id}`);
export const openShift = (data: { employee_id: number }) => api.post('/shifts', data);
export const updateReadings = (shiftId: number, readings: any[], confirm_anomaly?: boolean, confirm_large_sale?: boolean) =>
  api.put(`/shifts/${shiftId}/readings`, {
    readings,
    ...(confirm_anomaly ? { confirm_anomaly: true } : {}),
    ...(confirm_large_sale ? { confirm_large_sale: true } : {}),
  });
export const setOpeningReadings = (shiftId: number, readings: any[]) =>
  api.put(`/shifts/${shiftId}/opening-readings`, { readings });
export const updateCollections = (shiftId: number, data: any) =>
  api.put(`/shifts/${shiftId}/collections`, data);
export const addShiftExpense = (shiftId: number, data: any) =>
  api.post(`/shifts/${shiftId}/expenses`, data);
export const deleteShiftExpense = (shiftId: number, expenseId: number) =>
  api.delete(`/shifts/${shiftId}/expenses/${expenseId}`);
export const closeShift = (shiftId: number, data?: { notes?: string; deduct_amount?: number | null; wage_paid?: number }) =>
  api.put(`/shifts/${shiftId}/close`, data || {});
export const addShiftCredit = (shiftId: number, data: any) =>
  api.post(`/shifts/${shiftId}/credits`, data);
export const deleteShiftCredit = (shiftId: number, creditId: number) =>
  api.delete(`/shifts/${shiftId}/credits/${creditId}`);
export const updateWageDeduction = (shiftId: number, data: any) =>
  api.put(`/shifts/${shiftId}/wage-deduction`, data);
export const deleteWageDeduction = (shiftId: number) =>
  api.delete(`/shifts/${shiftId}/wage-deduction`);
export const getStaffDebts = (employeeId: number) =>
  api.get(`/shifts/staff-debts/${employeeId}`);
export const repayDebt = (shiftId: number, amount: number) =>
  api.put(`/shifts/${shiftId}/repay-debt`, { amount });
export const addShiftCreditReceipt = (shiftId: number, data: { account_id: number; amount: number; payment_method?: string; notes?: string }) =>
  api.post(`/shifts/${shiftId}/credit-receipts`, data);
export const addInvoiceConsumption = (shiftId: number, data: { account_id: number; pump_id?: number | null; tank_id?: number | null; fuel_type: 'petrol' | 'diesel'; litres: number }) =>
  api.post(`/shifts/${shiftId}/invoice-consumption`, data);
export const updateInvoiceConsumption = (shiftId: number, entryId: number, data: { litres?: number; pump_id?: number | null; tank_id?: number | null }) =>
  api.put(`/shifts/${shiftId}/invoice-consumption/${entryId}`, data);
export const deleteInvoiceConsumption = (shiftId: number, entryId: number) =>
  api.delete(`/shifts/${shiftId}/invoice-consumption/${entryId}`);
export const previewInvoiceConsumptionCorrection = (
  shiftId: number,
  entryId: number,
  data: { litres: number; pump_id?: number | null; tank_id?: number | null },
) => api.post(`/shifts/${shiftId}/invoice-consumption/${entryId}/correction-preview`, data);
export const correctInvoiceConsumption = (
  shiftId: number,
  entryId: number,
  data: {
    litres: number;
    pump_id?: number | null;
    tank_id?: number | null;
    reason: string;
    confirmation_token: string;
  },
) => api.post(`/shifts/${shiftId}/invoice-consumption/${entryId}/correct`, data);

// ============ Fuel Prices ============
export const getFuelPrices = () => api.get('/fuel-prices');
export const getCurrentPrices = () => api.get('/fuel-prices/current');
export const createFuelPrice = (data: any) => api.post('/fuel-prices', data);
export const deleteFuelPrice = (id: number) => api.delete(`/fuel-prices/${id}`);
export const updateFuelPrice = (fuelType: string, data: any) => api.put(`/fuel-prices/${fuelType}`, data);

// ============ Expenses ============
export const getExpenses = (params?: any) => api.get('/expenses', { params });
export const createExpense = (data: any) => api.post('/expenses', data);
export const updateExpense = (id: number, data: any) => api.put(`/expenses/${id}`, data);
export const deleteExpense = (id: number) => api.delete(`/expenses/${id}`);
export const getExpenseCategories = () => api.get('/expenses/categories');
export const getExpenseSummary = (params?: any) => api.get('/expenses/summary', { params });

// ============ Credits ============
export const getCredits = (params?: any) => api.get('/credits', { params });
export const getCredit = (id: number) => api.get(`/credits/${id}`);
export const createCredit = (data: any) => api.post('/credits', data);
export const addCreditPayment = (creditId: number, data: any) =>
  api.post(`/credits/${creditId}/payments`, data);
export const getCreditSummary = () => api.get('/credits/summary/by-customer');

// ============ Credit Accounts ============
export const getCreditAccounts = (params?: any) => api.get('/credit-accounts', { params });
export const getCreditAccount = (id: number) => api.get(`/credit-accounts/${id}`);
export const createCreditAccount = (data: any) => api.post('/credit-accounts', data);
export const updateCreditAccount = (id: number, data: any) => api.put(`/credit-accounts/${id}`, data);
export const deleteCreditAccount = (id: number) => api.delete(`/credit-accounts/${id}`);
export const getCreditAccountStatement = (id: number) => api.get(`/credit-accounts/${id}/statement`);
export const addAccountPayment = (accountId: number, data: any) =>
  api.post(`/credit-accounts/${accountId}/payments`, data);

// ============ Customer Invoices (invoice-mode AR) ============
export const getCustomerInvoices = (params?: { account_id?: number; status?: string; from?: string; to?: string }) =>
  api.get('/customer-invoices', { params });
export const getInvoiceCustomerMonitor = (params?: { recent_limit?: number }) =>
  api.get('/customer-invoices/customers/monitor', { params });
export const getInvoiceCustomerConsumption = (
  accountId: number,
  params?: {
    from?: string;
    to?: string;
    fuel_type?: string;
    status?: string;
    shift_id?: number;
    page?: number;
    page_size?: number;
  },
) => api.get(`/customer-invoices/customers/${accountId}/consumption`, { params });
export const getCustomerInvoice = (id: number) => api.get(`/customer-invoices/${id}`);
export const previewCustomerInvoice = (params: { account_id: number; from: string; to: string }) =>
  api.get('/customer-invoices/preview/scan', { params });
export const createCustomerInvoiceDraft = (data: {
  account_id: number;
  from_date: string;
  to_date: string;
  agreed_prices?: { petrol?: number; diesel?: number };
  notes?: string;
}) => api.post('/customer-invoices', data);
export const updateCustomerInvoiceLine = (invoiceId: number, lineId: number, data: { agreed_price: number }) =>
  api.put(`/customer-invoices/${invoiceId}/lines/${lineId}`, data);
export const issueCustomerInvoice = (id: number) => api.post(`/customer-invoices/${id}/issue`);
export const refreshCustomerInvoiceDraft = (id: number) => api.post(`/customer-invoices/${id}/refresh`);
export const voidCustomerInvoice = (id: number, data: { reason: string }) => api.post(`/customer-invoices/${id}/void`, data);
export const deleteCustomerInvoiceDraft = (id: number) => api.delete(`/customer-invoices/${id}`);
export const createCustomerInvoiceAdjustment = (id: number, data: any) =>
  api.post(`/customer-invoices/${id}/adjustments`, data);
export const reverseCustomerInvoiceAdjustment = (noteId: number, data: { reason: string; reversal_date?: string }) =>
  api.post(`/customer-invoices/adjustments/${noteId}/reverse`, data);
export const getInvoiceAccountingEvents = (params?: any) =>
  api.get('/customer-invoices/accounting-events', { params });

// ─── Customer Invoice Payments (Phase 3D) ───
export const getInvoicePayments = (params?: { account_id?: number; from?: string; to?: string }) =>
  api.get('/customer-invoices/payments', { params });
export const createInvoicePayment = (data: {
  account_id: number;
  amount: number;
  payment_method?: string;
  payment_date?: string;
  reference?: string;
  notes?: string;
}) => api.post('/customer-invoices/payments', data);
export const reverseInvoicePayment = (paymentId: number, data: { reason: string; reversal_date?: string }) =>
  api.post(`/customer-invoices/payments/${paymentId}/reverse`, data);

// ============ Fuel Deliveries ============
export const getFuelDeliveries = (params?: any) => api.get('/fuel-deliveries', { params });
export const createFuelDelivery = (data: any) => api.post('/fuel-deliveries', data);
export const updateFuelDelivery = (id: number, data: any) => api.put(`/fuel-deliveries/${id}`, data);
export const deleteFuelDelivery = (id: number) => api.delete(`/fuel-deliveries/${id}`);
export const uploadFuelDeliveryInvoiceDocument = (id: number, data: any) =>
  api.post(`/fuel-deliveries/${id}/invoice-document`, data);
export const getFuelDeliveryInvoiceDocument = (id: number) =>
  api.get(`/fuel-deliveries/${id}/invoice-document`, { responseType: 'blob' });

// ============ Tank Dips ============
export const getTankDips = (params?: any) => api.get('/tank-dips', { params });
export const createTankDip = (data: any) => api.post('/tank-dips', data);
export const updateTankDip = (id: number, data: any) => api.put(`/tank-dips/${id}`, data);
export const deleteTankDip = (id: number) => api.delete(`/tank-dips/${id}`);

// ============ Invoices ============
export const getInvoices = (params?: any) => api.get('/invoices', { params });
export const getInvoice = (id: number) => api.get(`/invoices/${id}`);
export const createInvoice = (data: any) => api.post('/invoices', data);
export const updateInvoice = (id: number, data: any) => api.put(`/invoices/${id}`, data);

// ============ Dashboard ============
export const getDashboard = () => api.get('/dashboard');

// ============ Reports ============
export const getDailyReport = (date?: string) => api.get('/reports/daily', { params: { date } });
export const getMonthlyReport = (month?: string) => api.get('/reports/monthly', { params: { month } });
export const getStockReconciliation = (date?: string) => api.get('/reports/stock-reconciliation', { params: { date } });
export const getStockReconciliationByShift = (date?: string) => api.get('/reports/stock-reconciliation-by-shift', { params: { date } });
export const getDebtorAging = () => api.get('/reports/debtor-aging');
export const getCashFlow = (params?: { from?: string; to?: string }) => api.get('/reports/cash-flow', { params });

// ============ Suppliers ============
export const getSuppliers = () => api.get('/suppliers');
export const getSupplier = (id: number) => api.get(`/suppliers/${id}`);
export const createSupplier = (data: any) => api.post('/suppliers', data);
export const updateSupplier = (id: number, data: any) => api.put(`/suppliers/${id}`, data);
export const deleteSupplier = (id: number) => api.delete(`/suppliers/${id}`);

// ============ Supplier Invoices ============
export const getSupplierInvoices = (params?: any) => api.get('/supplier-invoices', { params });
export const getSupplierInvoice = (id: number) => api.get(`/supplier-invoices/${id}`);
export const createSupplierInvoice = (data: any) => api.post('/supplier-invoices', data);

// ============ Supplier Payments ============
export const getSupplierPayments = (params?: any) => api.get('/supplier-payments', { params });
export const createSupplierPayment = (data: any) => api.post('/supplier-payments', data);
export const deleteSupplierPayment = (id: number) => api.delete(`/supplier-payments/${id}`);

// ============ Tank Accountability ============
export const getShiftTankSummary = (shiftId: number) => api.get(`/shifts/${shiftId}/tank-summary`);
export const getTankLedger = (tankId: number, params?: any) => api.get(`/tanks/${tankId}/ledger`, { params });

export default api;
