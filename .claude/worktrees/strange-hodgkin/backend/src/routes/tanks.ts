import { Router } from 'express';
import db from '../database';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const tanks = await db('tanks').orderBy('label');
    res.json({ success: true, data: tanks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const tank = await db('tanks').where({ id: req.params.id }).first();
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });
    res.json({ success: true, data: tank });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { label, fuel_type, capacity_litres } = req.body;
    const [id] = await db('tanks').insert({ label, fuel_type, capacity_litres });
    const tank = await db('tanks').where({ id }).first();
    res.status(201).json({ success: true, data: tank });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { label, fuel_type, capacity_litres } = req.body;
    await db('tanks').where({ id: req.params.id }).update({ label, fuel_type, capacity_litres });
    const tank = await db('tanks').where({ id: req.params.id }).first();
    res.json({ success: true, data: tank });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db('tanks').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
