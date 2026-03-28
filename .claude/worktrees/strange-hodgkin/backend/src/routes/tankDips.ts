import { Router } from 'express';
import db from '../database';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const tank_id = req.query.tank_id;
    let query = db('tank_dips')
      .join('tanks', 'tank_dips.tank_id', 'tanks.id')
      .select('tank_dips.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .orderBy('tank_dips.timestamp', 'desc');
    if (tank_id) query = query.where('tank_dips.tank_id', tank_id);
    const dips = await query;
    res.json({ success: true, data: dips });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { tank_id, measured_litres } = req.body;
    const [id] = await db('tank_dips').insert({ tank_id, measured_litres });
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

export default router;
