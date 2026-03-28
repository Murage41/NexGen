import { Router } from 'express';
import db from '../database';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { from, to, category } = req.query;
    let query = db('expenses').orderBy('date', 'desc');
    if (from) query = query.where('date', '>=', from);
    if (to) query = query.where('date', '<=', to);
    if (category) query = query.where('category', category);
    const expenses = await query;
    res.json({ success: true, data: expenses });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { category, description, amount, date } = req.body;
    const [id] = await db('expenses').insert({ category, description, amount, date });
    const expense = await db('expenses').where({ id }).first();
    res.status(201).json({ success: true, data: expense });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { category, description, amount, date } = req.body;
    await db('expenses').where({ id: req.params.id }).update({ category, description, amount, date });
    const expense = await db('expenses').where({ id: req.params.id }).first();
    res.json({ success: true, data: expense });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db('expenses').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET categories (distinct)
router.get('/categories', async (_req, res) => {
  try {
    const rows = await db('expenses').distinct('category').orderBy('category');
    res.json({ success: true, data: rows.map((r: any) => r.category) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
