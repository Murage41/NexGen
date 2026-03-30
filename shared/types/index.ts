// ============ Enums ============

export type FuelType = 'petrol' | 'diesel';
export type PaymentMethod = 'cash' | 'mpesa';
export type ShiftStatus = 'open' | 'closed';
export type CreditStatus = 'outstanding' | 'paid' | 'partial';
export type InvoiceStatus = 'unpaid' | 'paid' | 'partial';
export type UserRole = 'admin' | 'attendant';

// ============ Database Models ============

export interface Employee {
  id: number;
  name: string;
  daily_wage: number;
  phone: string;
  pin: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

export interface Tank {
  id: number;
  label: string;
  fuel_type: FuelType;
  capacity_litres: number;
  current_stock_litres: number;
  created_at: string;
}

export interface Pump {
  id: number;
  label: string;
  nozzle_label: string;
  fuel_type: FuelType;
  tank_id: number;
  active: boolean;
  created_at: string;
}

export interface Shift {
  id: number;
  employee_id: number;
  start_time: string;
  end_time: string | null;
  status: ShiftStatus;
  notes: string | null;
  created_at: string;
  // Joined fields
  employee_name?: string;
}

export interface PumpReading {
  id: number;
  shift_id: number;
  pump_id: number;
  opening_litres: number;
  closing_litres: number;
  opening_amount: number;
  closing_amount: number;
  litres_sold: number;
  amount_sold: number;
  // Joined fields
  pump_label?: string;
  nozzle_label?: string;
  fuel_type?: FuelType;
}

export interface ShiftCollection {
  id: number;
  shift_id: number;
  cash_amount: number;
  mpesa_amount: number;
  credits_amount: number;
  total_collected: number;
}

export interface ShiftExpense {
  id: number;
  shift_id: number;
  category: string;
  description: string;
  amount: number;
}

export interface FuelPrice {
  id: number;
  fuel_type: FuelType;
  price_per_litre: number;
  effective_date: string;
  created_at: string;
}

export interface FuelDelivery {
  id: number;
  tank_id: number;
  supplier: string;
  litres: number;
  cost_per_litre: number;
  total_cost: number;
  date: string;
  created_at: string;
  // Joined
  tank_label?: string;
  fuel_type?: FuelType;
}

export interface TankDip {
  id: number;
  tank_id: number;
  measured_litres: number;
  dip_date: string; // 'YYYY-MM-DD' — the date of the physical measurement
  timestamp: string; // when the entry was recorded
  // Joined
  tank_label?: string;
  fuel_type?: FuelType;
}

export interface Credit {
  id: number;
  customer_name: string;
  customer_phone: string | null;
  amount: number;
  balance: number;
  shift_id: number;
  description: string | null;
  status: CreditStatus;
  created_at: string;
}

export interface CreditPayment {
  id: number;
  credit_id: number;
  amount: number;
  payment_method: PaymentMethod;
  date: string;
  notes: string | null;
}

export interface Expense {
  id: number;
  category: string;
  description: string;
  amount: number;
  date: string;
  created_at: string;
}

export interface Invoice {
  id: number;
  credit_id: number;
  invoice_number: string;
  amount: number;
  date: string;
  status: InvoiceStatus;
  created_at: string;
  // Joined
  customer_name?: string;
}

// ============ API Request/Response Types ============

export interface ShiftWithDetails extends Shift {
  readings: PumpReading[];
  collections: ShiftCollection | null;
  expenses: ShiftExpense[];
  employee_wage: number;
  expected_sales: number;
  total_collected: number;
  total_outflows: number;
  variance: number;
}

export interface DashboardSummary {
  today_litres_petrol: number;
  today_litres_diesel: number;
  today_sales: number;
  today_variance: number;
  current_shift: Shift | null;
  weekly_sales: { date: string; amount: number }[];
}

export interface StockSummary {
  tank_id: number;
  tank_label: string;
  fuel_type: FuelType;
  capacity_litres: number;
  current_stock_litres: number;
  last_dip: {
    id: number;
    dip_date: string;
    measured_litres: number;
    timestamp: string;
  } | null;
  dip_variance: number | null; // current_stock_litres - last_dip.measured_litres (positive = book says more than physical = loss)
  total_deliveries_in: number;
  total_pump_sales_out: number;
  deliveries: FuelDelivery[];
  dips: TankDip[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
