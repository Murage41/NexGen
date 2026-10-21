import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-issued-source-'));
  process.env.NEXGEN_DATA_DIR = directory;
  const { default: db } = await import('../src/database');
  const migration = await import('../migrations/20261020_056_issued_invoice_money_notes');
  const { releaseInvoiceReservation } = await import('../src/services/invoiceDraftReservations');
  const { assertIssuedSourceUnlocked, issuedSourceState } = await import('../src/services/issuedInvoiceSource');
  const { fuelOnAccountRule } = await import('../src/services/correctionRules/fuelOnAccount');
  const { voidIssuedCustomerInvoice } = await import('../src/services/invoiceLifecycle');
  try {
    const migrations = fs.readdirSync(path.resolve(__dirname, '../migrations'))
      .filter((name) => name.endsWith('.ts') && name < '20261020_056_issued_invoice_money_notes.ts').sort();
    for (const name of migrations) await db.migrate.up({ name });
    const [employee] = await db('employees').insert({ name: 'Source Guard Attendant', daily_wage: 0, role: 'attendant', active: true });
    const [account] = await db('credit_accounts').insert({ name: 'Source Guard Customer', type: 'customer', billing_mode: 'invoice', balance: 0 });
    const [shift] = await db('shifts').insert({ employee_id: employee, shift_date: '2026-10-01', start_time: '2026-10-01T06:00:00Z', status: 'open' });
    const [tank] = await db('tanks').insert({ label: 'Source Guard Tank', fuel_type: 'petrol', capacity_litres: 1000 });
    const [pump] = await db('pumps').insert({ label: 'Source Guard Pump', nozzle_label: 'Source Guard Nozzle', fuel_type: 'petrol', tank_id: tank, active: true });
    const [invoice] = await db('customer_invoices').insert({ account_id: account, invoice_number: 'SOURCE-GUARD-INVOICE', from_date: '2026-10-01', to_date: '2026-10-01', status: 'draft', total_amount: 1800, balance: 1800 });
    const [line] = await db('invoice_lines').insert({ invoice_id: invoice, fuel_type: 'petrol', total_litres: 10, agreed_price: 180, line_total: 1800 });
    const entry = { account_id: account, shift_id: shift, pump_id: pump, tank_id: tank, fuel_type: 'petrol', litres: 10, retail_price_at_time: 180, retail_amount: 1800, entry_status: 'active', invoice_line_id: line };
    const [source] = await db('invoice_consumption').insert(entry);
    // Preserve an older issued correction's reversed source exactly as stored.
    const [historicalReversed] = await db('invoice_consumption').insert({ ...entry, litres: 2, retail_amount: 360, entry_status: 'reversed', deleted_at: '2026-10-02T12:00:00Z', reversed_by_record_correction_id: 17 });
    await db('customer_invoices').where({ id: invoice }).update({ status: 'issued', issue_date: '2026-10-03', issued_at: '2026-10-03T12:00:00Z' });
    const [legacyVoid] = await db('customer_invoices').insert({ account_id: account, invoice_number: 'SOURCE-GUARD-OLD-VOID', from_date: '2026-10-01', to_date: '2026-10-01', status: 'void', issue_date: '2026-10-02' });
    const [voidLine] = await db('invoice_lines').insert({ invoice_id: legacyVoid, fuel_type: 'petrol', total_litres: 10, agreed_price: 180, line_total: 1800 });
    const [voidLinked] = await db('invoice_consumption').insert({ ...entry, invoice_line_id: voidLine });
    const [previouslyReleased] = await db('invoice_consumption').insert({ ...entry, invoice_line_id: null });
    const [fuelDebit] = await db('customer_invoices').insert({ account_id: account, invoice_number: 'SOURCE-GUARD-OLD-DN', document_kind: 'debit_note', from_date: '2026-10-01', to_date: '2026-10-01', status: 'issued', issue_date: '2026-10-02', total_amount: 1800, balance: 1800 });
    const [fuelDebitLine] = await db('invoice_lines').insert({ invoice_id: fuelDebit, fuel_type: 'petrol', total_litres: 10, agreed_price: 180, line_total: 1800 });
    await db('invoice_consumption').insert({ ...entry, invoice_line_id: fuelDebitLine });
    const legacyRows = await db('invoice_consumption').whereIn('id', [voidLinked, previouslyReleased]).orderBy('id');
    const original = await db('invoice_consumption').whereIn('id', [source, historicalReversed]).orderBy('id');
    const originalLines = await db('invoice_lines').where({ invoice_id: invoice });
    const header = await db('customer_invoices').where({ id: invoice }).first();
    await migration.up(db);
    await migration.up(db);
    assert.deepEqual(await db('invoice_consumption').whereIn('id', [source, historicalReversed]).orderBy('id'), original, 'migration must not rewrite historical source facts');
    assert.deepEqual(await db('invoice_lines').where({ invoice_id: invoice }), originalLines);
    assert.deepEqual(await db('customer_invoices').where({ id: invoice }).first(), header);
    assert.deepEqual(await db('invoice_consumption').whereIn('id', [voidLinked, previouslyReleased]).orderBy('id'), legacyRows, 'migration never invents links for fuel released by an older void');
    assert.equal((await issuedSourceState(db, { invoice_line_id: voidLine })).issued_source_locked, true, 'an existing void link remains an issued boundary');
    assert.equal((await issuedSourceState(db, { invoice_line_id: null })).issued_source_locked, false);
    await assert.rejects(assertIssuedSourceUnlocked(db, { invoice_line_id: 999999 }), (error: any) => error.code === 'INVOICE_SOURCE_LINK_INCOMPLETE');

    const blocked = /Issued invoice source stays fixed/;
    // The shift is deliberately open: these refusals prove the new invoice
    // boundary independently of the older closed-shift fact guards.
    for (const change of [
      { litres: 9 }, { retail_price_at_time: 179 }, { retail_amount: 1799 },
      { account_id: Number(account) + 1 }, { shift_id: Number(shift) + 1 },
      { fuel_type: 'diesel' }, { pump_id: null }, { tank_id: null },
      { invoice_line_id: null }, { deleted_at: '2026-10-04' },
      { entry_status: 'reversed' }, { correction_of_id: 1 },
      { created_by_record_correction_id: 1 }, { reversed_by_record_correction_id: 1 },
    ]) {
      await assert.rejects(db('invoice_consumption').where({ id: source }).update(change), blocked);
    }
    await assert.rejects(db('invoice_consumption').where({ id: source }).delete(), blocked);
    await assert.rejects(db('invoice_consumption').where({ id: historicalReversed }).update({ deleted_at: null, entry_status: 'active' }), blocked);
    await assert.rejects(db('invoice_consumption').insert(entry), blocked);
    const [unbilled] = await db('invoice_consumption').insert({ ...entry, invoice_line_id: null });
    await assert.rejects(db('invoice_consumption').where({ id: unbilled }).update({ invoice_line_id: line }), blocked);

    for (const change of [{ total_litres: 11 }, { agreed_price: 181 }, { line_total: 1801 }, { fuel_type: 'diesel' }, { invoice_id: 999 }]) {
      await assert.rejects(db('invoice_lines').where({ id: line }).update(change), blocked);
    }
    await assert.rejects(db('invoice_lines').where({ id: line }).delete(), blocked);
    await assert.rejects(db('invoice_lines').insert({ invoice_id: invoice, fuel_type: 'diesel', total_litres: 1, agreed_price: 180, line_total: 180 }), blocked);
    for (const change of [{ account_id: Number(account) + 1 }, { total_amount: 1700 }, { issue_date: null }, { notes: 'Changed original text' }, { status: 'draft' }, { status: 'open' }, { status: 'void' }]) {
      await assert.rejects(db('customer_invoices').where({ id: invoice }).update(change), blocked);
    }
    await assert.rejects(db('customer_invoices').where({ id: invoice }).delete(), blocked);
    await assert.rejects(db('customer_invoices').where({ id: legacyVoid }).update({ status: 'issued' }), blocked);
    await assert.rejects(db('customer_invoices').where({ id: fuelDebit }).update({ status: 'void' }), blocked, 'historical debit-note fuel stays fixed too');
    await assert.rejects(voidIssuedCustomerInvoice(db, { invoiceId: Number(fuelDebit), voidDate: '2026-10-04', reason: 'Review the historical fuel debit' }), (error: any) => error.code === 'ISSUED_INVOICE_SOURCE_FIXED');
    // Settlement caches remain usable, and a no-op recomputation is valid.
    await db('customer_invoices').where({ id: invoice }).update({ total_amount: 1800, status: 'partial', balance: 1700, adjustment_total: -100 });
    await db('invoice_consumption').where({ id: source }).update({ litres: 10 });
    assert.equal((await issuedSourceState(db, { invoice_line_id: line })).issued_source_locked, true);
    await assert.rejects(assertIssuedSourceUnlocked(db, { invoice_line_id: line }), (error: any) => error.code === 'ISSUED_INVOICE_SOURCE_FIXED');
    await assert.rejects(db.transaction((trx) => releaseInvoiceReservation(trx, Number(invoice))), (error: any) => error.code === 'ISSUED_INVOICE_SOURCE_FIXED');
    assert.deepEqual(await db('invoice_consumption').whereIn('id', [source, historicalReversed]).orderBy('id'), original);
    console.log('PASS issued source, line and original invoice facts are fixed independently of shift status');

    const [draft] = await db('customer_invoices').insert({ account_id: account, invoice_number: 'SOURCE-GUARD-DRAFT', from_date: '2026-10-01', to_date: '2026-10-01', status: 'draft' });
    const [draftLine] = await db('invoice_lines').insert({ invoice_id: draft, fuel_type: 'petrol', total_litres: 10, agreed_price: 180, line_total: 1800 });
    await db('invoice_consumption').where({ id: unbilled }).update({ invoice_line_id: draftLine });
    assert.equal((await issuedSourceState(db, { invoice_line_id: draftLine })).issued_source_locked, false);
    assert.equal(await db.transaction((trx) => releaseInvoiceReservation(trx, Number(draft))), 1);
    assert.equal((await db('invoice_consumption').where({ id: unbilled }).first()).invoice_line_id, null);

    // An older correction may have reversed a source without adding a row.
    // Its original's issued link also prevents undo from reactivating it.
    const blocker = await fuelOnAccountRule.undoBlocker(db, {}, [{ action: 'reverse', target_id: historicalReversed, correction_id: 17 }]);
    assert.match(blocker || '', /original fuel is fixed on invoice/);
    await db('invoice_adjustment_notes').insert({ account_id: account, invoice_id: invoice,
      note_number: 'SOURCE-GUARD-HELD-CREDIT', note_type: 'credit_note', note_date: '2026-10-04',
      amount: 1, signed_amount: -1, applied_amount: 0, unapplied_amount: 1,
      correction: 'amount', reason: 'Held credit mode guard fixture', status: 'posted' });
    await assert.rejects(db('credit_accounts').where({ id: account }).update({ billing_mode: 'money' }), /holds invoice credit/);
    await db('credit_accounts').where({ id: account }).update({ name: 'Source Guard Customer Renamed' });
    console.log('PASS draft release remains available and historical issued-source undo is refused');
    console.log('PASS held invoice credit blocks an account-mode change atomically');
    await assert.rejects(migration.down(), /verified pre-update backup/);
  } finally {
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error('FAIL', error); process.exitCode = 1; });
