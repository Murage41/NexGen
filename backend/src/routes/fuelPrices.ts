import { Router } from 'express';
import db from '../database';
import { getKenyaDate } from '../utils/timezone';

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
    const today = getKenyaDate();
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

// PUT update price for a fuel type (creates new history row)
router.put('/:fuel_type', async (req, res) => {
  try {
    const { price_per_litre, effective_date } = req.body;
    const fuel_type = req.params.fuel_type;
    if (!price_per_litre || !effective_date) {
      return res.status(400).json({ success: false, error: 'price_per_litre and effective_date are required' });
    }
    // Always insert a new row to preserve history
    const [id] = await db('fuel_prices').insert({ fuel_type, price_per_litre, effective_date });
    const price = await db('fuel_prices').where({ id }).first();
    res.json({ success: true, data: price });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
