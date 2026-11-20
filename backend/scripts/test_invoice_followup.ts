import assert from 'assert';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// Following up invoice customers: overdue whenever an invoice is past its due
// date (limits or not), over limit, fuel waiting too long to be invoiced, the
// Today reminders, and the statement of account PDF.

// The text a PDF shows: inflate its streams and read the hex strings PDFKit
// writes for the standard fonts.
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  let text = '';
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    const chunk = Buffer.from(raw.slice(start, end), 'latin1');
    let content = '';
    try { content = zlib.inflateSync(chunk).toString('latin1'); } catch { content = chunk.toString('latin1'); }
    for (const h of content.matchAll(/<([0-9a-fA-F]+)>/g)) text += Buffer.from(h[1], 'hex').toString('latin1');
    text += ' ';
  }
  return text;
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-invoice-followup-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'invoice-followup-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { getInvoiceCustomerMonitor } = await import('../src/services/invoiceCustomerMonitor');
  const { createReservedInvoiceDraft } = await import('../src/services/invoiceDraftReservations');
  const { issueReservedCustomerInvoice } = await import('../src/services/invoiceLifecycle');
  const { recordInvoicePayment } = await import('../src/services/receivablePayments');
  const { statementDocument } = await import('../src/services/documents');
  const { longDate } = await import('../src/services/documentLayout');
  const { default: dashboardRouter } = await import('../src/routes/dashboard');
  const { default: invoicesRouter } = await import('../src/routes/customerInvoices');
  const auth = await import('../src/middleware/requireAdmin');

  let server: any;
  try {
    await db.migrate.latest();
    await db('station_profile').where({ id: 1 }).update({ trading_name: 'Test Filling Station' });
    const today = getKenyaDate();
    const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    const [attendant] = await db('employees').insert({ name: 'Day Attendant', daily_wage: 0, pin: 'test-only', role: 'attendant', active: true });
    const closedShift = async (date: string) =>
      Number((await db('shifts').insert({ employee_id: attendant, shift_date: date, start_time: `${date}T06:00:00Z`, end_time: `${date}T18:00:00Z`, status: 'closed' }))[0]);
    const customer = async (name: string, extra: Record<string, unknown> = {}) =>
      Number((await db('credit_accounts').insert({ name, type: 'customer', billing_mode: 'invoice', balance: 0, payment_terms_days: 0, ...extra }))[0]);
    const fuel = (account: number, shiftId: number, fuelType: string, litres: number, price: number) => db('invoice_consumption').insert({
      account_id: account, shift_id: shiftId, fuel_type: fuelType, litres, retail_price_at_time: price, retail_amount: litres * price, entry_status: 'active',
    });
    const invoice = async (account: number, upTo: string, issued: string) => {
      const draft = await createReservedInvoiceDraft(db, { accountId: account, toDate: upTo });
      return issueReservedCustomerInvoice(db, { invoiceId: Number(draft.invoice.id), issueDate: issued });
    };

    const haul = await customer('Haul Ltd');
    const limited = await customer('Limit Ltd', { payment_terms_days: 30, credit_limit: 1000 });
    const d70 = await closedShift(daysAgo(70));
    const d50 = await closedShift(daysAgo(50));
    const d40 = await closedShift(daysAgo(40));
    const d10 = await closedShift(daysAgo(10));
    await fuel(haul, d70, 'diesel', 100, 200);
    await fuel(haul, d50, 'diesel', 50, 210);
    await invoice(haul, daysAgo(60), daysAgo(60)); // 20,000, due the same day
    await invoice(haul, daysAgo(45), daysAgo(45)); // 10,500
    await recordInvoicePayment(db, { accountId: haul, amount: 5000, paymentMethod: 'mpesa', paymentDate: daysAgo(30), reference: 'QK12' });
    await fuel(haul, d40, 'diesel', 10, 210); // not invoiced for 40 days
    await fuel(haul, d10, 'petrol', 5, 200);
    await fuel(limited, d10, 'diesel', 10, 210); // 2,100 against a 1,000 limit
    await fuel(await customer('Waiting Ltd'), d40, 'petrol', 2, 200); // never invoiced, nothing overdue

    // ---- 1. Overdue without a limit, over limit, fuel waiting too long ----
    const monitor = await getInvoiceCustomerMonitor(db, { today });
    const byName = (name: string) => (monitor.customers as any[]).find((c) => c.name === name);
    const h = byName('Haul Ltd');
    assert.deepEqual([h.overdue_amount, h.oldest_due_date, h.days_past_due], [25500, daysAgo(60), 60], 'overdue with no limits set');
    assert.deepEqual([h.not_invoiced_days, h.not_invoiced_late, h.over_limit], [40, true, false]);
    const l = byName('Limit Ltd');
    assert.deepEqual([l.over_limit, l.overdue_amount, l.not_invoiced_late], [true, 0, false]);
    const lateOn = async (date: string) => (await getInvoiceCustomerMonitor(db, { today: date })).customers.find((c: any) => c.name === 'Haul Ltd').not_invoiced_late;
    assert.deepEqual([await lateOn(daysAgo(5)), await lateOn(daysAgo(4))], [false, true], 'late after 35 days, not on the 35th');
    console.log('PASS invoice customers are overdue past their due date and over limit by their exposure, limits or not');

    // ---- 2. The Today reminders ----
    const app = express();
    app.use(express.json());
    app.use(auth.requireAuth);
    app.use('/dashboard', dashboardRouter);
    app.use('/inv', invoicesRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const port = server.address().port;
    const get = async (url: string, headers: Record<string, string> = { 'x-desktop-key': process.env.DESKTOP_KEY! }) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { headers });
      return { status: response.status, type: response.headers.get('content-type') || '', buffer: Buffer.from(await response.arrayBuffer()) };
    };
    const today_ = JSON.parse((await get('/dashboard')).buffer.toString());
    assert.deepEqual(today_.data.invoice_alerts.map((a: any) => [a.name, a.not_invoiced_late, a.not_invoiced_since, a.overdue_amount, a.days_past_due]),
      [['Haul Ltd', true, daysAgo(40), 25500, 60], ['Waiting Ltd', true, daysAgo(40), 0, 0]], 'only the customers to act on');
    const attendantSession = { Authorization: `Bearer ${auth.generateToken(attendant, 'attendant')}` };
    assert.equal(JSON.parse((await get('/dashboard', attendantSession)).buffer.toString()).data.invoice_alerts, undefined, 'reminders are for administrators');
    console.log('PASS Today lists invoice customers with fuel not invoiced for over 35 days or invoices past due');

    // ---- 3. The statement of account ----
    const text = pdfText(await statementDocument(db, haul, daysAgo(50), today));
    for (const expected of ['STATEMENT', `Balance on ${longDate(daysAgo(51))}`, '20,000.00', '10,500.00', '-5,000.00', '30,500.00',
      'Payment, mpesa QK12', '25,500.00', 'Days overdue', 'Open invoices', 'Ageing', '31 to 60 days',
      'Fuel taken and not yet invoiced: 15.00 L', 'KES 3,100.00', 'Invoices are due on receipt.', 'This is not a tax invoice.']) {
      assert(text.includes(expected), `statement shows "${expected}"`);
    }
    const activity = text.slice(text.indexOf('Account activity'));
    assert(activity.indexOf('10,500.00') < activity.indexOf('-5,000.00'), 'activity runs by date');
    assert(text.slice(text.indexOf('Over 90 days')).startsWith('Over 90 days0.000.0025,500.000.000.00'), 'invoices 45 and 60 days overdue age as 31 to 60 days');
    await assert.rejects(() => statementDocument(db, haul, daysAgo(-1), today), (err: any) => err.code === 'INVALID_DATE');
    const routed = await get(`/inv/customers/${haul}/statement?from=${daysAgo(50)}`);
    assert.equal(routed.status, 200);
    assert.equal(routed.type, 'application/pdf');
    assert.equal((await get(`/inv/customers/${haul}/statement`, attendantSession)).status, 403, 'statements are for administrators');
    assert.equal(await db('stored_documents').count({ n: 'id' }).first().then((r: any) => Number(r.n)), 0, 'a statement is made when asked, never saved');
    console.log('PASS the statement shows the balance brought forward, activity with its running balance, open invoices, ageing and fuel not yet invoiced');
  } finally {
    server?.close();
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('invoice follow-up: all checks passed');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
