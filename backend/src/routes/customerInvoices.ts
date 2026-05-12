import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { getKenyaDate } from '../utils/timezone';
import { recomputeAccountBalance } from '../services/accountBalance';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate next invoice number: CINV-YYYYMMDD-NNN (reset per day). */
async function nextInvoiceNumber(trx: any): Promise<string> {
  const today = getKenyaDate().replace(/-/g, '');
  const prefix = `CINV-${today}-`;
  const row = await trx('customer_invoices')
    .where('invoice_number', 'like', `${prefix}%`)
    .count('* as c')
    .first();
  const seq = String((Number((row as any)?.c) || 0) + 1).padStart(3, '0');
  return `${prefix}${seq}`;
}

/**
 * FIFO-allocate a payment across an account's unpaid invoices.
 *
 * Walks `customer_invoices` for the account in (issue_date asc, id asc) order,
 * applies as much of `amount` to each invoice as fits its current balance,
 * inserts an `invoice_payment_allocations` row per touched invoice, and
 * recomputes that invoice's totals (which flips status: issued → partial → paid).
 *
 * Returns the per-invoice allocation breakdown plus any leftover (unallocated)
 * amount when the payment exceeds total outstanding. Unallocated amounts are
 * NOT auto-refunded — they remain on the payment and the account balance bottoms
 * out at 0 (per `recomputeAccountBalance`'s Math.max(0, ...) clamp).
 */
async function allocatePayment(
  trx: any,
  accountId: number,
  paymentId: number,
  amount: number,
): Promise<{ allocations: Array<{ invoice_id: number; invoice_number: string; amount_applied: number }>; unallocated: number }> {
  let remaining = Math.round(amount * 100) / 100;
  const allocations: Array<{ invoice_id: number; invoice_number: string; amount_applied: number }> = [];

  const unpaid = await trx('customer_invoices')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .whereIn('status', ['issued', 'partial'])
    .orderBy('issue_date', 'asc')
    .orderBy('id', 'asc')
    .select('id', 'invoice_number', 'balance');

  for (const inv of unpaid) {
    if (remaining <= 0) break;
    const balance = Math.round(parseFloat(inv.balance) * 100) / 100;
    if (balance <= 0) continue;
    const apply = Math.min(remaining, balance);
    await trx('invoice_payment_allocations').insert({
      payment_id: paymentId,
      invoice_id: inv.id,
      amount_applied: apply,
    });
    remaining = Math.round((remaining - apply) * 100) / 100;
    allocations.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, amount_applied: apply });
    await recomputeInvoiceTotals(inv.id, trx);
  }

  return { allocations, unallocated: remaining };
}

/** Recompute invoice.total_amount + invoice.balance from lines + payments. */
async function recomputeInvoiceTotals(invoiceId: number, trx: any): Promise<void> {
  const linesRow = await trx('invoice_lines')
    .where({ invoice_id: invoiceId })
    .sum('line_total as total')
    .first();
  const total = Math.round((parseFloat((linesRow as any)?.total) || 0) * 100) / 100;

  const paidRow = await trx('invoice_payment_allocations')
    .where({ invoice_id: invoiceId })
    .sum('amount_applied as total')
    .first();
  const paid = Math.round((parseFloat((paidRow as any)?.total) || 0) * 100) / 100;

  const balance = Math.max(0, Math.round((total - paid) * 100) / 100);

  const current = await trx('customer_invoices').where({ id: invoiceId }).first();
  let nextStatus = current.status;
  if (current.status !== 'draft' && current.status !== 'void') {
    if (paid >= total && total > 0) nextStatus = 'paid';
    else if (paid > 0) nextStatus = 'partial';
    else nextStatus = 'issued';
  }

  await trx('customer_invoices').where({ id: invoiceId }).update({
    total_amount: total,
    balance,
    status: nextStatus,
  });
}

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
      .whereNull('p.deleted_at')
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
// Response: { payment, allocations[], unallocated_amount }
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

    const result = await db.transaction(async (trx) => {
      const acct = await trx('credit_accounts').where({ id: account_id }).whereNull('deleted_at').first();
      if (!acct) throw Object.assign(new Error('Account not found'), { http: 404 });
      if (acct.billing_mode !== 'invoice') {
        throw Object.assign(
          new Error(`Account "${acct.name}" is money-mode. Use POST /credit-accounts/:id/payments instead.`),
          { http: 400 },
        );
      }

      const [paymentId] = await trx('invoice_payments').insert({
        account_id,
        amount: amt,
        payment_method: payment_method || 'cash',
        payment_date: payment_date || getKenyaDate(),
        reference: reference || null,
        notes: notes || null,
      });

      const { allocations, unallocated } = await allocatePayment(trx, account_id, paymentId, amt);
      await recomputeAccountBalance(account_id, trx);

      const payment = await trx('invoice_payments').where({ id: paymentId }).first();
      return { payment, allocations, unallocated_amount: unallocated };
    });

    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// DELETE /payments/:paymentId — soft-delete payment, hard-delete its allocations,
// recompute affected invoices' totals + status, recompute account balance.
router.delete('/payments/:paymentId', requireAdmin, async (req, res) => {
  try {
    const paymentId = Number(req.params.paymentId);
    await db.transaction(async (trx) => {
      const payment = await trx('invoice_payments').where({ id: paymentId }).whereNull('deleted_at').first();
      if (!payment) throw Object.assign(new Error('Payment not found'), { http: 404 });

      const affectedInvoices: number[] = await trx('invoice_payment_allocations')
        .where({ payment_id: paymentId })
        .pluck('invoice_id');

      // Hard-delete the allocations — they are derived data, regenerable from
      // payments. Soft-deleting them would require recomputeInvoiceTotals to
      // join through invoice_payments to filter deleted_at, which it doesn't.
      await trx('invoice_payment_allocations').where({ payment_id: paymentId }).delete();
      await trx('invoice_payments').where({ id: paymentId }).update({ deleted_at: trx.fn.now() });

      for (const invId of affectedInvoices) {
        await recomputeInvoiceTotals(invId, trx);
      }
      await recomputeAccountBalance(payment.account_id, trx);
    });
    res.json({ success: true });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
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
      .select('a.*', 'p.payment_date', 'p.payment_method', 'p.reference')
      .orderBy('p.payment_date', 'asc');

    res.json({ success: true, data: { ...invoice, lines, consumption, allocations } });
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

    const rows = await db('invoice_consumption as ic')
      .leftJoin('shifts as s', 'ic.shift_id', 's.id')
      .where('ic.account_id', Number(account_id))
      .whereNull('ic.deleted_at')
      .whereNull('ic.invoice_line_id')
      .where('s.shift_date', '>=', from)
      .where('s.shift_date', '<=', to)
      .select(
        'ic.fuel_type',
        'ic.litres',
        'ic.retail_price_at_time',
        'ic.retail_amount',
        's.shift_date',
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
// Creates a draft header + invoice_lines with default agreed_price = avg retail.
// Does NOT yet link consumption rows. Use POST /:id/issue to finalize.
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { account_id, from_date, to_date, agreed_prices, notes } = req.body;
    if (!account_id || !from_date || !to_date) {
      return res.status(400).json({ success: false, error: 'account_id, from_date, to_date required' });
    }

    const result = await db.transaction(async (trx) => {
      const account = await trx('credit_accounts').where({ id: account_id }).whereNull('deleted_at').first();
      if (!account) throw Object.assign(new Error('Account not found'), { http: 404 });
      if (account.billing_mode !== 'invoice') {
        throw Object.assign(new Error('Account is not in invoice mode'), { http: 400 });
      }

      const rows = await trx('invoice_consumption as ic')
        .leftJoin('shifts as s', 'ic.shift_id', 's.id')
        .where('ic.account_id', account_id)
        .whereNull('ic.deleted_at')
        .whereNull('ic.invoice_line_id')
        .where('s.shift_date', '>=', from_date)
        .where('s.shift_date', '<=', to_date)
        .select('ic.fuel_type', 'ic.litres', 'ic.retail_price_at_time', 'ic.retail_amount');

      if (rows.length === 0) {
        throw Object.assign(new Error('No unbilled consumption in this date range'), { http: 400 });
      }

      const byFuel: Record<string, { total_litres: number; total_retail: number }> = {};
      for (const r of rows) {
        const ft = r.fuel_type;
        if (!byFuel[ft]) byFuel[ft] = { total_litres: 0, total_retail: 0 };
        byFuel[ft].total_litres += Number(r.litres || 0);
        byFuel[ft].total_retail += Number(r.retail_amount || 0);
      }

      // Insert header (draft — no invoice_number yet; placeholder unique string)
      const placeholderNum = `DRAFT-${account_id}-${Date.now()}`;
      const [invoiceId] = await trx('customer_invoices').insert({
        account_id,
        invoice_number: placeholderNum,
        from_date,
        to_date,
        issue_date: null,
        status: 'draft',
        total_amount: 0,
        balance: 0,
        notes: notes || null,
      });

      // Lines — one per fuel type
      let total = 0;
      for (const [fuel_type, v] of Object.entries(byFuel)) {
        const litres = Math.round(v.total_litres * 100) / 100;
        const avgRetail = v.total_litres > 0 ? v.total_retail / v.total_litres : 0;
        const agreed =
          agreed_prices && typeof agreed_prices[fuel_type] === 'number'
            ? Number(agreed_prices[fuel_type])
            : Math.round(avgRetail * 100) / 100;
        const lineTotal = Math.round(litres * agreed * 100) / 100;
        total += lineTotal;
        await trx('invoice_lines').insert({
          invoice_id: invoiceId,
          fuel_type,
          total_litres: litres,
          agreed_price: agreed,
          line_total: lineTotal,
        });
      }

      total = Math.round(total * 100) / 100;
      await trx('customer_invoices').where({ id: invoiceId }).update({ total_amount: total, balance: total });

      return invoiceId;
    });

    const created = await db('customer_invoices').where({ id: result }).first();
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    const status = err.http || 500;
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
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ success: false, error: 'agreed_price must be a non-negative number' });
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

// POST /:id/issue — draft → issued
// Links unbilled consumption in the date range to this invoice's lines,
// refreshes line totals from actual litres, assigns invoice_number, and
// recomputes account balance.
router.post('/:id/issue', requireAdmin, async (req, res) => {
  try {
    const invoiceId = Number(req.params.id);
    await db.transaction(async (trx) => {
      const invoice = await trx('customer_invoices').where({ id: invoiceId }).whereNull('deleted_at').first();
      if (!invoice) throw Object.assign(new Error('Invoice not found'), { http: 404 });
      if (invoice.status !== 'draft') {
        throw Object.assign(new Error('Only draft invoices can be issued'), { http: 400 });
      }

      const lines = await trx('invoice_lines').where({ invoice_id: invoiceId });
      const lineByFuel: Record<string, any> = {};
      for (const l of lines) lineByFuel[l.fuel_type] = l;

      // Link each unbilled consumption row (account + date range) to the
      // matching fuel_type line. If a new fuel_type shows up that wasn't in
      // the draft, create a line on the fly at avg-retail price.
      const rows = await trx('invoice_consumption as ic')
        .leftJoin('shifts as s', 'ic.shift_id', 's.id')
        .where('ic.account_id', invoice.account_id)
        .whereNull('ic.deleted_at')
        .whereNull('ic.invoice_line_id')
        .where('s.shift_date', '>=', invoice.from_date)
        .where('s.shift_date', '<=', invoice.to_date)
        .select('ic.id', 'ic.fuel_type', 'ic.litres', 'ic.retail_price_at_time', 'ic.retail_amount');

      if (rows.length === 0) {
        throw Object.assign(new Error('No unbilled consumption to issue'), { http: 400 });
      }

      // Create missing fuel-type lines
      const byFuelNew: Record<string, { litres: number; retail: number }> = {};
      for (const r of rows) {
        const ft = r.fuel_type;
        if (!lineByFuel[ft]) {
          if (!byFuelNew[ft]) byFuelNew[ft] = { litres: 0, retail: 0 };
          byFuelNew[ft].litres += Number(r.litres);
          byFuelNew[ft].retail += Number(r.retail_amount);
        }
      }
      for (const [fuel_type, v] of Object.entries(byFuelNew)) {
        const avgRetail = v.litres > 0 ? v.retail / v.litres : 0;
        const agreed = Math.round(avgRetail * 100) / 100;
        const [newLineId] = await trx('invoice_lines').insert({
          invoice_id: invoiceId,
          fuel_type,
          total_litres: 0, // refreshed below
          agreed_price: agreed,
          line_total: 0,
        });
        lineByFuel[fuel_type] = { id: newLineId, fuel_type, agreed_price: agreed, total_litres: 0 };
      }

      // Link consumption rows
      const rowsByFuel: Record<string, number[]> = {};
      const litresByFuel: Record<string, number> = {};
      for (const r of rows) {
        if (!rowsByFuel[r.fuel_type]) { rowsByFuel[r.fuel_type] = []; litresByFuel[r.fuel_type] = 0; }
        rowsByFuel[r.fuel_type].push(r.id);
        litresByFuel[r.fuel_type] += Number(r.litres);
      }
      for (const [fuel_type, ids] of Object.entries(rowsByFuel)) {
        const line = lineByFuel[fuel_type];
        await trx('invoice_consumption').whereIn('id', ids).update({ invoice_line_id: line.id });
        // Refresh line total_litres + line_total from actuals (agreed_price preserved)
        const litres = Math.round(litresByFuel[fuel_type] * 100) / 100;
        const lineTotal = Math.round(litres * Number(line.agreed_price) * 100) / 100;
        await trx('invoice_lines').where({ id: line.id }).update({
          total_litres: litres,
          line_total: lineTotal,
        });
      }

      // Assign invoice_number + flip to issued
      const invoiceNumber = await nextInvoiceNumber(trx);
      await trx('customer_invoices').where({ id: invoiceId }).update({
        invoice_number: invoiceNumber,
        issue_date: getKenyaDate(),
        status: 'issued',
      });

      await recomputeInvoiceTotals(invoiceId, trx);
      await recomputeAccountBalance(invoice.account_id, trx);
    });

    const issued = await db('customer_invoices').where({ id: invoiceId }).first();
    res.json({ success: true, data: issued });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// POST /:id/void — issued → void (only if no payments allocated)
router.post('/:id/void', requireAdmin, async (req, res) => {
  try {
    const invoiceId = Number(req.params.id);
    await db.transaction(async (trx) => {
      const invoice = await trx('customer_invoices').where({ id: invoiceId }).whereNull('deleted_at').first();
      if (!invoice) throw Object.assign(new Error('Invoice not found'), { http: 404 });
      if (invoice.status === 'void' || invoice.status === 'draft') {
        throw Object.assign(new Error('Only issued invoices can be voided'), { http: 400 });
      }

      const paid = await trx('invoice_payment_allocations')
        .where({ invoice_id: invoiceId })
        .sum('amount_applied as total')
        .first();
      if (Number((paid as any)?.total || 0) > 0) {
        throw Object.assign(new Error('Cannot void an invoice with allocated payments'), { http: 400 });
      }

      // Unlink consumption so it becomes billable again
      const lineIds = await trx('invoice_lines').where({ invoice_id: invoiceId }).pluck('id');
      if (lineIds.length) {
        await trx('invoice_consumption').whereIn('invoice_line_id', lineIds).update({ invoice_line_id: null });
      }

      await trx('customer_invoices').where({ id: invoiceId }).update({
        status: 'void',
        balance: 0,
      });

      await recomputeAccountBalance(invoice.account_id, trx);
    });

    const voided = await db('customer_invoices').where({ id: invoiceId }).first();
    res.json({ success: true, data: voided });
  } catch (err: any) {
    const status = err.http || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// DELETE /:id — delete a draft (hard delete lines + header; nothing linked yet)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const invoiceId = Number(req.params.id);
    await db.transaction(async (trx) => {
      const invoice = await trx('customer_invoices').where({ id: invoiceId }).whereNull('deleted_at').first();
      if (!invoice) throw Object.assign(new Error('Invoice not found'), { http: 404 });
      if (invoice.status !== 'draft') {
        throw Object.assign(new Error('Only draft invoices can be deleted. Use /void for issued.'), { http: 400 });
      }
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
