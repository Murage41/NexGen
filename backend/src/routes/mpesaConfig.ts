import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

// GET all fee configs (history)
router.get('/', async (_req, res) => {
  try {
    const configs = await db('mpesa_fee_config').orderBy('effective_date', 'desc');
    res.json({ success: true, data: configs });
  } catch (err: any) {
    console.error('[mpesaConfig:list] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET current effective fee config
router.get('/current', async (_req, res) => {
  try {
    const today = getKenyaDate();
    const current = await db('mpesa_fee_config')
      .where('effective_date', '<=', today)
      .orderBy('effective_date', 'desc')
      .first();
    res.json({ success: true, data: current || null });
  } catch (err: any) {
    console.error('[mpesaConfig:get-current] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST a new fee config (admin only) — preserves history
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { fee_type, fee_value, effective_date, notes } = req.body;
    if (fee_value === undefined || fee_value === null || isNaN(Number(fee_value))) {
      return res.status(400).json({ success: false, error: 'fee_value is required and must be numeric' });
    }
    if (Number(fee_value) < 0 || Number(fee_value) > 100) {
      return res.status(400).json({ success: false, error: 'fee_value must be between 0 and 100' });
    }
    if (!effective_date || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) {
      return res.status(400).json({ success: false, error: 'effective_date must be YYYY-MM-DD' });
    }
    const [id] = await db('mpesa_fee_config').insert({
      fee_type: fee_type || 'percentage',
      fee_value,
      effective_date,
      notes: notes || null,
    });
    const row = await db('mpesa_fee_config').where({ id }).first();
    res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    console.error('[mpesaConfig:create] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
