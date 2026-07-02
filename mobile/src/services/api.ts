import axios from 'axios';

const API_URL_KEY = 'nexgen_api_url';

function normalizeApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

// When running under Vite dev server (5173/5174), call the local backend on :3001.
// Otherwise (served from backend directly, or via ngrok) use same origin.
const isViteDev = window.location.port === '5173' || window.location.port === '5174';
const storedApiUrl = normalizeApiUrl(localStorage.getItem(API_URL_KEY) || '');
const fallbackBaseURL = isViteDev
  ? import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001/api`
  : `${window.location.origin}/api`;
const baseURL = storedApiUrl || fallbackBaseURL;

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'ngrok-skip-browser-warning': 'true',
  },
});

export function getConfiguredApiUrl(): string {
  return localStorage.getItem(API_URL_KEY) || '';
}

export function setConfiguredApiUrl(value: string): string {
  const normalized = normalizeApiUrl(value);
  if (normalized) {
    localStorage.setItem(API_URL_KEY, normalized);
    api.defaults.baseURL = normalized;
  } else {
    localStorage.removeItem(API_URL_KEY);
    api.defaults.baseURL = fallbackBaseURL;
  }
  return normalized;
}

// Attach session token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('nexgen_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url || '');
    if (status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem('nexgen_token');
      localStorage.removeItem('nexgen_user');
      localStorage.removeItem('nexgen_session_expires_at');
      window.dispatchEvent(new Event('nexgen:session-expired'));
    }
    return Promise.reject(error);
  },
);

// Auth
export const getAuthEmployees = () => api.get('/auth/employees');
export const login = (employee_id: number | null, pin: string, username?: string) =>
  api.post('/auth/login', {
    pin,
    ...(employee_id ? { employee_id } : {}),
    ...(username ? { username } : {}),
  });

// Dashboard
export const getDashboard = () => api.get('/dashboard');

// Shifts
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
export const updateCollections = (shiftId: number, data: any) => api.put(`/shifts/${shiftId}/collections`, data);
export const addShiftExpense = (shiftId: number, data: any) => api.post(`/shifts/${shiftId}/expenses`, data);
export const deleteShiftExpense = (shiftId: number, expenseId: number) => api.delete(`/shifts/${shiftId}/expenses/${expenseId}`);
export const closeShift = (shiftId: number, data?: { notes?: string; deduct_amount?: number | null; wage_paid?: number }) =>
  api.put(`/shifts/${shiftId}/close`, data || {});
export const addShiftCredit = (shiftId: number, data: any) => api.post(`/shifts/${shiftId}/credits`, data);
export const deleteShiftCredit = (shiftId: number, creditId: number) => api.delete(`/shifts/${shiftId}/credits/${creditId}`);
export const updateWageDeduction = (shiftId: number, data: any) => api.put(`/shifts/${shiftId}/wage-deduction`, data);
export const deleteWageDeduction = (shiftId: number) => api.delete(`/shifts/${shiftId}/wage-deduction`);
export const setOpeningReadings = (shiftId: number, readings: any[]) => api.put(`/shifts/${shiftId}/opening-readings`, { readings });
export const getStaffDebts = (employeeId: number) => api.get(`/shifts/staff-debts/${employeeId}`);
export const repayDebt = (shiftId: number, amount: number) => api.put(`/shifts/${shiftId}/repay-debt`, { amount });
export const addShiftCreditReceipt = (shiftId: number, data: { account_id: number; amount: number; payment_method?: string; notes?: string }) =>
  api.post(`/shifts/${shiftId}/credit-receipts`, data);
export const addInvoiceConsumption = (shiftId: number, data: { account_id: number; tank_id?: number | null; fuel_type: 'petrol' | 'diesel'; litres: number }) =>
  api.post(`/shifts/${shiftId}/invoice-consumption`, data);
export const updateInvoiceConsumption = (shiftId: number, entryId: number, data: { litres?: number; tank_id?: number | null }) =>
  api.put(`/shifts/${shiftId}/invoice-consumption/${entryId}`, data);
export const deleteInvoiceConsumption = (shiftId: number, entryId: number) =>
  api.delete(`/shifts/${shiftId}/invoice-consumption/${entryId}`);

// Employees
export const getEmployees = () => api.get('/employees');
export const getActiveEmployees = () => api.get('/employees/active');
export const createEmployee = (data: any) => api.post('/employees', data);
export const updateEmployee = (id: number, data: any) => api.put(`/employees/${id}`, data);
export const deleteEmployee = (id: number) => api.delete(`/employees/${id}`);

// Pumps
export const getPumps = () => api.get('/pumps');
export const getActivePumps = () => api.get('/pumps/active');
export const createPump = (data: any) => api.post('/pumps', data);
export const updatePump = (id: number, data: any) => api.put(`/pumps/${id}`, data);
export const deletePump = (id: number) => api.delete(`/pumps/${id}`);

// Tanks
export const getTanks = () => api.get('/tanks');
export const getTank = (id: number) => api.get(`/tanks/${id}`);
export const createTank = (data: any) => api.post('/tanks', data);
export const updateTank = (id: number, data: any) => api.put(`/tanks/${id}`, data);
export const deleteTank = (id: number) => api.delete(`/tanks/${id}`);
export const getTankStockSummary = (id: number) => api.get(`/tanks/${id}/stock-summary`);
export const getTankAdjustments = (tankId: number) => api.get(`/tanks/${tankId}/adjustments`);
export const createTankAdjustment = (tankId: number, data: any) => api.post(`/tanks/${tankId}/adjustments`, data);

// Tank Dips
export const getTankDips = (params?: { tank_id?: number; date?: string }) => api.get('/tank-dips', { params });
export const createTankDip = (data: { tank_id: number; measured_litres: number; dip_date?: string }) =>
  api.post('/tank-dips', data);
export const updateTankDip = (id: number, data: { measured_litres?: number; dip_date?: string }) =>
  api.put(`/tank-dips/${id}`, data);
export const deleteTankDip = (id: number) => api.delete(`/tank-dips/${id}`);

// Fuel Deliveries
export const getFuelDeliveries = (params?: { from?: string; to?: string; tank_id?: number }) =>
  api.get('/fuel-deliveries', { params });
export const createFuelDelivery = (data: any) => api.post('/fuel-deliveries', data);
export const updateFuelDelivery = (id: number, data: any) => api.put(`/fuel-deliveries/${id}`, data);
export const deleteFuelDelivery = (id: number) => api.delete(`/fuel-deliveries/${id}`);
export const uploadFuelDeliveryInvoiceDocument = (id: number, data: any) =>
  api.post(`/fuel-deliveries/${id}/invoice-document`, data);
export const getFuelDeliveryInvoiceDocument = (id: number) =>
  api.get(`/fuel-deliveries/${id}/invoice-document`, { responseType: 'blob' });

// Fuel Prices
export const getFuelPrices = () => api.get('/fuel-prices');
export const getCurrentPrices = () => api.get('/fuel-prices/current');
export const createFuelPrice = (data: any) => api.post('/fuel-prices', data);
export const updateFuelPrice = (fuelType: string, data: any) => api.put(`/fuel-prices/${fuelType}`, data);

// Expenses
export const getExpenses = (params?: any) => api.get('/expenses', { params });
export const createExpense = (data: any) => api.post('/expenses', data);
export const deleteExpense = (id: number) => api.delete(`/expenses/${id}`);
export const getExpenseCategories = () => api.get('/expenses/categories');
export const getExpenseSummary = (params?: any) => api.get('/expenses/summary', { params });

// Credits
export const getCredits = (params?: any) => api.get('/credits', { params });
export const getCredit = (id: number) => api.get(`/credits/${id}`);
export const createCredit = (data: any) => api.post('/credits', data);
export const addCreditPayment = (creditId: number, data: any) => api.post(`/credits/${creditId}/payments`, data);

// Credit Accounts
export const getCreditAccounts = (params?: any) => api.get('/credit-accounts', { params });
export const getCreditAccount = (id: number) => api.get(`/credit-accounts/${id}`);
export const deleteCreditAccount = (id: number) => api.delete(`/credit-accounts/${id}`);
export const addAccountPayment = (accountId: number, data: any) =>
  api.post(`/credit-accounts/${accountId}/payments`, data);

// Reports
export const getDailyReport = (date?: string) => api.get('/reports/daily', { params: { date } });
export const getMonthlyReport = (month?: string) => api.get('/reports/monthly', { params: { month } });
export const getStockReconciliation = (date?: string) => api.get('/reports/stock-reconciliation', { params: { date } });
export const getStockReconciliationByShift = (date?: string) => api.get('/reports/stock-reconciliation-by-shift', { params: { date } });
export const getDebtorAging = () => api.get('/reports/debtor-aging');
export const getCashFlow = (params?: { from?: string; to?: string }) => api.get('/reports/cash-flow', { params });

// Suppliers
export const getSuppliers = () => api.get('/suppliers');
export const getSupplier = (id: number) => api.get(`/suppliers/${id}`);
export const createSupplier = (data: any) => api.post('/suppliers', data);
export const updateSupplier = (id: number, data: any) => api.put(`/suppliers/${id}`, data);
export const deleteSupplier = (id: number) => api.delete(`/suppliers/${id}`);
export const createSupplierPayment = (data: any) => api.post('/supplier-payments', data);

// Tank Accountability
export const getShiftTankSummary = (shiftId: number) => api.get(`/shifts/${shiftId}/tank-summary`);
export const getTankLedger = (tankId: number, params?: any) => api.get(`/tanks/${tankId}/ledger`, { params });

export default api;
