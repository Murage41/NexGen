import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Invoice customers' credit and debit notes (services/invoiceAdjustments.ts,
// migration 049): every note is fuel, litres and a price per litre; a credit
// note beyond what the invoice still owes becomes the customer's credit, which
// pays their open and next invoices and is never paid out; a debit note is a
// bill of its own, for an invoice or a shift. A note on a shift can name its
// attendant (migration 050): their shortage on the shift changes by the litres
// at the shift's pump price. Notes are dated today and need an administrator.
// Runs on a private temporary database through the real routes; never touches
// data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-invoice-notes-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'invoice-notes-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { readAccountBalance } = await import('../src/services/accountBalance');
  const { invoiceCustomerCredit } = await import('../src/services/receivablePayments');
  const { getReceivablePositionAsOf } = await import('../src/services/receivableReporting');
  const { auditReceivableIntegrity } = await import('../src/services/receivableIntegrity');
  const { getVarianceStatement, postShiftVariance } = await import('../src/services/employeeVariances');
  const { default: invoicesRouter } = await import('../src/routes/customerInvoices');
  const { default: authRouter } = await import('../src/routes/auth');

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const today = getKenyaDate();
    const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    const [attendant] = await db('employees').insert({ name: 'Attendant', daily_wage: 0, pin: 'x', role: 'attendant', active: true });
    const [admin] = await db('employees').insert({ name: 'Owner Admin', daily_wage: 0, pin: hashPin('4821'), role: 'admin', active: true });
    const [tank] = await db('tanks').insert({ label: 'Diesel', fuel_type: 'diesel', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'P1', nozzle_label: 'D1', fuel_type: 'diesel', tank_id: tank, active: true });
    const customer = async (name: string) =>
      (await db('credit_accounts').insert({ name, type: 'customer', billing_mode: 'invoice', balance: 0, payment_terms_days: 30 }))[0] as number;
    const gamma = await customer('Gamma');
    const delta = await customer('Delta');
    const closedShift = async (date: string) =>
      (await db('shifts').insert({ employee_id: attendant, shift_date: date, start_time: `${date}T06:00:00Z`, status: 'closed', wage_paid: 0 }))[0] as number;
    const fuel = (shiftId: number, account: number, litres: number) => db('invoice_consumption').insert({
      account_id: account, shift_id: shiftId, pump_id: pump, tank_id: tank, fuel_type: 'diesel', litres,
      retail_price_at_time: 190, retail_amount: litres * 190, entry_status: 'active',
    });

    const app = express();
    app.use(express.json());
    app.use('/inv', invoicesRouter);
    app.use('/auth', authRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const call = async (method: string, url: string, body?: any) => {
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-desktop-key': process.env.DESKTOP_KEY! },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() as any };
    };
    const approve = async (fields: Record<string, unknown>) => {
      const r = await call('POST', '/auth/verify-pin', { employee_id: admin, pin: '4821', ...fields });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data.approval_token as string;
    };
    const invoiceFor = async (account: number) => {
      const draft = await call('POST', '/inv', { account_id: account, from_date: daysAgo(40), to_date: today, agreed_prices: { diesel: 190 } });
      assert.equal(draft.status, 201, JSON.stringify(draft.body));
      const issued = await call('POST', `/inv/${draft.body.data.id}/issue`, {});
      assert.equal(issued.status, 200, JSON.stringify(issued.body));
      return issued.body.data;
    };
    const note = async (invoiceId: number, accountId: number, fields: Record<string, unknown>) => {
      const token = await approve({
        purpose: 'invoice_note', account_id: accountId, invoice_id: invoiceId, ...fields,
        unit_price: fields.correction === 'litres' ? 0 : fields.unit_price,
      });
      return call('POST', `/inv/${invoiceId}/adjustments`, { ...fields, approval_token: token });
    };
    const invoice = async (id: number) => db('customer_invoices').where({ id }).first();
    const balance = async (id: number) => Number((await invoice(id)).balance);

    // An issued invoice: 50 L diesel at 190 = 9,500.
    const s1 = await closedShift(daysAgo(10));
    await fuel(s1, gamma, 50);
    const inv1 = await invoiceFor(gamma);
    assert.equal(Number(inv1.total_amount), 9500);

    // 1. A note is fuel, litres and price; an administrator approves it.
    let r = await call('POST', `/inv/${inv1.id}/adjustments`, { note_type: 'credit_note', correction: 'litres', fuel_type: 'diesel', litres: 5, reason: 'no approval given' });
    assert.equal(r.status, 400, 'the desktop needs an approver');
    r = await call('POST', '/auth/verify-pin', { employee_id: admin, pin: '4821', purpose: 'invoice_note', account_id: gamma, invoice_id: inv1.id, note_type: 'credit_note', correction: 'litres', fuel_type: '', litres: 5 });
    assert.equal(r.status, 400, 'no approval for a note without fuel');
    r = await call('POST', `/inv/${inv1.id}/adjustments`, { note_type: 'credit_note', amount: 500, reason: 'an amount without fuel', approval_token: 'x' });
    assert.notEqual(r.status, 201, 'a bare amount is refused');
    console.log('PASS a note is fuel, litres and price, approved by an administrator');

    // 2. Litres corrections are priced at the invoice's agreed price and can
    // never credit more litres than it billed.
    r = await note(inv1.id, gamma, { note_type: 'credit_note', correction: 'litres', fuel_type: 'diesel', litres: 20, reason: 'Fuel recorded on Gamma, was Delta', note_date: daysAgo(5) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const cn1 = r.body.data.note;
    assert.deepEqual([Number(cn1.unit_price), Number(cn1.amount), cn1.note_date, cn1.correction, cn1.approved_by_name],
      [190, 3800, today, 'litres', 'Owner Admin'], "priced at the invoice's price, dated today");
    assert.equal(await balance(inv1.id), 5700);
    r = await note(inv1.id, gamma, { note_type: 'credit_note', correction: 'litres', fuel_type: 'diesel', litres: 31, reason: 'too many litres here' });
    assert.equal(r.status, 400, 'no more litres than billed (20 already credited)');
    console.log('PASS litres corrections at the invoice price, capped at the litres billed');

    // 3. Price corrections: the same litres at the difference, never above the price.
    r = await note(inv1.id, gamma, { note_type: 'credit_note', correction: 'price', fuel_type: 'diesel', litres: 30, unit_price: 5, reason: 'Agreed 185, invoiced 190' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(await balance(inv1.id), 5550);
    r = await note(inv1.id, gamma, { note_type: 'credit_note', correction: 'price', fuel_type: 'diesel', litres: 10, unit_price: 191, reason: 'price above the invoice' });
    assert.equal(r.status, 400);
    console.log('PASS price corrections at the difference per litre');

    // 4. A credit note on a paid invoice: the customer's credit.
    r = await call('POST', '/inv/payments', { account_id: gamma, amount: 5550, payment_method: 'cash' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await note(inv1.id, gamma, { note_type: 'credit_note', correction: 'litres', fuel_type: 'diesel', litres: 10, reason: 'Found after payment: 10 L not taken' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const cn3 = r.body.data.note;
    assert.deepEqual([Number(cn3.applied_amount), Number(cn3.unapplied_amount)], [0, 1900]);
    assert.equal(await invoiceCustomerCredit(gamma, db), 1900);
    assert.equal(await readAccountBalance(gamma, db), 0);
    console.log('PASS a credit note on a paid invoice becomes the customer\'s credit');

    // 5. The credit pays their next invoice when it is issued.
    const s2 = await closedShift(daysAgo(2));
    await fuel(s2, gamma, 20);
    const inv2 = await invoiceFor(gamma);
    assert.equal(Number(inv2.total_amount), 3800);
    assert.equal(await balance(inv2.id), 1900, 'the credit paid 1,900 of it');
    assert.equal(await invoiceCustomerCredit(gamma, db), 0);
    const detail = await call('GET', `/inv/${inv2.id}`);
    assert.equal(detail.body.data.credit_applied[0].note_number, cn3.note_number);
    console.log('PASS the credit pays the next invoice when issued');

    // 6. A debit note on an invoice is a bill of its own.
    r = await note(inv1.id, gamma, { note_type: 'debit_note', correction: 'litres', fuel_type: 'diesel', litres: 5, reason: 'Missed 5 L on this invoice' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const dn1 = r.body.data.debit_note;
    assert.match(dn1.invoice_number, /^DN-/);
    assert.deepEqual([dn1.document_kind, Number(dn1.total_amount), Number(dn1.balance), dn1.corrects_invoice_id, dn1.status],
      ['debit_note', 950, 950, inv1.id, 'issued']);
    assert.ok(dn1.due_date > today, 'due like an invoice');
    assert.equal(await readAccountBalance(gamma, db), 1900 + 950);
    console.log('PASS a debit note on an invoice is its own bill');

    // 7. A debit note for a customer with no invoice: fuel from a shift.
    r = await call('POST', '/inv/debit-notes', {
      account_id: delta, fuel_type: 'diesel', litres: 20, unit_price: 185, reason: 'Fuel recorded on Gamma, was Delta',
      approval_token: await approve({ purpose: 'invoice_note', account_id: delta, invoice_id: 0, note_type: 'debit_note', correction: 'litres', fuel_type: 'diesel', litres: 20, unit_price: 185 }),
    });
    assert.equal(r.status, 400, 'the shift is required');
    const token = await approve({ purpose: 'invoice_note', account_id: delta, invoice_id: 0, note_type: 'debit_note', correction: 'litres', fuel_type: 'diesel', litres: 20, unit_price: 185, shift_id: s1 });
    r = await call('POST', '/inv/debit-notes', {
      account_id: delta, fuel_type: 'diesel', litres: 20, unit_price: 185, shift_id: s1, reason: 'Fuel recorded on Gamma, was Delta', approval_token: token,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const dn2 = r.body.data;
    assert.deepEqual([Number(dn2.total_amount), dn2.shift_id, String(dn2.from_date).slice(0, 10)], [3700, s1, daysAgo(10)]);
    assert.equal(await readAccountBalance(delta, db), 3700);
    r = await call('POST', '/inv/debit-notes', { account_id: delta, fuel_type: 'diesel', litres: 20, unit_price: 185, shift_id: s1, reason: 'Fuel recorded on Gamma, was Delta', approval_token: token.replace(/.$/, 'x') });
    assert.notEqual(r.status, 201, 'a tampered approval is refused');
    console.log('PASS a debit note for a shift works without any invoice');

    // 8. Reversing a credit note takes its credit back off the invoice it paid.
    r = await call('POST', `/inv/adjustments/${cn3.id}/reverse`, { reason: 'Credit note entered by mistake', approval_token: await approve({ purpose: 'invoice_note_reversal', note_id: cn3.id }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await balance(inv2.id), 3800);
    assert.equal(r.body.data.note.status, 'reversed');
    console.log('PASS reversing a credit note takes its credit back');

    // 9. A paid debit note can't be voided: a credit note corrects it.
    r = await call('POST', '/inv/payments', { account_id: delta, amount: 3700, payment_method: 'mpesa', reference: 'QX1' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await call('POST', `/inv/${dn2.id}/void`, { reason: 'trying to void a paid bill' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /credit note/);
    r = await note(dn2.id, delta, { note_type: 'credit_note', correction: 'litres', fuel_type: 'diesel', litres: 2, reason: 'Only 18 L were Delta\'s' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(await invoiceCustomerCredit(delta, db), 370, 'paid, so the credit is theirs for next time');
    r = await call('POST', `/inv/${dn1.id}/void`, { reason: 'unpaid debit note entered twice' });
    assert.equal(r.status, 200, 'an unpaid debit note can be voided');
    console.log('PASS paid debit notes are corrected by credit notes; unpaid ones voided');

    // 10. Reports: a customer in credit is owed money, not a negative debt.
    const position = await getReceivablePositionAsOf(db, today);
    assert.equal(position.invoice_customer_credits, 370);
    assert.equal(position.invoice_receivables, await readAccountBalance(gamma, db));
    const audit: any = await auditReceivableIntegrity(db);
    assert.equal(audit.issues.length, 0, JSON.stringify(audit.issues));
    console.log('PASS reports and the integrity audit agree');

    // 11. An old debit note on an invoice that has been paid can't be reversed.
    const [legacy] = await db('invoice_adjustment_notes').insert({
      account_id: gamma, invoice_id: inv1.id, note_number: 'DN-LEGACY-001', note_type: 'debit_note', note_date: daysAgo(3),
      amount: 100, signed_amount: 100, fuel_type: 'diesel', litres: 0.5, unit_price: 200, reason: 'legacy debit note', status: 'posted',
    });
    await db('invoice_accounting_events').insert({ source_key: `adjustment-note:${legacy}:posted`, account_id: gamma, invoice_id: inv1.id, adjustment_note_id: legacy, event_type: 'debit_note', posting_date: daysAgo(3), receivable_delta: 100, document_amount: 100 });
    const { recomputeInvoiceTotals } = await import('../src/services/receivablePayments');
    await db.transaction((trx) => recomputeInvoiceTotals(inv1.id, trx));
    r = await call('POST', '/inv/payments', { account_id: gamma, amount: 100, payment_method: 'cash' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await call('POST', `/inv/adjustments/${legacy}/reverse`, { reason: 'reverse a paid debit note', approval_token: await approve({ purpose: 'invoice_note_reversal', note_id: legacy }) });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Issue a credit note instead/);
    console.log('PASS a paid debit note gives a clear answer');

    // 12. The attendant option. Kamau's invoice: 30 L recorded on shift s3 at
    // the pump price 190, billed at the agreed 185 (5,550).
    const kamau = await customer('Kamau');
    const s3 = await closedShift(daysAgo(6));
    await fuel(s3, kamau, 30);
    const kDraft = await call('POST', '/inv', { account_id: kamau, from_date: daysAgo(40), to_date: today, agreed_prices: { diesel: 185 } });
    assert.equal(kDraft.status, 201, JSON.stringify(kDraft.body));
    const kIssued = await call('POST', `/inv/${kDraft.body.data.id}/issue`, {});
    assert.equal(kIssued.status, 200, JSON.stringify(kIssued.body));
    const inv4 = kIssued.body.data;
    assert.equal(Number(inv4.total_amount), 5550);
    const owes = async () => Number((await getVarianceStatement(db, attendant)).totals.owes);
    const shortageOn = async (shiftId: number) =>
      Number(((await getVarianceStatement(db, attendant)).rows as any[]).find((row) => row.shift_id === shiftId)?.shortage || 0);
    const owedBefore = await owes();

    const onAttendant = { note_type: 'credit_note', correction: 'litres', fuel_type: 'diesel', reason: 'Recorded on Kamau to cover the drawer', shift_id: s3, attendant: true };
    r = await note(inv4.id, kamau, { ...onAttendant, correction: 'price', unit_price: 5, litres: 10 });
    assert.equal(r.status, 400, 'a price is never the attendant\'s');
    r = await note(inv4.id, kamau, { ...onAttendant, shift_id: undefined, litres: 10 });
    assert.equal(r.status, 400, 'the shift is required');
    r = await note(inv4.id, kamau, { ...onAttendant, shift_id: s1, litres: 10 });
    assert.equal(r.status, 400, 'Kamau had no fuel on shift s1');
    assert.equal(r.body.code, 'ATTENDANT_NOT_ON_SHIFT');
    // The form's preview: the shift's attendant, at the price the shift recorded.
    r = await call('GET', `/inv/note-attendant?account_id=${kamau}&invoice_id=${inv4.id}&note_type=credit_note&fuel_type=diesel&litres=10&shift_id=${s3}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(
      [r.body.data.employee_name, r.body.data.price, r.body.data.amount, r.body.data.available_litres, r.body.data.shift_shortage],
      ['Attendant', 190, 1900, 30, 0],
    );
    r = await call('GET', `/inv/note-attendant?account_id=${kamau}&note_type=credit_note&fuel_type=diesel&litres=10&shift_id=${s1}`);
    assert.equal(r.body.code, 'ATTENDANT_NOT_ON_SHIFT', "Gamma's litres on shift s1 are not Kamau's");
    // An approval for the station is not one for the attendant.
    const stationToken = await approve({ purpose: 'invoice_note', account_id: kamau, invoice_id: inv4.id, note_type: 'credit_note', correction: 'litres', fuel_type: 'diesel', litres: 10, unit_price: 0, shift_id: s3 });
    r = await call('POST', `/inv/${inv4.id}/adjustments`, { ...onAttendant, litres: 10, approval_token: stationToken });
    assert.notEqual(r.status, 201, 'the attendant was not approved');

    r = await note(inv4.id, kamau, { ...onAttendant, litres: 10 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const cn4 = r.body.data.note;
    assert.equal(Number(cn4.amount), 1850, 'the customer is credited at the invoice price');
    assert.equal(await balance(inv4.id), 3700);
    assert.equal(await owes(), owedBefore + 1900, 'the attendant owes the litres at the pump price');
    assert.equal(await shortageOn(s3), 1900, 'as a shortage on their shift');
    let event = await db('invoice_accounting_events').where({ source_key: `adjustment-note:${cn4.id}:posted` }).first();
    assert.equal(Number(event.revenue_adjustment), 50, 'the station keeps the fuel; only the discount on it comes back');
    r = await note(inv4.id, kamau, { ...onAttendant, litres: 25 });
    assert.equal(r.body.code, 'ATTENDANT_LITRES_EXCEED_SHIFT', 'only 20 L are left to put on the attendant');
    r = await call('GET', `/inv/${inv4.id}`);
    const shown = r.body.data.adjustment_notes.find((n: any) => n.id === cn4.id);
    assert.deepEqual([shown.attendant_name, Number(shown.attendant_amount)], ['Attendant', 1900]);

    r = await call('POST', `/inv/adjustments/${cn4.id}/reverse`, { reason: 'It was Kamau after all', approval_token: await approve({ purpose: 'invoice_note_reversal', note_id: cn4.id }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await owes(), owedBefore, 'reversing the note takes it off the attendant');
    assert.equal(await balance(inv4.id), 5550);
    event = await db('invoice_accounting_events').where({ source_key: `adjustment-note:${cn4.id}:reversal` }).first();
    assert.equal(Number(event.revenue_adjustment), -50);
    console.log('PASS a credit note can put the litres on the shift\'s attendant');

    // A debit note for fuel the attendant never recorded: their drawer was
    // short by it at the pump price of the day (200), so they owe less.
    await db('fuel_prices').insert({ fuel_type: 'diesel', price_per_litre: 200, effective_date: daysAgo(30) });
    const s4 = await closedShift(daysAgo(5));
    await db.transaction((trx) => postShiftVariance(trx, { id: s4, employee_id: attendant, shift_date: daysAgo(5) }, -2500, null));
    assert.equal(await shortageOn(s4), 2500);
    const dnFields = { account_id: kamau, fuel_type: 'diesel', litres: 10, unit_price: 185, shift_id: s4, attendant: true, reason: 'Kamau took 10 L that was never recorded' };
    r = await call('POST', '/inv/debit-notes', {
      ...dnFields,
      approval_token: await approve({ purpose: 'invoice_note', invoice_id: 0, note_type: 'debit_note', correction: 'litres', ...dnFields }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const dn4 = r.body.data;
    assert.equal(Number(dn4.total_amount), 1850);
    assert.equal(Number(dn4.price_adjustment_amount), -150, 'revenue: only the customer\'s discount on those litres');
    assert.equal(await shortageOn(s4), 500, 'their drawer was short by the 2,000 of fuel never recorded');
    assert.equal(await owes(), owedBefore + 500);
    r = await call('GET', `/inv/${dn4.id}`);
    assert.deepEqual([r.body.data.attendant.name, Number(r.body.data.attendant.amount)], ['Attendant', -2000]);
    r = await call('POST', `/inv/${dn4.id}/void`, { reason: 'debit note entered twice' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await shortageOn(s4), 2500, 'voiding the debit note puts it back');
    assert.equal(await owes(), owedBefore + 2500);
    const voided = await db('invoice_accounting_events').where({ source_key: `invoice:${dn4.id}:void` }).first();
    assert.equal(Number(voided.revenue_adjustment), 150);
    const audit2: any = await auditReceivableIntegrity(db);
    assert.equal(audit2.issues.length, 0, JSON.stringify(audit2.issues));
    console.log('PASS a debit note can take missed litres off the shift\'s attendant');
  } finally {
    server?.close();
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
