import { Router } from 'express';
import db from '../database';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = db('fuel_deliveries')
      .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
      .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .orderBy('fuel_deliveries.date', 'desc');
    if (from) query = query.where('fuel_deliveries.date', '>=', from);
    if (to) query = query.where('fuel_deliveries.date', '<=', to);
    const deliveries = await query;
    res.json({ success: true, data: deliveries });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { tank_id, supplier, litres, cost_per_litre, date } = req.body;
    const total_cost = litres * cost_per_litre;
    const [id] = await db('fuel_deliveries').insert({ tank_id, supplier, litres, cost_per_litre, total_cost, date });
    const delivery = await db('fuel_deliveries')
      .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
      .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .where('fuel_deliveries.id', id)
      .first();
    res.status(201).json({ success: true, data: delivery });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db('fuel_deliveries').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
