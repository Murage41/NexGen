import { Router } from 'express';
import db from '../database';

const router = Router();

// GET / - List all credit accounts with running balance
router.get('/', async (req, res) => {
  try {
    const type = req.query.type as string;

    let query = db('credit_accounts as ca')
      .select(
        'ca.id',
        'ca.name',
        'ca.phone',
        'ca.type',
        'ca.employee_id',
        'ca.created_at',
      );

    if (type) query = query.where('ca.type', type);

    // For customer accounts: outstanding = SUM(credits.balance) where status != 'paid'
    // For employee accounts: outstanding = SUM(staff_debts.balance) where status = 'outstanding'
    query = query.select(
      db.raw(`
        CASE ca.type
          WHEN 'customer' THEN COALESCE((
            SELECT SUM(c.balance) FROM credits c
            WHERE c.account_id = ca.id AND c.status != 'paid'
          ), 0)
          WHEN 'employee' THEN COALESCE((
            SELECT SUM(sd.balance) FROM staff_debts sd
            WHERE sd.employee_id = ca.employee_id AND sd.status = 'outstanding'
          ), 0)
          ELSE 0
        END as outstanding_balance
      `)
    );

    query = query.orderBy('outstanding_balance', 'desc');

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
      credits = await db('credits').where({ account_id: account.id }).orderBy('created_at', 'desc');
      payments = await db('credit_payments').where({ account_id: account.id }).orderBy('date', 'desc');
    } else if (account.type === 'employee') {
      debts = await db('staff_debts').where({ employee_id: account.employee_id }).orderBy('created_at', 'desc');
    }

    // Compute outstanding balance
    let outstanding_balance = 0;
    if (account.type === 'customer') {
      const result = await db('credits')
        .where({ account_id: account.id })
        .whereNot('status', 'paid')
        .sum('balance as total')
        .first();
      outstanding_balance = result?.total || 0;
    } else if (account.type === 'employee') {
      const result = await db('staff_debts')
        .where({ employee_id: account.employee_id, status: 'outstanding' })
        .sum('balance as total')
        .first();
      outstanding_balance = result?.total || 0;
    }

    res.json({
      success: true,
      data: {
        ...account,
        outstanding_balance,
        ...(account.type === 'customer' ? { credits, payments } : { debts }),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /:id - Remove a customer account (only if balance = 0 and type = 'customer')
router.delete('/:id', async (req, res) => {
  try {
    const account = await db('credit_accounts').where({ id: req.params.id }).first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });

    if (account.type === 'employee') {
      return res.status(400).json({ success: false, error: 'Cannot delete employee credit accounts' });
    }

    // Check outstanding balance
    const result = await db('credits')
      .where({ account_id: account.id })
      .whereNot('status', 'paid')
      .sum('balance as total')
      .first();
    const outstanding = result?.total || 0;

    if (outstanding > 0) {
      return res.status(400).json({ success: false, error: 'Cannot delete account with outstanding balance' });
    }

    // Delete associated records then the account
    await db.transaction(async (trx) => {
      await trx('credit_payments').where({ account_id: account.id }).del();
      await trx('credits').where({ account_id: account.id, balance: 0 }).del();
      await trx('credit_accounts').where({ id: account.id }).del();
    });

    res.json({ success: true, message: 'Account deleted' });
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
        .select('date', 'notes', 'amount', 'payment_method')
        .orderBy('date', 'asc');

      for (const p of payments) {
        entries.push({
          date: p.date,
          description: p.notes || `Payment (${p.payment_method})`,
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
        // Debit: the carried_forward amount (added to running debt)
        if (Number(d.carried_forward) > 0) {
          entries.push({
            date: d.date,
            description: 'Shift deficit carried forward',
            debit_amount: Number(d.carried_forward),
            credit_amount: 0,
          });
        }
        // Credit: the deducted_from_wage amount (reduced from debt)
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
