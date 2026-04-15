import { z } from 'zod';

/**
 * Helper: a string field that is truly optional — accepts undefined, null,
 * or missing entirely. UIs often send `null` for blank text inputs; plain
 * `.optional()` rejects null and produces the dreaded "Validation failed"
 * with no obvious reason.
 */
const optionalText = () => z.string().nullish().optional();

// --- Fuel Deliveries ---
export const createDeliverySchema = z.object({
  tank_id: z.number({ error: 'tank_id is required' }).int().positive(),
  supplier: optionalText(),
  supplier_id: z.number().int().positive().nullish().optional(),
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
  description: optionalText(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
});

// --- Credits ---
export const createCreditSchema = z.object({
  customer_name: z.string().min(1, 'customer_name is required'),
  customer_phone: optionalText(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  shift_id: z.number().int().positive().nullish().optional(),
  description: optionalText(),
});

export const createShiftCreditSchema = z.object({
  customer_name: z.string().min(1, 'customer_name is required'),
  customer_phone: optionalText(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  description: optionalText(),
});

export const creditPaymentSchema = z.object({
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  payment_method: optionalText(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format').optional(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD format').optional(),
  notes: optionalText(),
});

// --- Tank Dips ---
const VARIANCE_CATEGORIES = [
  'natural_loss',
  'operational_loss',
  'meter_drift',
  'delivery_variance',
  'unclassified',
] as const;

export const createTankDipSchema = z.object({
  tank_id: z.number({ error: 'tank_id is required' }).int().positive(),
  measured_litres: z.number({ error: 'measured_litres is required' }).min(0, 'measured_litres cannot be negative'),
  dip_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dip_date must be YYYY-MM-DD format').optional(),
  variance_category: z.enum(VARIANCE_CATEGORIES).nullish().optional(),
  variance_notes: optionalText(),
});

export const updateTankDipSchema = z.object({
  measured_litres: z.number().min(0, 'measured_litres cannot be negative').optional(),
  dip_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dip_date must be YYYY-MM-DD format').optional(),
  variance_category: z.enum(VARIANCE_CATEGORIES).nullish().optional(),
  variance_notes: optionalText(),
});

// --- Suppliers ---
export const createSupplierSchema = z.object({
  name: z.string().min(1, 'name is required'),
  phone: optionalText(),
  email: z.string().email('invalid email').nullish().optional().or(z.literal('')),
  address: optionalText(),
  bank_name: optionalText(),
  bank_account: optionalText(),
  payment_terms_days: z.number().int().min(0).nullish().optional(),
  notes: optionalText(),
});

export const updateSupplierSchema = createSupplierSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' }
);

export const createSupplierInvoiceSchema = z.object({
  supplier_id: z.number().int().positive(),
  invoice_number: optionalText(),
  delivery_id: z.number().int().positive().nullish().optional(),
  amount: z.number().positive('amount must be greater than 0'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD').optional(),
  notes: optionalText(),
});

export const createSupplierPaymentSchema = z.object({
  supplier_id: z.number().int().positive(),
  invoice_id: z.number().int().positive().nullish().optional(),
  amount: z.number().positive('amount must be greater than 0'),
  payment_method: z.enum(['bank_transfer', 'mpesa', 'cash', 'cheque']).nullish().optional(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD'),
  reference: optionalText(),
  notes: optionalText(),
});

// --- General Expenses ---
export const createExpenseSchema = z.object({
  category: z.string().min(1, 'category is required'),
  description: optionalText(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format'),
});

export const updateExpenseSchema = createExpenseSchema.partial();
