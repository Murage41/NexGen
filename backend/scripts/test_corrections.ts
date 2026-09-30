import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Corrections (services/corrections.ts, docs/CORRECTIONS.md), phase 1: fuel on
// account. Every error kind at every stage (not yet invoiced, in a draft, on an
// issued invoice paid or not), the attendant rule on shortage and surplus
// shifts with both routings, the notes, approval bound to the preview, undo,
// the register, and that closed shifts keep showing what they closed with.
// Runs on a private temporary database; never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-corrections-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'corrections-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { getVarianceStatement, postShiftVariance } = await import('../src/services/employeeVariances');
  const { accountabilityFromRows } = await import('../src/services/shiftSnapshot');
  const migration = await import('../migrations/20260930_053_corrections');
  const { default: invoicesRouter } = await import('../src/routes/customerInvoices');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: correctionsRouter } = await import('../src/routes/corrections');
  const { default: authRouter } = await import('../src/routes/auth');

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();

    const today = getKenyaDate();
    const year = today.slice(0, 4);
    const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    const [attendant] = await db('employees').insert({ name: 'Day Attendant', daily_wage: 0, pin: hashPin('9999'), role: 'attendant', active: true });
    const [admin] = await db('employees').insert({ name: 'Owner Admin', daily_wage: 0, pin: hashPin('4821'), role: 'admin', active: true });
    await db('credit_accounts').insert({ name: 'Day Attendant', type: 'employee', employee_id: attendant, balance: 0 });
    const [petrolTank] = await db('tanks').insert({ label: 'Petrol', fuel_type: 'petrol', capacity_litres: 10000 });
    const [dieselTank] = await db('tanks').insert({ label: 'Diesel', fuel_type: 'diesel', capacity_litres: 10000 });
    const [petrolPump] = await db('pumps').insert({ label: 'P1', nozzle_label: 'P', fuel_type: 'petrol', tank_id: petrolTank, active: true });
    const [dieselPump] = await db('pumps').insert({ label: 'D1', nozzle_label: 'D', fuel_type: 'diesel', tank_id: dieselTank, active: true });
    await db('fuel_prices').insert([
      { fuel_type: 'petrol', price_per_litre: 180, effective_date: '2020-01-01' },
      { fuel_type: 'diesel', price_per_litre: 190, effective_date: '2020-01-01' },
    ]);
    const customer = async (name: string) =>
      (await db('credit_accounts').insert({ name, type: 'customer', billing_mode: 'invoice', balance: 0, payment_terms_days: 30 }))[0] as number;
    const delta = await customer('Delta Haulage');
    const gamma = await customer('Gamma Transport');
    const price = { petrol: 180, diesel: 190 } as const;

    // A closed shift: pump sales, fuel on account, cash that leaves the given
    // result, its snapshot, and the attendant's variance entry, as a close does.
    const closedShift = async (date: string, petrol: number, diesel: number, entries: Array<[number, 'petrol' | 'diesel', number]>, result: number) => {
      const [shiftId] = await db('shifts').insert({ employee_id: attendant, shift_date: date, start_time: `${date}T06:00:00Z`, end_time: `${date}T18:00:00Z`, status: 'closed', wage_paid: 0 });
      await db('pump_readings').insert([
        { shift_id: shiftId, pump_id: petrolPump, opening_litres: 0, closing_litres: petrol, opening_amount: 0, closing_amount: petrol * 180, litres_sold: petrol, amount_sold: petrol * 180 },
        { shift_id: shiftId, pump_id: dieselPump, opening_litres: 0, closing_litres: diesel, opening_amount: 0, closing_amount: diesel * 190, litres_sold: diesel, amount_sold: diesel * 190 },
      ]);
      const ids: number[] = [];
      let onAccount = 0;
      for (const [account, fuel, litres] of entries) {
        onAccount += litres * price[fuel];
        ids.push((await db('invoice_consumption').insert({
          account_id: account, shift_id: shiftId, pump_id: fuel === 'petrol' ? petrolPump : dieselPump, tank_id: fuel === 'petrol' ? petrolTank : dieselTank,
          fuel_type: fuel, litres, retail_price_at_time: price[fuel], retail_amount: litres * price[fuel], entry_status: 'active',
        }))[0] as number);
      }
      await db('shift_collections').insert({ shift_id: shiftId, cash_amount: petrol * 180 + diesel * 190 - onAccount + result, mpesa_amount: 0 });
      const a = await accountabilityFromRows(db, shiftId);
      assert.equal(a.variance, result);
      await db('shift_close_reconciliations').insert({
        shift_id: shiftId, readings_reviewed: true, collections_reviewed: true, entries_reviewed: true,
        expected_sales: a.expected_sales, expected_shift_total: a.expected_shift_total, cash_received: a.total_cash, mpesa_received: a.total_mpesa,
        credit_receipts: a.total_credit_receipts, credits_issued: a.total_credits, invoice_consumption: a.total_invoice_consumption, expenses: a.total_expenses,
        direct_wage_payment: a.employee_wage, payroll_payments: a.total_payroll_payments, total_accounted: a.total_accounted, variance: a.variance,
        variance_type: result < 0 ? 'deficit' : result > 0 ? 'surplus' : 'balanced', approved_by_employee_id: admin, approved_by_role: 'admin', approved_at: `${date}T18:00:00Z`,
      });
      await db.transaction((trx) => postShiftVariance(trx, { id: shiftId, employee_id: attendant, shift_date: date }, result, admin));
      return { id: shiftId as number, entries: ids };
    };

    // s1: short 300. e1 was petrol (recorded diesel); e2 never taken; e3 wrong litres.
    const s1 = await closedShift(daysAgo(10), 100, 200, [[delta, 'diesel', 50], [delta, 'diesel', 20], [delta, 'petrol', 30]], -300);
    const [e1, e2, e3] = s1.entries;
    // s2: over 200. e4, e5 go on an issued invoice; e6 was Delta's, not Gamma's.
    const s2 = await closedShift(daysAgo(9), 100, 100, [[delta, 'petrol', 40], [delta, 'diesel', 10], [gamma, 'petrol', 20]], 200);
    const [e4, e5, e6] = s2.entries;
    // s3: balanced, nothing on account.
    const s3 = await closedShift(daysAgo(8), 100, 100, [], 0);
    const [openShift] = await db('shifts').insert({ employee_id: attendant, shift_date: today, start_time: `${today}T06:00:00Z`, status: 'open', wage_paid: 0 });
    const [onOpenShift] = await db('invoice_consumption').insert({
      account_id: delta, shift_id: openShift, pump_id: dieselPump, tank_id: dieselTank, fuel_type: 'diesel', litres: 5, retail_price_at_time: 190, retail_amount: 950, entry_status: 'active',
    });

    // ---- The migration: repeatable, backfills a closed shift without a snapshot ----
    const [old] = await db('shifts').insert({ employee_id: attendant, shift_date: daysAgo(30), start_time: `${daysAgo(30)}T06:00:00Z`, end_time: `${daysAgo(30)}T18:00:00Z`, status: 'closed', wage_paid: 0 });
    await db('shift_collections').insert({ shift_id: old, cash_amount: 500, mpesa_amount: 0 });
    await migration.up(db);
    const backfilled = await db('shift_close_reconciliations').where({ shift_id: old }).first();
    assert.equal(Number(backfilled.backfilled), 1);
    assert.equal(Number(backfilled.variance), 500, 'from its rows as they stood');
    assert.equal(Number((await db('shift_close_reconciliations').where({ shift_id: s1.id }).first()).backfilled), 0, 'a real snapshot is left alone');
    console.log('PASS migration is repeatable and backfills a missing snapshot, marked backfilled');

    // ---- Guards ----
    await assert.rejects(db('invoice_consumption').where({ id: e1 }).update({ litres: 49 }), /cannot be changed/);
    await assert.rejects(db('invoice_consumption').where({ id: e1 }).delete(), /cannot be changed/);
    await assert.rejects(db('pump_readings').where({ shift_id: s1.id }).update({ closing_litres: 1 }), /cannot be changed/);
    await assert.rejects(db('shift_collections').where({ shift_id: s1.id }).update({ cash_amount: 1 }), /cannot be changed/);
    await assert.rejects(db('shift_close_reconciliations').where({ shift_id: s1.id }).update({ variance: 0 }), /never changed/);
    await assert.rejects(db('shift_close_reconciliations').where({ shift_id: s1.id }).delete(), /never changed/);
    await db('invoice_consumption').where({ id: onOpenShift }).update({ litres: 5 });
    await db('invoice_consumption').where({ id: e1 }).update({ invoice_line_id: null, updated_at: db.fn.now() });
    console.log("PASS the database refuses changes to a closed shift's facts and its snapshot; status and links stay writable");

    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
    app.use(auth.requireAuth);
    app.use('/inv', invoicesRouter);
    app.use('/shifts', shiftsRouter);
    app.use('/corrections', correctionsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const phoneAdmin = { Authorization: `Bearer ${auth.generateToken(admin, 'admin')}` };
    const attendantSession = { Authorization: `Bearer ${auth.generateToken(attendant, 'attendant')}` };
    const call = async (method: string, url: string, headers: Record<string, string> = desktop, body?: any) => {
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() as any };
    };
    const token = async (purpose: string, fields: Record<string, unknown>) => {
      const r = await call('POST', '/auth/verify-pin', desktop, { employee_id: admin, pin: '4821', purpose, ...fields });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data.approval_token as string;
    };
    const reason = { reason_code: 'found_on_reconciling', reason_note: 'Checked against the issue book' };
    const preview = async (request: Record<string, unknown>, headers = desktop) =>
      call('POST', '/corrections/preview', headers, { record_type: 'fuel_on_account', ...reason, ...request });
    // Preview, approve that exact plan, post.
    const correct = async (request: Record<string, unknown>, headers = desktop) => {
      const body = { record_type: 'fuel_on_account', ...reason, ...request };
      const p = await call('POST', '/corrections/preview', headers, body);
      assert.equal(p.status, 200, JSON.stringify(p.body));
      const approval = headers === desktop ? { approval_token: await token('correction', { plan_hash: p.body.data.plan_hash }) } : {};
      const posted = await call('POST', '/corrections', headers, { ...body, plan_hash: p.body.data.plan_hash, ...approval });
      return { preview: p.body.data, ...posted };
    };
    const row = (id: number) => db('invoice_consumption').where({ id }).first();
    const owed = async (shiftId: number) => (await getVarianceStatement(db, attendant)).rows.find((r: any) => r.shift_id === shiftId)?.owed || 0;
    const onAccount = async () => Number((await db('credit_accounts').where({ employee_id: attendant, type: 'employee' }).first()).balance);
    const shiftView = async (shiftId: number, headers = desktop) => (await call('GET', `/shifts/${shiftId}`, headers)).body.data;
    const before = { s1: await shiftView(s1.id), s2: await shiftView(s2.id), s3: await shiftView(s3.id) };
    assert.equal(before.s1.variance, -300);
    assert.equal(await owed(s1.id), 300);

    // ---- Refusals ----
    assert.equal((await preview({ error_kind: 'duplicate', target_id: e2 }, attendantSession)).status, 403, 'administrators only');
    assert.equal((await preview({ error_kind: 'duplicate', target_id: onOpenShift })).body.code, 'SHIFT_OPEN');
    assert.equal((await preview({ error_kind: 'wrong_litres', target_id: e3, litres: 30 })).body.code, 'NO_CHANGE');
    assert.equal((await preview({ error_kind: 'wrong_litres', target_id: e3, litres: 101 })).body.code, 'LITRES_EXCEED_PUMP_SALES', 'the petrol pumps sold 100 L');
    assert.equal((await preview({ error_kind: 'wrong_customer', target_id: e3, account_id: delta })).body.code, 'NO_CHANGE');
    assert.equal((await preview({ error_kind: 'missing', account_id: gamma, shift_id: openShift, fuel_type: 'diesel', litres: 1 })).body.code, 'SHIFT_OPEN');
    assert.equal((await preview({ error_kind: 'teleport', target_id: e3 })).body.code, 'INVALID_ERROR_KIND');
    const p1 = (await preview({ error_kind: 'wrong_fuel', target_id: e1, fuel_type: 'petrol' })).body.data;
    assert.equal(p1.needs_choice, true, 'the shift gets worse: who carries it?');
    const body1 = { record_type: 'fuel_on_account', error_kind: 'wrong_fuel', target_id: e1, fuel_type: 'petrol', ...reason };
    assert.equal((await call('POST', '/corrections', desktop, { ...body1, plan_hash: p1.plan_hash })).status, 400, 'the desktop needs a PIN');
    const t1 = await token('correction', { plan_hash: p1.plan_hash });
    assert.equal((await call('POST', '/corrections', desktop, { ...body1, plan_hash: p1.plan_hash, approval_token: t1 })).body.code, 'CHOICE_REQUIRED');
    const withChoice = { ...body1, charge_to: 'attendant' };
    assert.equal((await call('POST', '/corrections', desktop, { ...withChoice, plan_hash: p1.plan_hash, approval_token: t1 })).body.code, 'PLAN_CHANGED', 'the choice is part of what was approved');
    const p1b = (await preview(withChoice)).body.data;
    assert.notEqual((await call('POST', '/corrections', desktop, { ...withChoice, plan_hash: p1b.plan_hash, approval_token: t1 })).status, 201, 'an approval is for that exact plan');
    assert.equal((await call('POST', '/corrections', desktop, { ...withChoice, reason_note: 'short', plan_hash: p1b.plan_hash, approval_token: await token('correction', { plan_hash: p1b.plan_hash }) })).body.code, 'REASON_REQUIRED');
    assert.equal((await row(e1)).entry_status, 'active', 'nothing changed by the refusals');
    assert.equal(await db('corrections').count({ n: 'id' }).first().then((r: any) => Number(r.n)), 0);
    console.log('PASS refusals: admins only, closed shifts only, a real change, pump sales cap, the choice, PIN bound to the exact plan, a reason');

    // ---- 1. Wrong fuel, not yet invoiced; worse by 500, the attendant carries it ----
    const c1 = await correct({ error_kind: 'wrong_fuel', target_id: e1, fuel_type: 'petrol', charge_to: 'attendant' });
    assert.equal(c1.status, 201, JSON.stringify(c1.body));
    assert.equal(c1.body.data.number, `C-${year}-0001`);
    assert.equal(c1.body.data.approved_by_name, 'Owner Admin');
    assert.deepEqual(c1.preview.shifts.map((s: any) => [s.shift_id, s.as_closed, s.change, s.corrected]), [[s1.id, -300, -500, -800]]);
    const e1b = c1.body.data.lines.find((l: any) => l.action === 'add').created_record_id;
    assert.deepEqual(
      await row(e1b).then((r: any) => [r.fuel_type, Number(r.litres), Number(r.retail_price_at_time), Number(r.retail_amount), r.shift_id, r.correction_of_id, r.invoice_line_id]),
      ['petrol', 50, 180, 9000, s1.id, e1, null],
    );
    assert.deepEqual(await row(e1).then((r: any) => [r.entry_status, Boolean(r.deleted_at), r.reversed_by_record_correction_id]), ['reversed', true, c1.body.data.id]);
    assert.equal(await owed(s1.id), 800, 'shortage 300 + 500');
    assert.equal(await onAccount(), 800);
    assert(c1.body.data.effects.some((e: string) => /Tank stock and fuel cost: no change/.test(e)));
    console.log('PASS wrong fuel before invoicing: reversed, petrol added at the shift price, the attendant carries the 500');

    // A draft takes s1's fuel.
    const draft = await call('POST', '/inv', desktop, { account_id: delta, from_date: daysAgo(10), to_date: daysAgo(10), agreed_prices: { diesel: 185, petrol: 175 } });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const draftId = draft.body.data.id;
    const draftLines = async () => Object.fromEntries((await db('invoice_lines').where({ invoice_id: draftId })).map((l: any) => [l.fuel_type, Number(l.total_litres)]));
    assert.deepEqual(await draftLines(), { diesel: 20, petrol: 80 });

    // ---- 2. Never taken, in a draft; from the phone; the station carries it ----
    const c2 = await correct({ error_kind: 'duplicate', target_id: e2, charge_to: 'station' }, phoneAdmin);
    assert.equal(c2.status, 201, JSON.stringify(c2.body));
    assert.equal(c2.preview.lines[0].stage, 'draft');
    assert.deepEqual(await draftLines(), { petrol: 80 }, 'the emptied diesel line goes');
    assert.equal(await owed(s1.id), 800, 'not their doing: unchanged');
    assert.equal((await db('employee_variance_entries').where({ record_correction_id: c2.body.data.id })).length, 0);
    assert.equal(c2.body.data.lines[0].charge_to, 'station');
    console.log('PASS recorded but not taken, in a draft: reversed, the draft refreshed, the station carries it');

    // ---- 3. Wrong litres in a draft, better: always the attendant's ----
    const c3 = await correct({ error_kind: 'wrong_litres', target_id: e3, litres: 32 });
    assert.equal(c3.status, 201, JSON.stringify(c3.body));
    assert.equal(c3.preview.needs_choice, false);
    assert.deepEqual(c3.preview.shifts.map((s: any) => [s.as_closed, s.earlier, s.change, s.corrected]), [[-300, -4300, 360, -4240]], 'counted on top of the earlier corrections');
    assert.equal(await owed(s1.id), 440, '800 - 2 L x 180');
    assert.deepEqual(await draftLines(), { petrol: 82 });
    console.log('PASS wrong litres in a draft: better by 360, it reduces what the attendant owes; the draft refreshed');

    // ---- An issued, paid invoice for s2 ----
    const inv = await call('POST', '/inv', desktop, { account_id: delta, from_date: daysAgo(9), to_date: daysAgo(9), agreed_prices: { diesel: 185, petrol: 175 } });
    const invId = inv.body.data.id;
    assert.equal((await call('POST', `/inv/${invId}/issue`, desktop, {})).status, 200);
    const invoice = async () => db('customer_invoices').where({ id: invId }).first();
    assert.equal(Number((await invoice()).total_amount), 40 * 175 + 10 * 185);
    assert.equal((await call('POST', '/inv/payments', desktop, { account_id: delta, amount: 8850, payment_method: 'cash' })).status, 201);
    assert.equal((await invoice()).status, 'paid');

    // ---- 4. Wrong litres on a paid invoice, a surplus shift, the attendant ----
    const c4 = await correct({ error_kind: 'wrong_litres', target_id: e5, litres: 8, charge_to: 'attendant' });
    assert.equal(c4.status, 201, JSON.stringify(c4.body));
    const cn4 = c4.preview.documents[0];
    assert.deepEqual([cn4.type, cn4.fuel_type, cn4.litres, cn4.unit_price, cn4.amount, cn4.held_as_credit], ['credit_note', 'diesel', 2, 185, 370, 370], "at the invoice's price; all held (paid)");
    const note4 = await db('invoice_adjustment_notes').where({ record_correction_id: c4.body.data.id }).first();
    assert.deepEqual([Number(note4.amount), Number(note4.unapplied_amount), note4.invoice_id], [370, 370, invId]);
    const event4 = await db('invoice_accounting_events').where({ adjustment_note_id: note4.id }).first();
    assert.equal(Number(event4.revenue_adjustment), 10, "only the price difference is revenue: the shift's result carries the 380");
    const e5b = c4.body.data.lines.find((l: any) => l.action === 'add').created_record_id;
    assert.equal((await row(e5b)).invoice_line_id, (await row(e5)).invoice_line_id, 'the right litres stay on the invoice');
    assert.equal(await owed(s2.id), 180, 'a surplus of 200 absorbs 200 of the 380 first');
    assert.equal(c4.body.data.lines.find((l: any) => l.document_type === 'credit_note').document_number, note4.note_number);
    console.log('PASS wrong litres on a paid invoice: credit note at the invoice price, held as credit, surplus absorbs first');

    // ---- 5. Wrong fuel on the same invoice: credit note, and a debit note paid by the held credit ----
    const c5 = await correct({ error_kind: 'wrong_fuel', target_id: e4, fuel_type: 'diesel' });
    assert.equal(c5.status, 201, JSON.stringify(c5.body));
    assert.deepEqual(c5.preview.documents.map((d: any) => [d.type, d.fuel_type, d.litres, d.unit_price, d.amount]), [
      ['credit_note', 'petrol', 40, 175, 7000],
      ['debit_note', 'diesel', 40, 185, 7400],
    ]);
    const dn5 = await db('customer_invoices').where({ record_correction_id: c5.body.data.id }).first();
    assert.deepEqual([dn5.document_kind, dn5.corrects_invoice_id, Number(dn5.total_amount), Number(dn5.balance)], ['debit_note', invId, 7400, 30], 'held credit 7370 pays it first');
    const e4b = c5.body.data.lines.find((l: any) => l.action === 'add').created_record_id;
    assert.equal((await db('invoice_lines').where({ id: (await row(e4b)).invoice_line_id }).first()).invoice_id, dn5.id, 'the diesel is billed by the debit note');
    assert.equal(await owed(s2.id), 0, 'better by 400: 180 owed goes');
    console.log('PASS wrong fuel on a paid invoice: credit note plus debit note, the held credit pays it');

    // ---- 6. Wrong customer: the plan changes when the invoice is issued in between ----
    const body6 = { record_type: 'fuel_on_account', error_kind: 'wrong_customer', target_id: e6, account_id: delta, ...reason };
    const p6 = (await call('POST', '/corrections/preview', desktop, body6)).body.data;
    assert.equal(p6.documents.length, 0);
    assert.equal(p6.needs_choice, false, 'same fuel, same price: the shift result does not move');
    const t6 = await token('correction', { plan_hash: p6.plan_hash });
    const gInv = (await call('POST', '/inv', desktop, { account_id: gamma, from_date: daysAgo(9), to_date: daysAgo(9), agreed_prices: { petrol: 170 } })).body.data.id;
    assert.equal((await call('POST', `/inv/${gInv}/issue`, desktop, {})).status, 200);
    assert.equal((await call('POST', '/corrections', desktop, { ...body6, plan_hash: p6.plan_hash, approval_token: t6 })).body.code, 'PLAN_CHANGED');
    const c6 = await correct({ error_kind: 'wrong_customer', target_id: e6, account_id: delta });
    assert.equal(c6.status, 201, JSON.stringify(c6.body));
    assert.deepEqual(c6.preview.documents.map((d: any) => [d.type, d.amount, d.held_as_credit]), [['credit_note', 3400, 0]], 'unpaid: the note reduces what Gamma owes');
    assert.equal(Number((await db('customer_invoices').where({ id: gInv }).first()).balance), 0);
    const e6b = c6.body.data.lines.find((l: any) => l.action === 'add').created_record_id;
    assert.deepEqual(await row(e6b).then((r: any) => [r.account_id, r.invoice_line_id]), [delta, null], "on Delta's unbilled fuel");
    console.log('PASS wrong customer: approval refused once the invoice was issued; then a credit note and the fuel moves to the right customer');

    // ---- 7. Wrong shift on an issued invoice: no notes ----
    const c7 = await correct({ error_kind: 'wrong_shift', target_id: e5b, shift_id: s3.id, charge_to: 'station' });
    assert.equal(c7.status, 201, JSON.stringify(c7.body));
    assert.equal(c7.preview.documents.length, 0);
    assert.deepEqual(c7.preview.shifts.map((s: any) => [s.shift_id, s.change]), [[s2.id, -1520], [s3.id, 1520]]);
    assert.equal((await row(c7.body.data.lines[1].created_record_id)).invoice_line_id, (await row(e5b)).invoice_line_id);
    assert.equal(await owed(s2.id), 0, 'worse, the station carries it');
    assert.equal(await owed(s3.id), 0, 'better: a surplus is the station\'s');
    console.log('PASS wrong shift on an issued invoice: it stays billed; one shift worse, the other better');

    // ---- 8. Missing, then the pump cap ----
    assert.equal((await preview({ error_kind: 'missing', account_id: gamma, shift_id: s3.id, fuel_type: 'diesel', litres: 93 })).body.code, 'LITRES_EXCEED_PUMP_SALES', '8 L already on account');
    const c8 = await correct({ error_kind: 'missing', account_id: gamma, shift_id: s3.id, fuel_type: 'diesel', litres: 15 });
    assert.equal(c8.status, 201, JSON.stringify(c8.body));
    assert.equal(c8.body.data.number, `C-${year}-0008`);
    console.log('PASS missing fuel added at the shift price, within what the pumps sold');

    // ---- A note made by hand on the same invoice: warned, and never more litres credited than billed ----
    const e7b = c7.body.data.lines.find((l: any) => l.action === 'add').created_record_id;
    const manual = { note_type: 'credit_note', correction: 'litres', fuel_type: 'diesel', litres: 1 };
    const manualToken = await token('invoice_note', { account_id: delta, invoice_id: invId, ...manual });
    assert.equal((await call('POST', `/inv/${invId}/adjustments`, desktop, { ...manual, reason: 'One litre spilt at the pump', approval_token: manualToken })).status, 201);
    const warned = (await preview({ error_kind: 'wrong_litres', target_id: e7b, litres: 7.5, charge_to: 'station' })).body.data;
    assert(warned.effects.some((e: string) => /^Check: invoice .* already has credit note/.test(e)), JSON.stringify(warned.effects));
    assert.equal((await preview({ error_kind: 'duplicate', target_id: e7b, charge_to: 'station' })).body.code, 'CREDIT_LITRES_EXCEED_INVOICE', '3 L credited + 8 L > 10 L billed');
    console.log('PASS a hand-made note on the invoice is flagged; credits never exceed the litres billed');

    // ---- Closed shifts show what they closed with ----
    // Even if a row were added some other way, the figures stay the snapshot's.
    await db('shift_expenses').insert({ shift_id: s3.id, category: 'other', amount: 100 });
    assert.notEqual((await accountabilityFromRows(db, s3.id)).variance, 0, 'recalculating the rows would move it');
    for (const [key, shift] of [['s1', s1], ['s2', s2], ['s3', s3]] as const) {
      const view = await shiftView(shift.id);
      assert.equal(view.variance, before[key].variance, `${key}: the result as closed`);
      assert.equal(view.total_invoice_consumption, before[key].total_invoice_consumption);
      assert.deepEqual(view.invoice_consumption.map((e: any) => e.id).sort(), before[key].invoice_consumption.map((e: any) => e.id).sort(), `${key}: the entries as closed`);
    }
    const s1View = await shiftView(s1.id);
    assert.equal(s1View.record_corrections.change, -3940, '-500 - 3800 + 360');
    assert.equal(s1View.record_corrections.corrected_variance, -4240);
    const s1Attendant = await shiftView(s1.id, attendantSession);
    assert.equal(s1Attendant.record_corrections.lines.length, 5);
    assert.equal(s1Attendant.record_corrections.lines[0].party_name, undefined, 'the attendant sees what changed, not customer details');
    const history = (await call('GET', `/inv/customers/${delta}/consumption?page_size=50&status=all`)).body.data;
    const status = Object.fromEntries(history.rows.map((r: any) => [r.id, r.billing_status]));
    assert.deepEqual([status[e2], status[e1b], status[e6b]], ['reversed', 'reserved', 'unbilled']);
    console.log('PASS closed shifts keep their snapshot and entries as closed; the corrected result and history show the corrections');

    // ---- Undo ----
    const u4 = await call('POST', `/corrections/${c4.body.data.id}/undo`, phoneAdmin, { reason_note: 'The litres were right' });
    assert.equal(u4.body.code, 'UNDO_BLOCKED', 'it made a credit note');
    assert.equal((await call('POST', `/corrections/${c1.body.data.id}/undo`, desktop, { reason_note: 'It was diesel after all' })).status, 400, 'the desktop needs a PIN');
    const u1 = await call('POST', `/corrections/${c1.body.data.id}/undo`, desktop, {
      reason_note: 'It was diesel after all',
      approval_token: await token('correction_undo', { correction_id: c1.body.data.id }),
    });
    assert.equal(u1.status, 201, JSON.stringify(u1.body));
    assert.deepEqual([u1.body.data.kind, u1.body.data.undoes_correction_id], ['undo', c1.body.data.id]);
    assert.equal((await db('corrections').where({ id: c1.body.data.id }).first()).status, 'undone');
    assert.equal((await row(e1)).entry_status, 'active');
    assert.equal((await row(e1b)).entry_status, 'reversed');
    assert.equal(await owed(s1.id), 0, '300 + 500 - 360 - 500: now a surplus');
    assert.equal((await db('employee_variance_entries').where({ record_correction_id: u1.body.data.id }).first()).amount, -500);
    assert.equal(await onAccount(), await owed(s1.id) + await owed(s2.id) + await owed(s3.id));
    assert.deepEqual(await draftLines(), { petrol: 32, diesel: 50 }, 'the draft lets go of the petrol and takes the diesel back');
    assert.equal((await shiftView(s1.id)).record_corrections.change, -3440);
    assert.equal((await call('POST', `/corrections/${c1.body.data.id}/undo`, phoneAdmin, { reason_note: 'a second time over' })).body.code, 'UNDO_BLOCKED');
    console.log('PASS undo: a cancelling correction; blocked when it made notes or was undone');

    // ---- The register ----
    const list = (await call('GET', '/corrections')).body.data;
    assert.equal(list.length, 9);
    assert.equal((await call('GET', `/corrections?shift_id=${s3.id}`)).body.data.length, 2);
    assert.equal((await call('GET', '/corrections', attendantSession)).status, 403);
    const detail = (await call('GET', `/corrections/${c5.body.data.id}`)).body.data;
    assert.deepEqual(detail.lines.map((l: any) => l.document_type), ['credit_note', 'debit_note']);
    assert.match(detail.undo_blocked_by, /^It made CN-.* and DN-/);
    console.log('PASS the register lists every correction with its lines and documents');
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
