import { Router } from 'express';
import db from '../database';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const status = req.query.status as string;
    let query = db('credits').orderBy('created_at', 'desc');
    if (status) query = query.where('status', status);
    const credits = await query;
    res.json({ success: true, data: credits });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const credit = await db('credits').where({ id: req.params.id }).first();
    if (!credit) return res.status(404).json({ success: false, error: 'Credit not found' });
    const payments = await db('credit_payments').where({ credit_id: credit.id }).orderBy('date', 'desc');
    res.json({ success: true, data: { ...credit, payments } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { customer_name, customer_phone, amount, shift_id, description } = req.body;
    const [id] = await db('credits').insert({
      customer_name, customer_phone, amount, balance: amount, shift_id, description, status: 'outstanding',
    });
    const credit = await db('credits').where({ id }).first();
    res.status(201).json({ success: true, data: credit });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST payment against a credit
router.post('/:id/payments', async (req, res) => {
  try {
    const { amount, payment_method, date, payment_date, notes } = req.body;
    const credit = await db('credits').where({ id: req.params.id }).first();
    if (!credit) return res.status(404).json({ success: false, error: 'Credit not found' });

    const resolvedDate = date || payment_date || new Date().toISOString().split('T')[0];
    const resolvedMethod = payment_method || 'cash';

    await db('credit_payments').insert({
      credit_id: credit.id, amount, payment_method: resolvedMethod, date: resolvedDate, notes,
      ...(credit.account_id ? { account_id: credit.account_id } : {}),
    });

    const newBalance = credit.balance - amount;
    const status = newBalance <= 0 ? 'paid' : 'partial';
    await db('credits').where({ id: credit.id }).update({ balance: Math.max(0, newBalance), status });

    // Auto-delete customer accounts when fully paid
    if (credit.account_id && status === 'paid') {
      const account = await db('credit_accounts').where({ id: credit.account_id }).first();
      if (account && account.type === 'customer') {
        const { total } = await db('credits')
          .where({ account_id: credit.account_id })
          .whereNot('status', 'paid')
          .sum('balance as total')
          .first() as any;
        if (!total || Number(total) === 0) {
          await db('credit_payments').where({ account_id: credit.account_id }).del();
          await db('credits').where({ account_id: credit.account_id }).del();
          await db('credit_accounts').where({ id: credit.account_id }).del();
        }
      }
    }

    const updated = await db('credits').where({ id: credit.id }).first();
    res.status(201).json({ success: true, data: updated || { id: credit.id, status: 'paid', balance: 0, deleted_with_account: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET summary by customer
router.get('/summary/by-customer', async (_req, res) => {
  try {
    const summary = await db('credits')
      .select('customer_name', 'customer_phone')
      .sum('amount as total_credit')
      .sum('balance as total_outstanding')
      .groupBy('customer_name', 'customer_phone')
      .orderBy('total_outstanding', 'desc');
    res.json({ success: true, data: summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
