import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Opening corrections and actual custody movements use the existing approved
// correction transaction. Every fixture lives in this private temporary DB.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-float-corrections-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'float-corrections-private-test-key';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { default: router } = await import('../src/routes/corrections');
  const { previewCorrection, postCorrection, undoCorrection, undoBlocker, shiftCorrections } = await import('../src/services/corrections');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const [admin] = await db('employees').insert({ name: 'Float Test Admin', daily_wage: 0, role: 'admin', pin: hashPin('7346'), active: true });
    const [attendant] = await db('employees').insert({ name: 'Float Test Attendant', daily_wage: 0, role: 'attendant', pin: hashPin('7347'), active: true });
    const day = '2026-10-16';
    const approver = { id: Number(admin), name: 'Float Test Admin' };
    const context = { approver, actorId: Number(admin), date: day };
    const reason = { reason_code: 'office_mistake', reason_note: 'Confirmed against the handover book' };
    const opening = (id: number, amount: number, extra: Record<string, unknown> = {}) => ({
      record_type: 'opening_funds', error_kind: 'wrong_amount', shift_id: id, payment_method: 'cash', amount, ...reason, ...extra,
    });
    const movement = (id: number, amount: number, extra: Record<string, unknown> = {}) => ({
      record_type: 'shift_funds', error_kind: 'missing', shift_id: id, amount, payment_method: 'cash', category: 'added',
      source: 'station_bank_safe', reference: 'HANDOVER-TEST-01', description: 'Cash provided from the station safe', ...reason, ...extra,
    });
    const preview = (request: any) => previewCorrection(db, request, day);
    const post = async (request: any) => {
      const plan = await preview(request);
      const posted = await db.transaction(trx => postCorrection(trx, request, { ...context, planHash: plan.plan_hash }));
      return { ...posted, plan };
    };
    const undo = (correctionId: number) => db.transaction(trx => undoCorrection(trx, { ...context, correctionId, reasonNote: 'Undo after checking the handover book' }));
    const fails = (action: Promise<unknown>, code: string) => assert.rejects(action, (err: any) => err.code === code);
    const [shiftId] = await db('shifts').insert({
      employee_id: attendant, shift_date: day, start_time: `${day}T05:00:00`, status: 'open', wage_paid: 0,
      reconciliation_basis: 'balances_v1', opening_cash_amount: 2000, opening_mpesa_amount: 3000,
    });
    const id = Number(shiftId);
    const [legacyId] = await db('shifts').insert({ employee_id: attendant, shift_date: day, start_time: `${day}T02:00:00`, status: 'closed', wage_paid: 0 });
    await fails(preview(opening(Number(legacyId), 100)), 'LEGACY_SHIFT');
    await fails(preview(movement(Number(legacyId), 100)), 'LEGACY_SHIFT');
    for (const amount of [null, undefined, '', -1, Infinity, NaN, 100_000_001]) {
      await fails(preview(opening(id, amount as any)), 'INVALID_AMOUNT');
    }
    await fails(preview(opening(id, 2000)), 'NO_CHANGE');
    await fails(preview(opening(id, 100, { payment_method: null })), 'METHOD_REQUIRED');
    for (const fields of [
      { amount: 0 }, { amount: -1 }, { amount: Infinity }, { amount: 100_000_001 },
      { category: 'expense' }, { source: 'payroll' }, { reference: '' }, { description: '' },
    ]) {
      await assert.rejects(preview(movement(id, 100, fields)));
    }
    console.log('PASS opening/movement validation: legacy, explicit amount, finite/capped money, custody source and explanation');

    const zero = await post(opening(id, 0));
    assert.equal(zero.plan.lines[1].amount, 0);
    assert.equal(zero.plan.shifts.length, 0, 'pre-close declaration has no employee debt entry');
    await undo(zero.id);
    const first = await post(opening(id, 2500));
    const second = await post(opening(id, 2600));
    assert.match(String(await undoBlocker(db, first.id)), /corrected the same opening/);
    await undo(second.id);
    assert.equal(await undoBlocker(db, first.id), null);
    assert.equal(Number((await db('shifts').where({ id }).first()).opening_cash_amount), 2000, 'raw opening is immutable');
    await assert.rejects(db('shifts').where({ id }).update({ opening_cash_amount: 2500 }), /cannot be changed/);

    const stale = await preview(opening(id, 2800));
    const transient = await post(opening(id, 2700));
    await undo(transient.id);
    await fails(db.transaction(trx => postCorrection(trx, opening(id, 2800), { ...context, planHash: stale.plan_hash })), 'PLAN_CHANGED');
    const staleOnClose = await preview(opening(id, 2800));
    const topup = await post(movement(id, 1000));
    const topupRow = await db('shift_funds_movements').where({ created_by_record_correction_id: topup.id }).first();
    assert.equal(topupRow.amount, 1000);
    assert.match(topupRow.reason, /station safe.*handover book/);
    await assert.rejects(db('shift_funds_movements').where({ id: topupRow.id }).update({ amount: 999 }), /cannot be changed/);
    await assert.rejects(db('shift_funds_movements').where({ id: topupRow.id }).delete(), /cannot be deleted/);
    await fails(db.transaction(trx => postCorrection(trx, movement(id, 1000), { ...context, planHash: topup.plan.plan_hash })), 'PLAN_CHANGED');
    const removed = await post(movement(id, 300, { category: 'removed', source: 'owner', reference: 'OWNER-TEST-01', description: 'Cash collected by the owner at handover' }));
    assert.equal(removed.plan.lines[0].shift_effect, 300);
    assert.equal((await db('employee_variance_entries').where({ shift_id: id })).length, 0);
    console.log('PASS pre-close amendments: zero, immutable original, ordered undo, full history in approval hash, custody movements without debt entries');

    // Close captured the effective opening 5,500 and net movements +700.
    // None of those pre-close effects may be added to the saved zero variance.
    await db('shift_collections').insert({ shift_id: id, cash_amount: 3200, mpesa_amount: 3000, credits_amount: 0, total_collected: 6200 });
    await db('shifts').where({ id }).update({ status: 'closed', end_time: `${day}T18:00:00` });
    await db('shift_close_reconciliations').insert({
      shift_id: id, readings_reviewed: true, collections_reviewed: true, entries_reviewed: true,
      expected_sales: 0, expected_shift_total: 6500, cash_received: 3200, mpesa_received: 3000, credit_receipts: 0,
      credits_issued: 0, invoice_consumption: 0, expenses: 0, direct_wage_payment: 0, payroll_payments: 0,
      total_accounted: 6500, variance: 0, variance_type: 'balanced', approved_by_role: 'admin', approved_at: `${day}T18:00:00`,
      reconciliation_basis: 'balances_v1', opening_cash_amount: 2500, opening_mpesa_amount: 3000,
      funds_added_cash: 1000, funds_added_mpesa: 0, funds_added_total: 1000, funds_removed_cash: 300, funds_removed_mpesa: 0,
      funds_removed_total: 300, drawer_business_payouts: 0, expected_closing: 6200, inferred_collections: 0, expected_receipts: 0,
    });
    const storedClose = await db('shift_close_reconciliations').where({ shift_id: id }).first();
    assert.match(String(await undoBlocker(db, first.id)), /included when the shift closed/);
    assert.match(String(await undoBlocker(db, topup.id)), /included when the shift closed/);
    await fails(db.transaction(trx => postCorrection(trx, opening(id, 2800), { ...context, planHash: staleOnClose.plan_hash })), 'PLAN_CHANGED');
    assert.equal((await shiftCorrections(db, id, 0)).corrected_variance, 0);
    const closedOpening = await post(opening(id, 2700, { charge_to: 'station' }));
    assert.deepEqual(closedOpening.plan.shifts.map(s => [s.earlier, s.change, s.corrected]), [[0, -200, -200]]);
    const noChoice = opening(id, 2800);
    const noChoicePlan = await preview(noChoice);
    await fails(db.transaction(trx => postCorrection(trx, noChoice, { ...context, planHash: noChoicePlan.plan_hash })), 'CHOICE_REQUIRED');
    const correction = await post(movement(id, 500, { category: 'removed', description: 'Cash sent to the station bank after counting' }));
    assert.deepEqual(correction.plan.shifts.map(s => [s.earlier, s.change, s.corrected]), [[-200, 500, 300]]);
    assert.equal((await shiftCorrections(db, id, 0)).corrected_variance, 300);
    assert.equal((await db('employee_variance_entries').where({ record_correction_id: closedOpening.id })).length, 0, 'station carries opening mistake');
    const row = await db('shift_funds_movements').where({ created_by_record_correction_id: correction.id }).first();
    const reverseReq = { record_type: 'shift_funds', error_kind: 'duplicate', target_id: row.id, charge_to: 'station', ...reason };
    const reverse = await post(reverseReq);
    assert.equal(reverse.plan.lines[0].shift_effect, -500);
    assert.equal((await db('shift_funds_movements').where({ id: row.id }).first()).reversed_by_record_correction_id, reverse.id);
    assert.match(String(await undoBlocker(db, correction.id)), /was reversed/);
    await fails(preview(reverseReq), 'MOVEMENT_NOT_ACTIVE');
    await undo(reverse.id);
    assert.equal((await db('shift_funds_movements').where({ id: row.id }).first()).deleted_at, null);
    await undo(correction.id);
    assert.equal((await shiftCorrections(db, id, 0)).corrected_variance, -200);
    await undo(closedOpening.id);
    assert.equal((await shiftCorrections(db, id, 0)).corrected_variance, 0);
    assert.deepEqual(await db('shift_close_reconciliations').where({ shift_id: id }).first(), storedClose);
    console.log('PASS post-close corrections: no pre-close double count, opposite opening sign, responsibility, dependent reversal/undo, original snapshot preserved');

    const app = express();
    app.use(express.json());
    app.use(auth.requireAuth);
    app.use('/corrections', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = `http://127.0.0.1:${(server.address() as any).port}`;
    const attendantResponse = await fetch(`${address}/corrections/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.generateToken(Number(attendant), 'attendant')}` },
      body: JSON.stringify(opening(id, 3000)),
    });
    assert.equal(attendantResponse.status, 403);
    const missingApproval = await preview(opening(id, 3000, { charge_to: 'station' }));
    const unapprovedResponse = await fetch(`${address}/corrections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-desktop-key': process.env.DESKTOP_KEY! },
      body: JSON.stringify({ ...opening(id, 3000, { charge_to: 'station' }), plan_hash: missingApproval.plan_hash }),
    });
    assert.equal(unapprovedResponse.status, 400);
    console.log('PASS existing server approval and admin-only correction gates apply to opening/funds rules');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
