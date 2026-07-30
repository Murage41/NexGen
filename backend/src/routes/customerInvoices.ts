import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { getKenyaDate } from '../utils/timezone';
import { getInvoiceCustomerMonitor } from '../services/invoiceCustomerMonitor';
import {
  paymentHttpStatus,
  recomputeInvoiceTotals,
  recordInvoicePayment,
  reverseInvoicePayment,
} from '../services/receivablePayments';
import {
  createReservedInvoiceDraft,
  getReservableConsumption,
  refreshInvoiceDraftReservation,
  releaseInvoiceReservation,
} from '../services/invoiceDraftReservations';
import {
  postInvoiceAdjustment,
  reverseInvoiceAdjustment,
} from '../services/invoiceAdjustments';
import {
  issueReservedCustomerInvoice,
  voidIssuedCustomerInvoice,
} from '../services/invoiceLifecycle';
import {
  getInvoiceConsumptionHistory,
  type ConsumptionHistoryStatus,
} from '../services/invoiceConsumptionHistory';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET / — list invoices (optional filters: account_id, status, from, to)
router.get('/', async (req, res) => {
  try {
    const { account_id, status, from, to } = req.query as any;
    let q = db('customer_invoices as ci')
      .leftJoin('credit_accounts as a', 'ci.account_id', 'a.id')
      .whereNull('ci.deleted_at')
      .select(
        'ci.*',
        'a.name as account_name',
        'a.phone as account_phone',
      );
    if (account_id) q = q.where('ci.account_id', Number(account_id));
    if (status) q = q.where('ci.status', status);
    if (from) q = q.where('ci.from_date', '>=', from);
    if (to) q = q.where('ci.to_date', '<=', to);

    const rows = await q.orderBy('ci.id', 'desc');
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Payments (Phase 3D) ────────────────────────────────────────────────────
//
// GET /customers/monitor - invoice-mode customer debt + unbilled litres overview.
router.get('/customers/monitor', async (req, res) => {
  try {
    const recentLimit = Number(req.query.recent_limit || 5);
    const data = await getInvoiceCustomerMonitor(db, { recentLimit });
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/customers/:accountId/consumption', async (req, res) => {
  try {
    const data = await getInvoiceConsumptionHistory(db, Number(req.params.accountId), {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      fuelType: req.query.fuel_type as string | undefined,
      status: req.query.status as ConsumptionHistoryStatus | undefined,
      shiftId: req.query.shift_id ? Number(req.query.shift_id) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.page_size ? Number(req.query.page_size) : undefined,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message });
  }
});

// IMPORTANT: these /payments routes MUST be declared before /:id so Express
// matches the literal path first (otherwise GET /payments would resolve as
// GET /:id with id="payments" and 404).

// GET /payments — list payments (filter by account_id, from, to)
// Returns each payment with its allocations array.
router.get('/payments', async (req, res) => {
  try {
    const { account_id, from, to } = req.query as any;
    let q = db('invoice_payments as p')
      .leftJoin('credit_accounts as a', 'p.account_id', 'a.id')
      .select('p.*', 'a.name as account_name');
    if (account_id) q = q.where('p.account_id', Number(account_id));
    if (from) q = q.where('p.payment_date', '>=', from);
    if (to) q = q.where('p.payment_date', '<=', to);
    const payments = await q.orderBy('p.payment_date', 'desc').orderBy('p.id', 'desc');

    // Hydrate allocations per payment in a single query
    const ids = payments.map((p: any) => p.id);
    const allocs = ids.length
      ? await db('invoice_payment_allocations as al')
          .leftJoin('customer_invoices as ci', 'al.invoice_id', 'ci.id')
          .whereIn('al.payment_id', ids)
          .select('al.*', 'ci.invoice_number', 'ci.status as invoice_status')
      : [];
    const byPayment: Record<number, any[]> = {};
    for (const a of allocs) {
      (byPayment[a.payment_id] ||= []).push(a);
    }
    const hydrated = payments.map((p: any) => ({ ...p, allocations: byPayment[p.id] || [] }));

    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /payments — record a payment + FIFO-allocate it across unpaid invoices.
// Body: { account_id, amount, payment_method?, payment_date?, reference?, notes? }
// Response: { payment, allocations[], outstanding_balance }
router.post('/payments', requireAdmin, async (req, res) => {
  try {
    const { account_id, amount, payment_method, payment_date, reference, notes } = req.body;
    if (!account_id || amount === undefined) {
      return res.status(400).json({ success: false, error: 'account_id and amount required' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be a positive number' });
    }

    const effectivePaymentDate = payment_date || getKenyaDate();
    if (effectivePaymentDate > getKenyaDate()) {
      return res.status(400).json({ success: false, error: 'Payment date cannot be in the future.' });
    }
    const result = await recordInvoicePayment(db, {
      accountId: Number(account_id),
      amount: amt,
      paymentMethod: payment_method || 'cash',
      paymentDate: effectivePaymentDate,
      reference,
      notes,
      receivingAccount: req.body.received_into,
      actorId: (req as any).employee?.id,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    const status = paymentHttpStatus(err);
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/payments/:paymentId/reverse', requireAdmin, async (req: any, res) => {
  try {
    const reversalDate = req.body.reversal_date || getKenyaDate();
    if (reversalDate > getKenyaDate()) {
      return res.status(400).json({ success: false, error: 'Reversal date cannot be in the future.' });
    }
    const result = await reverseInvoicePayment(db, {
      paymentId: Number(req.params.paymentId),
      reason: req.body.reason,
      reversalDate,
      actorId: req.employee?.id,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(paymentHttpStatus(err)).json({ success: false, error: err.message });
  }
});

router.delete('/payments/:paymentId', requireAdmin, (_req, res) => {
  res.status(405).json({
    success: false,
    error: 'Payments are not deleted. Use the reversal action and provide a reason.',
  });
});

router.get('/accounting-events', async (req, res) => {
  try {
    const { account_id, invoice_id, from, to, event_type } = req.query as any;
    let query = db('invoice_accounting_events as event')
      .leftJoin('credit_accounts as account', 'event.account_id', 'account.id')
      .select('event.*', 'account.name as account_name');
    if (account_id) query = query.where('event.account_id', Number(account_id));
    if (invoice_id) query = query.where('event.invoice_id', Number(invoice_id));
    if (event_type) query = query.where('event.event_type', event_type);
    if (from) query = query.where('event.posting_date', '>=', from);
    if (to) query = query.where('event.posting_date', '<=', to);
    const rows = await query.orderBy('event.posting_date', 'desc').orderBy('event.id', 'desc');
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/adjustments/:noteId/reverse', requireAdmin, async (req: any, res) => {
  try {
    const reversalDate = req.body.reversal_date || getKenyaDate();
    if (reversalDate > getKenyaDate()) {
      return res.status(400).json({ success: false, error: 'Reversal date cannot be in the future.' });
    }
    const result = await reverseInvoiceAdjustment(db, {
      noteId: Number(req.params.noteId),
      reversalDate,
      reason: req.body.reason,
      actorId: req.employee?.id,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(paymentHttpStatus(err)).json({ success: false, error: err.message });
  }
});

// GET /:id — full invoice (header + lines + consumption rows)
router.get('/:id', async (req, res) => {
  try {
    const invoice = await db('customer_invoices as ci')
      .leftJoin('credit_accounts as a', 'ci.account_id', 'a.id')
      .whereNull('ci.deleted_at')
      .where('ci.id', req.params.id)
      .select('ci.*', 'a.name as account_name', 'a.phone as account_phone')
      .first();
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const lines = await db('invoice_lines').where({ invoice_id: invoice.id }).orderBy('fuel_type');

    // Consumption rows linked to this invoice's lines (so the user can see the detail)
    const lineIds = lines.map((l: any) => l.id);
    const consumption = lineIds.length
      ? await db('invoice_consumption as ic')
          .leftJoin('shifts as s', 'ic.shift_id', 's.id')
          .whereIn('ic.invoice_line_id', lineIds)
          .whereNull('ic.deleted_at')
          .select('ic.*', 's.shift_date', 's.employee_id')
          .orderBy('s.shift_date', 'asc')
      : [];

    const allocations = await db('invoice_payment_allocations as a')
      .leftJoin('invoice_payments as p', 'a.payment_id', 'p.id')
      .where('a.invoice_id', invoice.id)
      .whereNull('p.deleted_at')
      .where('p.status', 'posted')
      .select('a.*', 'p.payment_date', 'p.payment_method', 'p.reference')
      .orderBy('p.payment_date', 'asc');

    const adjustmentNotes = await db('invoice_adjustment_notes')
      .where({ invoice_id: invoice.id })
      .orderBy('note_date', 'asc')
      .orderBy('id', 'asc');
    const accountingEvents = await db('invoice_accounting_events')
      .where({ invoice_id: invoice.id })
      .orderBy('posting_date', 'asc')
      .orderBy('id', 'asc');

    res.json({
      success: true,
      data: {
        ...invoice,
        lines,
        consumption,
        allocations,
        adjustment_notes: adjustmentNotes,
        accounting_events: accountingEvents,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /:id/preview — preview what a draft for (account, from, to) WOULD contain.
// Doesn't persist anything. Used by the "Generate Invoice" modal on the desktop.
// Query: ?account_id=&from=&to=
router.get('/preview/scan', async (req, res) => {
  try {
    const { account_id, from, to } = req.query as any;
    if (!account_id || !from || !to) {
      return res.status(400).json({ success: false, error: 'account_id, from, to required' });
    }

    const rows = await getReservableConsumption(
      db,
      Number(account_id),
      String(from),
      String(to),
    );

    // Group by fuel_type
    const byFuel: Record<string, { total_litres: number; total_retail: number; count: number }> = {};
    for (const r of rows) {
      const ft = r.fuel_type;
      if (!byFuel[ft]) byFuel[ft] = { total_litres: 0, total_retail: 0, count: 0 };
      byFuel[ft].total_litres += Number(r.litres || 0);
      byFuel[ft].total_retail += Number(r.retail_amount || 0);
      byFuel[ft].count += 1;
    }
    const lines = Object.entries(byFuel).map(([fuel_type, v]) => {
      const avgRetail = v.total_litres > 0 ? v.total_retail / v.total_litres : 0;
      return {
        fuel_type,
        total_litres: Math.round(v.total_litres * 100) / 100,
        avg_retail_price: Math.round(avgRetail * 100) / 100,
        suggested_agreed_price: Math.round(avgRetail * 100) / 100,
        retail_total: Math.round(v.total_retail * 100) / 100,
        entry_count: v.count,
      };
    });

    res.json({ success: true, data: { account_id: Number(account_id), from, to, lines, entries: rows.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST / — create a DRAFT invoice from unbilled consumption.
// Body: { account_id, from_date, to_date, agreed_prices?: { petrol?: number, diesel?: number }, notes? }
// Creates invoice lines and atomically reserves the exact closed-shift rows.
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { account_id, from_date, to_date, agreed_prices, notes } = req.body;
    if (!account_id || !from_date || !to_date) {
      return res.status(400).json({ success: false, error: 'account_id, from_date, to_date required' });
    }

    const result = await createReservedInvoiceDraft(db, {
      accountId: Number(account_id),
      fromDate: String(from_date),
      toDate: String(to_date),
      agreedPrices: agreed_prices,
      notes,
    });
    res.status(201).json({
      success: true,
      data: {
        ...result.invoice,
        reservation_added_entries: result.added_entries,
        reservation_entry_count: result.reserved_entries,
      },
    });
  } catch (err: any) {
    const status = err.http || (String(err.code || '').includes('SQLITE_BUSY') ? 409 : 500);
    res.status(status).json({ success: false, error: err.message });
  }
});

// PUT /:id/lines/:lineId — edit agreed_price (only while draft)
router.put('/:id/lines/:lineId', requireAdmin, async (req, res) => {
  try {
    const invoiceId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const { agreed_price } = req.body;

    const invoice = await db('customer_invoices').where({ id: invoiceId }).whereNull('deleted_at').first();
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (invoice.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Only draft invoices can be edited' });
    }

    const priceNum = Number(agreed_price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ success: false, error: 'agreed_price must be greater than zero' });
    }

    await db.transaction(async (trx) => {
      const line = await trx('invoice_lines').where({ id: lineId, invoice_id: invoiceId }).first();
      if (!line) throw Object.assign(new Error('Line not found'), { http: 404 });
      const lineTotal = Math.round(Number(line.total_litres) * priceNum * 100) / 100;
      await trx('invoice_lines').where({ id: lineId }).update({
        agreed_price: priceNum,
        line_total: lineTotal,
      });
      await recomputeInvoiceTotals(invoiceId, trx);
    });

    const updated = await db('customer_invoices').where({ id: invoiceId }).first();
    const lines = await db('invoice_lines').where({ invoice_id: invoiceId }).orderBy('fuel_type');
    res.json({ success: true, data: { ...updated, lines } });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/:id/refresh', requireAdmin, async (req, res) => {
  try {
    const result = await refreshInvoiceDraftReservation(db, Number(req.params.id));
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err.http || (String(err.code || '').includes('SQLITE_BUSY') ? 409 : 500);
    res.status(status).json({ success: false, error: err.message });
  }
});

// POST /:id/issue — draft → issued
// Uses only the rows already reserved by this draft. Later consumption is
// included only when an administrator explicitly refreshes the draft.
router.post('/:id/issue', requireAdmin, async (req: any, res) => {
  try {
    const invoiceId = Number(req.params.id);
    const issued = await issueReservedCustomerInvoice(db, {
      invoiceId,
      issueDate: getKenyaDate(),
      actorId: req.employee?.id,
    });
    res.json({ success: true, data: issued });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/:id/adjustments', requireAdmin, async (req: any, res) => {
  try {
    const noteDate = req.body.note_date || getKenyaDate();
    if (noteDate > getKenyaDate()) {
      return res.status(400).json({ success: false, error: 'Adjustment date cannot be in the future.' });
    }
    const result = await postInvoiceAdjustment(db, {
      invoiceId: Number(req.params.id),
      noteType: req.body.note_type,
      noteDate,
      amount: req.body.amount,
      fuelType: req.body.fuel_type,
      litres: req.body.litres,
      unitPrice: req.body.unit_price,
      reason: req.body.reason,
      actorId: req.employee?.id,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(paymentHttpStatus(err)).json({ success: false, error: err.message });
  }
});

// POST /:id/void — issued → void (only if no payments allocated)
router.post('/:id/void', requireAdmin, async (req: any, res) => {
  try {
    const invoiceId = Number(req.params.id);
    const voided = await voidIssuedCustomerInvoice(db, {
      invoiceId,
      voidDate: getKenyaDate(),
      reason: req.body.reason,
      actorId: req.employee?.id,
    });
    res.json({ success: true, data: voided });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// DELETE /:id - release reserved consumption, then delete the draft.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const invoiceId = Number(req.params.id);
    await db.transaction(async (trx) => {
      const invoice = await trx('customer_invoices').where({ id: invoiceId }).whereNull('deleted_at').first();
      if (!invoice) throw Object.assign(new Error('Invoice not found'), { http: 404 });
      if (invoice.status !== 'draft') {
        throw Object.assign(new Error('Only draft invoices can be deleted. Use /void for issued.'), { http: 400 });
      }
      await releaseInvoiceReservation(trx, invoiceId);
      await trx('invoice_lines').where({ invoice_id: invoiceId }).delete();
      await trx('customer_invoices').where({ id: invoiceId }).delete();
    });
    res.json({ success: true });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

export default router;
