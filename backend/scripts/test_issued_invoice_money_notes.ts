import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';

// B2: use the real HTTP routes on a private database. Source guards have a
// separate suite; these checks prove money, retained receipts, approvals,
// retries and unchanged saved documents together.
function pdfText(pdf: Buffer) {
  const raw = pdf.toString('latin1');
  let result = '';
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const bytes = Buffer.from(raw.slice(start, raw.indexOf('endstream', start)), 'latin1');
    let text: string;
    try { text = zlib.inflateSync(bytes).toString('latin1'); } catch { continue; }
    for (const item of text.matchAll(/<([0-9a-f]+)>/gi)) result += Buffer.from(item[1], 'hex').toString('latin1');
  }
  return result;
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-issued-invoice-money-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'issued-invoice-money-private-test';
  const { default: db } = await import('../src/database');
  const { default: router } = await import('../src/routes/customerInvoices');
  const { default: authRouter } = await import('../src/routes/auth');
  const { default: customerRouter } = await import('../src/routes/creditAccounts');
  const { generateToken } = await import('../src/middleware/requireAdmin');
  const { hashPin } = await import('../src/services/pinSecurity');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { invoiceCustomerCredit, recomputeInvoiceTotals } = await import('../src/services/receivablePayments');
  const { postInvoiceAccountingEvent } = await import('../src/services/invoiceAccounting');
  const { recomputeAccountBalance } = await import('../src/services/accountBalance');
  const { postInvoiceAdjustment, postCreditNote } = await import('../src/services/invoiceAdjustments');
  const { auditReceivableIntegrity } = await import('../src/services/receivableIntegrity');
  const { getReceivablePositionAsOf } = await import('../src/services/receivableReporting');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const today = getKenyaDate();
    const [admin] = await db('employees').insert({ name: 'Test Admin', role: 'admin', active: true, pin: hashPin('4821'), daily_wage: 0 });
    const [attendant] = await db('employees').insert({ name: 'Test Attendant', role: 'attendant', active: true, pin: 'x', daily_wage: 0 });
    await db('station_profile').update({ trading_name: 'Test Station', physical_address: 'Test Road', phone: '0700000000' });
    const [tank] = await db('tanks').insert({ label: 'Test diesel', fuel_type: 'diesel', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'Test pump', nozzle_label: 'D1', fuel_type: 'diesel', tank_id: tank, active: true });
    const customer = async (name: string) => (await db('credit_accounts').insert({ name, type: 'customer', billing_mode: 'invoice', payment_terms_days: 30, balance: 0 }))[0] as number;
    const a = await customer('Customer A');
    const b = await customer('Customer B');
    const c = await customer('Customer C');
    const app = express(); app.use(express.json()); app.use('/auth', authRouter); app.use('/inv', router); app.use('/customers', customerRouter);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const adminHeaders = { Authorization: `Bearer ${generateToken(admin, 'admin')}` };
    const desktopHeaders = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const call = async (method: string, url: string, body?: any, headers: Record<string, string> = adminHeaders) => {
      const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const buffer = Buffer.from(await response.arrayBuffer());
      return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(buffer.toString()) : null, buffer };
    };
    const good = (response: any, status = 201) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body.data; };
    const invoice = async (account: number) => {
      const [shift] = await db('shifts').insert({ employee_id: attendant, shift_date: today, start_time: `${today}T06:00:00Z`, status: 'closed', wage_paid: 0 });
      const [entry] = await db('invoice_consumption').insert({ account_id: account, shift_id: shift, pump_id: pump, tank_id: tank, fuel_type: 'diesel', litres: 10, retail_price_at_time: 100, retail_amount: 1000, entry_status: 'active' });
      const draft = good(await call('POST', '/inv', { account_id: account, from_date: today, to_date: today, agreed_prices: { diesel: 100 } }));
      const issued = good(await call('POST', `/inv/${draft.id}/issue`, {}), 200);
      return { ...issued, entry, shift };
    };
    const fields = (note_type: string, amount: any, reason = 'Commercial billing correction') => ({ note_type, correction: 'amount', amount, reason });
    const note = async (id: number, amount: number, note_type = 'credit_note', extra: any = {}) => good(await call('POST', `/inv/${id}/adjustments`, { ...fields(note_type, amount), ...extra }));
    const row = (id: number) => db('customer_invoices').where({ id }).first();
    const due = async (id: number) => Number((await row(id)).balance);
    const stored = async (kind: string, record_id: number) => Buffer.from((await db('stored_documents').where({ kind, record_id }).first()).content);

    const original = await invoice(a);
    const originalPdf = await stored('customer_invoice', original.id);
    const source = await db('invoice_consumption').where({ id: original.entry }).first();
    const lines = await db('invoice_lines').where({ invoice_id: original.id });
    const payment = good(await call('POST', '/inv/payments', { account_id: a, amount: 800, payment_method: 'mpesa' }));
    const paymentsBefore = await db('invoice_payments').orderBy('id');
    const allocationsBefore = await db('invoice_payment_allocations').orderBy('id');
    const credit = (await note(original.id, 300)).note;
    assert.deepEqual([Number(credit.applied_amount), Number(credit.unapplied_amount), credit.correction, credit.fuel_type, credit.litres, credit.unit_price, credit.shift_id], [200, 100, 'amount', null, null, null, null]);
    assert.equal(await due(original.id), 0); assert.equal(await invoiceCustomerCredit(a, db), 100);
    const heldMode = await call('PUT', `/customers/${a}`, { billing_mode: 'money' });
    assert.equal(heldMode.status, 400, JSON.stringify(heldMode.body));
    assert.equal(heldMode.body.code, 'INVOICE_CREDIT_HELD');
    assert.equal((await db('credit_accounts').where({ id: a }).first()).billing_mode, 'invoice');
    assert.deepEqual(await db('invoice_payments').orderBy('id'), paymentsBefore);
    assert.deepEqual(await db('invoice_payment_allocations').orderBy('id'), allocationsBefore);
    const debit = (await note(original.id, 250, 'debit_note')).debit_note;
    assert.equal(await due(debit.id), 150); assert.equal(await invoiceCustomerCredit(a, db), 0);
    assert.deepEqual((await db('invoice_lines').where({ invoice_id: debit.id })).map((l: any) => [l.fuel_type, Number(l.total_litres), Number(l.agreed_price), Number(l.line_total)]), [['adjustment', 0, 0, 250]]);
    good(await call('POST', '/inv/payments', { account_id: a, amount: 50, payment_method: 'cash' }));
    const full = (await note(original.id, 700)).note;
    assert.equal(await due(debit.id), 0); assert.equal(await invoiceCustomerCredit(a, db), 600);
    assert.equal((await row(original.id)).status, 'paid');
    const over = await call('POST', `/inv/${original.id}/adjustments`, fields('credit_note', 0.01));
    assert.equal(over.body.code, 'CREDIT_NOTE_EXCEEDS_BILLED', 'linked debit does not enlarge original credit ceiling');
    assert.equal((await call('POST', `/inv/${original.id}/void`, { reason: 'Use full credit instead' })).status, 409);
    assert.deepEqual(await db('invoice_consumption').where({ id: original.entry }).first(), source);
    assert.deepEqual(await db('invoice_lines').where({ invoice_id: original.id }), lines);
    assert.equal(Number((await row(original.id)).total_amount), 1000);
    assert.deepEqual(await stored('customer_invoice', original.id), originalPdf);
    assert.deepEqual((await call('GET', `/inv/${original.id}/document`)).buffer, originalPdf);
    assert.equal(await db('employee_variance_entries').where({ shift_id: original.shift }).count({ n: 'id' }).first().then((x: any) => Number(x.n)), 0);
    assert.equal((await db('invoice_payments').where({ id: payment.payment.id }).first()).status, 'posted');
    console.log('PASS paid and partial bills retain receipts, fixed issued source, held credit and source PDF');

    const moneyPdf = pdfText(await stored('credit_note', credit.id));
    assert(moneyPdf.includes('Monetary credit adjustment')); assert(!moneyPdf.includes('Litres')); assert(!moneyPdf.includes('Price per litre'));
    const debitPdf = pdfText(await stored('customer_invoice', debit.id));
    assert(debitPdf.includes('Monetary debit adjustment')); assert(!debitPdf.includes('Litres')); assert(!debitPdf.includes('Price per litre'));
    const fullPdf = await stored('credit_note', full.id);
    good(await call('POST', `/inv/adjustments/${full.id}/reverse`, { reason: 'Credit note entered in error' }), 200);
    assert.equal(await due(debit.id), 100); assert.equal(await invoiceCustomerCredit(a, db), 0);
    assert.deepEqual(await stored('credit_note', full.id), fullPdf);
    const standalone = good(await call('POST', '/inv/debit-notes', { account_id: b, ...fields('debit_note', 400, 'Correct customer B owes this amount') }));
    assert.deepEqual([Number(standalone.balance), standalone.shift_id, standalone.corrects_invoice_id], [400, null, null]);
    const bCredit = (await note(standalone.id, 400)).note;
    assert.equal(await due(standalone.id), 0); assert.equal((await row(standalone.id)).status, 'paid');
    good(await call('POST', `/inv/adjustments/${bCredit.id}/reverse`, { reason: 'Credit was entered in error' }), 200);
    assert.equal(await due(standalone.id), 400);
    const unpaid = await invoice(c); const unpaidCredit = (await note(unpaid.id, 1000)).note;
    assert.equal((await row(unpaid.id)).status, 'paid'); assert.equal(await due(unpaid.id), 0);
    assert.equal((await db('invoice_consumption').where({ id: unpaid.entry }).first()).invoice_line_id > 0, true, 'full credit never returns source to unbilled');
    good(await call('PUT', `/customers/${c}`, { billing_mode: 'money' }), 200);
    assert.equal((await call('POST', `/inv/adjustments/${unpaidCredit.id}/reverse`, { reason: 'Wrong-mode account cannot restore debt' })).body.code, 'ACCOUNT_NOT_FOUND');
    assert.equal((await db('invoice_adjustment_notes').where({ id: unpaidCredit.id }).first()).status, 'posted');
    assert.equal(await due(unpaid.id), 0);
    good(await call('PUT', `/customers/${c}`, { billing_mode: 'invoice' }), 200);
    await db('credit_accounts').where({ id: c }).update({ deleted_at: db.fn.now() });
    assert.equal((await call('POST', `/inv/adjustments/${unpaidCredit.id}/reverse`, { reason: 'Unavailable account cannot restore debt' })).body.code, 'ACCOUNT_NOT_FOUND');
    assert.equal((await db('invoice_adjustment_notes').where({ id: unpaidCredit.id }).first()).status, 'posted');
    await db('credit_accounts').where({ id: c }).update({ deleted_at: null });
    const d = await customer('Historical Customer D');
    const historical = await invoice(d);
    await db.transaction(async (trx) => postCreditNote(trx, await trx('customer_invoices').where({ id: historical.id }).first(), {
      noteType: 'credit_note', correction: 'litres', fuelType: 'diesel', litres: 2,
      reason: 'Historical fuel credit before B2', noteDate: today, approver: { id: admin, name: 'Test Admin' },
    }));
    await note(historical.id, 800);
    assert.equal((await call('POST', `/inv/${historical.id}/adjustments`, fields('credit_note', 0.01))).body.code, 'CREDIT_NOTE_EXCEEDS_BILLED', 'historical credits count towards the same face-value ceiling');
    const penny = (await note(historical.id, 0.01, 'debit_note')).debit_note;
    await note(penny.id, 0.01);
    const maximum = good(await call('POST', '/inv/debit-notes', { account_id: d, ...fields('debit_note', 100_000_000, 'Maximum valid monetary amount') }));
    await note(maximum.id, 100_000_000);
    assert.equal(await due(maximum.id), 0);
    const upperCents = good(await call('POST', '/inv/debit-notes', { account_id: d, ...fields('debit_note', 99_999_999.99, 'Large valid amount with cents') }));
    await note(upperCents.id, 99_999_999.99);
    assert.equal(await due(upperCents.id), 0);
    const smallCents = (await note(historical.id, 0.29, 'debit_note')).debit_note;
    await note(smallCents.id, 0.29);
    const e = await customer('Inline Legacy Customer E');
    const inlineInvoice = await invoice(e);
    const [inlineId] = await db('invoice_adjustment_notes').insert({ account_id: e, invoice_id: inlineInvoice.id,
      note_number: 'DN-LEGACY-INLINE-TEST', note_type: 'debit_note', note_date: today, amount: 200, signed_amount: 200,
      fuel_type: 'diesel', litres: 2, unit_price: 100, reason: 'Historical inline supplementary bill', status: 'posted' });
    await db.transaction(async (trx) => {
      await recomputeInvoiceTotals(inlineInvoice.id, trx);
      await recomputeAccountBalance(e, trx);
      await postInvoiceAccountingEvent(trx, { sourceKey: `adjustment-note:${inlineId}:posted`, accountId: e,
        invoiceId: inlineInvoice.id, adjustmentNoteId: inlineId, eventType: 'debit_note', postingDate: today,
        receivableDelta: 200, revenueAdjustment: 200, documentAmount: 200, reason: 'Historical inline supplementary bill' });
    });
    good(await call('POST', '/inv/payments', { account_id: e, amount: 1200, payment_method: 'bank' }));
    const inlinePayments = await db('invoice_payments').where({ account_id: e });
    const inlineAllocations = await db('invoice_payment_allocations').where({ invoice_id: inlineInvoice.id });
    const inlineCredit = (await note(inlineInvoice.id, 1200)).note;
    assert.deepEqual([Number(inlineCredit.applied_amount), Number(inlineCredit.unapplied_amount)], [0, 1200]);
    assert.equal(await invoiceCustomerCredit(e, db), 1200);
    assert.deepEqual(await db('invoice_payments').where({ account_id: e }), inlinePayments);
    assert.deepEqual(await db('invoice_payment_allocations').where({ invoice_id: inlineInvoice.id }), inlineAllocations);
    assert.equal((await call('POST', `/inv/${inlineInvoice.id}/adjustments`, fields('credit_note', 0.01))).body.code, 'CREDIT_NOTE_EXCEEDS_BILLED');
    good(await call('POST', `/inv/adjustments/${inlineCredit.id}/reverse`, { reason: 'Restore historical paid account position' }), 200);
    assert.equal(await invoiceCustomerCredit(e, db), 0);
    console.log('PASS monetary documents omit invented litres; standalone debt and full credit remain actionable');

    const tokenFor = async (account: number, invoiceId: number, values: any) => good(await call('POST', '/auth/verify-pin', { employee_id: admin, pin: '4821', purpose: 'invoice_note', account_id: account, invoice_id: invoiceId, ...values }, desktopHeaders), 200).approval_token;
    const decision = fields('debit_note', 25, 'Exact approved monetary decision');
    const token = await tokenFor(a, original.id, decision);
    const invalidBefore = await Promise.all(['invoice_adjustment_notes', 'customer_invoices', 'invoice_lines', 'invoice_accounting_events'].map((table) => db(table).count({ n: '*' }).first().then((x: any) => Number(x.n))));
    for (const changed of [{ amount: 26 }, { reason: 'Different approved monetary reason' }, { note_type: 'credit_note' }]) {
      assert.equal((await call('POST', `/inv/${original.id}/adjustments`, { ...decision, ...changed, approval_token: token }, desktopHeaders)).status, 403);
    }
    assert.equal((await call('POST', `/inv/${standalone.id}/adjustments`, { ...decision, approval_token: token }, desktopHeaders)).status, 403);
    for (const amount of [undefined, null, '', '25', 0, -1, 1.001, 1.000000001, 100_000_000.01]) {
      assert.equal((await call('POST', `/inv/${original.id}/adjustments`, fields('debit_note', amount))).status, 400, `invalid amount ${amount}`);
    }
    for (const amount of [NaN, Infinity]) {
      await assert.rejects(() => postInvoiceAdjustment(db, { noteType: 'debit_note', correction: 'amount', amount, reason: 'Invalid numeric amount', noteDate: today, approver: { id: admin, name: 'Test Admin' }, invoiceId: original.id }), (err: any) => err.code === 'INVALID_NOTE_AMOUNT');
    }
    for (const legacy of [{ fuel_type: 'diesel' }, { litres: 1 }, { unit_price: 100 }, { shift_id: original.shift }, { attendant: false }]) {
      assert.equal((await call('POST', `/inv/${original.id}/adjustments`, { ...decision, ...legacy })).status, 400);
    }
    assert.equal((await call('POST', `/inv/${original.id}/adjustments`, decision, desktopHeaders)).status, 400);
    assert.equal((await call('POST', `/inv/${original.id}/adjustments`, decision, { Authorization: `Bearer ${generateToken(attendant, 'attendant')}` })).status, 403);
    assert.deepEqual(await Promise.all(['invoice_adjustment_notes', 'customer_invoices', 'invoice_lines', 'invoice_accounting_events'].map((table) => db(table).count({ n: '*' }).first().then((x: any) => Number(x.n)))), invalidBefore, 'refused decisions create no financial rows');
    const retryHeaders = { ...desktopHeaders, 'Idempotency-Key': 'money-note-retry-001' };
    const first = good(await call('POST', `/inv/${original.id}/adjustments`, { ...decision, approval_token: token }, retryHeaders));
    const replay = good(await call('POST', `/inv/${original.id}/adjustments`, { ...decision, approval_token: 'expired-token' }, retryHeaders));
    assert.equal(replay.debit_note.id, first.debit_note.id);
    assert.equal((await call('POST', `/inv/${original.id}/adjustments`, { ...decision, amount: 26, approval_token: token }, retryHeaders)).body.code, 'IDEMPOTENCY_KEY_REUSED');
    const adminRetry = { ...adminHeaders, 'Idempotency-Key': 'money-note-admin-retry' };
    good(await call('POST', `/inv/${original.id}/adjustments`, decision, adminRetry));
    await db('employees').where({ id: admin }).update({ active: false });
    assert.equal((await call('POST', `/inv/${original.id}/adjustments`, decision, adminRetry)).status, 403);
    await db('employees').where({ id: admin }).update({ active: true });
    console.log('PASS strict amounts, exact decision approval, active administrators and semantic retries');

    const events = await db('invoice_accounting_events').whereIn('event_type', ['credit_note', 'debit_note', 'credit_note_reversal']);
    assert(events.every((event: any) => Number(event.cash_delta) === 0), 'notes never fabricate money received or paid');
    const eventFigures = async (source_key: string) => {
      const event = await db('invoice_accounting_events').where({ source_key }).first();
      return [Number(event.receivable_delta), Number(event.revenue_adjustment), Number(event.cash_delta)];
    };
    assert.deepEqual(await eventFigures(`adjustment-note:${credit.id}:posted`), [-300, -300, 0]);
    assert.deepEqual(await eventFigures(`debit-note:${debit.id}:issue`), [250, 250, 0]);
    assert.deepEqual(await eventFigures(`adjustment-note:${full.id}:reversal`), [700, 700, 0]);
    const position = await getReceivablePositionAsOf(db, today);
    assert.equal(position.invoice_customer_credits, 0);
    assert.equal(position.invoice_receivables, 550);
    const audit = await auditReceivableIntegrity(db); assert.deepEqual(audit.issues, [], JSON.stringify(audit.issues));
    assert.equal((await db.raw('PRAGMA integrity_check'))[0].integrity_check, 'ok');
    console.log('PASS current receivables, accounting events and read-only integrity audit agree');
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await db.destroy();
    const cleanupTarget = fs.realpathSync(directory);
    assert(path.isAbsolute(cleanupTarget) && path.dirname(cleanupTarget) === fs.realpathSync(os.tmpdir())
      && path.basename(cleanupTarget).startsWith('nexgen-issued-invoice-money-'), 'cleanup stays inside this test’s owned temporary directory');
    fs.rmSync(cleanupTarget, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error('FAIL', err); process.exitCode = 1; });
