import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  timeout: 10000,
  headers: {
    // Desktop app is admin-only — bypass mobile role auth with shared key
    'x-desktop-key': 'nexgen-desktop-2026',
  },
});

// ============ Employees ============
export const getEmployees = () => api.get('/employees');
export const getActiveEmployees = () => api.get('/employees/active');
export const getEmployee = (id: number) => api.get(`/employees/${id}`);
export const createEmployee = (data: any) => api.post('/employees', data);
export const updateEmployee = (id: number, data: any) => api.put(`/employees/${id}`, data);
export const deleteEmployee = (id: number) => api.delete(`/employees/${id}`);

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

// ============ Shifts ============
export const getShifts = (params?: any) => api.get('/shifts', { params });
export const getCurrentShift = () => api.get('/shifts/current');
export const getShift = (id: number) => api.get(`/shifts/${id}`);
export const openShift = (data: { employee_id: number; shift_date?: string }) => api.post('/shifts', data);
export const updateReadings = (shiftId: number, readings: any[]) =>
  api.put(`/shifts/${shiftId}/readings`, { readings });
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
export const deleteCreditAccount = (id: number) => api.delete(`/credit-accounts/${id}`);
export const getCreditAccountStatement = (id: number) => api.get(`/credit-accounts/${id}/statement`);
export const addAccountPayment = (accountId: number, data: any) =>
  api.post(`/credit-accounts/${accountId}/payments`, data);

// ============ Fuel Deliveries ============
export const getFuelDeliveries = (params?: any) => api.get('/fuel-deliveries', { params });
export const createFuelDelivery = (data: any) => api.post('/fuel-deliveries', data);
export const updateFuelDelivery = (id: number, data: any) => api.put(`/fuel-deliveries/${id}`, data);
export const deleteFuelDelivery = (id: number) => api.delete(`/fuel-deliveries/${id}`);

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
