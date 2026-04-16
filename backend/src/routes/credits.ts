import { Router } from 'express';
import db from '../database';
import { validate } from '../middleware/validate';
import { createCreditSchema, creditPaymentSchema } from '../schemas';
import { getKenyaDate } from '../utils/timezone';
import { recomputeAccountBalance } from '../services/accountBalance';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const status = req.query.status as string;
    let query = db('credits').whereNull('deleted_at').orderBy('created_at', 'desc');
    if (status) query = query.where('status', status);
    const credits = await query;
    res.json({ success: true, data: credits });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const credit = await db('credits').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!credit) return res.status(404).json({ success: false, error: 'Credit not found' });
    const payments = await db('credit_payments').where({ credit_id: credit.id }).whereNull('deleted_at').orderBy('date', 'desc');
    res.json({ success: true, data: { ...credit, payments } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', validate(createCreditSchema), async (req, res) => {
  try {
    const { customer_name, customer_phone, amount, shift_id, description } = req.body;

    const credit = await db.transaction(async (trx) => {
      // 1. Create credit row
      const [id] = await trx('credits').insert({
        customer_name, customer_phone, amount, balance: amount, shift_id, description, status: 'outstanding',
      });

      // 2. Find or create credit_account and sync balance
      let account = await trx('credit_accounts')
        .where({ name: customer_name, type: 'customer' })
        .first();
      if (!account) {
        const [accountId] = await trx('credit_accounts').insert({
          name: customer_name, phone: customer_phone || null,
          type: 'customer', balance: 0,
        });
        account = { id: accountId };
      }

      // 3. Link credit to account + recompute balance from source rows
      // (Phase 1 stale-cache fix: replaces increment pattern that risks drift)
      await trx('credits').where({ id }).update({ account_id: account.id });
      await recomputeAccountBalance(account.id, trx);

      return trx('credits').where({ id }).first();
    });

    res.status(201).json({ success: true, data: credit });
  } catch (err: any) {
    console.error('[credits:create] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST payment against a credit (LEGACY — prefer POST /credit-accounts/:id/payments)
// Kept for backwards compatibility. Internally also decrements the account balance
// so both paths produce consistent state.
router.post('/:id/payments', validate(creditPaymentSchema), async (req, res) => {
  try {
    const { amount, payment_method, date, payment_date, notes } = req.body;
    const credit = await db('credits').where({ id: req.params.id }).first();
    if (!credit) return res.status(404).json({ success: false, error: 'Credit not found' });

    if (amount > credit.balance) {
      return res.status(400).json({
        success: false,
        error: `Payment amount (${amount}) exceeds outstanding balance (${credit.balance}). Maximum payable: ${credit.balance}`,
      });
    }

    const resolvedDate = date || payment_date || getKenyaDate();
    const resolvedMethod = payment_method || 'cash';

    const updated = await db.transaction(async (trx) => {
      await trx('credit_payments').insert({
        credit_id: credit.id,
        amount,
        payment_method: resolvedMethod,
        payment_type: 'credit',
        date: resolvedDate,
        notes,
        ...(credit.account_id ? { account_id: credit.account_id } : {}),
      });

      const newBalance = credit.balance - amount;
      const status = newBalance <= 0 ? 'paid' : 'partial';
      await trx('credits').where({ id: credit.id }).update({ balance: Math.max(0, newBalance), status });

      // Keep credit_accounts.balance in sync (Phase 1 stale-cache fix:
      // recompute from source rows rather than decrement)
      if (credit.account_id) {
        await recomputeAccountBalance(credit.account_id, trx);
      }

      return trx('credits').where({ id: credit.id }).first();
    });

    res.status(201).json({ success: true, data: updated });
  } catch (err: any) {
    console.error('[credits:payment] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET summary by customer
router.get('/summary/by-customer', async (_req, res) => {
  try {
    const summary = await db('credits')
      .whereNull('deleted_at')
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
