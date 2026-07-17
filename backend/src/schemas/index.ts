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
  supplier_id: z.number({ error: 'supplier_id is required' }).int().positive(),
  litres: z.number({ error: 'litres is required' }).positive('litres must be greater than 0'),
  cost_per_litre: z.number({ error: 'cost_per_litre is required' }).positive('cost_per_litre must be greater than 0'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format'),
  delivery_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'delivery_time must be HH:MM format').optional(),
  invoice_number: optionalText(),
});

export const updateDeliverySchema = createDeliverySchema;

// --- Pump Readings ---
// Accept either cumulative `closing_*` (legacy / direct) or display `raw_closing_*`
// (preferred — what the user reads off the pump). The route compensates raw values
// for meter rollover before storing the cumulative.
export const updateReadingsSchema = z.object({
  readings: z.array(
    z.object({
      pump_id: z.number().int().positive(),
      closing_litres: z.number().min(0).optional(),
      closing_amount: z.number().min(0).optional(),
      raw_closing_litres: z.number().min(0).optional(),
      raw_closing_amount: z.number().min(0).optional(),
      // When the user explicitly acknowledges a rollover in the UI, set true.
      // If unset and the raw input would imply a rollover, the route returns 409.
      rollover_litres: z.boolean().optional(),
      rollover_amount: z.boolean().optional(),
    }).refine(
      (r) => r.closing_litres !== undefined || r.raw_closing_litres !== undefined,
      { message: 'closing_litres or raw_closing_litres is required' },
    ).refine(
      (r) => r.closing_amount !== undefined || r.raw_closing_amount !== undefined,
      { message: 'closing_amount or raw_closing_amount is required' },
    ),
  ).min(1, 'At least one reading is required'),
  // When the price-per-litre sanity check flags an anomaly, the client must
  // re-submit with this set true to acknowledge and proceed.
  confirm_anomaly: z.boolean().optional(),
  // Separate from price sanity: catches mechanically plausible but operationally
  // impossible sales volumes/amounts caused by a wrong display reading.
  confirm_large_sale: z.boolean().optional(),
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

// --- Tank Stock Adjustments ---
const TANK_ADJUSTMENT_REASONS = [
  'stock_take',
  'delivery_correction_gain',
  'meter_calibration_gain',
  'opening_balance_correction_gain',
  'other_gain',
  'dip_reconciliation_loss',
  'evaporation_loss',
  'spillage_loss',
  'leakage_loss',
  'theft_loss',
  'contamination_loss',
  'calibration_loss',
  'write_off',
  'other_loss',
] as const;

export const createTankStockAdjustmentSchema = z.object({
  litres_change: z.number()
    .refine((n) => Number.isFinite(n) && n !== 0, 'litres_change cannot be zero')
    .optional(),
  reason: z.enum(TANK_ADJUSTMENT_REASONS),
  notes: z.string().min(3, 'notes/reason details are required'),
  adjustment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'adjustment_date must be YYYY-MM-DD format').optional(),
  reference_dip_id: z.number({ error: 'reference_dip_id is required' }).int().positive(),
  cost_per_litre: z.number().min(0, 'cost_per_litre cannot be negative').nullish().optional(),
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
