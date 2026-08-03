import { z } from 'zod';

/**
 * Helper: a string field that is truly optional — accepts undefined, null,
 * or missing entirely. UIs often send `null` for blank text inputs; plain
 * `.optional()` rejects null and produces the dreaded "Validation failed"
 * with no obvious reason.
 */
const optionalText = () => z.string().nullish().optional();

// --- Employees ---
const employeeBaseSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120, 'name is too long'),
  daily_wage: z.number({ error: 'daily_wage is required' })
    .finite('daily_wage must be a valid number')
    .min(0, 'daily_wage cannot be negative')
    .max(100000000, 'daily_wage is too large'),
  phone: z.string().trim().max(32, 'phone is too long').nullish().optional(),
  role: z.enum(['admin', 'attendant']).default('attendant'),
  active: z.boolean().optional(),
  job_title: z.string().trim().max(120, 'job_title is too long').nullish().optional(),
  employment_type: z.enum(['permanent', 'contract', 'casual', 'temporary']).nullish().optional(),
  employment_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().optional(),
  employment_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().optional(),
});

export const updateEmployeeSchema = employeeBaseSchema.partial().extend({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits').optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' },
);

// --- Employee Compensation ---
const compensationComponentSchema = z.object({
  component_type: z.enum([
    'fixed_per_shift',
    'fixed_periodic',
    'sales_percentage',
    'litre_rate',
  ]),
  amount: z.number().finite().min(0).nullish().optional(),
  rate: z.number().finite().min(0).nullish().optional(),
  fuel_type: z.enum(['petrol', 'diesel']).nullish().optional(),
  minimum_amount: z.number().finite().min(0).nullish().optional(),
  maximum_amount: z.number().finite().min(0).nullish().optional(),
}).superRefine((component, ctx) => {
  if (
    (component.component_type === 'fixed_per_shift' || component.component_type === 'fixed_periodic')
    && component.amount == null
  ) {
    ctx.addIssue({ code: 'custom', path: ['amount'], message: 'amount is required for fixed compensation' });
  }
  if (
    (component.component_type === 'sales_percentage' || component.component_type === 'litre_rate')
    && component.rate == null
  ) {
    ctx.addIssue({ code: 'custom', path: ['rate'], message: 'rate is required for commission compensation' });
  }
  if (component.component_type === 'sales_percentage' && Number(component.rate) > 100) {
    ctx.addIssue({ code: 'custom', path: ['rate'], message: 'sales percentage cannot exceed 100' });
  }
  if (
    component.minimum_amount != null
    && component.maximum_amount != null
    && component.minimum_amount > component.maximum_amount
  ) {
    ctx.addIssue({ code: 'custom', path: ['maximum_amount'], message: 'maximum must be at least the minimum' });
  }
});

export const createCompensationPlanSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  pay_schedule: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  proration_method: z.enum(['calendar_days', 'none']).default('calendar_days'),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be YYYY-MM-DD'),
  notes: z.string().trim().max(1000).nullish().optional(),
  components: z.array(compensationComponentSchema).min(1).max(8),
});

export const createEmployeeSchema = employeeBaseSchema.extend({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  initial_compensation_plan: createCompensationPlanSchema.optional(),
});

// --- Payroll ---
const payrollPeriodFields = {
  pay_schedule: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

export const payrollPeriodSchema = z.object(payrollPeriodFields).refine((data) => data.period_start <= data.period_end, {
  path: ['period_end'],
  message: 'period_end must be on or after period_start',
});

export const calculatePayrollRunSchema = z.object({
  ...payrollPeriodFields,
  name: z.string().trim().min(1).max(120),
}).refine((data) => data.period_start <= data.period_end, {
  path: ['period_end'],
  message: 'period_end must be on or after period_start',
});

export const createPayrollDeductionSchema = z.object({
  deduction_type: z.enum(['staff_debt', 'statutory', 'advance', 'manual']),
  amount: z.number().finite().positive('amount must be greater than zero'),
  authorization_reference: z.string().trim().max(200).nullish().optional(),
  notes: z.string().trim().max(1000).nullish().optional(),
}).superRefine((data, ctx) => {
  if (data.deduction_type === 'staff_debt' && !data.authorization_reference) {
    ctx.addIssue({
      code: 'custom',
      path: ['authorization_reference'],
      message: 'authorization reference is required for a staff debt deduction',
    });
  }
});

export const createPayrollPaymentSchema = z.object({
  amount: z.number().finite().positive('amount must be greater than zero'),
  payment_method: z.enum(['cash', 'mpesa', 'bank_transfer', 'cheque']),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift_id: z.number().int().positive().nullish().optional(),
  reference: z.string().trim().max(200).nullish().optional(),
  notes: z.string().trim().max(1000).nullish().optional(),
});

export const payrollReasonSchema = z.object({
  reason: z.string().trim().min(3, 'reason is required').max(1000),
});

// --- Fuel Deliveries ---
export const createDeliverySchema = z.object({
  tank_id: z.number({ error: 'tank_id is required' }).int().positive(),
  supplier_id: z.number({ error: 'supplier_id is required' }).int().positive(),
  litres: z.number({ error: 'litres is required' }).positive('litres must be greater than 0'),
  cost_per_litre: z.number().min(0, 'cost_per_litre cannot be negative').nullish().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format'),
  delivery_time: optionalText(),
  invoice_number: optionalText(),
});

export const updateDeliverySchema = createDeliverySchema;

// --- Shifts ---
export const openShiftSchema = z.object({
  employee_id: z.number({ error: 'employee_id is required' }).int().positive(),
  compensation_plan_id: z.number({ error: 'compensation_plan_id is required' }).int().positive(),
});

export const closeShiftSchema = z.object({
  notes: optionalText(),
  deduct_amount: z.number().min(0, 'deduct_amount cannot be negative').nullish().optional(),
  wage_paid: z.number().min(0, 'wage_paid cannot be negative'),
  variance_reason: optionalText(),
  reconciliation: z.object({
    readings_reviewed: z.literal(true),
    collections_reviewed: z.literal(true),
    entries_reviewed: z.literal(true),
  }),
});

export const shiftReviewSchema = z.object({
  review_status: z.enum(['reviewed', 'flagged']),
  notes: z.string().trim().max(2000, 'notes are too long').nullish().optional(),
});

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
  expected_revision: z.number().int().min(0).optional(),
});

export const updateCollectionsSchema = z.object({
  cash_amount: z.number().finite().min(0),
  mpesa_amount: z.number().finite().min(0),
  expected_revision: z.number().int().min(0).optional(),
});

export const shiftCancellationSchema = z.object({
  reason: z.string().trim().min(3, 'cancellation reason is required').max(1000),
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
