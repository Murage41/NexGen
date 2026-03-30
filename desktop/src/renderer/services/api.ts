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
export const openShift = (data: { employee_id: number }) => api.post('/shifts', data);
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
export const closeShift = (shiftId: number, data?: { notes?: string; deduct_amount?: number | null }) =>
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

// ============ Fuel Prices ============
export const getFuelPrices = () => api.get('/fuel-prices');
export const getCurrentPrices = () => api.get('/fuel-prices/current');
export const createFuelPrice = (data: any) => api.post('/fuel-prices', data);
export const deleteFuelPrice = (id: number) => api.delete(`/fuel-prices/${id}`);

// ============ Expenses ============
export const getExpenses = (params?: any) => api.get('/expenses', { params });
export const createExpense = (data: any) => api.post('/expenses', data);
export const updateExpense = (id: number, data: any) => api.put(`/expenses/${id}`, data);
export const deleteExpense = (id: number) => api.delete(`/expenses/${id}`);

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

export default api;
