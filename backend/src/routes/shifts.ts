import { Router } from 'express';
import db from '../database';
import { validate } from '../middleware/validate';
import { createShiftExpenseSchema, createShiftCreditSchema, updateReadingsSchema } from '../schemas';
import { computeBookStock, recomputeCache, consumeBatchesFIFO, recomputeDipsForTankFromDate } from '../services/stockCalculator';
import { compensate } from '../services/meterRollover';
import { recomputeAccountBalance } from '../services/accountBalance';
import { computeMpesaFee } from '../services/mpesaFees';
import { requireAdmin, requireAuth, requireOwnShiftOrAdmin } from '../middleware/requireAdmin';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

function toSqliteDateTime(value: string): string {
  return String(value).slice(0, 19).replace('T', ' ');
}

/** Guard: reject modifications to closed shifts */
async function requireOpenShift(req: any, res: any): Promise<boolean> {
  const shift = await db('shifts').where({ id: req.params.id }).select('status').first();
  if (!shift) {
    res.status(404).json({ success: false, error: 'Shift not found' });
    return false;
  }
  if (shift.status === 'closed') {
    res.status(400).json({ success: false, error: 'Cannot modify a closed shift.' });
    return false;
  }
  return true;
}

// GET all shifts (with pagination)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;

    let query = db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name');

    if (status) query = query.where('shifts.status', status);

    const shifts = await query.orderBy('shifts.start_time', 'desc').limit(limit).offset(offset);
    const [{ count }] = await db('shifts').count('* as count');
    res.json({ success: true, data: { shifts, total: count, page, limit } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET current open shift
router.get('/current', async (_req, res) => {
  try {
    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name')
      .where('shifts.status', 'open')
      .orderBy('shifts.start_time', 'desc')
      .first();
    res.json({ success: true, data: shift || null });
  } catch (err: any) {
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

    const collections = await db('shift_collections').where({ shift_id: shift.id }).first();
    const expenses = await db('shift_expenses').where({ shift_id: shift.id }).whereNull('deleted_at');
    const shiftCredits = await db('shift_credits').where({ shift_id: shift.id }).whereNull('deleted_at');
    const wageDeduction = await db('wage_deductions').where({ shift_id: shift.id }).whereNull('deleted_at').first();

    // Phase 3B: invoice-mode consumption (litre ledger, retail-priced for shift balance)
    const invoiceConsumption = await db('invoice_consumption')
      .leftJoin('credit_accounts', 'invoice_consumption.account_id', 'credit_accounts.id')
      .where('invoice_consumption.shift_id', shift.id)
      .whereNull('invoice_consumption.deleted_at')
      .select(
        'invoice_consumption.*',
        'credit_accounts.name as account_name',
        'credit_accounts.phone as account_phone',
      )
      .orderBy('invoice_consumption.created_at', 'asc');

    // Credit receipts collected during this shift (old-debt payments received)
    const creditReceipts = await db('credit_payments')
      .join('credit_accounts', 'credit_payments.account_id', 'credit_accounts.id')
      .where('credit_payments.shift_id', shift.id)
      .whereNull('credit_payments.deleted_at')
      .select('credit_payments.*', 'credit_accounts.name as account_name', 'credit_accounts.phone as account_phone')
      .orderBy('credit_payments.date', 'asc');
    const total_credit_receipts = creditReceipts.reduce((s: number, r: any) => s + Number(r.amount), 0);

    // Get employee's outstanding debt
    const outstandingDebts = await db('staff_debts')
      .where({ employee_id: shift.employee_id, status: 'outstanding' })
      .orderBy('created_at', 'asc');
    const total_outstanding_debt = outstandingDebts.reduce((sum: number, d: any) => sum + d.balance, 0);

    const expected_sales = readings.reduce((sum: number, r: any) => sum + r.amount_sold, 0);
    const total_cash = collections ? collections.cash_amount : 0;
    const total_mpesa = collections ? collections.mpesa_amount : 0;
    const total_credits = shiftCredits.reduce((sum: number, c: any) => sum + c.amount, 0);
    const total_expenses = expenses.reduce((sum: number, e: any) => sum + e.amount, 0);
    // Phase 3B: invoice-mode consumption counts toward shift balance at retail price
    // (like a credit from the shift's POV). Pricing delta vs agreed invoice price is
    // a separate concern reported in the pricing-variance report.
    const total_invoice_consumption = invoiceConsumption.reduce(
      (sum: number, c: any) => sum + Number(c.retail_amount || 0),
      0,
    );
    // For closed shifts, use the stored wage_paid; for open shifts, show daily_wage as preview
    const employee_wage = shift.status === 'closed'
      ? (shift.wage_paid ?? shift.employee_wage ?? 0)
      : (shift.employee_wage || 0);
    // Accounted = everything the attendant used the sales money for (including wages taken from drawer)
    const total_accounted =
      total_cash + total_mpesa + total_credits + total_invoice_consumption + total_expenses + employee_wage;
    const variance = total_accounted - expected_sales;

    res.json({
      success: true,
      data: {
        ...shift,
        readings,
        collections: collections || null,
        expenses,
        shift_credits: shiftCredits,
        invoice_consumption: invoiceConsumption,
        credit_receipts: creditReceipts,
        wage_deduction: wageDeduction || null,
        outstanding_debts: outstandingDebts,
        total_outstanding_debt,
        expected_sales,
        total_cash,
        total_mpesa,
        total_credits,
        total_invoice_consumption,
        total_credit_receipts,
        total_expenses,
        employee_wage,
        total_accounted,
        variance,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST open a new shift
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { employee_id, shift_date } = req.body;
    const today = getKenyaDate();
    const resolvedDate = today;

    if (shift_date && shift_date !== today) {
      return res.status(400).json({
        success: false,
        error: 'Shift date is controlled by the system date. Open the shift on the day it is actually worked.',
      });
    }

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

      const [id] = await trx('shifts').insert({
        employee_id,
        start_time: new Date().toISOString(),
        shift_date: resolvedDate,
        status: 'open',
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
    if (err.httpStatus === 400) {
      return res.status(400).json({ success: false, error: err.message });
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
    const updatedReadings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.nozzle_label', 'pumps.fuel_type', 'pumps.meter_capacity_litres', 'pumps.meter_capacity_amount')
      .where('pump_readings.shift_id', req.params.id);
    res.json({ success: true, data: updatedReadings });
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
    const { readings, confirm_anomaly, confirm_large_sale } = req.body;

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

    for (const r of readings) {
      const existing = await db('pump_readings')
        .where({ shift_id: req.params.id, pump_id: r.pump_id })
        .first();

      if (existing) {
        const cL = resolved[r.pump_id].closing_litres;
        const cA = resolved[r.pump_id].closing_amount;
        const litres_sold = cL - Number(existing.opening_litres);
        const amount_sold = cA - Number(existing.opening_amount);
        await db('pump_readings')
          .where({ shift_id: req.params.id, pump_id: r.pump_id })
          .update({
            closing_litres: cL,
            closing_amount: cA,
            litres_sold,
            amount_sold,
          });
      }
    }

    const updatedReadings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.nozzle_label', 'pumps.fuel_type', 'pumps.meter_capacity_litres', 'pumps.meter_capacity_amount')
      .where('pump_readings.shift_id', req.params.id);

    res.json({ success: true, data: updatedReadings });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update collections for a shift
router.put('/:id/collections', requireAuth, requireOwnShiftOrAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const { cash_amount, mpesa_amount, credits_amount } = req.body;
    const total_collected = (cash_amount || 0) + (mpesa_amount || 0) + (credits_amount || 0);

    // Auto-compute Lipa na M-Pesa Buy Goods fee + net (Phase 1A)
    const { fee: mpesa_fee, net: mpesa_net } = await computeMpesaFee(Number(mpesa_amount) || 0);

    const existing = await db('shift_collections').where({ shift_id: req.params.id }).first();
    if (existing) {
      await db('shift_collections').where({ shift_id: req.params.id }).update({
        cash_amount, mpesa_amount, credits_amount, total_collected, mpesa_fee, mpesa_net,
      });
    } else {
      await db('shift_collections').insert({
        shift_id: req.params.id, cash_amount, mpesa_amount, credits_amount, total_collected, mpesa_fee, mpesa_net,
      });
    }

    const collections = await db('shift_collections').where({ shift_id: req.params.id }).first();
    res.json({ success: true, data: collections });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add shift expense
router.post('/:id/expenses', requireAuth, requireOwnShiftOrAdmin, validate(createShiftExpenseSchema), async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const { category, description, amount } = req.body;
    const [expId] = await db('shift_expenses').insert({
      shift_id: req.params.id, category, description, amount,
    });
    const expense = await db('shift_expenses').where({ id: expId }).first();
    res.status(201).json({ success: true, data: expense });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
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

    const shiftCredit = await db.transaction(async (trx) => {
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
          { code: 'INVOICE_MODE_ACCOUNT' },
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

      return trx('shift_credits').where({ id: shiftCreditId }).first();
    });

    res.status(201).json({ success: true, data: shiftCredit });
  } catch (err: any) {
    if (err.code === 'INVOICE_MODE_ACCOUNT') {
      return res.status(400).json({ success: false, error: err.message, code: err.code });
    }
    res.status(500).json({ success: false, error: err.message });
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

// POST /shifts/:id/invoice-consumption
// Body: { account_id, tank_id?, fuel_type: 'petrol' | 'diesel', litres }
router.post('/:id/invoice-consumption', requireAuth, requireOwnShiftOrAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const shiftId = Number(req.params.id);
    const { account_id, tank_id, fuel_type, litres } = req.body;

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

    const entry = await db.transaction(async (trx) => {
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

      const priceAsOf = shift.shift_date || getKenyaDate();
      const retailPrice = await getRetailPriceAsOf(trx, fuel_type, priceAsOf);
      if (retailPrice === null) {
        throw Object.assign(
          new Error(`No fuel_price configured for ${fuel_type} on/before ${priceAsOf}`),
          { http: 400 },
        );
      }
      const retailAmount = Math.round(litresNum * retailPrice * 100) / 100;

      const [id] = await trx('invoice_consumption').insert({
        account_id,
        shift_id: shiftId,
        tank_id: tank_id || null,
        fuel_type,
        litres: litresNum,
        retail_price_at_time: retailPrice,
        retail_amount: retailAmount,
      });
      return trx('invoice_consumption').where({ id }).first();
    });

    res.status(201).json({ success: true, data: entry });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// PUT /shifts/:id/invoice-consumption/:entryId
// Editable: litres, tank_id. fuel_type & account_id are frozen — delete & re-add to change those.
router.put('/:id/invoice-consumption/:entryId', requireAuth, requireOwnShiftOrAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const shiftId = Number(req.params.id);
    const entryId = Number(req.params.entryId);

    const entry = await db('invoice_consumption')
      .where({ id: entryId, shift_id: shiftId })
      .whereNull('deleted_at')
      .first();
    if (!entry) return res.status(404).json({ success: false, error: 'Consumption entry not found' });
    if (entry.invoice_line_id) {
      return res.status(400).json({
        success: false,
        error: 'Entry has already been invoiced and cannot be edited from the shift. Adjust via the invoice instead.',
      });
    }

    const update: any = {};
    if (req.body.tank_id !== undefined) update.tank_id = req.body.tank_id || null;
    if (req.body.litres !== undefined) {
      const litresNum = Number(req.body.litres);
      if (!Number.isFinite(litresNum) || litresNum <= 0) {
        return res.status(400).json({ success: false, error: 'litres must be a positive number' });
      }
      update.litres = litresNum;
      update.retail_amount = Math.round(litresNum * Number(entry.retail_price_at_time) * 100) / 100;
    }

    if (Object.keys(update).length > 0) {
      await db('invoice_consumption').where({ id: entryId }).update(update);
    }
    const updated = await db('invoice_consumption').where({ id: entryId }).first();
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /shifts/:id/invoice-consumption/:entryId (soft-delete; blocked once invoiced)
router.delete('/:id/invoice-consumption/:entryId', requireAuth, requireOwnShiftOrAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const shiftId = Number(req.params.id);
    const entryId = Number(req.params.entryId);

    const entry = await db('invoice_consumption')
      .where({ id: entryId, shift_id: shiftId })
      .whereNull('deleted_at')
      .first();
    if (!entry) return res.status(404).json({ success: false, error: 'Consumption entry not found' });
    if (entry.invoice_line_id) {
      return res.status(400).json({
        success: false,
        error: 'Entry has already been invoiced and cannot be deleted. Void the invoice instead.',
      });
    }

    await db('invoice_consumption')
      .where({ id: entryId })
      .update({ deleted_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /shifts/:id/credit-receipts
 *
 * Record a debt payment received DURING an open shift.
 * The cash (or M-Pesa) goes straight into the shift drawer.
 *
 * Accounting treatment:
 *   - Reduces credit_accounts.balance (receivable decreases)
 *   - Increases shift_collections.cash_amount or mpesa_amount (cash in drawer increases)
 *   - Records credit_payments row linked to this shift_id
 *   - Does NOT touch revenue / pump_readings — no double-counting
 *   - The shift may show a positive variance (cash > today's sales) which is correct
 *     because old debt was collected; the UI labels this as "debt collected"
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

    const account = await db('credit_accounts')
      .where({ id: account_id })
      .whereNull('deleted_at')
      .first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });
    if (account.type !== 'customer') {
      return res.status(400).json({
        success: false,
        error: 'Shift credit receipts can only be recorded for customer accounts',
      });
    }
    if ((account.billing_mode || 'money') !== 'money') {
      return res.status(400).json({
        success: false,
        error: `Account "${account.name}" is invoice-mode. Record invoice payments from Customer Invoices instead.`,
      });
    }

    const balance = Number(account.balance);
    if (pay > balance) {
      return res.status(400).json({
        success: false,
        error: `Payment KES ${pay} exceeds account balance KES ${balance}`,
      });
    }

    const today = getKenyaDate();

    const receipt = await db.transaction(async (trx) => {
      // 1. Record credit payment linked to this shift
      const [paymentId] = await trx('credit_payments').insert({
        account_id,
        credit_id: null,
        payment_type: 'account',
        payment_method: method,
        amount: pay,
        date: today,
        notes: notes || null,
        shift_id: shiftId,
      });

      // 2. FIFO settle oldest individual credit line items
      let remaining = pay;
      const openCredits = await trx('credits')
        .where({ account_id })
        .whereNull('deleted_at')
        .whereNot('status', 'paid')
        .where('balance', '>', 0)
        .orderBy('created_at', 'asc');
      for (const credit of openCredits) {
        if (remaining <= 0) break;
        const apply = Math.min(remaining, Number(credit.balance));
        const newBal = Math.round((Number(credit.balance) - apply) * 100) / 100;
        await trx('credits').where({ id: credit.id }).update({
          balance: newBal,
          status: newBal <= 0 ? 'paid' : 'partial',
        });
        remaining = Math.round((remaining - apply) * 100) / 100;
      }

      // 3. Recompute account balance from source rows (Phase 1 stale-cache fix)
      await recomputeAccountBalance(account_id, trx);

      // 4. Add to shift collections (cash or mpesa)
      let collections = await trx('shift_collections').where({ shift_id: shiftId }).first();
      if (!collections) {
        await trx('shift_collections').insert({ shift_id: shiftId, cash_amount: 0, mpesa_amount: 0, credits_amount: 0, total_collected: 0 });
        collections = await trx('shift_collections').where({ shift_id: shiftId }).first();
      }

      if (method === 'mpesa') {
        const { fee, net } = await computeMpesaFee(pay, today);
        const newMpesa = Math.round((Number(collections.mpesa_amount) + pay) * 100) / 100;
        const newFee = Math.round(((Number(collections.mpesa_fee) || 0) + fee) * 100) / 100;
        const newNet = Math.round(((Number(collections.mpesa_net) || 0) + net) * 100) / 100;
        await trx('shift_collections').where({ shift_id: shiftId }).update({
          mpesa_amount: newMpesa,
          mpesa_fee: newFee,
          mpesa_net: newNet,
          total_collected: Number(collections.cash_amount) + newMpesa + Number(collections.credits_amount),
        });
      } else {
        const newCash = Math.round((Number(collections.cash_amount) + pay) * 100) / 100;
        await trx('shift_collections').where({ shift_id: shiftId }).update({
          cash_amount: newCash,
          total_collected: newCash + Number(collections.mpesa_amount) + Number(collections.credits_amount),
        });
      }

      return trx('credit_payments')
        .join('credit_accounts', 'credit_payments.account_id', 'credit_accounts.id')
        .where('credit_payments.id', paymentId)
        .select('credit_payments.*', 'credit_accounts.name as account_name')
        .first();
    });

    res.status(201).json({ success: true, data: receipt });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST/PUT wage deduction for shift
router.put('/:id/wage-deduction', requireAdmin, async (req, res) => {
  try {
    if (!(await requireOpenShift(req, res))) return;
    const { deduction_amount, reason } = req.body;
    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.employee_id', 'employees.daily_wage')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    const original_wage = shift.daily_wage;
    const final_wage = original_wage - deduction_amount;

    const existing = await db('wage_deductions').where({ shift_id: req.params.id }).first();
    if (existing) {
      await db('wage_deductions').where({ shift_id: req.params.id }).update({
        deduction_amount, original_wage, final_wage, reason: reason || null,
      });
    } else {
      await db('wage_deductions').insert({
        shift_id: req.params.id, employee_id: shift.employee_id,
        original_wage, deduction_amount, final_wage, reason: reason || null,
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
router.put('/:id/close', requireAdmin, async (req: any, res: any) => {
  try {
    const { notes, deduct_amount, wage_paid: submittedWage } = req.body;
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
    if (shift.status === 'closed') {
      return res.status(400).json({ success: false, error: 'Shift is already closed.' });
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
      // Phase 3B: invoice-mode consumption — retail_amount enters the balance math
      // exactly like a credit. Agreed-price delta is reconciled at invoice time.
      const invoiceConsumption = await trx('invoice_consumption')
        .where({ shift_id: shift.id })
        .whereNull('deleted_at');

      const expected_sales = readings.reduce((s: number, r: any) => s + r.amount_sold, 0);
      const total_cash = collections ? collections.cash_amount : 0;
      const total_mpesa = collections ? collections.mpesa_amount : 0;
      const total_credits = shiftCredits.reduce((s: number, c: any) => s + c.amount, 0);
      const total_invoice_consumption = invoiceConsumption.reduce(
        (s: number, c: any) => s + Number(c.retail_amount || 0),
        0,
      );
      const total_expenses = expenses.reduce((s: number, e: any) => s + e.amount, 0);
      const employee_wage = (submittedWage !== undefined && submittedWage !== null)
        ? Number(submittedWage)
        : (shift.daily_wage || 0);
      const total_accounted =
        total_cash + total_mpesa + total_credits + total_invoice_consumption + total_expenses + employee_wage;
      const variance = total_accounted - expected_sales;

      // Handle deficit and deductions
      if (variance < 0) {
        const deficit = Math.abs(variance);
        const actualDeduction = deduct_amount != null ? Math.min(deduct_amount, employee_wage, deficit) : 0;
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
          const fifoResult = await consumeBatchesFIFO(t.id, sales, parseInt(req.params.id), trx);
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
    res.status(500).json({ success: false, error: err.message });
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
    const { amount } = req.body;
    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.daily_wage', 'employees.id as emp_id')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    await db.transaction(async (trx) => {
      // Get outstanding debts oldest first
      const debts = await trx('staff_debts')
        .where({ employee_id: shift.emp_id, status: 'outstanding' })
        .orderBy('created_at', 'asc');

      let remaining = amount;
      for (const debt of debts) {
        if (remaining <= 0) break;
        const payment = Math.min(remaining, debt.balance);
        const newBalance = debt.balance - payment;
        await trx('staff_debts').where({ id: debt.id }).update({
          balance: newBalance,
          status: newBalance <= 0 ? 'cleared' : 'outstanding',
        });
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
        const existing = await trx('wage_deductions').where({ shift_id: shift.id }).first();
        const totalDeduction = (existing?.deduction_amount || 0) + deductionAmount;
        if (existing) {
          await trx('wage_deductions').where({ shift_id: shift.id }).update({
            deduction_amount: totalDeduction,
            final_wage: shift.daily_wage - totalDeduction,
            reason: existing.reason
              ? `${existing.reason} + Debt repayment KES ${deductionAmount.toFixed(2)}`
              : `Debt repayment KES ${deductionAmount.toFixed(2)}`,
          });
        } else {
          await trx('wage_deductions').insert({
            shift_id: shift.id,
            employee_id: shift.emp_id,
            original_wage: shift.daily_wage,
            deduction_amount: totalDeduction,
            final_wage: shift.daily_wage - totalDeduction,
            reason: `Debt repayment KES ${deductionAmount.toFixed(2)}`,
          });
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
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
