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

// Who authorized a deduction is a verified approver (services/approval.ts), not
// a typed reference. staff_debt stays in the enum only so addPayrollDeduction can
// redirect it to debt recovery with a clear message.
export const createPayrollDeductionSchema = z.object({
  deduction_type: z.enum(['staff_debt', 'statutory', 'advance', 'manual']),
  amount: z.number().finite().positive('amount must be greater than zero'),
  notes: z.string().trim().max(1000).nullish().optional(),
  approval_token: z.string().max(1000).optional(),
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
  // This validator strips unknown keys, so approval_token must be listed here or
  // every desktop recovery would arrive without its approval.
  // authorization_reference, reason and variance_reason are no longer collected;
  // they stay accepted so a phone still running a cached older bundle can close.
  recovery_decision: z.object({ version: z.string().length(64), amount: z.number().finite().min(0), approval_token: z.string().max(1000).optional(), authorization_reference: z.string().max(200).optional(), reason: z.string().max(1000).optional() }).optional(),
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
export const createShiftCreditSchema = z.object({
  // Customers are chosen, never typed into existence here: send account_id.
  // customer_name is still accepted from clients cached before select-only
  // entry, and must match an existing customer.
  account_id: z.number().int().positive().optional(),
  customer_name: z.string().trim().min(1, 'customer_name is required').optional(),
  customer_phone: optionalText(),
  amount: z.number({ error: 'amount is required' }).positive('amount must be greater than 0'),
  description: optionalText(),
  limit_override: z.boolean().optional(),
  approval_token: z.string().max(1000).optional(),
}).refine((data) => data.account_id || data.customer_name, {
  message: 'Select a customer',
  path: ['account_id'],
});

// Kenya Revenue Authority PIN: a letter, nine digits, a letter (A012345678Z).
// Not all digits - an "exactly N digits" rule would reject every real PIN.
export const KRA_PIN_PATTERN = /^[A-Z]\d{9}[A-Z]$/;

// Optional; blank means not recorded; stored uppercase.
const kraPin = () => z.string().trim().toUpperCase()
  .refine((value) => value === '' || KRA_PIN_PATTERN.test(value), 'KRA PIN must be a letter, 9 digits and a letter, e.g. A012345678Z')
  .transform((value) => value || null)
  .nullish();

// Stored without spaces or dashes so one number always matches itself.
const PHONE_PATTERN = /^\+?\d{9,13}$/;
const PHONE_MESSAGE = 'Enter a valid phone number, e.g. 0712345678';
const normalizePhone = (value: string) => value.replace(/[\s-]/g, '');

const customerName = () => z.string().trim().min(1, 'name is required').max(120, 'name is too long');
const paymentTermsDays = () => z.number().int('payment_terms_days must be a whole number').min(0).max(365, 'payment_terms_days must be a whole number from 0 to 365');
// Limits are opt-in: null means no rule, never "zero allowed".
const creditLimit = () => z.number({ error: 'credit_limit must be a number' }).finite()
  .min(0, 'credit_limit cannot be negative').max(1_000_000_000, 'credit_limit is too large').nullish();
const repaymentLimitDays = () => z.number({ error: 'credit_age_limit_days must be a number' })
  .int('credit_age_limit_days must be a whole number of days').min(0).max(365, 'credit_age_limit_days must be 365 or less').nullish();

export const createCreditAccountSchema = z.object({
  name: customerName(),
  phone: z.string({ error: 'phone is required' }).transform(normalizePhone).superRefine((value, ctx) => {
    if (!value) ctx.addIssue({ code: 'custom', message: 'phone is required' });
    else if (!PHONE_PATTERN.test(value)) ctx.addIssue({ code: 'custom', message: PHONE_MESSAGE });
  }),
  kra_pin: kraPin(),
  billing_mode: z.enum(['money', 'invoice']).default('money'),
  payment_terms_days: paymentTermsDays().default(0),
  credit_limit: creditLimit(),
  credit_age_limit_days: repaymentLimitDays(),
});

export const updateCreditAccountSchema = z.object({
  name: customerName().optional(),
  // Customers created before phone numbers were required may have none, so a
  // blank phone is accepted here; the route refuses removing an existing one.
  phone: z.string().nullish().transform((value) => (value == null ? value : normalizePhone(value))).superRefine((value, ctx) => {
    if (value && !PHONE_PATTERN.test(value)) ctx.addIssue({ code: 'custom', message: PHONE_MESSAGE });
  }),
  kra_pin: kraPin(),
  billing_mode: z.enum(['money', 'invoice']).optional(),
  payment_terms_days: paymentTermsDays().optional(),
  credit_limit: creditLimit(),
  credit_age_limit_days: repaymentLimitDays(),
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
  notes: z.string().optional(),
  adjustment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'adjustment_date must be YYYY-MM-DD format').optional(),
  reference_dip_id: z.number({ error: 'reference_dip_id is required' }).int().positive(),
  cost_per_litre: z.number().min(0, 'cost_per_litre cannot be negative').nullish().optional(),
}).superRefine((data, ctx) => {
  // The reason enum is usually self-explanatory; only "other_*" needs free text.
  const isOther = data.reason === 'other_gain' || data.reason === 'other_loss';
  if (isOther && String(data.notes || '').trim().length < 3) {
    ctx.addIssue({ code: 'custom', path: ['notes'], message: 'notes/reason details are required for "Other"' });
  }
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
