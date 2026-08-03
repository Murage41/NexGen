import { Router } from 'express';
import crypto from 'crypto';
import db from '../database';
import { validate } from '../middleware/validate';
import {
  createShiftExpenseSchema,
  createShiftCreditSchema,
  closeShiftSchema,
  openShiftSchema,
  shiftReviewSchema,
  shiftCancellationSchema,
  updateCollectionsSchema,
  updateReadingsSchema,
} from '../schemas';
import { computeBookStock, recomputeCache, consumeBatchesFIFO, recomputeDipsForTankFromDate } from '../services/stockCalculator';
import { compensate } from '../services/meterRollover';
import { recomputeAccountBalance } from '../services/accountBalance';
import { computeMpesaFee } from '../services/mpesaFees';
import {
  listShiftHistory,
  getShiftHistoryNeighbors,
  exportShiftHistory,
  normalizeShiftHistoryQuery,
  ShiftHistoryExportError,
  ShiftHistoryQueryError,
} from '../services/shiftHistory';
import { requireAdmin, requireAuth, requireOwnShiftOrAdmin } from '../middleware/requireAdmin';
import { getKenyaDate } from '../utils/timezone';
import {
  calculateShiftEarnings,
  generateShiftEarnings,
  getCompensationPlan,
  getCompensationPlanById,
} from '../services/compensation';
import {
  paymentHttpStatus,
  recordMoneyAccountPaymentInTransaction,
} from '../services/receivablePayments';
import {
  resolveConsumptionSource,
  validateInvoiceConsumptionAgainstReadings,
} from '../services/invoiceConsumption';
import { cancelOpenShift, previewShiftCancellation } from '../services/shiftCancellation';
import { buildShiftTimeline } from '../services/shiftTimeline';
import { getShiftReview, updateShiftReview } from '../services/shiftReview';
import { normalizeIdempotencyKey, runIdempotent } from '../services/idempotency';
import { decorateShiftStaleness, getStaleShiftHours } from '../services/shiftOperations';

const router = Router();

function staleShiftWrite(section: 'readings' | 'collections', currentRevision: number) {
  const label = section === 'readings' ? 'Pump readings' : 'Cash and M-Pesa collections';
  return Object.assign(
    new Error(`${label} were changed by another device. Refresh and review before saving.`),
    {
      httpStatus: 409,
      code: section === 'readings' ? 'STALE_SHIFT_READINGS' : 'STALE_SHIFT_COLLECTIONS',
      currentRevision,
    },
  );
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (
    typeof value === 'string'
    && (/^[=+@]/.test(text) || (/^-/.test(text) && !/^-\d+(\.\d+)?$/.test(text)))
  ) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toSqliteDateTime(value: string): string {
  return String(value).slice(0, 19).replace('T', ' ');
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumMoney(rows: any[], selector: (row: any) => any): number {
  return roundMoney(rows.reduce((sum: number, row: any) => sum + Number(selector(row) || 0), 0));
}

function splitCreditReceipts(creditReceipts: any[]) {
  const credit_receipts_cash = sumMoney(
    creditReceipts.filter((receipt: any) => (receipt.payment_method || 'cash') !== 'mpesa'),
    (receipt: any) => receipt.amount,
  );
  const credit_receipts_mpesa = sumMoney(
    creditReceipts.filter((receipt: any) => receipt.payment_method === 'mpesa'),
    (receipt: any) => receipt.amount,
  );
  const total_credit_receipts = roundMoney(credit_receipts_cash + credit_receipts_mpesa);

  return {
    credit_receipts_cash,
    credit_receipts_mpesa,
    total_credit_receipts,
  };
}

export function computeShiftAccountability({
  readings,
  collections,
  shiftCredits,
  invoiceConsumption,
  creditReceipts,
  expenses,
  employee_wage,
  payrollPayments = [],
}: {
  readings: any[];
  collections: any;
  shiftCredits: any[];
  invoiceConsumption: any[];
  creditReceipts: any[];
  expenses: any[];
  employee_wage: number;
  payrollPayments?: any[];
}) {
  const expected_sales = sumMoney(readings, (reading: any) => reading.amount_sold);
  const total_cash = roundMoney(collections ? Number(collections.cash_amount || 0) : 0);
  const total_mpesa = roundMoney(collections ? Number(collections.mpesa_amount || 0) : 0);
  const total_credits = sumMoney(shiftCredits, (credit: any) => credit.amount);
  const total_invoice_consumption = sumMoney(invoiceConsumption, (entry: any) => entry.retail_amount);
  const total_expenses = sumMoney(expenses, (expense: any) => expense.amount);
  const total_payroll_payments = sumMoney(payrollPayments, (payment: any) => payment.amount);
  const normalized_wage = roundMoney(Number(employee_wage || 0));
  const { credit_receipts_cash, credit_receipts_mpesa, total_credit_receipts } = splitCreditReceipts(creditReceipts);

  const sales_cash = roundMoney(total_cash - credit_receipts_cash);
  const sales_mpesa = roundMoney(total_mpesa - credit_receipts_mpesa);
  const sales_collections = roundMoney(sales_cash + sales_mpesa);
  const drawer_cash = total_cash;
  const drawer_mpesa = total_mpesa;
  const drawer_total = roundMoney(drawer_cash + drawer_mpesa);
  const sales_accounted = roundMoney(
    sales_collections
      + total_credits
      + total_invoice_consumption
      + total_expenses
      + normalized_wage
      + total_payroll_payments,
  );
  const sales_variance = roundMoney(sales_accounted - expected_sales);
  const expected_shift_total = roundMoney(expected_sales + total_credit_receipts);
  const total_accounted = roundMoney(
    drawer_total
      + total_credits
      + total_invoice_consumption
      + total_expenses
      + normalized_wage
      + total_payroll_payments,
  );
  const variance = roundMoney(total_accounted - expected_shift_total);

  return {
    expected_sales,
    expected_shift_total,
    total_cash,
    total_mpesa,
    expected_cash: drawer_cash,
    expected_mpesa: drawer_mpesa,
    expected_total_received: drawer_total,
    drawer_total,
    credit_receipts_cash,
    credit_receipts_mpesa,
    total_credit_receipts,
    sales_cash,
    sales_mpesa,
    sales_collections,
    drawer_cash,
    drawer_mpesa,
    total_credits,
    total_invoice_consumption,
    total_expenses,
    total_payroll_payments,
    employee_wage: normalized_wage,
    sales_accounted,
    sales_variance,
    total_accounted,
    variance,
  };
}

/** Guard: only open shifts are editable. */
async function requireOpenShift(req: any, res: any): Promise<boolean> {
  const shift = await db('shifts').where({ id: req.params.id }).select('status').first();
  if (!shift) {
    res.status(404).json({ success: false, error: 'Shift not found' });
    return false;
  }
  if (shift.status !== 'open') {
    res.status(400).json({ success: false, error: `Cannot modify a ${shift.status} shift.` });
    return false;
  }
  return true;
}

// GET all shifts (with pagination)
router.get('/', async (req, res) => {
  try {
    const options = normalizeShiftHistoryQuery(req.query as Record<string, unknown>);
    const [result, staleShiftHours] = await Promise.all([
      listShiftHistory(db, options),
      getStaleShiftHours(db),
    ]);
    const shifts = result.shifts.map((shift) => decorateShiftStaleness(shift, staleShiftHours));
    res.json({
      success: true,
      data: {
        ...result,
        shifts,
        operational: {
          stale_shift_hours: staleShiftHours,
          stale_open_shifts_on_page: shifts.filter((shift) => shift.is_stale).length,
        },
      },
    });
  } catch (err: any) {
    if (err instanceof ShiftHistoryQueryError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/export.csv', requireAdmin, async (req, res) => {
  try {
    const options = normalizeShiftHistoryQuery({
      ...(req.query as Record<string, unknown>),
      page: 1,
      limit: 100,
    });
    const { rows } = await exportShiftHistory(db, options);
    const headers = [
      'Shift ID', 'Shift Date', 'Employee', 'Status', 'Started At', 'Ended At',
      'Compensation Plan ID', 'Wage Paid', 'Review Status', 'Review Notes', 'Reviewed At',
      'Expected Sales', 'Expected Shift Total', 'Cash Received', 'M-Pesa Received',
      'Debt Receipts', 'Credits Issued', 'Invoice Consumption', 'Expenses',
      'Direct Wage Payment', 'Payroll Payments', 'Total Accounted', 'Variance',
      'Variance Type', 'Variance Reason', 'Approved At', 'Cancellation Reason',
    ];
    const body = rows.map((row: any) => [
      row.id, row.shift_date, row.employee_name, row.status, row.start_time, row.end_time,
      row.compensation_plan_id, row.wage_paid, row.review_status, row.review_notes, row.reviewed_at,
      row.expected_sales, row.expected_shift_total, row.cash_received, row.mpesa_received,
      row.credit_receipts, row.credits_issued, row.invoice_consumption, row.expenses,
      row.direct_wage_payment, row.payroll_payments, row.total_accounted, row.variance,
      row.variance_type, row.variance_reason, row.approved_at, row.cancellation_reason,
    ].map(csvCell).join(','));
    const range = options.from || options.to
      ? `${options.from || 'first'}-to-${options.to || 'latest'}`
      : 'all-dates';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nexgen-shifts-${range}.csv"`);
    res.send(`\uFEFF${[headers.map(csvCell).join(','), ...body].join('\r\n')}`);
  } catch (err: any) {
    if (err instanceof ShiftHistoryQueryError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err instanceof ShiftHistoryExportError) {
      return res.status(413).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET current open shift
router.get('/current', async (_req, res) => {
  try {
    const [shift, staleShiftHours] = await Promise.all([
      db('shifts')
        .join('employees', 'shifts.employee_id', 'employees.id')
        .select('shifts.*', 'employees.name as employee_name')
        .where('shifts.status', 'open')
        .orderBy('shifts.start_time', 'desc')
        .first(),
      getStaleShiftHours(db),
    ]);
    res.json({
      success: true,
      data: shift ? decorateShiftStaleness(shift, staleShiftHours) : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/neighbors', async (req, res) => {
  try {
    const options = normalizeShiftHistoryQuery(req.query as Record<string, unknown>);
    const neighbors = await getShiftHistoryNeighbors(db, Number(req.params.id), options);
    if (!neighbors) return res.status(404).json({ success: false, error: 'Shift not found' });
    res.json({ success: true, data: neighbors });
  } catch (err: any) {
    if (err instanceof ShiftHistoryQueryError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET shift with full details
router.get('/:id', async (req, res) => {
  try {
    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name', 'employees.daily_wage as employee_wage')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    // Sync pump readings with active pumps for open shifts
    if (shift.status === 'open') {
      const activePumps = await db('pumps').where({ active: true });
      const activePumpIds = activePumps.map((p: any) => p.id);
      const existingReadings = await db('pump_readings').where({ shift_id: shift.id }).select('pump_id');
      const existingPumpIds = existingReadings.map((r: any) => r.pump_id);

      // Remove readings for deactivated pumps
      for (const pumpId of existingPumpIds) {
        if (!activePumpIds.includes(pumpId)) {
          await db('pump_readings').where({ shift_id: shift.id, pump_id: pumpId }).delete();
        }
      }

      // Add readings for newly added pumps
      for (const pump of activePumps) {
        if (!existingPumpIds.includes(pump.id)) {
          const lastReading = await db('pump_readings')
            .join('shifts', 'pump_readings.shift_id', 'shifts.id')
            .where('pump_readings.pump_id', pump.id)
            .where('shifts.status', 'closed')
            .orderBy('shifts.end_time', 'desc')
            .select('pump_readings.closing_litres', 'pump_readings.closing_amount')
            .first();
          const openLitres = lastReading ? lastReading.closing_litres : (pump.initial_litres || 0);
          const openAmount = lastReading ? lastReading.closing_amount : (pump.initial_amount || 0);
          await db('pump_readings').insert({
            shift_id: shift.id, pump_id: pump.id,
            opening_litres: openLitres, opening_amount: openAmount,
            closing_litres: openLitres, closing_amount: openAmount,
            litres_sold: 0, amount_sold: 0,
          });
        }
      }
    }

    const readings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.nozzle_label', 'pumps.fuel_type', 'pumps.meter_capacity_litres', 'pumps.meter_capacity_amount')
      .where('pump_readings.shift_id', shift.id)
      .where('pumps.active', true);
    const compensationPlan = shift.compensation_plan_id
      ? await getCompensationPlanById(Number(shift.compensation_plan_id))
      : await getCompensationPlan(
        Number(shift.employee_id),
        shift.shift_date || String(shift.start_time).slice(0, 10),
      );
    const earnings = await db('employee_earnings')
      .where({ shift_id: shift.id })
      .whereNull('reversed_at')
      .orderBy('id');
    const earningPreview = shift.status === 'open' && compensationPlan
      ? calculateShiftEarnings(compensationPlan, readings)
      : [];

    const collections = await db('shift_collections').where({ shift_id: shift.id }).first();
    const closeReconciliation = await db('shift_close_reconciliations').where({ shift_id: shift.id }).first();
    const shiftReview = shift.status === 'closed' ? await getShiftReview(db, Number(shift.id)) : null;
    const reviewEvents = shift.status === 'closed'
      ? await db('shift_review_events')
        .leftJoin('employees as review_actor', 'shift_review_events.actor_employee_id', 'review_actor.id')
        .where('shift_review_events.shift_id', shift.id)
        .select('shift_review_events.*', 'review_actor.name as actor_name')
        .orderBy('shift_review_events.created_at', 'asc')
        .orderBy('shift_review_events.id', 'asc')
      : [];
    const expenses = await db('shift_expenses').where({ shift_id: shift.id }).whereNull('deleted_at');
    const shiftCredits = await db('shift_credits').where({ shift_id: shift.id }).whereNull('deleted_at');
    const wageDeduction = await db('wage_deductions').where({ shift_id: shift.id }).whereNull('deleted_at').first();
    const payrollPayments = await db('payroll_payments')
      .where({ shift_id: shift.id, status: 'posted' })
      .where((query) => {
        query.whereNull('reference').orWhere('reference', 'not like', 'SHIFT-WAGE:%');
      })
      .orderBy('id');

    // Phase 3B: invoice-mode consumption (litre ledger, retail-priced for shift balance)
    const invoiceConsumption = await db('invoice_consumption')
      .leftJoin('credit_accounts', 'invoice_consumption.account_id', 'credit_accounts.id')
      .leftJoin('pumps as invoice_pumps', 'invoice_consumption.pump_id', 'invoice_pumps.id')
      .leftJoin('tanks as invoice_tanks', 'invoice_consumption.tank_id', 'invoice_tanks.id')
      .where('invoice_consumption.shift_id', shift.id)
      .whereNull('invoice_consumption.deleted_at')
      .select(
        'invoice_consumption.*',
        'credit_accounts.name as account_name',
        'credit_accounts.phone as account_phone',
        'invoice_pumps.label as pump_label',
        'invoice_pumps.nozzle_label as nozzle_label',
        'invoice_tanks.label as tank_label',
      )
      .orderBy('invoice_consumption.created_at', 'asc');

    // Credit receipts collected during this shift (old-debt payments received)
    const creditReceipts = await db('credit_payments')
      .join('credit_accounts', 'credit_payments.account_id', 'credit_accounts.id')
      .where('credit_payments.shift_id', shift.id)
      .where('credit_payments.status', 'posted')
      .whereNull('credit_payments.deleted_at')
      .select('credit_payments.*', 'credit_accounts.name as account_name', 'credit_accounts.phone as account_phone')
      .orderBy('credit_payments.date', 'asc');

    // Get employee's outstanding debt
    const outstandingDebts = await db('staff_debts')
      .where({ employee_id: shift.employee_id, status: 'outstanding' })
      .orderBy('created_at', 'asc');
    const total_outstanding_debt = outstandingDebts.reduce((sum: number, d: any) => sum + d.balance, 0);

    const grossEarningPreview = earningPreview.reduce(
      (sum: number, earning: any) => sum + Number(earning.gross_amount || 0),
      0,
    );
    // Earnings are an expense when earned. Only actual direct payments belong
    // in drawer accountability; monthly/weekly earnings accrue without leaving
    // the shift drawer.
    const employee_wage = shift.status === 'closed'
      ? (shift.wage_paid ?? shift.employee_wage ?? 0)
      : compensationPlan?.pay_schedule === 'daily'
        ? grossEarningPreview
        : 0;
    const accountability = computeShiftAccountability({
      readings,
      collections,
      shiftCredits,
      invoiceConsumption,
      creditReceipts,
      expenses,
      employee_wage,
      payrollPayments,
    });
    const activityTimeline = buildShiftTimeline({
      shift,
      closeReconciliation,
      shiftCredits,
      invoiceConsumption,
      creditReceipts,
      expenses,
      payrollPayments,
      reviewEvents,
    });

    res.json({
      success: true,
      data: {
        ...shift,
        readings,
        collections: collections || null,
        close_reconciliation: closeReconciliation || null,
        review: shiftReview || null,
        activity_timeline: activityTimeline,
        expenses,
        shift_credits: shiftCredits,
        invoice_consumption: invoiceConsumption,
        credit_receipts: creditReceipts,
        wage_deduction: wageDeduction || null,
        payroll_payments: payrollPayments,
        compensation_plan: compensationPlan,
        earnings,
        earning_preview: earningPreview,
        gross_earning_preview: grossEarningPreview,
        default_direct_wage_payment: shift.status === 'open' ? employee_wage : 0,
        total_gross_earnings: earnings.reduce(
          (sum: number, earning: any) => sum + Number(earning.gross_amount || 0),
          0,
        ),
        outstanding_debts: outstandingDebts,
        total_outstanding_debt,
        ...accountability,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST open a new shift
router.post('/', requireAdmin, validate(openShiftSchema), async (req, res) => {
  try {
    const { employee_id, compensation_plan_id } = req.body;
    const today = getKenyaDate();
    const resolvedDate = today;

    // Phase 12: wrap the "at most one open shift" check + insert in a single
    // SQLite transaction so a near-simultaneous second POST cannot win the
    // race and produce two open shifts. SQLite serializes transactions, so
    // the second one sees the first's inserted row when it reaches the check.
    const shift = await db.transaction(async (trx) => {
      const openShift = await trx('shifts').where({ status: 'open' }).first();
      if (openShift) {
        const err: any = new Error('There is already an open shift. Close it first.');
        err.httpStatus = 400;
        throw err;
      }

      const employee = await trx('employees').where({ id: employee_id, active: true }).first();
      if (!employee) {
        const err: any = new Error('Select an active employee before opening the shift.');
        err.httpStatus = 400;
        throw err;
      }
      const compensationPlan = await getCompensationPlan(Number(employee_id), resolvedDate, trx);
      if (!compensationPlan) {
        const err: any = new Error('This employee has no compensation plan for the shift date.');
        err.httpStatus = 400;
        throw err;
      }
      if (Number(compensationPlan.id) !== Number(compensation_plan_id)) {
        const err: any = new Error(
          'The selected compensation plan changed before the shift was opened. Review the employee and try again.',
        );
        err.httpStatus = 409;
        throw err;
      }
      const lockedPayrollPeriod = await trx('payroll_periods')
        .where({ pay_schedule: compensationPlan.pay_schedule })
        .whereNot({ status: 'void' })
        .where('period_start', '<=', resolvedDate)
        .where('period_end', '>=', resolvedDate)
        .first();
      if (lockedPayrollPeriod) {
        const err: any = new Error(
          `${compensationPlan.pay_schedule} payroll for ${resolvedDate} has already been calculated.`,
        );
        err.httpStatus = 409;
        throw err;
      }

      const [id] = await trx('shifts').insert({
        employee_id,
        start_time: new Date().toISOString(),
        shift_date: resolvedDate,
        status: 'open',
        compensation_plan_id: compensationPlan.id,
      });

      // Auto-populate opening readings from last closed shift (or pump's initial readings)
      const pumps = await trx('pumps').where({ active: true });
      for (const pump of pumps) {
        const lastReading = await trx('pump_readings')
          .join('shifts', 'pump_readings.shift_id', 'shifts.id')
          .where('pump_readings.pump_id', pump.id)
          .where('shifts.status', 'closed')
          .orderBy('shifts.end_time', 'desc')
          .select('pump_readings.closing_litres', 'pump_readings.closing_amount')
          .first();

        const openLitres = lastReading ? lastReading.closing_litres : (pump.initial_litres || 0);
        const openAmount = lastReading ? lastReading.closing_amount : (pump.initial_amount || 0);

        await trx('pump_readings').insert({
          shift_id: id,
          pump_id: pump.id,
          opening_litres: openLitres,
          opening_amount: openAmount,
          closing_litres: openLitres,
          closing_amount: openAmount,
          litres_sold: 0,
          amount_sold: 0,
        });
      }

      return trx('shifts')
        .join('employees', 'shifts.employee_id', 'employees.id')
        .select('shifts.*', 'employees.name as employee_name')
        .where('shifts.id', id)
        .first();
    });

    res.status(201).json({ success: true, data: shift });
  } catch (err: any) {
    if (Number(err.httpStatus) >= 400 && Number(err.httpStatus) < 500) {
      return res.status(Number(err.httpStatus)).json({ success: false, error: err.message });
    }
    console.error('[shifts:create] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT set opening readings (admin only, for initial setup)
router.put('/:id/opening-readings', requireAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const { readings } = req.body; // Array of { pump_id, opening_litres, opening_amount }

    // Phase 12: reject opening readings greater than existing closing — same
    // monotonic-meter reasoning as the closing-readings handler.
    const invalid: string[] = [];
    for (const r of readings) {
      const existing = await db('pump_readings')
        .where({ shift_id: req.params.id, pump_id: r.pump_id })
        .first();
      if (existing) {
        if (Number(r.opening_litres) > Number(existing.closing_litres)) {
          invalid.push(
            `Pump ${r.pump_id}: opening litres ${r.opening_litres} is above closing ${existing.closing_litres}.`
          );
        }
        if (Number(r.opening_amount) > Number(existing.closing_amount)) {
          invalid.push(
            `Pump ${r.pump_id}: opening amount ${r.opening_amount} is above closing ${existing.closing_amount}.`
          );
        }
      }
    }
    if (invalid.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Opening readings cannot exceed closing readings: ${invalid.join(' ')}`,
      });
    }

    for (const r of readings) {
      const existing = await db('pump_readings')
        .where({ shift_id: req.params.id, pump_id: r.pump_id })
        .first();
      if (existing) {
        const litres_sold = existing.closing_litres - r.opening_litres;
        const amount_sold = existing.closing_amount - r.opening_amount;
        await db('pump_readings')
          .where({ shift_id: req.params.id, pump_id: r.pump_id })
          .update({
            opening_litres: r.opening_litres,
            opening_amount: r.opening_amount,
            litres_sold: Math.max(0, litres_sold),
            amount_sold: Math.max(0, amount_sold),
          });
      }
    }
    await db('shifts').where({ id: req.params.id, status: 'open' }).increment('readings_revision', 1);
    const revisionRow = await db('shifts')
      .where({ id: req.params.id })
      .select('readings_revision')
      .first();
    const updatedReadings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.nozzle_label', 'pumps.fuel_type', 'pumps.meter_capacity_litres', 'pumps.meter_capacity_amount')
      .where('pump_readings.shift_id', req.params.id);
    res.json({
      success: true,
      data: updatedReadings,
      revision: Number(revisionRow?.readings_revision || 0),
    });
  } catch (err: any) {
    console.error('[shifts:opening-readings] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update pump readings for a shift
router.put('/:id/readings', requireAuth, requireOwnShiftOrAdmin, validate(updateReadingsSchema), async (req, res) => {
  try {
    console.log('[shifts:readings PUT]', { shiftId: req.params.id, body: req.body });
    if (!(await requireOpenShift(req, res))) return;
    const { readings, confirm_anomaly, confirm_large_sale, expected_revision } = req.body;
    const shiftState = await db('shifts')
      .where({ id: req.params.id })
      .select('readings_revision')
      .first();
    const currentRevision = Number(shiftState?.readings_revision || 0);
    if (expected_revision !== undefined && Number(expected_revision) !== currentRevision) {
      const stale = staleShiftWrite('readings', currentRevision);
      return res.status(stale.httpStatus).json({
        success: false,
        error: stale.message,
        code: stale.code,
        current_revision: stale.currentRevision,
      });
    }

    // Current fuel prices keyed by fuel_type, used by Layer 2 (price sanity).
    const today = getKenyaDate();
    const priceRows = await db('fuel_prices')
      .where('effective_date', '<=', today)
      .orderBy('effective_date', 'desc')
      .orderBy('id', 'desc');
    const priceByFuel: Record<string, number> = {};
    for (const p of priceRows) {
      if (!(p.fuel_type in priceByFuel)) priceByFuel[p.fuel_type] = Number(p.price_per_litre);
    }

    // Validate every reading first; only persist after all pass.
    const errors: string[] = [];
    type Anomaly = { pump_id: number; pump_label: string; observed: number; expected: number; deviation_pct: number };
    type RolloverConfirm = { pump_id: number; pump_label: string; field: 'litres' | 'amount'; raw: number; cumulative: number };
    type LargeSale = {
      pump_id: number;
      pump_label: string;
      litres_sold: number;
      amount_sold: number;
      litres_threshold: number;
      amount_threshold: number;
    };
    const anomalies: Anomaly[] = [];
    const rolloverConfirms: RolloverConfirm[] = [];
    const largeSales: LargeSale[] = [];
    // Resolved cumulative closings, keyed by pump_id, used in the persist loop.
    const resolved: Record<number, { closing_litres: number; closing_amount: number }> = {};
    const PRICE_DEVIATION = 0.15; // ±15%

    for (const r of readings) {
      const existing = await db('pump_readings as pr')
        .join('pumps as p', 'pr.pump_id', 'p.id')
        .where({ 'pr.shift_id': req.params.id, 'pr.pump_id': r.pump_id })
        .select(
          'pr.opening_litres', 'pr.opening_amount',
          'p.label as pump_label', 'p.fuel_type',
          'p.meter_capacity_litres', 'p.meter_capacity_amount',
        )
        .first();
      if (!existing) continue;

      const oL = Number(existing.opening_litres);
      const oA = Number(existing.opening_amount);
      const capL = Number(existing.meter_capacity_litres) || 1000000;
      const capA = Number(existing.meter_capacity_amount) || 1000000;

      // Resolve cumulative closing_litres: prefer raw input (compensated for
      // rollover) over direct cumulative input.
      let cL: number;
      if (r.raw_closing_litres !== undefined) {
        const out = compensate(oL, Number(r.raw_closing_litres), capL);
        if (!out.ok) {
          errors.push(`Pump ${existing.pump_label}: ${out.reason}`);
          continue;
        }
        if (out.rolledOver && !r.rollover_litres) {
          rolloverConfirms.push({
            pump_id: r.pump_id, pump_label: existing.pump_label, field: 'litres',
            raw: Number(r.raw_closing_litres), cumulative: out.cumulative,
          });
        }
        cL = out.cumulative;
      } else {
        cL = Number(r.closing_litres);
      }

      // Same for amount.
      let cA: number;
      if (r.raw_closing_amount !== undefined) {
        const out = compensate(oA, Number(r.raw_closing_amount), capA);
        if (!out.ok) {
          errors.push(`Pump ${existing.pump_label}: ${out.reason}`);
          continue;
        }
        if (out.rolledOver && !r.rollover_amount) {
          rolloverConfirms.push({
            pump_id: r.pump_id, pump_label: existing.pump_label, field: 'amount',
            raw: Number(r.raw_closing_amount), cumulative: out.cumulative,
          });
        }
        cA = out.cumulative;
      } else {
        cA = Number(r.closing_amount);
      }

      resolved[r.pump_id] = { closing_litres: cL, closing_amount: cA };

      // Phase 12: monotonic check — closing must be >= opening.
      if (cL < oL) {
        errors.push(`Pump ${existing.pump_label}: closing litres ${cL} is below opening ${oL}.`);
      }
      if (cA < oA) {
        errors.push(`Pump ${existing.pump_label}: closing amount ${cA} is below opening ${oA}.`);
      }
      if (cL < oL || cA < oA) continue;

      const lDelta = Math.round((cL - oL) * 100) / 100;
      const aDelta = Math.round((cA - oA) * 100) / 100;

      // Layer 1: cross-field zero check — pumps cannot dispense KES without
      // dispensing litres (or vice versa). One field changing while the other
      // stays at opening is the shift-42 bug class.
      if (lDelta > 0 && aDelta === 0) {
        errors.push(`Pump ${existing.pump_label}: litres changed by ${lDelta.toFixed(2)} but amount did not. Did you forget the closing amount?`);
        continue;
      }
      if (aDelta > 0 && lDelta === 0) {
        errors.push(`Pump ${existing.pump_label}: amount changed by ${aDelta.toFixed(2)} but litres did not. Did you forget the closing litres?`);
        continue;
      }

      // Layer 2: price-per-litre sanity check. Soft — caller can confirm and proceed.
      if (lDelta > 0 && aDelta > 0) {
        const observed = aDelta / lDelta;
        const expected = priceByFuel[existing.fuel_type];
        if (expected && Math.abs(observed - expected) / expected > PRICE_DEVIATION) {
          anomalies.push({
            pump_id: r.pump_id,
            pump_label: existing.pump_label,
            observed: Math.round(observed * 100) / 100,
            expected: Math.round(expected * 100) / 100,
            deviation_pct: Math.round(((observed - expected) / expected) * 1000) / 10,
          });
        }
      }

      // Layer 3: implausible-sale guard. A typo can keep the right KES/L
      // price while still creating a huge fake sale.
      const historical = await db('pump_readings as pr')
        .join('shifts as s', 'pr.shift_id', 's.id')
        .where('pr.pump_id', r.pump_id)
        .where('s.status', 'closed')
        .whereNot('pr.shift_id', req.params.id)
        .max({ max_litres: 'pr.litres_sold', max_amount: 'pr.amount_sold' })
        .first();
      const defaultMaxLitres = Number(process.env.MAX_PUMP_LITRES_PER_SHIFT || 10000);
      const expectedPrice = priceByFuel[existing.fuel_type] || 200;
      const defaultMaxAmount = Number(process.env.MAX_PUMP_AMOUNT_PER_SHIFT || (defaultMaxLitres * expectedPrice));
      const litresThreshold = Math.max(defaultMaxLitres, (Number(historical?.max_litres) || 0) * 2);
      const amountThreshold = Math.max(defaultMaxAmount, (Number(historical?.max_amount) || 0) * 2);
      if (lDelta > litresThreshold || aDelta > amountThreshold) {
        largeSales.push({
          pump_id: r.pump_id,
          pump_label: existing.pump_label,
          litres_sold: lDelta,
          amount_sold: aDelta,
          litres_threshold: Math.round(litresThreshold * 100) / 100,
          amount_threshold: Math.round(amountThreshold * 100) / 100,
        });
      }
    }

    if (errors.length > 0) {
      console.log('[shifts:readings PUT] hard errors', errors);
      return res.status(400).json({ success: false, error: errors.join(' ') });
    }

    if (rolloverConfirms.length > 0) {
      console.log('[shifts:readings PUT] rollover confirm required', rolloverConfirms);
      return res.status(409).json({
        success: false,
        code: 'ROLLOVER_REQUIRED',
        error: 'Pump display rollover detected. Confirm to proceed.',
        rollovers: rolloverConfirms,
      });
    }

    if (largeSales.length > 0 && !confirm_large_sale) {
      console.log('[shifts:readings PUT] large sale confirm required', largeSales);
      return res.status(409).json({
        success: false,
        code: 'LARGE_SALE_CONFIRMATION_REQUIRED',
        error: 'One or more pump readings imply an unusually large sale. Re-check the display values or confirm with manager approval.',
        large_sales: largeSales,
      });
    }

    if (anomalies.length > 0 && !confirm_anomaly) {
      console.log('[shifts:readings PUT] price anomalies (require confirm)', anomalies);
      return res.status(409).json({
        success: false,
        code: 'PRICE_ANOMALY',
        error: 'Price-per-litre looks off. Re-check the readings or confirm to proceed.',
        anomalies,
      });
    }

    const result = await db.transaction(async (trx) => {
      const changed = await trx('shifts')
        .where({
          id: req.params.id,
          status: 'open',
          readings_revision: currentRevision,
        })
        .update({ readings_revision: currentRevision + 1 });
      if (changed !== 1) {
        const latest = await trx('shifts')
          .where({ id: req.params.id })
          .select('readings_revision')
          .first();
        throw staleShiftWrite('readings', Number(latest?.readings_revision || currentRevision));
      }

      for (const r of readings) {
        const existing = await trx('pump_readings')
          .where({ shift_id: req.params.id, pump_id: r.pump_id })
          .first();

        if (existing) {
          const cL = resolved[r.pump_id].closing_litres;
          const cA = resolved[r.pump_id].closing_amount;
          const litres_sold = cL - Number(existing.opening_litres);
          const amount_sold = cA - Number(existing.opening_amount);
          await trx('pump_readings')
            .where({ shift_id: req.params.id, pump_id: r.pump_id })
            .update({
              closing_litres: cL,
              closing_amount: cA,
              litres_sold,
              amount_sold,
            });
        }
      }

      const updatedReadings = await trx('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.nozzle_label', 'pumps.fuel_type', 'pumps.meter_capacity_litres', 'pumps.meter_capacity_amount')
        .where('pump_readings.shift_id', req.params.id);
      return { readings: updatedReadings, revision: currentRevision + 1 };
    });

    res.json({ success: true, data: result.readings, revision: result.revision });
  } catch (err: any) {
    res.status(err.httpStatus || 500).json({
      success: false,
      error: err.message,
      code: err.code,
      current_revision: err.currentRevision,
    });
  }
});

// PUT update collections for a shift
router.put('/:id/collections', requireAuth, requireOwnShiftOrAdmin, validate(updateCollectionsSchema), async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const cashAmount = Number(req.body.cash_amount);
    const mpesaAmount = Number(req.body.mpesa_amount);
    const expectedRevision = req.body.expected_revision;
    const shiftState = await db('shifts')
      .where({ id: req.params.id })
      .select('collections_revision')
      .first();
    const currentRevision = Number(shiftState?.collections_revision || 0);
    if (expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
      const stale = staleShiftWrite('collections', currentRevision);
      return res.status(stale.httpStatus).json({
        success: false,
        error: stale.message,
        code: stale.code,
        current_revision: stale.currentRevision,
      });
    }

    // Auto-compute Lipa na M-Pesa Buy Goods fee + net (Phase 1A)
    const { fee: mpesaFee, net: mpesaNet } = await computeMpesaFee(mpesaAmount);

    const result = await db.transaction(async (trx) => {
      const changed = await trx('shifts')
        .where({
          id: req.params.id,
          status: 'open',
          collections_revision: currentRevision,
        })
        .update({ collections_revision: currentRevision + 1 });
      if (changed !== 1) {
        const latest = await trx('shifts')
          .where({ id: req.params.id })
          .select('collections_revision')
          .first();
        throw staleShiftWrite('collections', Number(latest?.collections_revision || currentRevision));
      }

      const creditRow = await trx('shift_credits')
        .where({ shift_id: req.params.id })
        .whereNull('deleted_at')
        .sum('amount as total')
        .first();
      const creditsAmount = Number((creditRow as any)?.total || 0);
      const totalCollected = cashAmount + mpesaAmount + creditsAmount;
      const existing = await trx('shift_collections').where({ shift_id: req.params.id }).first();
      const values = {
        cash_amount: cashAmount,
        mpesa_amount: mpesaAmount,
        credits_amount: creditsAmount,
        total_collected: totalCollected,
        mpesa_fee: mpesaFee,
        mpesa_net: mpesaNet,
      };
      if (existing) {
        await trx('shift_collections').where({ shift_id: req.params.id }).update(values);
      } else {
        await trx('shift_collections').insert({ shift_id: req.params.id, ...values });
      }

      const collections = await trx('shift_collections').where({ shift_id: req.params.id }).first();
      return { collections, revision: currentRevision + 1 };
    });
    res.json({ success: true, data: result.collections, revision: result.revision });
  } catch (err: any) {
    res.status(err.httpStatus || 500).json({
      success: false,
      error: err.message,
      code: err.code,
      current_revision: err.currentRevision,
    });
  }
});

// POST add shift expense
router.post('/:id/expenses', requireAuth, requireOwnShiftOrAdmin, validate(createShiftExpenseSchema), async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const { category, description, amount } = req.body;
    if (category.trim().toLowerCase() === 'wages') {
      return res.status(400).json({
        success: false,
        error: 'Record employee pay through the shift wage or payroll workflow, not as a shift expense.',
      });
    }
    const key = normalizeIdempotencyKey(req.get('Idempotency-Key'));
    const result = await runIdempotent(
      db,
      { scope: `shift:${req.params.id}:expense`, key, payload: req.body },
      async (trx) => {
        const shift = await trx('shifts').where({ id: req.params.id }).select('status').first();
        if (!shift || shift.status !== 'open') {
          throw Object.assign(new Error('Cannot modify a closed shift.'), { httpStatus: 400 });
        }
        const [expId] = await trx('shift_expenses').insert({
          shift_id: req.params.id, category, description, amount,
        });
        const expense = await trx('shift_expenses').where({ id: expId }).first();
        return { status: 201, body: { success: true, data: expense } };
      },
    );
    if (result.replayed) res.set('Idempotency-Replayed', 'true');
    res.status(result.status).json(result.body);
  } catch (err: any) {
    res.status(err.httpStatus || 500).json({ success: false, error: err.message, code: err.code });
  }
});

// DELETE shift expense
router.delete('/:id/expenses/:expenseId', requireAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    await db('shift_expenses').where({ id: req.params.expenseId, shift_id: req.params.id }).update({ deleted_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add shift credit — creates shift_credit + credits line item, increments account balance
router.post('/:id/credits', requireAuth, requireOwnShiftOrAdmin, validate(createShiftCreditSchema), async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const { customer_name, customer_phone, amount, description } = req.body;
    const shiftId = req.params.id;

    const key = normalizeIdempotencyKey(req.get('Idempotency-Key'));
    const result = await runIdempotent(
      db,
      { scope: `shift:${shiftId}:credit`, key, payload: req.body },
      async (trx) => {
      const shift = await trx('shifts').where({ id: shiftId }).select('status').first();
      if (!shift || shift.status !== 'open') {
        throw Object.assign(new Error('Cannot modify a closed shift.'), { httpStatus: 400 });
      }
      // Look up or auto-create credit_account for this customer
      // Phase 6: exclude soft-deleted accounts so we don't resurrect archived ones
      let account = await trx('credit_accounts')
        .whereRaw('LOWER(name) = ?', [customer_name.toLowerCase()])
        .where({ type: 'customer' })
        .whereNull('deleted_at')
        .first();

      if (!account) {
        const [accountId] = await trx('credit_accounts').insert({
          name: customer_name,
          phone: customer_phone || null,
          type: 'customer',
          balance: 0,
        });
        account = { id: accountId, balance: 0, billing_mode: 'money' };
      }

      // Phase 3B: invoice-mode accounts (e.g. Diwafa, Mugendi Stores) must not
      // be debited in KES; they bill by litres at an agreed price later. The
      // mobile shift-close UI should branch on billing_mode and call
      // POST /shifts/:id/invoice-consumption instead.
      if (account.billing_mode === 'invoice') {
        throw Object.assign(
          new Error(
            `"${customer_name}" is an invoice-mode customer. Record litres & fuel type via invoice consumption instead of a money credit.`,
          ),
          { code: 'INVOICE_MODE_ACCOUNT', httpStatus: 400 },
        );
      }

      // 1. Create credits line item (preserved for shift reporting / audit trail)
      const [mainCreditId] = await trx('credits').insert({
        customer_name,
        customer_phone: customer_phone || null,
        amount,
        balance: amount,
        shift_id: shiftId,
        description: description || null,
        status: 'outstanding',
        account_id: account.id,
      });

      // 2. Create shift_credits entry (for shift accountability)
      const [shiftCreditId] = await trx('shift_credits').insert({
        shift_id: shiftId,
        customer_name,
        customer_phone: customer_phone || null,
        amount,
        description: description || null,
        credit_id: mainCreditId,
      });

      // 3. Recompute the account balance from source rows (Phase 1 stale-cache fix:
      //    replaces the increment/decrement pattern that risks drift over time).
      await recomputeAccountBalance(account.id, trx);

      // 4. Update credits_amount in shift_collections (auto-sum)
      const totalCredits = await trx('shift_credits')
        .where({ shift_id: shiftId })
        .whereNull('deleted_at')
        .sum('amount as total')
        .first();
      const existing = await trx('shift_collections').where({ shift_id: shiftId }).first();
      const creditsTotal = Number((totalCredits as any)?.total || 0);
      if (existing) {
        await trx('shift_collections').where({ shift_id: shiftId }).update({
          credits_amount: creditsTotal,
          total_collected: existing.cash_amount + existing.mpesa_amount + creditsTotal,
        });
      } else {
        await trx('shift_collections').insert({
          shift_id: shiftId,
          cash_amount: 0,
          mpesa_amount: 0,
          credits_amount: creditsTotal,
          total_collected: creditsTotal,
        });
      }

      const shiftCredit = await trx('shift_credits').where({ id: shiftCreditId }).first();
      return { status: 201, body: { success: true, data: shiftCredit } };
      },
    );

    if (result.replayed) res.set('Idempotency-Replayed', 'true');
    res.status(result.status).json(result.body);
  } catch (err: any) {
    res.status(err.httpStatus || 500).json({ success: false, error: err.message, code: err.code });
  }
});

// DELETE shift credit — decrements account balance and voids the credits line item
router.delete('/:id/credits/:creditId', requireAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const shiftId = req.params.id;

    await db.transaction(async (trx) => {
      const shiftCredit = await trx('shift_credits')
        .where({ id: req.params.creditId, shift_id: shiftId })
        .whereNull('deleted_at')
        .first();

      if (shiftCredit) {
        const now = new Date().toISOString();

        // Soft-delete the shift credit
        await trx('shift_credits').where({ id: req.params.creditId }).update({ deleted_at: now });

        // Soft-delete the main credits line item (only if no payments have been applied to it)
        if (shiftCredit.credit_id) {
          const credit = await trx('credits').where({ id: shiftCredit.credit_id }).first();
          const payments = await trx('credit_payments')
            .where({ credit_id: shiftCredit.credit_id })
            .where({ status: 'posted' })
            .whereNull('deleted_at');

          if (credit && payments.length === 0) {
            await trx('credits')
              .where({ id: shiftCredit.credit_id })
              .update({ deleted_at: now, status: 'cancelled' });

            // Phase 1 stale-cache fix: recompute account balance from source rows
            if (credit.account_id) {
              await recomputeAccountBalance(credit.account_id, trx);
            }
          }
          // If payments exist, we don't touch the credit or balance — the payment
          // has already modified the account state, so removing the credit would
          // create an inconsistency. Manager must resolve manually.
        }
      }

      // Update credits_amount total
      const totalCredits = await trx('shift_credits')
        .where({ shift_id: shiftId })
        .whereNull('deleted_at')
        .sum('amount as total')
        .first();
      const existing = await trx('shift_collections').where({ shift_id: shiftId }).first();
      const creditsTotal = Number((totalCredits as any)?.total || 0);
      if (existing) {
        await trx('shift_collections').where({ shift_id: shiftId }).update({
          credits_amount: creditsTotal,
          total_collected: existing.cash_amount + existing.mpesa_amount + creditsTotal,
        });
      }
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Phase 3B: Invoice Consumption (invoice-mode customers) ──────────────────
// Attendants record LITRES per fuel type for invoice-mode customers during a
// shift. Retail price is snapshotted for shift-balance math only; the actual
// agreed price is set later when the invoice is generated. No KES debit hits
// the customer account here — just a litre ledger that later rolls up into a
// customer_invoices row.

/** Look up retail fuel price effective on a given date (YYYY-MM-DD). */
async function getRetailPriceAsOf(
  trx: any,
  fuelType: string,
  asOfDate: string,
): Promise<number | null> {
  const row = await trx('fuel_prices')
    .where({ fuel_type: fuelType })
    .where('effective_date', '<=', asOfDate)
    .orderBy('effective_date', 'desc')
    .orderBy('id', 'desc')
    .first();
  return row ? Number(row.price_per_litre) : null;
}

export async function buildConsumptionCorrectionPreview(
  trx: any,
  shiftId: number,
  entryId: number,
  proposed: { litres: number; pump_id?: number | null; tank_id?: number | null },
) {
  const shift = await trx('shifts').where({ id: shiftId }).first();
  if (!shift) throw Object.assign(new Error('Shift not found'), { http: 404 });
  if (shift.status !== 'closed') {
    throw Object.assign(
      new Error('Use the normal edit action while the shift is open.'),
      { http: 400 },
    );
  }

  const entry = await trx('invoice_consumption')
    .where({ id: entryId, shift_id: shiftId })
    .whereNull('deleted_at')
    .first();
  if (!entry) throw Object.assign(new Error('Consumption entry not found'), { http: 404 });
  if (entry.invoice_line_id) {
    throw Object.assign(
      new Error('Reserved or invoiced consumption must be corrected through the invoice document workflow.'),
      { http: 400 },
    );
  }

  const litres = Number(proposed.litres);
  if (!Number.isFinite(litres) || litres <= 0) {
    throw Object.assign(new Error('litres must be a positive number'), { http: 400 });
  }

  const source = await resolveConsumptionSource(trx, {
    fuelType: entry.fuel_type,
    pumpId: proposed.pump_id !== undefined
      ? (proposed.pump_id ? Number(proposed.pump_id) : null)
      : (entry.pump_id ? Number(entry.pump_id) : null),
    tankId: proposed.tank_id !== undefined
      ? (proposed.tank_id ? Number(proposed.tank_id) : null)
      : (entry.tank_id ? Number(entry.tank_id) : null),
  });
  if (source.source_required) {
    throw Object.assign(
      new Error('Select the pump/nozzle source before correcting a closed-shift entry.'),
      { http: 400 },
    );
  }

  const readings = await trx('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .where('pump_readings.shift_id', shiftId)
    .select('pump_readings.*', 'pumps.fuel_type');
  const collections = await trx('shift_collections').where({ shift_id: shiftId }).first();
  const expenses = await trx('shift_expenses').where({ shift_id: shiftId }).whereNull('deleted_at');
  const shiftCredits = await trx('shift_credits').where({ shift_id: shiftId }).whereNull('deleted_at');
  const creditReceipts = await trx('credit_payments')
    .where({ shift_id: shiftId })
    .where({ status: 'posted' })
    .whereNull('deleted_at');
  const payrollPayments = await trx('payroll_payments')
    .where({ shift_id: shiftId, status: 'posted' })
    .where((query: any) => {
      query.whereNull('reference').orWhere('reference', 'not like', 'SHIFT-WAGE:%');
    });
  const activeConsumption = await trx('invoice_consumption')
    .where({ shift_id: shiftId })
    .whereNull('deleted_at')
    .orderBy('id');

  const replacement = {
    account_id: entry.account_id,
    shift_id: shiftId,
    pump_id: source.pump_id,
    tank_id: source.tank_id,
    fuel_type: entry.fuel_type,
    litres,
    retail_price_at_time: Number(entry.retail_price_at_time),
    retail_amount: roundMoney(litres * Number(entry.retail_price_at_time)),
  };
  const correctedConsumption = activeConsumption.map((row: any) => (
    Number(row.id) === entryId ? replacement : row
  ));
  const litre_validation = validateInvoiceConsumptionAgainstReadings(
    readings,
    correctedConsumption,
  );

  const common = {
    readings,
    collections,
    shiftCredits,
    creditReceipts,
    expenses,
    employee_wage: Number(shift.wage_paid || 0),
    payrollPayments,
  };
  const before = computeShiftAccountability({
    ...common,
    invoiceConsumption: activeConsumption,
  });
  const after = computeShiftAccountability({
    ...common,
    invoiceConsumption: correctedConsumption,
  });
  const deficitBefore = Math.max(0, roundMoney(-before.variance));
  const deficitAfter = Math.max(0, roundMoney(-after.variance));
  const deficitChange = roundMoney(deficitAfter - deficitBefore);
  const amountDelta = roundMoney(replacement.retail_amount - Number(entry.retail_amount));

  const revision = activeConsumption.map((row: any) => ({
    id: Number(row.id),
    updated_at: row.updated_at || row.created_at || null,
    litres: Number(row.litres),
    retail_amount: Number(row.retail_amount),
    pump_id: row.pump_id ? Number(row.pump_id) : null,
    deleted_at: row.deleted_at || null,
  }));
  const confirmationToken = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      shift_id: shiftId,
      entry_id: entryId,
      replacement,
      variance_before: before.variance,
      variance_after: after.variance,
      revision,
    }))
    .digest('hex');

  return {
    shift,
    entry,
    replacement,
    before,
    after,
    amount_delta: amountDelta,
    deficit_before: deficitBefore,
    deficit_after: deficitAfter,
    deficit_change: deficitChange,
    litre_validation,
    confirmation_token: confirmationToken,
  };
}

async function recomputeEmployeeDebtAccount(employeeId: number, trx: any) {
  const row = await trx('staff_debts')
    .where({ employee_id: employeeId })
    .where('balance', '>', 0)
    .sum('balance as total')
    .first();
  const balance = roundMoney(Number((row as any)?.total || 0));
  const account = await trx('credit_accounts')
    .where({ employee_id: employeeId, type: 'employee' })
    .first();
  if (account) {
    await trx('credit_accounts').where({ id: account.id }).update({ balance });
  } else if (balance > 0) {
    const employee = await trx('employees').where({ id: employeeId }).first();
    await trx('credit_accounts').insert({
      name: employee?.name || `Employee ${employeeId}`,
      type: 'employee',
      employee_id: employeeId,
      balance,
    });
  }
  return balance;
}

async function applyCorrectionDebtImpact(
  trx: any,
  preview: any,
  accountabilityAdjustmentId: number,
  reason: string,
  actorId: number | null,
) {
  const deficitChange = roundMoney(Number(preview.deficit_change || 0));
  const employeeId = Number(preview.shift.employee_id);
  const adjustments: any[] = [];
  let reviewRequired = 0;

  if (deficitChange > 0) {
    const [debtId] = await trx('staff_debts').insert({
      employee_id: employeeId,
      shift_id: preview.shift.id,
      original_deficit: deficitChange,
      deducted_from_wage: 0,
      carried_forward: deficitChange,
      balance: deficitChange,
      status: 'outstanding',
    });
    const [adjustmentId] = await trx('staff_debt_adjustments').insert({
      shift_id: preview.shift.id,
      staff_debt_id: debtId,
      accountability_adjustment_id: accountabilityAdjustmentId,
      adjustment_type: 'increase',
      amount: deficitChange,
      balance_before: 0,
      balance_after: deficitChange,
      status: 'posted',
      reason,
      created_by_employee_id: actorId,
    });
    adjustments.push(await trx('staff_debt_adjustments').where({ id: adjustmentId }).first());
  } else if (deficitChange < 0) {
    let relief = Math.abs(deficitChange);
    const debts = await trx('staff_debts')
      .where({ shift_id: preview.shift.id, employee_id: employeeId })
      .where('balance', '>', 0)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');
    for (const debt of debts) {
      if (relief <= 0) break;
      const before = roundMoney(Number(debt.balance || 0));
      const applied = Math.min(relief, before);
      const after = roundMoney(before - applied);
      await trx('staff_debts').where({ id: debt.id }).update({
        balance: after,
        status: after === 0 ? 'cleared' : 'outstanding',
      });
      const [adjustmentId] = await trx('staff_debt_adjustments').insert({
        shift_id: preview.shift.id,
        staff_debt_id: debt.id,
        accountability_adjustment_id: accountabilityAdjustmentId,
        adjustment_type: 'decrease',
        amount: applied,
        balance_before: before,
        balance_after: after,
        status: 'posted',
        reason,
        created_by_employee_id: actorId,
      });
      adjustments.push(await trx('staff_debt_adjustments').where({ id: adjustmentId }).first());
      relief = roundMoney(relief - applied);
    }

    if (relief > 0) {
      reviewRequired = relief;
      const [adjustmentId] = await trx('staff_debt_adjustments').insert({
        shift_id: preview.shift.id,
        staff_debt_id: null,
        accountability_adjustment_id: accountabilityAdjustmentId,
        adjustment_type: 'employee_credit_review',
        amount: relief,
        balance_before: null,
        balance_after: null,
        status: 'review_required',
        reason: `${reason} Existing debt or wage deduction was already settled; review employee reimbursement.`,
        created_by_employee_id: actorId,
      });
      adjustments.push(await trx('staff_debt_adjustments').where({ id: adjustmentId }).first());
    }
  }

  const employeeDebtBalance = await recomputeEmployeeDebtAccount(employeeId, trx);
  return {
    adjustments,
    employee_debt_balance: employeeDebtBalance,
    review_required_amount: reviewRequired,
  };
}

export async function postConsumptionCorrection(
  conn: any,
  input: {
    shiftId: number;
    entryId: number;
    litres: number;
    pumpId?: number | null;
    tankId?: number | null;
    reason: string;
    confirmationToken: string;
    actorId?: number | null;
  },
) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 10) {
    throw Object.assign(
      new Error('A correction reason of at least 10 characters is required.'),
      { http: 400 },
    );
  }
  if (!input.confirmationToken) {
    throw Object.assign(new Error('Preview this correction before posting it.'), { http: 400 });
  }

  return conn.transaction(async (trx: any) => {
    const preview = await buildConsumptionCorrectionPreview(
      trx,
      input.shiftId,
      input.entryId,
      {
        litres: input.litres,
        pump_id: input.pumpId,
        tank_id: input.tankId,
      },
    );
    if (preview.confirmation_token !== input.confirmationToken) {
      throw Object.assign(
        new Error('The shift changed after the preview. Review the correction again before posting.'),
        { http: 409 },
      );
    }

    const actorId = input.actorId && input.actorId > 0 ? Number(input.actorId) : null;
    const now = new Date().toISOString();
    const [replacementId] = await trx('invoice_consumption').insert({
      ...preview.replacement,
      invoice_line_id: null,
      correction_of_id: preview.entry.id,
      entry_status: 'active',
      correction_reason: reason,
      created_by_employee_id: actorId,
      created_at: now,
    });
    await trx('invoice_consumption').where({ id: preview.entry.id }).update({
      entry_status: 'reversed',
      reversed_at: now,
      reversed_by_employee_id: actorId,
      correction_reason: reason,
      updated_at: now,
      deleted_at: now,
    });

    const [accountabilityAdjustmentId] = await trx('shift_accountability_adjustments').insert({
      shift_id: preview.shift.id,
      adjustment_type: 'invoice_consumption_correction',
      reference_id: replacementId,
      amount_delta: preview.amount_delta,
      variance_before: preview.before.variance,
      variance_after: preview.after.variance,
      reason,
      created_by_employee_id: actorId,
    });
    const debtImpact = await applyCorrectionDebtImpact(
      trx,
      preview,
      accountabilityAdjustmentId,
      reason,
      actorId,
    );
    const replacement = await trx('invoice_consumption').where({ id: replacementId }).first();

    return {
      replacement,
      reversed_entry_id: preview.entry.id,
      accountability_adjustment_id: accountabilityAdjustmentId,
      amount_delta: preview.amount_delta,
      variance_before: preview.before.variance,
      variance_after: preview.after.variance,
      deficit_change: preview.deficit_change,
      debt_impact: debtImpact,
    };
  });
}

// POST /shifts/:id/invoice-consumption
// Body: { account_id, tank_id?, fuel_type: 'petrol' | 'diesel', litres }
router.post('/:id/invoice-consumption', requireAuth, requireOwnShiftOrAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const shiftId = Number(req.params.id);
    const { account_id, pump_id, tank_id, fuel_type, litres } = req.body;

    if (!account_id || !fuel_type || litres === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'account_id, fuel_type, and litres are required' });
    }
    if (fuel_type !== 'petrol' && fuel_type !== 'diesel') {
      return res.status(400).json({ success: false, error: "fuel_type must be 'petrol' or 'diesel'" });
    }
    const litresNum = Number(litres);
    if (!Number.isFinite(litresNum) || litresNum <= 0) {
      return res.status(400).json({ success: false, error: 'litres must be a positive number' });
    }

    const key = normalizeIdempotencyKey(req.get('Idempotency-Key'));
    const result = await runIdempotent(
      db,
      { scope: `shift:${shiftId}:invoice-consumption`, key, payload: req.body },
      async (trx) => {
      const account = await trx('credit_accounts')
        .where({ id: account_id })
        .whereNull('deleted_at')
        .first();
      if (!account) throw Object.assign(new Error('Credit account not found'), { http: 404 });
      if (account.type !== 'customer') {
        throw Object.assign(new Error('Invoice consumption only applies to customer accounts'), { http: 400 });
      }
      if (account.billing_mode !== 'invoice') {
        throw Object.assign(
          new Error(`Account "${account.name}" is money-mode. Use POST /shifts/:id/credits instead.`),
          { http: 400 },
        );
      }

      const shift = await trx('shifts').where({ id: shiftId }).first();
      if (!shift) throw Object.assign(new Error('Shift not found'), { http: 404 });
      if (shift.status !== 'open') {
        throw Object.assign(new Error('Cannot modify a closed shift.'), { http: 400 });
      }

      const priceAsOf = shift.shift_date || getKenyaDate();
      const retailPrice = await getRetailPriceAsOf(trx, fuel_type, priceAsOf);
      if (retailPrice === null) {
        throw Object.assign(
          new Error(`No fuel_price configured for ${fuel_type} on/before ${priceAsOf}`),
          { http: 400 },
        );
      }
      const retailAmount = Math.round(litresNum * retailPrice * 100) / 100;
      const source = await resolveConsumptionSource(trx, {
        fuelType: fuel_type,
        pumpId: pump_id ? Number(pump_id) : null,
        tankId: tank_id ? Number(tank_id) : null,
      });

      const [id] = await trx('invoice_consumption').insert({
        account_id,
        shift_id: shiftId,
        pump_id: source.pump_id,
        tank_id: source.tank_id,
        fuel_type,
        litres: litresNum,
        retail_price_at_time: retailPrice,
        retail_amount: retailAmount,
        created_by_employee_id: (req as any).employee?.id > 0
          ? (req as any).employee.id
          : null,
      });
      const created = await trx('invoice_consumption').where({ id }).first();
      const entry = { ...created, source_required: source.source_required };
      return { status: 201, body: { success: true, data: entry } };
      },
    );

    if (result.replayed) res.set('Idempotency-Replayed', 'true');
    res.status(result.status).json(result.body);
  } catch (err: any) {
    const status = err.http || err.httpStatus || 500;
    res.status(status).json({ success: false, error: err.message, code: err.code });
  }
});

// PUT /shifts/:id/invoice-consumption/:entryId
// Editable: litres and source. fuel_type/account_id remain frozen.
router.put('/:id/invoice-consumption/:entryId', requireAuth, requireOwnShiftOrAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const shiftId = Number(req.params.id);
    const entryId = Number(req.params.entryId);

    const updated = await db.transaction(async (trx) => {
      const shift = await trx('shifts').where({ id: shiftId }).first();
      if (!shift) throw Object.assign(new Error('Shift not found'), { http: 404 });
      if (shift.status !== 'open') {
        throw Object.assign(new Error('Cannot modify a closed shift.'), { http: 400 });
      }

      const entry = await trx('invoice_consumption')
        .where({ id: entryId, shift_id: shiftId })
        .whereNull('deleted_at')
        .first();
      if (!entry) throw Object.assign(new Error('Consumption entry not found'), { http: 404 });
      if (entry.invoice_line_id) {
        throw Object.assign(
          new Error('Entry is reserved or invoiced and cannot be edited from the shift.'),
          { http: 400 },
        );
      }

      const update: any = { updated_at: new Date().toISOString() };
      if (req.body.litres !== undefined) {
        const litresNum = Number(req.body.litres);
        if (!Number.isFinite(litresNum) || litresNum <= 0) {
          throw Object.assign(new Error('litres must be a positive number'), { http: 400 });
        }
        update.litres = litresNum;
        update.retail_amount = Math.round(litresNum * Number(entry.retail_price_at_time) * 100) / 100;
      }

      if (req.body.pump_id !== undefined || req.body.tank_id !== undefined) {
        const source = await resolveConsumptionSource(trx, {
          fuelType: entry.fuel_type,
          pumpId: req.body.pump_id !== undefined
            ? (req.body.pump_id ? Number(req.body.pump_id) : null)
            : (entry.pump_id ? Number(entry.pump_id) : null),
          tankId: req.body.tank_id !== undefined
            ? (req.body.tank_id ? Number(req.body.tank_id) : null)
            : (entry.tank_id ? Number(entry.tank_id) : null),
        });
        update.pump_id = source.pump_id;
        update.tank_id = source.tank_id;
      }

      await trx('invoice_consumption').where({ id: entryId }).update(update);
      return trx('invoice_consumption').where({ id: entryId }).first();
    });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(err.http || err.httpStatus || 500).json({ success: false, error: err.message });
  }
});

router.get('/:id/cancellation-preview', requireAdmin, async (req, res) => {
  try {
    const data = await previewShiftCancellation(Number(req.params.id));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.post('/:id/cancel', requireAdmin, validate(shiftCancellationSchema), async (req: any, res) => {
  try {
    const data = await cancelOpenShift(Number(req.params.id), {
      reason: req.body.reason,
      actorId: req.employee?.id,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.put('/:id/review', requireAdmin, validate(shiftReviewSchema), async (req: any, res) => {
  try {
    const review = await updateShiftReview(db, Number(req.params.id), {
      status: req.body.review_status,
      notes: req.body.notes,
      actor: {
        employeeId: req.employee?.id,
        role: req.employee?.role,
      },
    });
    res.json({ success: true, data: review });
  } catch (err: any) {
    res.status(err.httpStatus || 500).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
});

// DELETE /shifts/:id/invoice-consumption/:entryId (soft-delete; blocked once invoiced)
router.delete('/:id/invoice-consumption/:entryId', requireAuth, requireOwnShiftOrAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const shiftId = Number(req.params.id);
    const entryId = Number(req.params.entryId);

    await db.transaction(async (trx) => {
      const shift = await trx('shifts').where({ id: shiftId }).first();
      if (!shift) throw Object.assign(new Error('Shift not found'), { http: 404 });
      if (shift.status !== 'open') {
        throw Object.assign(new Error('Cannot modify a closed shift.'), { http: 400 });
      }

      const entry = await trx('invoice_consumption')
        .where({ id: entryId, shift_id: shiftId })
        .whereNull('deleted_at')
        .first();
      if (!entry) throw Object.assign(new Error('Consumption entry not found'), { http: 404 });
      if (entry.invoice_line_id) {
        throw Object.assign(
          new Error('Entry is reserved or invoiced and cannot be deleted.'),
          { http: 400 },
        );
      }

      const now = new Date().toISOString();
      await trx('invoice_consumption')
        .where({ id: entryId })
        .update({ deleted_at: now, updated_at: now, entry_status: 'deleted' });
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message });
  }
});

// Preview a closed-shift correction without changing any records.
router.post('/:id/invoice-consumption/:entryId/correction-preview', requireAdmin, async (req: any, res) => {
  try {
    const preview = await db.transaction(async (trx) => buildConsumptionCorrectionPreview(
      trx,
      Number(req.params.id),
      Number(req.params.entryId),
      {
        litres: Number(req.body.litres),
        pump_id: req.body.pump_id,
        tank_id: req.body.tank_id,
      },
    ));
    res.json({
      success: true,
      data: {
        original: preview.entry,
        replacement: preview.replacement,
        amount_delta: preview.amount_delta,
        variance_before: preview.before.variance,
        variance_after: preview.after.variance,
        deficit_before: preview.deficit_before,
        deficit_after: preview.deficit_after,
        deficit_change: preview.deficit_change,
        litre_validation: preview.litre_validation,
        confirmation_token: preview.confirmation_token,
      },
    });
  } catch (err: any) {
    res.status(err.http || err.httpStatus || 500).json({ success: false, error: err.message });
  }
});

// Correct a closed-shift, unreserved consumption row through reversal + replacement.
router.post('/:id/invoice-consumption/:entryId/correct', requireAdmin, async (req: any, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'A correction reason of at least 10 characters is required.',
      });
    }
    if (!req.body.confirmation_token) {
      return res.status(400).json({
        success: false,
        error: 'Preview this correction before posting it.',
      });
    }

    const result = await postConsumptionCorrection(db, {
      shiftId: Number(req.params.id),
      entryId: Number(req.params.entryId),
      litres: Number(req.body.litres),
      pumpId: req.body.pump_id,
      tankId: req.body.tank_id,
      reason,
      confirmationToken: req.body.confirmation_token,
      actorId: req.employee?.id,
    });

    res.status(201).json({
      success: true,
      data: result,
      ...(result.debt_impact.review_required_amount > 0
        ? {
            warnings: [
              `KES ${result.debt_impact.review_required_amount.toFixed(2)} requires manager review because the related employee debt or wage deduction was already settled.`,
            ],
          }
        : {}),
    });
  } catch (err: any) {
    res.status(err.http || err.httpStatus || 500).json({ success: false, error: err.message });
  }
});

/**
 * POST /shifts/:id/credit-receipts
 *
 * Record a prior debt payment received DURING an open shift.
 * The cash (or M-Pesa) goes straight into the shift drawer.
 * Credits issued by an open shift are deliberately excluded: same-shift
 * give-and-collect creates false comfort in the drawer reconciliation.
 *
 * Accounting treatment:
 *   - Reduces credit_accounts.balance (receivable decreases)
 *   - Leaves shift_collections as gross cash/M-Pesa received totals
 *   - Records credit_payments row linked to this shift_id
 *   - Does NOT touch revenue / pump_readings
 *   - Is already included inside the shift's cash/M-Pesa handover totals
 *   - Stays separate from fuel revenue so old debt is not treated as new sales
 */
router.post('/:id/credit-receipts', requireAuth, requireOwnShiftOrAdmin, async (req, res) => {
  if (!(await requireOpenShift(req, res))) return;
  try {
    const shiftId = parseInt(req.params.id as string);
    const { account_id, amount, payment_method, notes } = req.body;
    const pay = Math.round(Number(amount) * 100) / 100;

    if (!account_id || !Number.isFinite(pay) || pay <= 0) {
      return res.status(400).json({ success: false, error: 'account_id and a positive amount are required' });
    }

    const method = payment_method || 'cash';
    if (!['cash', 'mpesa'].includes(method)) {
      return res.status(400).json({
        success: false,
        error: 'Shift credit receipts must be cash or M-Pesa because they affect shift collections',
      });
    }

    const today = getKenyaDate();
    const key = normalizeIdempotencyKey(req.get('Idempotency-Key'));
    const result = await runIdempotent(
      db,
      { scope: `shift:${shiftId}:credit-receipt`, key, payload: req.body },
      async (trx) => {
        const paymentResult = await recordMoneyAccountPaymentInTransaction(trx, {
          accountId: Number(account_id),
          amount: pay,
          paymentMethod: method,
          paymentDate: today,
          notes,
          shiftId,
        });
        const account = await trx('credit_accounts')
          .where({ id: Number(account_id) })
          .first('name');
        const receipt = { ...paymentResult.payment, account_name: account?.name || null };
        return { status: 201, body: { success: true, data: receipt } };
      },
    );

    if (result.replayed) res.set('Idempotency-Replayed', 'true');
    res.status(result.status).json(result.body);
  } catch (err: any) {
    res.status(paymentHttpStatus(err)).json({ success: false, error: err.message, code: err.code });
  }
});

// POST/PUT wage deduction for shift
router.put('/:id/wage-deduction', requireAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const { deduction_amount, reason } = req.body;
    const normalizedDeduction = Number(deduction_amount);
    if (!Number.isFinite(normalizedDeduction) || normalizedDeduction < 0) {
      return res.status(400).json({ success: false, error: 'deduction_amount must be a non-negative number' });
    }

    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.employee_id', 'employees.daily_wage')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    const original_wage = Number(shift.daily_wage || 0);
    if (normalizedDeduction > original_wage) {
      return res.status(400).json({
        success: false,
        error: `Deduction cannot exceed the available wage of KES ${original_wage.toFixed(2)}`,
      });
    }
    const final_wage = original_wage - normalizedDeduction;

    const existing = await db('wage_deductions').where({ shift_id: req.params.id }).first();
    if (existing) {
      await db('wage_deductions').where({ shift_id: req.params.id }).update({
        deduction_amount: normalizedDeduction, original_wage, final_wage, reason: reason || null,
      });
    } else {
      await db('wage_deductions').insert({
        shift_id: req.params.id, employee_id: shift.employee_id,
        original_wage, deduction_amount: normalizedDeduction, final_wage, reason: reason || null,
      });
    }

    const deduction = await db('wage_deductions').where({ shift_id: req.params.id }).first();
    res.json({ success: true, data: deduction });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE wage deduction
router.delete('/:id/wage-deduction', requireAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    await db('wage_deductions').where({ shift_id: req.params.id }).update({ deleted_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT close shift — with deduction options and debt carry-forward
// Finalizes financials, stock snapshots, and FIFO costing, so it is admin-only.
router.put('/:id/close', requireAdmin, validate(closeShiftSchema), async (req: any, res: any) => {
  try {
    const {
      notes,
      deduct_amount,
      wage_paid: submittedWage,
      variance_reason: varianceReason,
      reconciliation,
    } = req.body;
    // deduct_amount: number | null
    //   null/undefined = don't deduct (full deficit becomes debt)
    //   number = deduct this amount from wage (can be partial or full)
    // wage_paid: number | undefined — the actual wage taken from the drawer this shift

    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.daily_wage', 'employees.id as emp_id', 'employees.name as emp_name')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    // Phase 4: guard against double-close (already-closed shift)
    if (shift.status !== 'open') {
      return res.status(400).json({ success: false, error: `Shift is already ${shift.status}.` });
    }

    const normalizedWage = submittedWage === undefined || submittedWage === null
      ? 0
      : Number(submittedWage);
    if (!Number.isFinite(normalizedWage) || normalizedWage < 0) {
      return res.status(400).json({ success: false, error: 'wage_paid must be a non-negative number' });
    }

    const normalizedDeduction = deduct_amount === undefined || deduct_amount === null
      ? null
      : Number(deduct_amount);
    if (normalizedDeduction !== null && (!Number.isFinite(normalizedDeduction) || normalizedDeduction < 0)) {
      return res.status(400).json({ success: false, error: 'deduct_amount must be a non-negative number' });
    }

    const warnings: string[] = [];
    const closeTime = new Date().toISOString();
    const closeTimeSql = toSqliteDateTime(closeTime);

    await db.transaction(async (trx) => {
      // Calculate variance
      const readings = await trx('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .where('pump_readings.shift_id', shift.id)
        .where('pumps.active', true);
      const collections = await trx('shift_collections').where({ shift_id: shift.id }).first();
      const expenses = await trx('shift_expenses').where({ shift_id: shift.id }).whereNull('deleted_at');
      const shiftCredits = await trx('shift_credits').where({ shift_id: shift.id }).whereNull('deleted_at');
      const creditReceipts = await trx('credit_payments')
        .where({ shift_id: shift.id })
        .where({ status: 'posted' })
        .whereNull('deleted_at');
      const payrollPayments = await trx('payroll_payments')
        .where({ shift_id: shift.id, status: 'posted' });
      // Phase 3B: invoice-mode consumption — retail_amount enters the balance math
      // exactly like a credit. Agreed-price delta is reconciled at invoice time.
      const invoiceConsumption = await trx('invoice_consumption')
        .where({ shift_id: shift.id })
        .whereNull('deleted_at');
      const invoiceLitreValidation = validateInvoiceConsumptionAgainstReadings(
        readings,
        invoiceConsumption,
      );
      if (invoiceLitreValidation.missing_source_entries > 0) {
        warnings.push(
          `${invoiceLitreValidation.missing_source_entries} invoice-consumption entr${invoiceLitreValidation.missing_source_entries === 1 ? 'y has' : 'ies have'} no pump/nozzle source. Fuel totals were validated, but source-level reconciliation is incomplete.`,
        );
      }

      const employee_wage = normalizedWage;
      const compensationPlan = shift.compensation_plan_id
        ? await getCompensationPlanById(Number(shift.compensation_plan_id), trx)
        : await getCompensationPlan(
          Number(shift.emp_id),
          shift.shift_date || String(shift.start_time).slice(0, 10),
          trx,
        );
      if (!compensationPlan) {
        throw new Error(`No compensation plan is configured for employee ${shift.emp_id}`);
      }
      const grossEarnings = calculateShiftEarnings(compensationPlan, readings)
        .reduce((sum, earning) => sum + Number(earning.gross_amount || 0), 0);
      if (compensationPlan.pay_schedule !== 'daily' && employee_wage > 0) {
        const err: any = new Error(
          `${compensationPlan.pay_schedule} compensation must be paid through its payroll run.`,
        );
        err.httpStatus = 400;
        throw err;
      }
      if (employee_wage > grossEarnings + 0.005) {
        const err: any = new Error(
          `Direct wage payment cannot exceed this shift's gross earnings of KES ${grossEarnings.toFixed(2)}.`,
        );
        err.httpStatus = 400;
        throw err;
      }
      const accountability = computeShiftAccountability({
        readings,
        collections,
        shiftCredits,
        invoiceConsumption,
        creditReceipts,
        expenses,
        employee_wage,
        payrollPayments,
      });
      const { variance } = accountability;
      if (Math.abs(variance) >= 0.01 && String(varianceReason || '').trim().length < 3) {
        const err: any = new Error('A variance reason is required before closing an unbalanced shift.');
        err.httpStatus = 400;
        throw err;
      }

      // Handle deficit and deductions
      if (variance < 0) {
        const deficit = Math.abs(variance);
        const actualDeduction = normalizedDeduction != null
          ? Math.min(normalizedDeduction, employee_wage, deficit)
          : 0;
        const carriedForward = deficit - actualDeduction;

        if (actualDeduction > 0) {
          const existing = await trx('wage_deductions').where({ shift_id: shift.id }).first();
          if (existing) {
            await trx('wage_deductions').where({ shift_id: shift.id }).update({
              deduction_amount: actualDeduction,
              original_wage: employee_wage,
              final_wage: employee_wage - actualDeduction,
              reason: `Shift deficit of KES ${deficit.toFixed(2)}`,
            });
          } else {
            await trx('wage_deductions').insert({
              shift_id: shift.id,
              employee_id: shift.emp_id,
              original_wage: employee_wage,
              deduction_amount: actualDeduction,
              final_wage: employee_wage - actualDeduction,
              reason: `Shift deficit of KES ${deficit.toFixed(2)}`,
            });
          }
        }

        if (carriedForward > 0) {
          await trx('staff_debts').insert({
            employee_id: shift.emp_id,
            shift_id: shift.id,
            original_deficit: deficit,
            deducted_from_wage: actualDeduction,
            carried_forward: carriedForward,
            balance: carriedForward,
            status: 'outstanding',
          });

          const existingAccount = await trx('credit_accounts')
            .where({ employee_id: shift.emp_id, type: 'employee' })
            .first();
          if (!existingAccount) {
            await trx('credit_accounts').insert({
              name: shift.emp_name,
              type: 'employee',
              employee_id: shift.emp_id,
              balance: carriedForward,
            });
          } else {
            await trx('credit_accounts')
              .where({ id: existingAccount.id })
              .update({ balance: Number(existingAccount.balance || 0) + carriedForward });
          }
        }
      }

      // --- Litre accountability: computed book stock + FIFO costing ---
      const allTanks = await trx('tanks').select('id');
      const shiftDate = shift.shift_date || (shift.start_time || '').slice(0, 10);
      const shiftStartTs = toSqliteDateTime(shift.start_time);

      const openingStocks: Record<number, number> = {};
      for (const t of allTanks) {
        openingStocks[t.id] = await computeBookStock(t.id, shiftStartTs, trx);
      }

      const allReadings = await trx('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .where('pump_readings.shift_id', req.params.id)
        .where('pumps.active', true)
        .whereNotNull('pumps.tank_id')
        .select('pumps.tank_id', 'pump_readings.litres_sold');

      const tankDeductions: Record<number, number> = {};
      for (const r of allReadings) {
        const tankId = r.tank_id;
        tankDeductions[tankId] = (tankDeductions[tankId] || 0) + parseFloat(r.litres_sold || 0);
      }

      const shiftDeliveries = await trx('fuel_deliveries')
        .select('tank_id')
        .sum('litres as total_litres')
        .whereNull('deleted_at')
        .whereRaw('datetime(COALESCE(delivery_timestamp, created_at)) > datetime(?)', [shiftStartTs])
        .whereRaw('datetime(COALESCE(delivery_timestamp, created_at)) <= datetime(?)', [closeTimeSql])
        .groupBy('tank_id');
      const deliveriesByTank: Record<number, number> = {};
      for (const d of shiftDeliveries) {
        deliveriesByTank[d.tank_id] = parseFloat(d.total_litres) || 0;
      }

      for (const t of allTanks) {
        const sales = tankDeductions[t.id] || 0;
        const deliveries = deliveriesByTank[t.id] || 0;
        const opening = openingStocks[t.id];
        const closing = opening + deliveries - sales;

        // Warn if stock goes negative (don't block — fuel was physically sold)
        if (closing < 0) {
          const tankInfo = await trx('tanks').where({ id: t.id }).select('label').first();
          warnings.push(`Tank ${tankInfo?.label || t.id} stock would go negative by ${Math.abs(closing).toFixed(1)} litres. Consider recording a delivery or taking a dip.`);
        }

        let cogs = 0;
        if (sales > 0) {
          const fifoResult = await consumeBatchesFIFO(
            t.id,
            sales,
            parseInt(req.params.id),
            closeTime,
            trx,
          );
          cogs = fifoResult.totalCost;

          // Phase 2 fix: warn if FIFO couldn't find batches for some litres
          // (batchId=0 means 0-cost placeholder — missing delivery records)
          const missingBatch = fifoResult.details.find(d => d.batchId === 0);
          if (missingBatch) {
            const tankInfo = await trx('tanks').where({ id: t.id }).select('label').first();
            warnings.push(
              `Tank ${tankInfo?.label || t.id}: ${missingBatch.litres.toFixed(1)} L sold have no matching delivery batch — COGS for those litres is KES 0. Record the missing delivery to correct profit calculations.`
            );
          }
        }

        await trx('shift_tank_snapshots').insert({
          shift_id: parseInt(req.params.id),
          tank_id: t.id,
          opening_stock_litres: opening,
          deliveries_litres: deliveries,
          sales_litres: sales,
          closing_stock_litres: closing,
          cogs,
        });

      }

      // *** Mark shift closed BEFORE recomputeCache so that computeBookStock
      // sees this shift's status = 'closed' and includes its sales in the total ***
      await generateShiftEarnings(
        {
          id: shift.id,
          employee_id: shift.emp_id,
          compensation_plan_id: shift.compensation_plan_id,
          shift_date: shift.shift_date,
          start_time: shift.start_time,
        },
        readings,
        closeTime,
        trx,
      );

      await trx('shift_close_reconciliations').insert({
        shift_id: shift.id,
        readings_reviewed: reconciliation.readings_reviewed,
        collections_reviewed: reconciliation.collections_reviewed,
        entries_reviewed: reconciliation.entries_reviewed,
        expected_sales: accountability.expected_sales,
        expected_shift_total: accountability.expected_shift_total,
        cash_received: accountability.total_cash,
        mpesa_received: accountability.total_mpesa,
        credit_receipts: accountability.total_credit_receipts,
        credits_issued: accountability.total_credits,
        invoice_consumption: accountability.total_invoice_consumption,
        expenses: accountability.total_expenses,
        direct_wage_payment: accountability.employee_wage,
        payroll_payments: accountability.total_payroll_payments,
        total_accounted: accountability.total_accounted,
        variance,
        variance_type: variance < 0 ? 'deficit' : variance > 0 ? 'surplus' : 'balanced',
        variance_reason: Math.abs(variance) >= 0.01 ? String(varianceReason).trim() : null,
        approved_by_employee_id: Number(req.employee?.id) > 0 ? Number(req.employee.id) : null,
        approved_by_role: req.employee?.role || 'admin',
        approved_at: closeTime,
      });

      await trx('shift_reviews').insert({
        shift_id: shift.id,
        review_status: 'pending_review',
        created_at: closeTime,
        updated_at: closeTime,
      });

      await trx('shifts').where({ id: req.params.id }).update({
        status: 'closed',
        end_time: closeTime,
        notes: notes || null,
        wage_paid: employee_wage,
      });

      // Now recompute tank cache — the shift is closed so its sales are included
      for (const t of allTanks) {
        const sales = tankDeductions[t.id] || 0;
        if (sales > 0) {
          const newStock = await recomputeCache(t.id, trx);
          await trx('tank_stock_ledger').insert({
            tank_id: t.id,
            event_type: 'shift_sale',
            reference_id: parseInt(req.params.id),
            litres_change: -sales,
            balance_after: newStock,
            notes: `Shift #${req.params.id} sales: ${sales.toFixed(1)} L`,
          });
        }
        // Phase 1 stale-cache fix: any dip on/after this shift_date now has a
        // stale book_stock_at_dip because this shift's sales weren't counted.
        await recomputeDipsForTankFromDate(t.id, shiftDate, trx);
      }
    });

    res.json({ success: true, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (err: any) {
    console.error('[shifts:close] ERROR', err.message, err.stack);
    res.status(err.httpStatus || 500).json({ success: false, error: err.message });
  }
});

// GET staff debts for an employee
router.get('/staff-debts/:employeeId', async (req, res) => {
  try {
    const debts = await db('staff_debts')
      .where({ employee_id: req.params.employeeId })
      .orderBy('created_at', 'desc');
    const total = debts
      .filter((d: any) => d.status === 'outstanding')
      .reduce((sum: number, d: any) => sum + d.balance, 0);
    res.json({ success: true, data: { debts, total_outstanding: total } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT repay staff debt from wage (used when opening/during a shift to clear past debts)
// Phase 3 fix: wrapped in transaction — writes staff_debts + credit_accounts + wage_deductions
// Phase 5: require admin — adjusts financial records
router.put('/:id/repay-debt', requireAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be greater than zero' });
    }

    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.daily_wage', 'employees.id as emp_id')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    await db.transaction(async (trx) => {
      const existingDeduction = await trx('wage_deductions')
        .where({ shift_id: shift.id })
        .whereNull('deleted_at')
        .first();
      const availableWage = Math.max(
        0,
        Number(shift.daily_wage || 0) - Number(existingDeduction?.deduction_amount || 0),
      );
      if (amount > availableWage) {
        const error: any = new Error(`Debt deduction cannot exceed the available wage of KES ${availableWage.toFixed(2)}`);
        error.http = 400;
        throw error;
      }

      // Get outstanding debts oldest first
      const debts = await trx('staff_debts')
        .where({ employee_id: shift.emp_id, status: 'outstanding' })
        .orderBy('created_at', 'asc');

      let remaining = amount;
      const debtAllocations: Array<{ staff_debt_id: number; amount: number }> = [];
      for (const debt of debts) {
        if (remaining <= 0) break;
        const payment = Math.min(remaining, debt.balance);
        const newBalance = debt.balance - payment;
        await trx('staff_debts').where({ id: debt.id }).update({
          balance: newBalance,
          status: newBalance <= 0 ? 'cleared' : 'outstanding',
        });
        debtAllocations.push({ staff_debt_id: Number(debt.id), amount: payment });
        remaining -= payment;
      }

      // Sync credit_accounts.balance for this employee
      const deductionAmount = amount - remaining; // actual amount applied
      if (deductionAmount > 0) {
        const empAccount = await trx('credit_accounts')
          .where({ employee_id: shift.emp_id, type: 'employee' })
          .first();
        if (empAccount) {
          const newBalance = Math.max(0, Number(empAccount.balance) - deductionAmount);
          await trx('credit_accounts')
            .where({ id: empAccount.id })
            .update({ balance: newBalance });
        }
      }

      // Create/update wage deduction for this debt repayment
      if (deductionAmount > 0) {
        const existing = existingDeduction;
        const totalDeduction = (existing?.deduction_amount || 0) + deductionAmount;
        let deductionId = existing?.id ? Number(existing.id) : null;
        if (existing) {
          await trx('wage_deductions').where({ shift_id: shift.id }).update({
            deduction_amount: totalDeduction,
            final_wage: shift.daily_wage - totalDeduction,
            reason: existing.reason
              ? `${existing.reason} + Debt repayment KES ${deductionAmount.toFixed(2)}`
              : `Debt repayment KES ${deductionAmount.toFixed(2)}`,
          });
        } else {
          const [createdDeductionId] = await trx('wage_deductions').insert({
            shift_id: shift.id,
            employee_id: shift.emp_id,
            original_wage: shift.daily_wage,
            deduction_amount: totalDeduction,
            final_wage: shift.daily_wage - totalDeduction,
            reason: `Debt repayment KES ${deductionAmount.toFixed(2)}`,
          });
          deductionId = Number(createdDeductionId);
        }
        if (debtAllocations.length > 0) {
          await trx('shift_staff_debt_allocations').insert(
            debtAllocations.map((allocation) => ({
              shift_id: shift.id,
              wage_deduction_id: deductionId,
              staff_debt_id: allocation.staff_debt_id,
              amount: allocation.amount,
            })),
          );
        }
      }
    });

    // Return updated debts (outside trx — read-only)
    const updatedDebts = await db('staff_debts')
      .where({ employee_id: shift.emp_id })
      .orderBy('created_at', 'desc');
    const totalOutstanding = updatedDebts
      .filter((d: any) => d.status === 'outstanding')
      .reduce((sum: number, d: any) => sum + d.balance, 0);

    res.json({ success: true, data: { debts: updatedDebts, total_outstanding: totalOutstanding } });
  } catch (err: any) {
    console.error('[shifts:repay-debt] ERROR', err.message, err.stack);
    res.status(err.http || 500).json({ success: false, error: err.message });
  }
});

// GET per-shift tank stock summary
router.get('/:id/tank-summary', async (req, res) => {
  try {
    const shift = await db('shifts').where({ id: req.params.id }).first();
    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    if (shift.status === 'closed') {
      // Return stored snapshots
      const snapshots = await db('shift_tank_snapshots')
        .join('tanks', 'shift_tank_snapshots.tank_id', 'tanks.id')
        .where('shift_tank_snapshots.shift_id', req.params.id)
        .select(
          'shift_tank_snapshots.*',
          'tanks.label as tank_label',
          'tanks.fuel_type',
        );
      return res.json({ success: true, data: { shift_id: shift.id, status: 'closed', tanks: snapshots } });
    }

    // Open shift: compute live
    const allTanks = await db('tanks').select('id', 'label', 'fuel_type', 'current_stock_litres');
    const shiftDate = shift.shift_date || (shift.start_time || '').slice(0, 10);

    const pumpSales = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .where('pump_readings.shift_id', req.params.id)
      .where('pumps.active', true)
      .whereNotNull('pumps.tank_id')
      .select('pumps.tank_id', 'pump_readings.litres_sold');

    const salesByTank: Record<number, number> = {};
    for (const r of pumpSales) {
      salesByTank[r.tank_id] = (salesByTank[r.tank_id] || 0) + (parseFloat(r.litres_sold) || 0);
    }

    const deliveries = await db('fuel_deliveries')
      .select('tank_id')
      .sum('litres as total_litres')
      .where('date', shiftDate)
      .groupBy('tank_id');
    const deliveriesByTank: Record<number, number> = {};
    for (const d of deliveries) {
      deliveriesByTank[d.tank_id] = parseFloat(d.total_litres) || 0;
    }

    // For open shift, current_stock_litres hasn't been decremented yet
    // So opening = current_stock (since sales haven't been deducted)
    const tanks = allTanks.map((t: any) => {
      const currentStock = parseFloat(t.current_stock_litres) || 0;
      const sales = salesByTank[t.id] || 0;
      const dels = deliveriesByTank[t.id] || 0;
      return {
        tank_id: t.id,
        tank_label: t.label,
        fuel_type: t.fuel_type,
        opening_stock_litres: currentStock,
        deliveries_litres: dels,
        sales_litres: sales,
        closing_stock_litres: currentStock + dels - sales,
      };
    });

    res.json({ success: true, data: { shift_id: shift.id, status: 'open', tanks } });
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message });
  }
});

export default router;
