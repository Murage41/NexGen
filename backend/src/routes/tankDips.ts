import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

// Helper: check if any shift is currently open
async function hasOpenShift(): Promise<boolean> {
  const open = await db('shifts').where({ status: 'open' }).first();
  return !!open;
}

// GET all dips (filterable by tank_id and date)
router.get('/', async (req, res) => {
  try {
    const { tank_id, date } = req.query;
    let query = db('tank_dips')
      .join('tanks', 'tank_dips.tank_id', 'tanks.id')
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

// POST create a new dip — blocked while a shift is open
router.post('/', requireAdmin, async (req, res) => {
  try {
    if (await hasOpenShift()) {
      return res.status(400).json({ success: false, error: 'Cannot record a tank dip while a shift is open. Close the shift first.' });
    }
    const { tank_id, measured_litres, dip_date } = req.body;
    // Default dip_date to today if not provided
    const today = new Date().toISOString().slice(0, 10);
    const [id] = await db('tank_dips').insert({
      tank_id,
      measured_litres,
      dip_date: dip_date || today,
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

// PUT edit a dip — blocked while a shift is open
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    if (await hasOpenShift()) {
      return res.status(400).json({ success: false, error: 'Cannot edit a tank dip while a shift is open. Close the shift first.' });
    }
    const { measured_litres, dip_date } = req.body;
    const updateData: any = {};
    if (measured_litres !== undefined) updateData.measured_litres = measured_litres;
    if (dip_date !== undefined) updateData.dip_date = dip_date;
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

// DELETE a dip — blocked while a shift is open
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    if (await hasOpenShift()) {
      return res.status(400).json({ success: false, error: 'Cannot delete a tank dip while a shift is open. Close the shift first.' });
    }
    await db('tank_dips').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
