import { Router } from 'express';
import db from '../database';
import { employeeDebtHistory } from '../services/employeePay';
import { getKenyaDate } from '../utils/timezone';
import { requireAdmin, requireAuth } from '../middleware/requireAdmin';
import {
  customerCreditBalance,
  paymentHttpStatus,
  recordMoneyAccountPayment,
  refundCustomerCredit,
  roundMoney,
} from '../services/receivablePayments';
import { validate } from '../middleware/validate';
import { createCreditAccountSchema, updateCreditAccountSchema } from '../schemas';
import { evaluateCreditLimits } from '../services/creditLimits';
import { approvalBindings, resolveApprover } from '../services/approval';
import { normalizeIdempotencyKey, runIdempotent } from '../services/idempotency';

const router = Router();
router.use(requireAuth);

const hasLimits = (account: any) => account.credit_limit != null || account.credit_age_limit_days != null;

// Shift credit entry still matches customers by name for cached clients, so two
// customers may not share a name (ignoring case and surrounding spaces).
async function nameTaken(name: string, exceptId: number | null = null) {
  const clash = await db('credit_accounts')
    .where({ type: 'customer' })
    .whereNull('deleted_at')
    .whereRaw('LOWER(TRIM(name)) = ?', [name.trim().toLowerCase()])
    .modify((q) => { if (exceptId) q.whereNot({ id: exceptId }); })
    .first('id');
  return Boolean(clash);
}

// GET / - List all credit accounts with running balance
router.get('/', async (req, res) => {
  try {
    const type = (req as any).employee?.role === 'admin' ? req.query.type as string : 'customer';

    const billingMode = req.query.billing_mode as string;

    let query = db('credit_accounts as ca')
      .whereNull('ca.deleted_at')
      .select(
      'ca.id',
      'ca.name',
      'ca.phone',
      'ca.type',
      'ca.billing_mode',
      'ca.payment_terms_days',
      'ca.employee_id',
      'ca.balance as outstanding_balance',
      'ca.created_at',
      'ca.kra_pin',
      'ca.credit_limit',
      'ca.credit_age_limit_days',
    );

    if (type) query = query.where('ca.type', type);
    if (billingMode) query = query.where('ca.billing_mode', billingMode);

    query = query.orderBy('ca.balance', 'desc');

    const accounts = await query;
    const isAdmin = (req as any).employee?.role === 'admin';
    // Credit held on account after a closed-shift correction (receivablePayments.ts).
    const heldRows = await db('credit_payments')
      .where({ status: 'posted' })
      .whereNull('deleted_at')
      .where('unapplied_amount', '>', 0)
      .groupBy('account_id')
      .select('account_id')
      .sum({ total: 'unapplied_amount' });
    const held = new Map(heldRows.map((row: any) => [Number(row.account_id), roundMoney(Number(row.total || 0))]));
    for (const account of accounts) {
      account.credit_on_account = held.get(Number(account.id)) || 0;
      // Limit status only for customers that have limits; everyone else has no
      // rule to report, and shift screens load this list on every visit.
      if (account.type === 'customer' && hasLimits(account)) {
        account.credit_check = await evaluateCreditLimits(account, 0, db);
      }
      // A tax identifier isn't needed to serve a customer at the pump.
      if (!isAdmin) delete account.kra_pin;
    }
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
    if ((req as any).employee?.role !== 'admin' && account.type === 'employee' && Number(account.employee_id) !== Number((req as any).employee?.id)) return res.status(403).json({ success: false, error: 'You may only view your own employee account.' });

    let credits: any[] = [];
    let payments: any[] = [];
    let debts: any[] = [];
    let debtHistory: any[] = [];
    let debtReviews: any[] = [];
    let customerInvoices: any[] = [];

    if (account.type === 'customer' && account.billing_mode === 'invoice') {
      customerInvoices = await db('customer_invoices')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .orderBy('id', 'desc');
      payments = await db('invoice_payments')
        .where({ account_id: account.id })
        .orderBy('payment_date', 'desc')
        .orderBy('id', 'desc');
    } else if (account.type === 'customer') {
      credits = await db('credits')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc');
      payments = await db('credit_payments')
        .where({ account_id: account.id, status: 'posted' })
        .whereNull('deleted_at')
        .orderBy('date', 'desc');
    } else if (account.type === 'employee') {
      const history = await employeeDebtHistory(Number(account.employee_id), db);
      debts = history.debts;
      debtHistory = history.history;
      debtReviews = history.reviews;
    }

    let creditCheck = null;
    let limitOverrides: any[] = [];
    let creditOnAccount = 0;
    let refunds: any[] = [];
    const isAdmin = (req as any).employee?.role === 'admin';
    if (account.type === 'customer' && account.billing_mode !== 'invoice') {
      creditOnAccount = await customerCreditBalance(Number(account.id), db);
      refunds = await db('customer_refunds')
        .where({ account_id: account.id })
        .orderBy('refund_date', 'desc')
        .orderBy('id', 'desc');
    }
    if (!isAdmin) delete account.kra_pin;
    if (account.type === 'customer') {
      creditCheck = await evaluateCreditLimits(account, 0, db);
      // Who approved which override is for administrators.
      if (isAdmin) limitOverrides = (await db('credit_limit_overrides as o')
        .leftJoin('employees as recorder', 'recorder.id', 'o.recorded_by_employee_id')
        .where('o.account_id', account.id)
        .orderBy('o.created_at', 'desc')
        .orderBy('o.id', 'desc')
        .limit(50)
        .select('o.*', 'recorder.name as recorded_by_name'))
        .map((row: any) => ({ ...row, breaches: JSON.parse(row.breaches || '[]') }));
    }

    res.json({
      success: true,
      data: {
        ...account,
        outstanding_balance: Number(account.balance || 0),
        ...(account.type === 'customer'
          ? { credits, payments, customer_invoices: customerInvoices, credit_check: creditCheck, limit_overrides: limitOverrides, credit_on_account: creditOnAccount, refunds }
          : { debts, debt_history: debtHistory, debt_reviews: debtReviews }),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST / - Create a new customer credit account (admin)
// The only way customers come into existence: shift credit entry is
// select-only. Limits are optional; blank means no rule.
router.post('/', requireAdmin, validate(createCreditAccountSchema), async (req, res) => {
  try {
    const { name, phone, kra_pin, billing_mode, payment_terms_days, credit_limit, credit_age_limit_days } = req.body;
    if (await nameTaken(name)) {
      return res.status(409).json({ success: false, error: `A customer named "${name}" already exists.` });
    }

    const [id] = await db('credit_accounts').insert({
      name,
      phone,
      kra_pin: kra_pin ?? null,
      type: 'customer',
      billing_mode,
      // Money credits fall due the day they're given; terms apply to invoices.
      payment_terms_days: billing_mode === 'invoice' ? payment_terms_days : 0,
      credit_limit: credit_limit ?? null,
      credit_age_limit_days: credit_age_limit_days ?? null,
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
router.put('/:id', requireAdmin, validate(updateCreditAccountSchema), async (req, res) => {
  try {
    const account = await db('credit_accounts').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!account) return res.status(404).json({ success: false, error: 'Credit account not found' });
    if (account.type !== 'customer') {
      return res.status(400).json({ success: false, error: 'Only customer accounts are editable here' });
    }

    const { name, phone, kra_pin, billing_mode, payment_terms_days, credit_limit, credit_age_limit_days } = req.body;
    const update: any = {};
    if (name !== undefined && name !== account.name) {
      if (await nameTaken(name, account.id)) {
        return res.status(409).json({ success: false, error: `A customer named "${name}" already exists.` });
      }
      update.name = name;
    }
    if (phone !== undefined) {
      // Customers from before phones were required may be edited without one,
      // but a number on file can be changed, not removed.
      if (!phone && account.phone) {
        return res.status(400).json({ success: false, error: 'phone is required' });
      }
      update.phone = phone || null;
    }
    if (kra_pin !== undefined) update.kra_pin = kra_pin;
    if (credit_limit !== undefined) update.credit_limit = credit_limit;
    if (credit_age_limit_days !== undefined) update.credit_age_limit_days = credit_age_limit_days;
    if (payment_terms_days !== undefined) update.payment_terms_days = payment_terms_days;

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
      if (billing_mode === 'money') update.payment_terms_days = 0;
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
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be positive' });
    }

    const paymentMethod = req.body.payment_method || 'cash';
    const paymentDate = req.body.date || req.body.payment_date || getKenyaDate();
    const notes = req.body.notes || null;

    const result = await recordMoneyAccountPayment(db, {
      accountId: Number(req.params.id),
      amount,
      paymentMethod,
      paymentDate,
      notes,
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
    res.status(paymentHttpStatus(err)).json({ success: false, error: err.message });
  }
});

// POST /:id/refunds - pay a customer back credit they hold on account.
// Body: { amount, method: 'cash'|'mpesa', date?, reference?, approval_token? }.
// An administrator approves: their own session, or a PIN token on the desktop.
router.post('/:id/refunds', requireAdmin, async (req: any, res) => {
  try {
    const accountId = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const method = String(req.body?.method || '');
    const sessionEmployeeId = Number(req.employee?.id) > 0 ? Number(req.employee.id) : null;
    const result = await runIdempotent(
      db,
      { scope: `customer-refund:${accountId}`, key: normalizeIdempotencyKey(req.get('Idempotency-Key')), payload: req.body },
      async (trx) => {
        const approver = await resolveApprover(
          sessionEmployeeId,
          req.body?.approval_token,
          approvalBindings.customer_refund({ account_id: accountId, method, amount }),
          trx,
        );
        const refund = await refundCustomerCredit(trx, {
          accountId,
          amount,
          method,
          date: req.body?.date || null,
          reference: req.body?.reference || null,
          approver,
          recordedBy: sessionEmployeeId,
        });
        return { status: 201, body: { success: true, data: refund } };
      },
    );
    res.status(result.status).json(result.body);
  } catch (err: any) {
    res.status(err.http || err.httpStatus || paymentHttpStatus(err)).json({ success: false, error: err.message, code: err.code });
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
    const held = await customerCreditBalance(Number(account.id), db);
    if (held > 0) {
      return res.status(400).json({
        success: false,
        error: `${account.name} holds KES ${held.toFixed(2)} in credit. Refund it before removing the account.`,
      });
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
    if ((req as any).employee?.role !== 'admin' && account.type === 'employee' && Number(account.employee_id) !== Number((req as any).employee?.id)) return res.status(403).json({ success: false, error: 'You may only view your own employee statement.' });

    let entries: Array<{
      date: string;
      description: string;
      debit_amount: number;
      credit_amount: number;
    }> = [];

    if (account.type === 'customer' && account.billing_mode === 'invoice') {
      const events = await db('invoice_accounting_events as event')
        .leftJoin('customer_invoices as invoice', 'event.invoice_id', 'invoice.id')
        .leftJoin('invoice_adjustment_notes as note', 'event.adjustment_note_id', 'note.id')
        .where('event.account_id', account.id)
        .select(
          'event.posting_date as date',
          'event.event_type',
          'event.receivable_delta',
          'event.reason',
          'invoice.invoice_number',
          'note.note_number',
        )
        .orderBy('event.posting_date', 'asc')
        .orderBy('event.id', 'asc');
      for (const event of events as any[]) {
        const delta = Number(event.receivable_delta || 0);
        const documentNumber = event.note_number || event.invoice_number;
        const label = String(event.event_type || 'invoice event').replace(/_/g, ' ');
        entries.push({
          date: event.date,
          description: event.reason || `${label}${documentNumber ? ` (${documentNumber})` : ''}`,
          debit_amount: delta > 0 ? delta : 0,
          credit_amount: delta < 0 ? Math.abs(delta) : 0,
        });
      }
    } else if (account.type === 'customer') {
      // Debits: credits added (money owed increases). A credit a closed-shift
      // correction reversed keeps its line, and the reversal gets its own on
      // the day it was posted, so an earlier statement never changes.
      const credits = await db('credits')
        .leftJoin('shift_accountability_adjustments as correction', 'credits.reversed_by_correction_id', 'correction.id')
        .where('credits.account_id', account.id)
        .where((q) => q.whereNull('credits.deleted_at').orWhereNotNull('credits.reversed_by_correction_id'))
        .select(
          'credits.created_at as date',
          'credits.description',
          'credits.amount',
          'credits.shift_id',
          'credits.correction_of_id',
          'credits.reversed_at',
          'credits.reversed_by_correction_id',
          'correction.reason as correction_reason',
        )
        .orderBy('credits.created_at', 'asc');

      for (const c of credits) {
        entries.push({
          date: c.date,
          description: c.correction_of_id
            ? `Corrected credit, shift #${c.shift_id}${c.description ? ` (${c.description})` : ''}`
            : c.description || 'Credit issued',
          debit_amount: Number(c.amount),
          credit_amount: 0,
        });
        if (c.reversed_by_correction_id) {
          entries.push({
            date: c.reversed_at,
            description: `Correction #${c.reversed_by_correction_id}: ${c.correction_reason || 'credit reversed'}`,
            debit_amount: 0,
            credit_amount: Number(c.amount),
          });
        }
      }

      // Credits: payments made (money owed decreases)
      const payments = await db('credit_payments')
        .leftJoin('shift_accountability_adjustments as correction', 'credit_payments.reversed_by_correction_id', 'correction.id')
        .where('credit_payments.account_id', account.id)
        .whereNull('credit_payments.deleted_at')
        .where((q) => q.where('credit_payments.status', 'posted').orWhereNotNull('credit_payments.reversed_by_correction_id'))
        .select(
          'credit_payments.date',
          'credit_payments.notes',
          'credit_payments.amount',
          'credit_payments.payment_method',
          'credit_payments.payment_type',
          'credit_payments.correction_of_id',
          'credit_payments.reversed_at',
          'credit_payments.reversed_by_correction_id',
          'correction.reason as correction_reason',
        )
        .orderBy('credit_payments.date', 'asc');

      for (const p of payments) {
        const label = p.payment_type === 'account' ? 'Account payment' : 'Credit payment';
        entries.push({
          date: p.date,
          description: p.correction_of_id
            ? `Corrected payment (${p.payment_method})`
            : p.notes || `${label} (${p.payment_method})`,
          debit_amount: 0,
          credit_amount: Number(p.amount),
        });
        if (p.reversed_by_correction_id) {
          entries.push({
            date: p.reversed_at,
            description: `Correction #${p.reversed_by_correction_id}: ${p.correction_reason || 'payment reversed'}`,
            debit_amount: Number(p.amount),
            credit_amount: 0,
          });
        }
      }

      // Credit held on account that was paid back to the customer.
      const refunds = await db('customer_refunds')
        .where({ account_id: account.id, status: 'posted' })
        .orderBy('refund_date', 'asc');
      for (const r of refunds) {
        entries.push({
          date: r.refund_date,
          description: `Refund of credit on account (${r.method === 'mpesa' ? 'M-Pesa' : 'cash'})${r.reference ? `: ${r.reference}` : ''}`,
          debit_amount: Number(r.amount),
          credit_amount: 0,
        });
      }
    } else if (account.type === 'employee') {
      const data = await employeeDebtHistory(Number(account.employee_id), db);
      for (const debt of data.debts) {
        entries.push({ date: debt.created_at, description: debt.created_by_correction_id ? `Correction #${debt.created_by_correction_id}: shortage added for shift #${debt.shift_id}` : `Shift #${debt.shift_id} deficit carried forward`, debit_amount: Number(debt.carried_forward), credit_amount: 0 });
        if (debt.historical_adjustment) entries.push({ date: debt.created_at, description: `Historical corrections / settlements for shift #${debt.shift_id} (not a new repayment)`, debit_amount: Math.max(0, debt.historical_adjustment), credit_amount: Math.max(0, -debt.historical_adjustment) });
      }
      for (const item of data.history.filter(h => !h.reversed_at)) entries.push({ date: item.created_at || data.debts.find(d => d.id === item.staff_debt_id)?.created_at, description: `${item.type} #${item.source_id} for shift #${item.origin_shift_id}`, debit_amount: 0, credit_amount: Number(item.amount) });
      // Shortage reduced by a closed-shift correction, or set off against money
      // owed back to them.
      for (const item of data.corrections.filter((a: any) => a.adjustment_type === 'decrease' && a.status === 'posted')) entries.push({ date: item.created_at, description: item.reason, debit_amount: 0, credit_amount: Number(item.amount) });
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
