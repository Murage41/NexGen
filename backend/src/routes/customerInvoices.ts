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
  noteAttendant,
  postStandaloneDebitNote,
  reverseInvoiceAdjustment,
} from '../services/invoiceAdjustments';
import { activeAdmin, approvalBindings, approvalSubjectError, resolveApprover } from '../services/approval';
import { normalizeIdempotencyKey, runIdempotent } from '../services/idempotency';
import { getVarianceStatement } from '../services/employeeVariances';
import {
  issueReservedCustomerInvoice,
  voidIssuedCustomerInvoice,
} from '../services/invoiceLifecycle';
import {
  getInvoiceConsumptionHistory,
  type ConsumptionHistoryStatus,
} from '../services/invoiceConsumptionHistory';
import { creditNoteDocument, invoiceDocument, saveDocumentAfterPosting, statementDocument } from '../services/documents';

const router = Router();
// Invoices, balances and consumption are administrators' figures (M6).
router.use(requireAdmin);

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

// GET /customers/:accountId/statement?from=YYYY-MM-DD: the statement of account
// as at today, as a PDF made when asked (not saved). Activity is listed from
// `from`, by default the first day of last month.
router.get('/customers/:accountId/statement', async (req: any, res) => {
  try {
    const today = getKenyaDate();
    const [year, month] = today.split('-').map(Number);
    const lastMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
    const pdf = await statementDocument(db, Number(req.params.accountId), String(req.query.from || lastMonth), today);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="statement-${today}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message, code: err.code });
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
    await noteSession(req);
    const noteId = Number(req.params.noteId);
    const sessionEmployeeId = Number(req.employee?.id) > 0 ? Number(req.employee.id) : null;
    const result = await runIdempotent(db, {
      scope: `invoice-note-reversal:${noteId}`, key: normalizeIdempotencyKey(req.get('Idempotency-Key')),
      payload: { note_id: noteId, reason: req.body?.reason },
    }, async (trx) => {
      await resolveApprover(sessionEmployeeId, req.body?.approval_token, approvalBindings.invoice_note_reversal({ note_id: noteId }), trx);
      const data = await reverseInvoiceAdjustment(trx, {
        noteId, reversalDate: getKenyaDate(), reason: req.body.reason, actorId: req.employee?.id,
      });
      return { status: 200, body: { success: true, data } };
    });
    res.status(result.status).json(result.body);
  } catch (err: any) {
    console.error('[customerInvoices:reverseNote] ERROR', err.message);
    res.status(err.http || err.httpStatus || paymentHttpStatus(err)).json({ success: false, error: err.message, code: err.code });
  }
});

// Issued documents are corrected in money. Fuel and attendant changes are not
// accepted here, including obsolete fields from an older client.
function noteInput(req: any, approver: any) {
  return {
    noteType: req.body?.note_type,
    correction: req.body?.correction,
    amount: req.body?.amount,
    reason: req.body?.reason,
    noteDate: getKenyaDate(),
    approver,
    actorId: req.employee?.id,
  };
}
const noteApproval = (req: any, accountId: number, invoiceId: number | null, conn: typeof db) => {
  const fields = { ...req.body, account_id: accountId, invoice_id: invoiceId || 0 };
  const error = approvalSubjectError('invoice_note', fields);
  if (error) throw Object.assign(new Error(error), { http: 400, code: 'INVALID_NOTE_REQUEST' });
  return resolveApprover(Number(req.employee?.id) > 0 ? Number(req.employee.id) : null,
    req.body?.approval_token, approvalBindings.invoice_note(fields), conn);
};
const notePayload = (req: any) => {
  const { approval_token: _token, ...payload } = req.body || {};
  return payload;
};
async function noteSession(req: any) {
  if (Number(req.employee?.id) > 0 && !await activeAdmin(Number(req.employee.id), db)) {
    throw Object.assign(new Error('The signed-in employee is no longer an active administrator.'), { http: 403 });
  }
}

// GET /note-attendant?account_id&invoice_id?&note_type&fuel_type&litres&shift_id
// Who a note on a shift would put the litres on, and at what pump price, so
// the form shows it before the PIN.
router.get('/note-attendant', requireAdmin, async (req: any, res) => {
  try {
    const q = req.query || {};
    const data = await noteAttendant(db, {
      accountId: Number(q.account_id),
      invoiceId: Number(q.invoice_id) > 0 ? Number(q.invoice_id) : null,
      noteType: String(q.note_type || ''),
      correction: 'litres',
      fuelType: String(q.fuel_type || ''),
      litres: Number(q.litres) || 0,
      shiftId: Number(q.shift_id) > 0 ? Number(q.shift_id) : null,
    });
    // Their shortage on that shift as it stands, so the approver can see it.
    const statement = await getVarianceStatement(db, data.employee_id);
    const row: any = statement.rows.find((r: any) => r.shift_id === data.shift_id);
    res.json({ success: true, data: { ...data, shift_shortage: Number(row?.shortage || 0) } });
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message, code: err.code });
  }
});

// POST /debit-notes — a standalone monetary bill for an invoice customer.
// Body: { account_id, note_type:'debit_note', correction:'amount', amount, reason, approval_token? }
router.post('/debit-notes', requireAdmin, async (req: any, res) => {
  console.log('[customerInvoices:debitNote]', { ...req.body, approval_token: undefined });
  try {
    await noteSession(req);
    const accountId = Number(req.body?.account_id);
    if (req.body?.note_type !== 'debit_note') throw Object.assign(new Error('Choose a debit note.'), { http: 400 });
    const result = await runIdempotent(db, { scope: `invoice-debit-note:${accountId}`, key: normalizeIdempotencyKey(req.get('Idempotency-Key')), payload: notePayload(req) }, async (trx) => {
      const approver = await noteApproval(req, accountId, null, trx);
      const bill = await postStandaloneDebitNote(trx, { ...noteInput(req, approver), accountId });
      return { status: 201, body: { success: true, data: bill } };
    });
    const bill = result.body.data;
    await saveDocumentAfterPosting(db, 'customer_invoice', Number(bill.id), req.employee?.id);
    res.status(result.status).json(result.body);
  } catch (err: any) {
    console.error('[customerInvoices:debitNote] ERROR', err.message);
    res.status(err.http || err.httpStatus || paymentHttpStatus(err)).json({ success: false, error: err.message, code: err.code });
  }
});


// GET /:id/document and /adjustments/:noteId/document — the saved PDF of an
// invoice, debit-note bill or credit note, served unchanged every time (M8).
function sendDocument(res: any, doc: any) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${String(doc.document_number).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`);
  res.setHeader('X-Document-SHA256', doc.sha256);
  res.send(Buffer.from(doc.content));
}

router.get('/:id/document', async (req: any, res) => {
  console.log('[customerInvoices:document]', { invoiceId: req.params.id });
  try {
    sendDocument(res, await invoiceDocument(db, Number(req.params.id), req.employee?.id));
  } catch (err: any) {
    console.error('[customerInvoices:document] ERROR', err.message);
    res.status(err.http || 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.get('/adjustments/:noteId/document', async (req: any, res) => {
  console.log('[customerInvoices:noteDocument]', { noteId: req.params.noteId });
  try {
    sendDocument(res, await creditNoteDocument(db, Number(req.params.noteId), req.employee?.id));
  } catch (err: any) {
    console.error('[customerInvoices:noteDocument] ERROR', err.message);
    res.status(err.http || 500).json({ success: false, error: err.message, code: err.code });
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

    // With the attendant a note put the litres on, if any.
    const adjustmentNotes = await db('invoice_adjustment_notes as n')
      .leftJoin('employee_variance_entries as v', 'v.invoice_note_id', 'n.id')
      .leftJoin('employees as e', 'v.employee_id', 'e.id')
      .where('n.invoice_id', invoice.id)
      .select('n.*', 'e.name as attendant_name', 'v.amount as attendant_amount', 'v.status as attendant_status')
      .orderBy('n.note_date', 'asc')
      .orderBy('n.id', 'asc');
    const attendant = invoice.document_kind === 'debit_note'
      ? await db('employee_variance_entries as v')
        .leftJoin('employees as e', 'v.employee_id', 'e.id')
        .where('v.invoice_id', invoice.id)
        .first('e.name', 'v.amount', 'v.shift_id', 'v.status')
      : null;
    const accountingEvents = await db('invoice_accounting_events')
      .where({ invoice_id: invoice.id })
      .orderBy('posting_date', 'asc')
      .orderBy('id', 'asc');
    // The customer's credit (from credit notes on other invoices) that paid this.
    const creditApplied = await db('invoice_credit_applications as c')
      .join('invoice_adjustment_notes as n', 'c.note_id', 'n.id')
      .where('c.invoice_id', invoice.id)
      .whereNull('c.reversed_at')
      .select('c.id', 'c.amount', 'c.created_at', 'n.note_number', 'n.invoice_id as from_invoice_id')
      .orderBy('c.id', 'asc');
    // Debit-note bills that correct this invoice, or the invoice this one corrects.
    const debitNotes = await db('customer_invoices')
      .where({ corrects_invoice_id: invoice.id, document_kind: 'debit_note' })
      .whereNull('deleted_at')
      .select('id', 'invoice_number', 'issue_date', 'status', 'total_amount', 'balance', 'reason');
    const corrects = invoice.corrects_invoice_id
      ? await db('customer_invoices').where({ id: invoice.corrects_invoice_id }).first('id', 'invoice_number')
      : null;

    res.json({
      success: true,
      data: {
        ...invoice,
        lines,
        consumption,
        allocations,
        credit_applied: creditApplied,
        debit_notes: debitNotes,
        corrects_invoice: corrects,
        attendant: attendant || null,
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
    const { account_id, to } = req.query as any;
    if (!account_id || !to) {
      return res.status(400).json({ success: false, error: 'account_id and to required' });
    }

    const rows = await getReservableConsumption(db, Number(account_id), String(to));

    // What the draft would hold: one line per fuel and pump price.
    const byPrice = new Map<string, { fuel_type: string; price: number; litres: number; amount: number; count: number }>();
    for (const r of rows) {
      const key = `${r.fuel_type}|${Math.round(Number(r.retail_price_at_time) * 100)}`;
      const line = byPrice.get(key) || { fuel_type: String(r.fuel_type), price: Number(r.retail_price_at_time), litres: 0, amount: 0, count: 0 };
      line.litres += Number(r.litres || 0);
      line.amount += Number(r.retail_amount || 0);
      line.count += 1;
      byPrice.set(key, line);
    }
    const lines = [...byPrice.values()].map((line) => ({
      fuel_type: line.fuel_type,
      price: line.price,
      total_litres: Math.round(line.litres * 100) / 100,
      amount: Math.round(line.amount * 100) / 100,
      entry_count: line.count,
    }));

    res.json({
      success: true,
      data: {
        account_id: Number(account_id),
        to,
        first_date: rows[0]?.shift_date || null,
        last_date: rows.length ? rows[rows.length - 1].shift_date : null,
        lines,
        entries: rows.length,
      },
    });
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message });
  }
});

// POST / — create a DRAFT invoice from unbilled consumption.
// Body: { account_id, to_date, notes? }. Every unbilled closed-shift fill up to
// to_date is reserved, each at the amount recorded at the pump.
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { account_id, to_date, notes } = req.body;
    if (!account_id || !to_date) {
      return res.status(400).json({ success: false, error: 'account_id and to_date required' });
    }

    const result = await createReservedInvoiceDraft(db, {
      accountId: Number(account_id),
      toDate: String(to_date),
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
    // The customer's copy is saved now, from the station profile as it is today.
    await saveDocumentAfterPosting(db, 'customer_invoice', invoiceId, req.employee?.id);
    res.json({ success: true, data: issued });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/:id/adjustments', requireAdmin, async (req: any, res) => {
  console.log('[customerInvoices:note]', { invoiceId: req.params.id, ...req.body, approval_token: undefined });
  try {
    await noteSession(req);
    const invoiceId = Number(req.params.id);
    const result = await runIdempotent(db, { scope: `invoice-note:${invoiceId}`, key: normalizeIdempotencyKey(req.get('Idempotency-Key')), payload: notePayload(req) }, async (trx) => {
      const invoice = await trx('customer_invoices').where({ id: invoiceId }).whereNull('deleted_at').first('account_id');
      if (!invoice) throw Object.assign(new Error('Invoice not found'), { http: 404 });
      const approver = await noteApproval(req, Number(invoice.account_id), invoiceId, trx);
      const data = await postInvoiceAdjustment(trx, { ...noteInput(req, approver), invoiceId });
      return { status: 201, body: { success: true, data } };
    });
    const data: any = result.body.data;
    if (data.debit_note) await saveDocumentAfterPosting(db, 'customer_invoice', Number(data.debit_note.id), req.employee?.id);
    if (data.note) await saveDocumentAfterPosting(db, 'credit_note', Number(data.note.id), req.employee?.id);
    res.status(result.status).json(result.body);
  } catch (err: any) {
    console.error('[customerInvoices:note] ERROR', err.message);
    res.status(err.http || err.httpStatus || paymentHttpStatus(err)).json({ success: false, error: err.message, code: err.code });
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
        throw Object.assign(new Error('Only draft invoices can be deleted. Correct an issued invoice with a monetary credit or debit note.'), { http: 400 });
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
