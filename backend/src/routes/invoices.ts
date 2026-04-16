import { Router } from 'express';
import db from '../database';
import { getKenyaDate } from '../utils/timezone';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const status = req.query.status as string;
    let query = db('invoices')
      .join('credits', 'invoices.credit_id', 'credits.id')
      .select('invoices.*', 'credits.customer_name')
      .orderBy('invoices.date', 'desc');
    if (status) query = query.where('invoices.status', status);
    const invoices = await query;
    res.json({ success: true, data: invoices });
  } catch (err: any) {
    console.error('[invoices:list] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const invoice = await db('invoices')
      .join('credits', 'invoices.credit_id', 'credits.id')
      .select('invoices.*', 'credits.customer_name', 'credits.customer_phone', 'credits.description as credit_description')
      .where('invoices.id', req.params.id)
      .first();
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    console.error('[invoices:get] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Phase 5 fix: require admin for invoice creation
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { credit_id, amount, date } = req.body;
    // Generate invoice number: INV-YYYYMMDD-XXX
    const today = (date || getKenyaDate()).replace(/-/g, '');
    const count = await db('invoices').where('invoice_number', 'like', `INV-${today}%`).count('* as c').first();
    const seq = String(((count as any).c || 0) + 1).padStart(3, '0');
    const invoice_number = `INV-${today}-${seq}`;

    const [id] = await db('invoices').insert({ credit_id, invoice_number, amount, date: date || getKenyaDate(), status: 'unpaid' });
    const invoice = await db('invoices')
      .join('credits', 'invoices.credit_id', 'credits.id')
      .select('invoices.*', 'credits.customer_name')
      .where('invoices.id', id)
      .first();
    res.status(201).json({ success: true, data: invoice });
  } catch (err: any) {
    console.error('[invoices:create] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Phase 5 fix: require admin for invoice status change
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    await db('invoices').where({ id: req.params.id }).update({ status });
    const invoice = await db('invoices').where({ id: req.params.id }).first();
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    console.error('[invoices:update] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
