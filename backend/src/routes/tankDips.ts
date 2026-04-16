import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createTankDipSchema, updateTankDipSchema } from '../schemas';
import { computeBookStock } from '../services/stockCalculator';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

/**
 * Phase 1C — cumulative variance % for a tank in a given month.
 *   = (sum of |variance| for all dips in month / sum of litres sold in month) * 100
 */
async function computeCumulativeVariancePct(tank_id: number, monthKey: string): Promise<number> {
  // monthKey = 'YYYY-MM'
  const start = `${monthKey}-01`;
  // Compute end as first day of next month
  const [yy, mm] = monthKey.split('-').map(Number);
  const nextMonth = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, '0')}-01`;

  const dipResult = await db('tank_dips')
    .where('tank_id', tank_id)
    .whereNull('deleted_at')
    .where('dip_date', '>=', start)
    .where('dip_date', '<', nextMonth)
    .select(db.raw('SUM(ABS(variance_litres)) as total'))
    .first();
  const totalVariance = Number((dipResult as any)?.total || 0);

  const salesResult = await db('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .join('shifts', 'pump_readings.shift_id', 'shifts.id')
    .where('pumps.tank_id', tank_id)
    .where('shifts.shift_date', '>=', start)
    .where('shifts.shift_date', '<', nextMonth)
    .sum('pump_readings.litres_sold as total')
    .first();
  const totalSales = Number((salesResult as any)?.total || 0);

  if (totalSales <= 0) return 0;
  return (totalVariance / totalSales) * 100;
}

function buildWarnings(varianceLitres: number, cumulativePct: number, tankLabel: string): string[] {
  const warnings: string[] = [];
  if (cumulativePct > 0.1) {
    warnings.push(
      `Tank ${tankLabel} cumulative loss is ${cumulativePct.toFixed(3)}% of monthly sales — exceeds 0.1% threshold. Investigate for leaks or meter drift.`,
    );
  }
  if (Math.abs(varianceLitres) > 150) {
    warnings.push(
      `Single dip variance of ${varianceLitres.toFixed(1)}L exceeds 150L threshold — check for delivery discrepancy or theft.`,
    );
  }
  return warnings;
}

// GET all dips (filterable by tank_id and date)
router.get('/', async (req, res) => {
  try {
    const { tank_id, date } = req.query;
    let query = db('tank_dips')
      .join('tanks', 'tank_dips.tank_id', 'tanks.id')
      .whereNull('tank_dips.deleted_at')
      .select('tank_dips.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .orderByRaw('tank_dips.dip_date DESC, tank_dips.timestamp DESC');
    if (tank_id) query = query.where('tank_dips.tank_id', tank_id);
    if (date) query = query.where('tank_dips.dip_date', date);
    const dips = await query;
    res.json({ success: true, data: dips });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /trends — monthly cumulative variance % per tank.
 * Query: ?months=6 (default 6) returns the last N months ending with the current month.
 */
router.get('/trends', async (req, res) => {
  try {
    const months = Math.max(1, Math.min(24, Number(req.query.months) || 6));
    const today = getKenyaDate();
    const [year, month] = today.split('-').map(Number);

    const tanks = await db('tanks').select('id', 'label', 'fuel_type');
    const result: any[] = [];

    for (const tank of tanks) {
      const series: any[] = [];
      for (let i = months - 1; i >= 0; i--) {
        // Walk back i months
        let m = month - i;
        let y = year;
        while (m <= 0) { m += 12; y -= 1; }
        const monthKey = `${y}-${String(m).padStart(2, '0')}`;
        const pct = await computeCumulativeVariancePct(tank.id, monthKey);
        series.push({ month: monthKey, cumulative_variance_pct: Number(pct.toFixed(4)) });
      }
      result.push({
        tank_id: tank.id,
        tank_label: tank.label,
        fuel_type: tank.fuel_type,
        series,
      });
    }

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create a new dip — admins can dip anytime
router.post('/', requireAdmin, validate(createTankDipSchema), async (req, res) => {
  try {
    const { tank_id, measured_litres, dip_date, variance_category, variance_notes } = req.body;
    const today = getKenyaDate();
    const dipDate = dip_date || today;

    // Computed book stock as-of the dip date (not the running counter)
    const bookStock = await computeBookStock(tank_id, dipDate);
    const varianceLitres = parseFloat(measured_litres) - bookStock;

    const [id] = await db('tank_dips').insert({
      tank_id,
      measured_litres,
      dip_date: dipDate,
      book_stock_at_dip: bookStock,
      variance_litres: varianceLitres,
      variance_category: variance_category || 'unclassified',
      variance_notes: variance_notes || null,
    });
    const dip = await db('tank_dips')
      .join('tanks', 'tank_dips.tank_id', 'tanks.id')
      .select('tank_dips.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .where('tank_dips.id', id)
      .first();

    // Phase 1C: cumulative variance + threshold warnings
    const monthKey = dipDate.slice(0, 7);
    const cumulativePct = await computeCumulativeVariancePct(tank_id, monthKey);
    const warnings = buildWarnings(varianceLitres, cumulativePct, dip.tank_label);

    res.status(201).json({
      success: true,
      data: { ...dip, cumulative_variance_pct: Number(cumulativePct.toFixed(4)) },
      warnings,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT edit a dip
router.put('/:id', requireAdmin, validate(updateTankDipSchema), async (req, res) => {
  try {
    const existing = await db('tank_dips').where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Dip not found' });

    const { measured_litres, dip_date, variance_category, variance_notes } = req.body;
    const updateData: any = {};
    const effectiveDate = dip_date !== undefined ? dip_date : existing.dip_date;
    const ml = measured_litres !== undefined
      ? parseFloat(measured_litres)
      : parseFloat(existing.measured_litres);

    // Phase 1 stale-cache fix: always recompute book_stock_at_dip from current
    // truth. The previous version froze book_stock when only `measured_litres`
    // changed, but deliveries/shifts can mutate underneath — book_stock_at_dip
    // is a Cat C cache and must always reflect current source data.
    const bookStock = await computeBookStock(existing.tank_id, effectiveDate);
    updateData.book_stock_at_dip = bookStock;
    updateData.variance_litres = ml - bookStock;
    if (dip_date !== undefined) updateData.dip_date = dip_date;
    if (measured_litres !== undefined) updateData.measured_litres = measured_litres;
    if (variance_category !== undefined) updateData.variance_category = variance_category;
    if (variance_notes !== undefined) updateData.variance_notes = variance_notes;

    if (Object.keys(updateData).length > 0) {
      await db('tank_dips').where({ id: req.params.id }).update(updateData);
    }

    const dip = await db('tank_dips')
      .join('tanks', 'tank_dips.tank_id', 'tanks.id')
      .select('tank_dips.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .where('tank_dips.id', req.params.id)
      .first();

    const monthKey = (dip.dip_date as string).slice(0, 7);
    const cumulativePct = await computeCumulativeVariancePct(dip.tank_id, monthKey);
    const warnings = buildWarnings(Number(dip.variance_litres), cumulativePct, dip.tank_label);

    res.json({
      success: true,
      data: { ...dip, cumulative_variance_pct: Number(cumulativePct.toFixed(4)) },
      warnings,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE a dip
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await db('tank_dips').where({ id: req.params.id }).update({ deleted_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
