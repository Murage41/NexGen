import { z } from 'zod';

// --- Fuel Deliveries ---
export const createDeliverySchema = z.object({
  tank_id: z.number({ error: 'tank_id is required' }).int().positive(),
  supplier: z.string().optional(),
  litres: z.number({ error: 'litres is required' }).positive('litres must be greater than 0'),
  cost_per_litre: z.number({ error: 'cost_per_litre is required' }).positive('cost_per_litre must be greater than 0'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format'),
});

export const updateDeliverySchema = createDeliverySchema;

// --- Pump Readings ---
export const updateReadingsSchema = z.object({
  readings: z.array(z.object({
    pump_id: z.number().int().positive(),
    closing_litres: z.number().min(0, 'closing_litres cannot be negative'),
    closing_amount: z.number().min(0, 'closing_amount cannot be negative'),
  })).min(1, 'At least one reading is required'),
});

// --- Shift Expenses ---
export const createShiftExpenseSchema = z.object({
  category: z.string().min(1, 'category is required'),
  description: z.string().optional(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
});

// --- Credits ---
export const createCreditSchema = z.object({
  customer_name: z.string().min(1, 'customer_name is required'),
  customer_phone: z.string().optional(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  shift_id: z.number().int().positive().optional(),
  description: z.string().optional(),
});

export const createShiftCreditSchema = z.object({
  customer_name: z.string().min(1, 'customer_name is required'),
  customer_phone: z.string().optional(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  description: z.string().optional(),
});

export const creditPaymentSchema = z.object({
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  payment_method: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format').optional(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD format').optional(),
  notes: z.string().optional(),
});

// --- Tank Dips ---
export const createTankDipSchema = z.object({
  tank_id: z.number({ error: 'tank_id is required' }).int().positive(),
  measured_litres: z.number({ error: 'measured_litres is required' }).min(0, 'measured_litres cannot be negative'),
  dip_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dip_date must be YYYY-MM-DD format').optional(),
});

export const updateTankDipSchema = z.object({
  measured_litres: z.number().min(0, 'measured_litres cannot be negative').optional(),
  dip_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dip_date must be YYYY-MM-DD format').optional(),
});

// --- General Expenses ---
export const createExpenseSchema = z.object({
  category: z.string().min(1, 'category is required'),
  description: z.string().optional(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format'),
});

export const updateExpenseSchema = createExpenseSchema.partial();
