import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';

// Station profile, logo and PDF documents (M8): who may change the profile and
// logo; an invoice, debit-note bill and credit note each get a PDF saved when
// issued and served unchanged after (even when the profile later changes); the
// "not a tax invoice" notice; refusals; and backups that carry every document.
// Runs on a private temporary database; never touches data/nexgen.db.

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-station-documents-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'station-documents-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { verifiedDatabaseBackup, UPLOADED_FILES_DIR } = await import('../src/services/databaseBackup');
  const migration = await import('../migrations/20260926_052_station_profile_documents');
  const { default: invoicesRouter } = await import('../src/routes/customerInvoices');
  const { default: authRouter } = await import('../src/routes/auth');
  const { default: profileRouter, serveStationLogo } = await import('../src/routes/stationProfile');
  const sqlite3 = (await import('sqlite3')).default;

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    await migration.up(db);
    assert.equal(Number((await db('station_profile').count({ n: 'id' }).first() as any).n), 1, 'one profile row, however often the migration runs');
    console.log('PASS migration is repeatable');

    const today = getKenyaDate();
    const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    const [attendant] = await db('employees').insert({ name: 'Day Attendant', daily_wage: 0, pin: hashPin('9999'), role: 'attendant', active: true });
    const [admin] = await db('employees').insert({ name: 'Owner Admin', daily_wage: 0, pin: hashPin('4821'), role: 'admin', active: true });
    const [tank] = await db('tanks').insert({ label: 'Diesel', fuel_type: 'diesel', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'P1', nozzle_label: 'D1', fuel_type: 'diesel', tank_id: tank, active: true });
    const [account] = await db('credit_accounts').insert({ name: 'Delta Haulage', phone: '0700000001', kra_pin: 'P051234567Q', type: 'customer', billing_mode: 'invoice', balance: 0, payment_terms_days: 30 });
    const closedShift = async (date: string) =>
      (await db('shifts').insert({ employee_id: attendant, shift_date: date, start_time: `${date}T06:00:00Z`, status: 'closed', wage_paid: 0 }))[0] as number;
    const fuel = (shiftId: number, litres: number) => db('invoice_consumption').insert({
      account_id: account, shift_id: shiftId, pump_id: pump, tank_id: tank, fuel_type: 'diesel', litres,
      retail_price_at_time: 190, retail_amount: litres * 190, entry_status: 'active',
    });

    const app = express();
    app.use(express.json({ limit: '12mb' }));
    app.get('/station-profile/logo', serveStationLogo);
    app.use('/auth', authRouter);
    app.use(auth.requireAuth);
    app.use('/inv', invoicesRouter);
    app.use('/station-profile', profileRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const attendantSession = { Authorization: `Bearer ${auth.generateToken(attendant, 'attendant')}` };
    const adminSession = { Authorization: `Bearer ${auth.generateToken(admin, 'admin')}` };
    const call = async (method: string, url: string, headers: Record<string, string> = desktop, body?: any) => {
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') || '';
      return { status: res.status, type, buffer, body: type.includes('json') ? JSON.parse(buffer.toString()) : null };
    };

    // ---- A. The profile and the logo ----
    assert.equal((await call('GET', '/station-profile', attendantSession)).status, 200, 'everyone signed in reads it');
    assert.equal((await call('PUT', '/station-profile', attendantSession, { trading_name: 'X' })).status, 403, 'administrators change it');
    assert.match(JSON.stringify((await call('PUT', '/station-profile', desktop, { kra_pin: '12345' })).body), /KRA PIN must be/);
    assert.match(JSON.stringify((await call('PUT', '/station-profile', desktop, { email: 'not-an-email' })).body), /valid email/);
    const logo = await fetch(`http://127.0.0.1:${port}/station-profile/logo`);
    const defaultLogo = Buffer.from(await logo.arrayBuffer());
    assert.equal(logo.status, 200, 'the logo needs no sign-in');
    assert.equal(defaultLogo.subarray(1, 4).toString(), 'PNG', 'the NexGen logo by default');
    assert.equal((await call('PUT', '/station-profile/logo', attendantSession, { data_base64: defaultLogo.toString('base64') })).status, 403);
    assert.match((await call('PUT', '/station-profile/logo', desktop, { data_base64: Buffer.from('<svg/>').toString('base64') })).body.error, /PNG or JPEG/);
    assert.match((await call('PUT', '/station-profile/logo', desktop, { data_base64: Buffer.alloc(2 * 1024 * 1024 + 1, 1).toString('base64') })).body.error, /under 2 MB/);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    assert.equal((await call('PUT', '/station-profile/logo', adminSession, { data_base64: `data:image/jpeg;base64,${jpeg.toString('base64')}` })).body.data.has_custom_logo, true);
    const custom = await fetch(`http://127.0.0.1:${port}/station-profile/logo`);
    assert.equal(custom.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await custom.arrayBuffer()), jpeg, "the station's own logo");
    assert.equal((await call('DELETE', '/station-profile/logo', desktop)).body.data.has_custom_logo, false);
    assert.deepEqual(Buffer.from(await (await fetch(`http://127.0.0.1:${port}/station-profile/logo`)).arrayBuffer()), defaultLogo, 'back to the default');
    console.log('PASS profile and logo: everyone reads, administrators change, PNG or JPEG under 2 MB');

    // ---- B. Documents ----
    const invoiceFor = async () => {
      const draft = await call('POST', '/inv', desktop, { account_id: account, to_date: today });
      assert.equal(draft.status, 201, JSON.stringify(draft.body));
      const issued = await call('POST', `/inv/${draft.body.data.id}/issue`, desktop, {});
      assert.equal(issued.status, 200, JSON.stringify(issued.body));
      return issued.body.data;
    };
    const stored = (kind: string, id: number) => db('stored_documents').where({ kind, record_id: id }).first();

    await fuel(await closedShift(daysAgo(20)), 50);
    const inv1 = await invoiceFor();
    assert.equal(await stored('customer_invoice', inv1.id), undefined, 'no profile yet: issuing still works, the document waits');
    const blocked = await call('GET', `/inv/${inv1.id}/document`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /station profile/);

    await call('PUT', '/station-profile', desktop, {
      trading_name: 'Test Filling Station', physical_address: 'Main Road', phone: '0711000000',
      kra_pin: 'p000000000a', mpesa_details: 'Buy Goods Till 123456', document_footer: 'Thank you for your business.',
    });
    const first = await call('GET', `/inv/${inv1.id}/document`, adminSession);
    assert.equal(first.status, 200);
    assert.equal(first.type, 'application/pdf');
    assert.equal(first.buffer.subarray(0, 5).toString(), '%PDF-');
    const text1 = pdfText(first.buffer);
    for (const expected of ['INVOICE', inv1.invoice_number, 'Delta Haulage', 'P051234567Q', 'Test Filling Station', 'KRA PIN P000000000A',
      'This is not a tax invoice. Tax invoices are issued through KRA eTIMS.', 'Amount due', '9,500.00', 'Buy Goods Till 123456', 'Page 1 of 1']) {
      assert(text1.includes(expected), `invoice shows "${expected}"`);
    }
    await call('PUT', '/station-profile', desktop, { trading_name: 'Renamed Station' });
    const again = await call('GET', `/inv/${inv1.id}/document`, adminSession);
    assert.deepEqual(again.buffer, first.buffer, 'served unchanged after the profile changed');
    assert.equal(Number((await db('stored_documents').count({ n: 'id' }).first() as any).n), 1);
    console.log('PASS an invoice issued before the profile gets its PDF when first opened, then never changes');

    await fuel(await closedShift(daysAgo(2)), 20);
    const inv2 = await invoiceFor();
    const saved2 = await stored('customer_invoice', inv2.id);
    assert(saved2, 'saved the moment it was issued');
    assert(pdfText(Buffer.from(saved2.content)).includes('Renamed Station'), 'with the profile as it was then');
    assert.equal((await call('GET', `/inv/${inv2.id}/document`)).buffer.toString('base64'), Buffer.from(saved2.content).toString('base64'));

    const token = async (fields: Record<string, unknown>) => {
      const r = await call('POST', '/auth/verify-pin', desktop, { employee_id: admin, pin: '4821', purpose: 'invoice_note', account_id: account, invoice_id: inv2.id, ...fields });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data.approval_token;
    };
    // Paid in full, then a monetary credit: held for the next invoice.
    assert.equal((await call('POST', '/inv/payments', desktop, { account_id: account, amount: 9500 + 3800, payment_method: 'cash' })).status, 201);
    const cnFields = { note_type: 'credit_note', correction: 'amount', amount: 950, reason: 'Agreed commercial credit' };
    const cn = await call('POST', `/inv/${inv2.id}/adjustments`, desktop, { ...cnFields, approval_token: await token(cnFields) });
    assert.equal(cn.status, 201, JSON.stringify(cn.body));
    const note = cn.body.data.note;
    assert(await stored('credit_note', note.id), 'credit note saved when posted');
    const cnText = pdfText((await call('GET', `/inv/adjustments/${note.id}/document`)).buffer);
    for (const expected of ['CREDIT NOTE', note.note_number, inv2.invoice_number, 'Agreed commercial credit', 'Held for the next invoice', '950.00']) {
      assert(cnText.includes(expected), `credit note shows "${expected}"`);
    }

    const dnFields = { note_type: 'debit_note', correction: 'amount', amount: 380, reason: 'Agreed additional charge' };
    const dn = await call('POST', `/inv/${inv2.id}/adjustments`, desktop, { ...dnFields, approval_token: await token(dnFields) });
    assert.equal(dn.status, 201, JSON.stringify(dn.body));
    const bill = dn.body.data.debit_note;
    const dnText = pdfText(Buffer.from((await stored('customer_invoice', bill.id)).content));
    assert(!dnText.includes('Fuel by shift'), 'a debit note has no fuel by shift');
    for (const expected of ['DEBIT NOTE', bill.invoice_number, `Corrects`, inv2.invoice_number, 'Reason: Agreed additional charge']) {
      assert(dnText.includes(expected), `debit note shows "${expected}"`);
    }

    await fuel(await closedShift(daysAgo(1)), 10);
    const inv3 = await invoiceFor();
    const inv3Text = pdfText(Buffer.from((await stored('customer_invoice', inv3.id)).content));
    assert(inv3Text.includes(`Less credit (${note.note_number})`), 'the held credit shows on the next invoice');
    console.log('PASS invoices, debit-note bills and credit notes are saved when issued, with credit carried to the next invoice');

    await fuel(await closedShift(today), 5);
    const draft = await call('POST', '/inv', desktop, { account_id: account, to_date: today });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.equal((await call('GET', `/inv/${draft.body.data.id}/document`)).status, 400, 'a draft has no document');
    assert.equal(await stored('customer_invoice', draft.body.data.id), undefined);
    assert.equal((await call('GET', `/inv/${inv1.id}/document`, attendantSession)).status, 403, 'documents are for administrators');
    assert.equal((await call('GET', '/inv/999999/document')).status, 404);
    console.log('PASS drafts and attendants are refused');

    // ---- B2. Fuel by shift ----
    {
      const [hauler] = await db('credit_accounts').insert({ name: 'Shift Lines Ltd', phone: '0700000002', type: 'customer', billing_mode: 'invoice', balance: 0, payment_terms_days: 30 });
      const take = (shiftId: number, fuelType: string, litres: number, price: number, amount = Math.round(litres * price * 100) / 100) =>
        db('invoice_consumption').insert({
          account_id: hauler, shift_id: shiftId, pump_id: pump, tank_id: tank, fuel_type: fuelType, litres,
          retail_price_at_time: price, retail_amount: amount, entry_status: 'active',
        });
      const s1 = await closedShift(daysAgo(6));
      const s2 = await closedShift(daysAgo(5));
      const s3 = await closedShift(daysAgo(4));
      await take(s1, 'diesel', 100, 229);
      await take(s2, 'diesel', 12.02, 229);
      await take(s2, 'petrol', 15, 216);
      await take(s2, 'diesel', 8, 229); // two entries on one shift make one row
      // The price changed: a KES 5,000 sale of 21.664 L at 230.80 is billed as sold.
      await take(s3, 'diesel', 21.664, 230.8, 5000);
      // Meters give 3 decimals: 1.004 + 1.004 + 1.004 = 3.012 L, billed as 3.01 L.
      const s4 = await closedShift(daysAgo(3));
      const s5 = await closedShift(daysAgo(3));
      await take(s4, 'petrol', 1.004, 216);
      await take(s5, 'petrol', 1.004, 216);
      await take(s1, 'petrol', 1.004, 216);
      const draft2 = await call('POST', '/inv', desktop, { account_id: hauler, to_date: daysAgo(3) });
      assert.equal(draft2.status, 201, JSON.stringify(draft2.body));
      const issued2 = await call('POST', `/inv/${draft2.body.data.id}/issue`, desktop, {});
      assert.equal(issued2.status, 200, JSON.stringify(issued2.body));
      assert.equal(Number(issued2.body.data.total_amount), 36375.16, 'the pump amounts, nothing averaged');
      assert.equal(Number(issued2.body.data.price_adjustment_amount), 0);
      const text = pdfText(Buffer.from((await stored('customer_invoice', issued2.body.data.id)).content));
      // Lines: diesel at 229 (120.02 L, 27,484.58), diesel at 230.80 (21.66 L,
      // 5,000.00), petrol at 216 (18.01 L, 3,890.58). Rows at the pump amounts.
      for (const expected of ['Fuel by shift', `#${s1}`, `#${s2}`, `#${s3}`, '229.00', '230.80', '27,484.58', '3,890.58',
        '22,900.00', '4,584.58', '3,240.00', '216.86', '21.66', '1.01', '159.69', '36,375.16']) {
        assert(text.includes(expected), `fuel by shift shows "${expected}"`);
      }
      assert(!text.includes('12.02') && !text.includes('8.00'), 'entries on the same shift and fuel are one row');
      const order = [text.indexOf('22,900.00'), text.indexOf('4,584.58'), text.lastIndexOf('3,240.00'), text.lastIndexOf('5,000.00')];
      assert.deepEqual([...order].sort((a, b) => a - b), order, 'rows run by date and shift');
      console.log('PASS invoices list the fuel on each shift, adding up exactly to the invoice');

      // An older invoice whose entries do not add up to its line keeps one line per fuel.
      const [older] = await db('customer_invoices').insert({ account_id: hauler, invoice_number: 'INV-OLD-1', from_date: daysAgo(30), to_date: daysAgo(30), status: 'draft', total_amount: 1900, balance: 1900, due_date: today });
      const [olderLine] = await db('invoice_lines').insert({ invoice_id: older, fuel_type: 'diesel', total_litres: 10, agreed_price: 190, line_total: 1900 });
      await db('invoice_consumption').insert({ account_id: hauler, shift_id: await closedShift(daysAgo(30)), fuel_type: 'diesel', litres: 7, retail_price_at_time: 190, retail_amount: 1330, entry_status: 'active', invoice_line_id: olderLine });
      await db('customer_invoices').where({ id: older }).update({ status: 'issued', issue_date: daysAgo(30) });
      const olderText = pdfText((await call('GET', `/inv/${older}/document`)).buffer);
      assert(olderText.includes('1,900.00') && !olderText.includes('Fuel by shift'), 'an invoice whose entries do not match keeps one line per fuel');
      console.log('PASS an older invoice that does not add up has no fuel by shift');
    }

    // ---- C. Backups carry every document ----
    fs.mkdirSync(path.join(UPLOADED_FILES_DIR, 'fuel-deliveries'), { recursive: true });
    fs.writeFileSync(path.join(UPLOADED_FILES_DIR, 'fuel-deliveries', 'delivery-1.pdf'), '%PDF-1.4 test');
    assert(UPLOADED_FILES_DIR.startsWith(directory), 'uploads live in the data folder, not the real one');
    const backup = await verifiedDatabaseBackup(db, path.join(directory, 'backups'));
    assert.equal(backup.uploaded_files_copied, 1, 'supplier invoice PDFs are copied beside the database');
    assert(fs.existsSync(path.join(backup.uploaded_files_path!, 'invoice-documents', 'fuel-deliveries', 'delivery-1.pdf')));
    const count = await new Promise<number>((resolve, reject) => {
      const copy = new sqlite3.Database(backup.path, sqlite3.OPEN_READONLY);
      copy.get('SELECT COUNT(*) AS n FROM stored_documents', (err: any, row: any) => { copy.close(); err ? reject(err) : resolve(row.n); });
    });
    assert.equal(count, Number((await db('stored_documents').count({ n: 'id' }).first() as any).n), 'every saved PDF is in the backup');
    console.log('PASS backups carry the saved PDFs and the uploaded supplier invoices');

    assert.equal((await db.raw('PRAGMA integrity_check'))[0].integrity_check, 'ok');
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
