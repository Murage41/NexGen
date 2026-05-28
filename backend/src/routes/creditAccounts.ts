import { Router } from 'express';
import db from '../database';
import { getKenyaDate } from '../utils/timezone';
import { requireAdmin } from '../middleware/requireAdmin';
import { recomputeAccountBalance } from '../services/accountBalance';

const router = Router();

function excludeOpenShiftCredits(query: any, trx: any) {
  query.where(function (this: any) {
    this.whereNull('shift_id')
      .orWhereNotIn('shift_id', trx('shifts').select('id').where({ status: 'open' }));
  });
}

// GET / - List all credit accounts with running balance
router.get('/', async (req, res) => {
  try {
    const type = req.query.type as string;

    const billingMode = req.query.billing_mode as string;

    let query = db('credit_accounts as ca')
      .whereNull('ca.deleted_at')
      .select(
      'ca.id',
      'ca.name',
      'ca.phone',
      'ca.type',
      'ca.billing_mode',
      'ca.employee_id',
      'ca.balance as outstanding_balance',
      'ca.created_at',
    );

    if (type) query = query.where('ca.type', type);
    if (billingMode) query = query.where('ca.billing_mode', billingMode);

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
    const account = await db('credit_accounts').where({ id: req.params.id }).whereNull('deleted_at').first();
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

// POST / - Create a new customer credit account (admin)
// Used primarily to onboard invoice-mode customers like Diwafa before their
// first fuel-up. Money-mode accounts are still auto-created on shift credits.
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, phone, billing_mode } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    const mode = billing_mode === 'invoice' ? 'invoice' : 'money';

    const [id] = await db('credit_accounts').insert({
      name: name.trim(),
      phone: phone || null,
      type: 'customer',
      billing_mode: mode,
      balance: 0,
    });
    const account = await db('credit_accounts').where({ id }).first();
    res.status(201).json({ success: true, data: account });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /:id - Update name, phone, or billing_mode (customer accounts only)
// Safety rules on mode switch:
//   money → invoice: blocked if any credits exist on this account
//     (mixing models on history is confusing; open a new account instead)
//   invoice → money: blocked if unbilled invoice_consumption or unpaid
//     customer_invoices exist on this account
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const account = await db('credit_accounts').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });
    if (account.type !== 'customer') {
      return res.status(400).json({ success: false, error: 'Only customer accounts are editable here' });
    }

    const { name, phone, billing_mode } = req.body;
    const update: any = {};
    if (name !== undefined) update.name = String(name).trim();
    if (phone !== undefined) update.phone = phone || null;

    if (billing_mode !== undefined && billing_mode !== account.billing_mode) {
      if (billing_mode !== 'money' && billing_mode !== 'invoice') {
        return res.status(400).json({ success: false, error: "billing_mode must be 'money' or 'invoice'" });
      }

      if (billing_mode === 'invoice') {
        // Allow flip only if the money balance is fully settled. Historical
        // fully-paid credits remain as read-only audit trail.
        if (Number(account.balance || 0) > 0) {
          return res.status(400).json({
            success: false,
            error: `Cannot switch to invoice mode: account has an outstanding money balance of KES ${Number(account.balance).toFixed(2)}. Settle it or create a new account.`,
          });
        }
      } else {
        // invoice → money
        const unbilled = await db('invoice_consumption')
          .where({ account_id: account.id })
          .whereNull('deleted_at')
          .whereNull('invoice_line_id')
          .count('* as c')
          .first();
        if (Number((unbilled as any)?.c || 0) > 0) {
          return res.status(400).json({
            success: false,
            error: 'Cannot switch to money mode: unbilled invoice consumption exists. Invoice or clear those first.',
          });
        }
        const unpaidInv = await db('customer_invoices')
          .where({ account_id: account.id })
          .whereNull('deleted_at')
          .whereIn('status', ['draft', 'issued', 'partial'])
          .count('* as c')
          .first();
        if (Number((unpaidInv as any)?.c || 0) > 0) {
          return res.status(400).json({
            success: false,
            error: 'Cannot switch to money mode: unpaid customer invoices exist. Clear them first.',
          });
        }
      }
      update.billing_mode = billing_mode;
    }

    if (Object.keys(update).length > 0) {
      await db('credit_accounts').where({ id: account.id }).update(update);
    }

    const updated = await db('credit_accounts').where({ id: account.id }).first();
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /:id/payments - Record a payment against the account balance
// Auto-settles outstanding credits FIFO (oldest first) for audit continuity.
router.post('/:id/payments', requireAdmin, async (req, res) => {
  try {
    const account = await db('credit_accounts').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });

    if (account.type !== 'customer') {
      return res.status(400).json({
        success: false,
        error: 'Payments can only be recorded against customer accounts',
      });
    }

    if ((account.billing_mode || 'money') !== 'money') {
      return res.status(400).json({
        success: false,
        error: `Account "${account.name}" is invoice-mode. Use customer invoice payments instead.`,
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
      const openCredits = await trx('credits')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .whereNot('status', 'paid')
        .where('balance', '>', 0)
        .modify((query: any) => excludeOpenShiftCredits(query, trx))
        .orderBy('created_at', 'asc');
      const eligibleBalance = Math.round(
        openCredits.reduce((sum: number, credit: any) => sum + Number(credit.balance || 0), 0) * 100,
      ) / 100;

      if (amount > eligibleBalance) {
        throw Object.assign(
          new Error(
            eligibleBalance > 0
              ? `Payment amount (${amount}) exceeds closed-shift debt (${eligibleBalance}). Credits issued in open shifts can be paid after their shifts are closed.`
              : 'This account only has open-shift credit. Close the shift before recording a payment against it.',
          ),
          { http: 400 },
        );
      }
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
    console.error('[creditAccounts:payment] ERROR', err.message, err.stack);
    res.status(err.http || 500).json({ success: false, error: err.message });
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
    const account = await db('credit_accounts').where({ id: req.params.id }).whereNull('deleted_at').first();
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
