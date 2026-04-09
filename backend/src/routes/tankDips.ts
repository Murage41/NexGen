import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createTankDipSchema, updateTankDipSchema } from '../schemas';
import { computeBookStock } from '../services/stockCalculator';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

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

// POST create a new dip — admins can dip anytime
router.post('/', requireAdmin, validate(createTankDipSchema), async (req, res) => {
  try {
    const { tank_id, measured_litres, dip_date } = req.body;
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
    });
    const dip = await db('tank_dips')
      .join('tanks', 'tank_dips.tank_id', 'tanks.id')
      .select('tank_dips.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .where('tank_dips.id', id)
      .first();
    res.status(201).json({ success: true, data: dip });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT edit a dip
router.put('/:id', requireAdmin, validate(updateTankDipSchema), async (req, res) => {
  try {
    const existing = await db('tank_dips').where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Dip not found' });

    const { measured_litres, dip_date } = req.body;
    const updateData: any = {};
    const effectiveDate = dip_date !== undefined ? dip_date : existing.dip_date;

    if (measured_litres !== undefined || dip_date !== undefined) {
      // Recompute book stock as-of the (possibly new) dip date
      const bookStock = await computeBookStock(existing.tank_id, effectiveDate);
      const ml = measured_litres !== undefined ? parseFloat(measured_litres) : parseFloat(existing.measured_litres);
      updateData.book_stock_at_dip = bookStock;
      updateData.variance_litres = ml - bookStock;
      if (measured_litres !== undefined) updateData.measured_litres = measured_litres;
      if (dip_date !== undefined) updateData.dip_date = dip_date;
    }
    await db('tank_dips').where({ id: req.params.id }).update(updateData);
    const dip = await db('tank_dips')
      .join('tanks', 'tank_dips.tank_id', 'tanks.id')
      .select('tank_dips.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .where('tank_dips.id', req.params.id)
      .first();
    res.json({ success: true, data: dip });
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
