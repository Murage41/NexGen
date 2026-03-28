import { Router } from 'express';
import db from '../database';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const prices = await db('fuel_prices').orderBy('effective_date', 'desc');
    res.json({ success: true, data: prices });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET current prices (latest per fuel type)
router.get('/current', async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const petrol = await db('fuel_prices')
      .where('fuel_type', 'petrol')
      .where('effective_date', '<=', today)
      .orderBy('effective_date', 'desc')
      .first();
    const diesel = await db('fuel_prices')
      .where('fuel_type', 'diesel')
      .where('effective_date', '<=', today)
      .orderBy('effective_date', 'desc')
      .first();
    res.json({ success: true, data: { petrol, diesel } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { fuel_type, price_per_litre, effective_date } = req.body;
    const [id] = await db('fuel_prices').insert({ fuel_type, price_per_litre, effective_date });
    const price = await db('fuel_prices').where({ id }).first();
    res.status(201).json({ success: true, data: price });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db('fuel_prices').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
