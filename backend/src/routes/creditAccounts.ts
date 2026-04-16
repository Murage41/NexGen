import { Router } from 'express';
import db from '../database';
import { getKenyaDate } from '../utils/timezone';
import { requireAdmin } from '../middleware/requireAdmin';
import { recomputeAccountBalance } from '../services/accountBalance';

const router = Router();

// GET / - List all credit accounts with running balance
router.get('/', async (req, res) => {
  try {
    const type = req.query.type as string;

    let query = db('credit_accounts as ca').select(
      'ca.id',
      'ca.name',
      'ca.phone',
      'ca.type',
      'ca.employee_id',
      'ca.balance as outstanding_balance',
      'ca.created_at',
    );

    if (type) query = query.where('ca.type', type);

    query = query.orderBy('ca.balance', 'desc');

    const accounts = await query;
    res.json({ success: true, data: accounts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /:id - Get single account with all credits and payments
router.get('/:id', async (req, res) => {
  try {
    const account = await db('credit_accounts').where({ id: req.params.id }).first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });

    let credits: any[] = [];
    let payments: any[] = [];
    let debts: any[] = [];

    if (account.type === 'customer') {
      credits = await db('credits')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc');
      payments = await db('credit_payments')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .orderBy('date', 'desc');
    } else if (account.type === 'employee') {
      debts = await db('staff_debts')
        .where({ employee_id: account.employee_id })
        .orderBy('created_at', 'desc');
    }

    res.json({
      success: true,
      data: {
        ...account,
        outstanding_balance: Number(account.balance || 0),
        ...(account.type === 'customer' ? { credits, payments } : { debts }),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /:id/payments - Record a payment against the account balance
// Auto-settles outstanding credits FIFO (oldest first) for audit continuity.
router.post('/:id/payments', requireAdmin, async (req, res) => {
  try {
    const account = await db('credit_accounts').where({ id: req.params.id }).first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });

    if (account.type !== 'customer') {
      return res.status(400).json({
        success: false,
        error: 'Payments can only be recorded against customer accounts',
      });
    }

    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be positive' });
    }

    const currentBalance = Number(account.balance || 0);
    if (amount > currentBalance) {
      return res.status(400).json({
        success: false,
        error: `Payment amount (${amount}) exceeds account balance (${currentBalance}). Maximum payable: ${currentBalance}`,
      });
    }

    const paymentMethod = req.body.payment_method || 'cash';
    const paymentDate = req.body.date || req.body.payment_date || getKenyaDate();
    const notes = req.body.notes || null;

    const result = await db.transaction(async (trx) => {
      // 1. Record the payment against the account (credit_id is null — it's an account-level payment)
      const [paymentId] = await trx('credit_payments').insert({
        credit_id: null,
        account_id: account.id,
        amount,
        payment_method: paymentMethod,
        payment_type: 'account',
        date: paymentDate,
        notes,
      });

      // 2. Auto-settle outstanding credits FIFO so individual rows stay consistent.
      let remaining = amount;
      const openCredits = await trx('credits')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .whereNot('status', 'paid')
        .orderBy('created_at', 'asc');

      for (const credit of openCredits) {
        if (remaining <= 0) break;
        const creditBalance = Number(credit.balance);
        const apply = Math.min(remaining, creditBalance);
        const newBalance = creditBalance - apply;
        await trx('credits').where({ id: credit.id }).update({
          balance: Math.max(0, newBalance),
          status: newBalance <= 0 ? 'paid' : 'partial',
        });
        remaining -= apply;
      }

      // 3. Recompute account balance from source rows (Phase 1 stale-cache fix:
      //    replaces decrement pattern that risks drift over time)
      await recomputeAccountBalance(account.id, trx);

      const updatedAccount = await trx('credit_accounts').where({ id: account.id }).first();
      const payment = await trx('credit_payments').where({ id: paymentId }).first();
      return { account: updatedAccount, payment };
    });

    res.status(201).json({
      success: true,
      data: {
        ...result.account,
        outstanding_balance: Number(result.account.balance || 0),
        last_payment: result.payment,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /:id - Remove a customer account (only if balance = 0 and type = 'customer')
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const account = await db('credit_accounts').where({ id: req.params.id }).first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });

    if (account.type === 'employee') {
      return res.status(400).json({ success: false, error: 'Cannot delete employee credit accounts' });
    }

    if (Number(account.balance || 0) > 0) {
      return res.status(400).json({ success: false, error: 'Cannot delete account with outstanding balance' });
    }

    // Phase 7 fix: soft-delete to preserve audit trail (was hard-delete)
    const now = new Date().toISOString();
    await db.transaction(async (trx) => {
      await trx('credit_payments').where({ account_id: account.id }).update({ deleted_at: now });
      await trx('credits').where({ account_id: account.id }).update({ deleted_at: now, status: 'cancelled' });
      await trx('credit_accounts').where({ id: account.id }).update({ deleted_at: now });
    });

    res.json({ success: true, message: 'Account archived' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /:id/statement - Chronological list of all debits and credits
router.get('/:id/statement', async (req, res) => {
  try {
    const account = await db('credit_accounts').where({ id: req.params.id }).first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });

    let entries: Array<{
      date: string;
      description: string;
      debit_amount: number;
      credit_amount: number;
    }> = [];

    if (account.type === 'customer') {
      // Debits: credits added (money owed increases)
      const credits = await db('credits')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .select('created_at as date', 'description', 'amount')
        .orderBy('created_at', 'asc');

      for (const c of credits) {
        entries.push({
          date: c.date,
          description: c.description || 'Credit issued',
          debit_amount: Number(c.amount),
          credit_amount: 0,
        });
      }

      // Credits: payments made (money owed decreases)
      const payments = await db('credit_payments')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .select('date', 'notes', 'amount', 'payment_method', 'payment_type')
        .orderBy('date', 'asc');

      for (const p of payments) {
        const label = p.payment_type === 'account' ? 'Account payment' : 'Credit payment';
        entries.push({
          date: p.date,
          description: p.notes || `${label} (${p.payment_method})`,
          debit_amount: 0,
          credit_amount: Number(p.amount),
        });
      }
    } else if (account.type === 'employee') {
      // For employees, staff_debts are debits (deficit carried forward)
      const debts = await db('staff_debts')
        .where({ employee_id: account.employee_id })
        .select('created_at as date', 'original_deficit', 'deducted_from_wage', 'carried_forward', 'balance', 'status')
        .orderBy('created_at', 'asc');

      for (const d of debts) {
        if (Number(d.carried_forward) > 0) {
          entries.push({
            date: d.date,
            description: 'Shift deficit carried forward',
            debit_amount: Number(d.carried_forward),
            credit_amount: 0,
          });
        }
        if (Number(d.deducted_from_wage) > 0) {
          entries.push({
            date: d.date,
            description: 'Deducted from wage',
            debit_amount: 0,
            credit_amount: Number(d.deducted_from_wage),
          });
        }
      }
    }

    // Sort chronologically
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Compute running balance
    let running = 0;
    const statement = entries.map((entry) => {
      running = running + entry.debit_amount - entry.credit_amount;
      return { ...entry, running_balance: running };
    });

    res.json({ success: true, data: statement });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
