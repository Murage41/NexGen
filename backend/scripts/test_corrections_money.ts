import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Corrections phase 2a (services/correctionRules/, docs/CORRECTIONS.md): a
// closed shift's credit sales, debt receipts, drawer expenses and cash/M-Pesa
// split. Shifts are recorded and closed through the real routes. Checks every
// error kind, what each customer owes and holds, the attendant rule, credit
// limits approved with the correction, the shifts staying as they closed, the
// database guards, undo, and the daily report. Runs on a private temporary
// database; never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-corrections-money-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'corrections-money-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { getVarianceStatement } = await import('../src/services/employeeVariances');
  const { customerCreditBalance } = await import('../src/services/receivablePayments');
  const migration = await import('../migrations/20261002_054_corrections_shift_money');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: correctionsRouter } = await import('../src/routes/corrections');
  const { default: reportsRouter } = await import('../src/routes/reports');
  const { default: authRouter } = await import('../src/routes/auth');

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    await migration.up(db);
    console.log('PASS migration 054 is repeatable');

    const today = getKenyaDate();
    const [attendant] = await db('employees').insert({ name: 'Day Attendant', daily_wage: 0, pin: hashPin('9999'), role: 'attendant', active: true });
    const [admin] = await db('employees').insert({ name: 'Owner Admin', daily_wage: 0, pin: hashPin('4821'), role: 'admin', active: true });
    await db('credit_accounts').insert({ name: 'Day Attendant', type: 'employee', employee_id: attendant, balance: 0 });
    const [plan] = await db('employee_compensation_plans').insert({
      employee_id: attendant, name: 'Daily', pay_schedule: 'daily', effective_from: '2026-01-01', version: 1, status: 'active',
    });
    await db('employee_compensation_components').insert({ plan_id: plan, component_type: 'fixed_per_shift', amount: 800 });
    const [tank] = await db('tanks').insert({ label: 'Petrol', fuel_type: 'petrol', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'P1', nozzle_label: 'P', fuel_type: 'petrol', tank_id: tank, active: true });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 180, effective_date: '2020-01-01' });
    const customer = async (name: string, extra: Record<string, unknown> = {}) =>
      (await db('credit_accounts').insert({ name, type: 'customer', billing_mode: 'money', balance: 0, ...extra }))[0] as number;
    const alpha = await customer('Alpha Hardware');
    const beta = await customer('Beta Motors', { credit_limit: 1000 });
    const gamma = await customer('Gamma Farm');
    const [invoiceOnly] = await db('credit_accounts').insert({ name: 'Invoice Fleet', type: 'customer', billing_mode: 'invoice', balance: 0 });

    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
    app.use(auth.requireAuth);
    app.use('/shifts', shiftsRouter);
    app.use('/corrections', correctionsRouter);
    app.use('/reports', reportsRouter);
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
    const ok = (r: { status: number; body: any }, status = 201) => {
      assert.equal(r.status, status, JSON.stringify(r.body));
      return r.body.data;
    };

    // A shift recorded through the real routes, then closed: litres sold,
    // credits, receipts and expenses, then cash and M-Pesa, and the 800 wage
    // paid from the drawer.
    const shiftRun = async (litres: number, record: (id: number) => Promise<void>, cash: number, mpesa: number) => {
      const [id] = await db('shifts').insert({
        employee_id: attendant, compensation_plan_id: plan, shift_date: today, start_time: new Date().toISOString(), status: 'open', wage_paid: 0,
      });
      await db('pump_readings').insert({ shift_id: id, pump_id: pump, opening_litres: 0, closing_litres: litres, opening_amount: 0, closing_amount: litres * 180, litres_sold: litres, amount_sold: litres * 180 });
      await record(id);
      const counted = { cash_amount: cash, mpesa_amount: mpesa };
      if (await db('shift_collections').where({ shift_id: id }).first()) await db('shift_collections').where({ shift_id: id }).update(counted);
      else await db('shift_collections').insert({ shift_id: id, ...counted, credits_amount: 0, total_collected: cash + mpesa });
      ok(await call('PUT', `/shifts/${id}/close`, desktop, {
        wage_paid: 800, reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true },
      }), 200);
      return id as number;
    };
    const sale = async (shiftId: number, account: number, amount: number) => ok(await call('POST', `/shifts/${shiftId}/credits`, desktop, { account_id: account, amount })).id;
    const receipt = async (shiftId: number, account: number, amount: number, method: string) =>
      ok(await call('POST', `/shifts/${shiftId}/credit-receipts`, desktop, { account_id: account, amount, payment_method: method })).id as number;
    const expense = async (shiftId: number, category: string, amount: number) =>
      ok(await call('POST', `/shifts/${shiftId}/expenses`, desktop, { category, amount, description: `${category} paid` })).id as number;

    // S1: 18,000 sold; credits 3,500, expenses 500, wage 800; short 400.
    const ids: Record<string, number> = {};
    const s1 = await shiftRun(100, async (id) => {
      await sale(id, alpha, 2000);
      await sale(id, alpha, 500);
      await sale(id, gamma, 1000);
      ids.x1 = await expense(id, 'Cleaning', 300);
      ids.x2 = await expense(id, 'Transport', 200);
    }, 9200, 3600);
    const [c1, c2, c3] = (await db('shift_credits').where({ shift_id: s1 }).orderBy('id')).map((r: any) => Number(r.id));
    // S2: 18,000 sold; debts paid 2,800 (alpha 1,500 + 300 cash, gamma 1,000 M-Pesa); over 200.
    const s2 = await shiftRun(100, async (id) => {
      ids.r1 = await receipt(id, alpha, 1500, 'cash');
      ids.r2 = await receipt(id, gamma, 1000, 'mpesa');
      ids.r3 = await receipt(id, alpha, 300, 'cash');
    }, 14200, 6000);
    // S3: 9,000 sold, balanced.
    const s3 = await shiftRun(50, async () => {}, 8200, 0);

    const owes = async (account: number) => Number((await db('credit_accounts').where({ id: account }).first()).balance);
    const holds = (account: number) => customerCreditBalance(account, db);
    const owed = async (shiftId: number) => (await getVarianceStatement(db, attendant)).rows.find((r: any) => r.shift_id === shiftId)?.owed || 0;
    const view = async (shiftId: number, headers = desktop) => (await call('GET', `/shifts/${shiftId}`, headers)).body.data;
    const before = { s1: await view(s1), s2: await view(s2), s3: await view(s3) };
    assert.deepEqual([before.s1.variance, before.s2.variance, before.s3.variance], [-400, 200, 0]);
    assert.deepEqual([await owes(alpha), await owes(gamma), await owed(s1)], [700, 0, 400]);

    const token = async (purpose: string, fields: Record<string, unknown>) => {
      const r = await call('POST', '/auth/verify-pin', desktop, { employee_id: admin, pin: '4821', purpose, ...fields });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data.approval_token as string;
    };
    const reason = { reason_code: 'found_on_reconciling', reason_note: 'Checked against the credit book' };
    const preview = async (recordType: string, request: Record<string, unknown>, headers = desktop) =>
      call('POST', '/corrections/preview', headers, { record_type: recordType, ...reason, ...request });
    const correct = async (recordType: string, request: Record<string, unknown>, headers = desktop) => {
      const body = { record_type: recordType, ...reason, ...request };
      const p = ok(await call('POST', '/corrections/preview', headers, body), 200);
      const approval = headers === desktop ? { approval_token: await token('correction', { plan_hash: p.plan_hash }) } : {};
      const posted = await call('POST', '/corrections', headers, { ...body, plan_hash: p.plan_hash, ...approval });
      return { preview: p, ...posted, data: posted.body.data };
    };
    const added = (c: any) => c.data.lines.find((l: any) => l.action === 'add').created_record_id as number;

    // ---- Guards ----
    await assert.rejects(db('shift_credits').where({ id: c1 }).update({ amount: 1 }), /cannot be changed/);
    await assert.rejects(db('credits').where({ shift_id: s1 }).update({ amount: 1 }), /cannot be changed/);
    await assert.rejects(db('credit_payments').where({ id: ids.r1 }).update({ amount: 1 }), /cannot be changed/);
    await assert.rejects(db('credit_payments').where({ id: ids.r1 }).update({ payment_method: 'mpesa' }), /cannot be changed/);
    await assert.rejects(db('credit_payments').where({ id: ids.r1 }).delete(), /cannot be changed/);
    await assert.rejects(db('shift_credits').where({ id: c1 }).delete(), /cannot be changed/);
    await db('credits').where({ shift_id: s1, account_id: gamma }).update({ status: 'paid' });
    console.log("PASS guards: a closed shift's credit sales and payments cannot change; balances and statuses still can");

    // ---- Refusals ----
    assert.equal((await preview('credit_sale', { error_kind: 'duplicate', target_id: c2 }, attendantSession)).status, 403);
    assert.equal((await preview('credit_sale', { error_kind: 'wrong_amount', target_id: c2, amount: 500 })).body.code, 'NO_CHANGE');
    assert.equal((await preview('credit_sale', { error_kind: 'wrong_customer', target_id: c2, account_id: invoiceOnly })).body.code, 'NOT_MONEY_CUSTOMER');
    assert.equal((await preview('debt_receipt', { error_kind: 'missing', account_id: beta, shift_id: s3, amount: 100 })).body.code, 'METHOD_REQUIRED');
    assert.equal((await preview('drawer_expense', { error_kind: 'missing', shift_id: s3, amount: 100, category: 'Wages' })).body.code, 'PAYROLL_CATEGORY');
    assert.equal((await preview('collection', { error_kind: 'wrong_split', shift_id: s2, amount: 14201, payment_method: 'mpesa' })).body.code, 'AMOUNT_EXCEEDS_SPLIT');
    assert.equal(await db('corrections').count({ n: 'id' }).first().then((r: any) => Number(r.n)), 0);
    console.log('PASS refusals: admins only, a real change, credit customers only, a method, no wages as expenses, the split');

    // ---- Credit sales ----
    // B1: a credit sale never given; the station carries it.
    const b1 = await correct('credit_sale', { error_kind: 'duplicate', target_id: c2, charge_to: 'station' }, phoneAdmin);
    assert.equal(b1.status, 201, JSON.stringify(b1.body));
    assert.equal(await owes(alpha), 200);
    assert.equal(await owed(s1), 400, 'not their doing');
    // B2: on the wrong customer, partly paid; the right one goes past their limit.
    const toBeta = { error_kind: 'wrong_customer', target_id: c1, account_id: beta };
    const p2 = ok(await preview('credit_sale', toBeta), 200);
    assert.equal(p2.needs_override, true);
    assert(p2.effects.some((e: string) => /Over Beta Motors's credit limits/.test(e)), JSON.stringify(p2.effects));
    assert(p2.effects.includes('Alpha Hardware owes KES 200.00 now; KES 0.00 (holding KES 1,800.00 as credit) after this correction.'), JSON.stringify(p2.effects));
    const t2 = await token('correction', { plan_hash: p2.plan_hash });
    assert.equal((await call('POST', '/corrections', desktop, { record_type: 'credit_sale', ...reason, ...toBeta, plan_hash: p2.plan_hash, approval_token: t2 })).body.code, 'OVERRIDE_REQUIRED');
    const b2 = await correct('credit_sale', { ...toBeta, limit_override: true });
    assert.equal(b2.status, 201, JSON.stringify(b2.body));
    assert.deepEqual([await owes(alpha), await holds(alpha), await owes(beta)], [0, 1800, 2000], "the 1,800 that paid it is Alpha's credit");
    assert.equal((await db('credit_limit_overrides').where({ account_id: beta })).length, 1, 'the override is on record');
    assert.equal(b2.preview.shifts[0].change, 0);
    // B3: the wrong amount, already paid; it gets better, so the attendant owes less.
    const b3 = await correct('credit_sale', { error_kind: 'wrong_amount', target_id: c3, amount: 1200 });
    assert.equal(b3.status, 201, JSON.stringify(b3.body));
    assert.equal(b3.preview.needs_choice, false);
    assert(b3.preview.effects.includes('Gamma Farm owes KES 0.00 now; KES 200.00 after this correction.'), JSON.stringify(b3.preview.effects));
    assert.deepEqual([await owes(gamma), await owed(s1)], [200, 200], 'the 1,000 paid covers most of the 1,200');
    // B4: on the wrong shift (Beta's, from B2): S1 worse, S3 better.
    const b4 = await correct('credit_sale', { error_kind: 'wrong_shift', target_id: added(b2), shift_id: s3, charge_to: 'station' });
    assert.equal(b4.status, 201, JSON.stringify(b4.body));
    assert.equal(b4.preview.needs_override, false, 'the same debt, only on another shift');
    assert.deepEqual(b4.preview.shifts.map((s: any) => [s.shift_id, s.change]), [[s1, -2000], [s3, 2000]]);
    // B5: a credit sale never recorded.
    const b5 = await correct('credit_sale', { error_kind: 'missing', account_id: gamma, shift_id: s3, amount: 700, description: 'Diesel for the tractor' });
    assert.equal(b5.status, 201, JSON.stringify(b5.body));
    assert.equal(await owes(gamma), 900);
    console.log('PASS credit sales: never given, wrong customer (paid part becomes credit, limit approved), wrong amount, wrong shift, missing');

    // ---- Debt receipts ----
    // C1: cash that was M-Pesa: no shift change, no customer change.
    const c1x = await correct('debt_receipt', { error_kind: 'wrong_method', target_id: ids.r3 });
    assert.equal(c1x.status, 201, JSON.stringify(c1x.body));
    assert.equal(c1x.preview.shifts[0].change, 0);
    assert.deepEqual([await owes(alpha), await holds(alpha)], [0, 1800]);
    assert.equal((await db('credit_payments').where({ id: added(c1x) }).first()).payment_method, 'mpesa');
    // C2: never received: Gamma owes it again; the drawer was never short of it.
    const c2x = await correct('debt_receipt', { error_kind: 'duplicate', target_id: ids.r2 });
    assert.equal(c2x.status, 201, JSON.stringify(c2x.body));
    assert.deepEqual([await owes(gamma), await owed(s2)], [1900, 0]);
    // C3: Gamma paid it, not Alpha.
    const c3x = await correct('debt_receipt', { error_kind: 'wrong_customer', target_id: ids.r1, account_id: gamma });
    assert.equal(c3x.status, 201, JSON.stringify(c3x.body));
    assert.deepEqual([await owes(alpha), await holds(alpha), await owes(gamma)], [0, 300, 400]);
    // C4: a payment never recorded: the drawer should have held it; the attendant carries it.
    const c4x = await correct('debt_receipt', { error_kind: 'missing', account_id: beta, shift_id: s3, amount: 500, payment_method: 'cash', charge_to: 'attendant' });
    assert.equal(c4x.status, 201, JSON.stringify(c4x.body));
    assert.equal(await owes(beta), 1500);
    // C5: the wrong amount (450, not 500).
    const c5x = await correct('debt_receipt', { error_kind: 'wrong_amount', target_id: added(c4x), amount: 450 });
    assert.equal(c5x.status, 201, JSON.stringify(c5x.body));
    assert.equal(await owes(beta), 1550);
    // C6: the M-Pesa payment from C1 was taken in S3, not S2.
    const c6x = await correct('debt_receipt', { error_kind: 'wrong_shift', target_id: added(c1x), shift_id: s3, charge_to: 'station' });
    assert.equal(c6x.status, 201, JSON.stringify(c6x.body));
    assert.deepEqual(c6x.preview.shifts.map((s: any) => [s.shift_id, s.change]), [[s2, 300], [s3, -300]]);
    console.log('PASS debt receipts: cash/M-Pesa, never received, wrong customer, missing, wrong amount, wrong shift');

    // ---- Drawer expenses ----
    const d1 = await correct('drawer_expense', { error_kind: 'wrong_amount', target_id: ids.x1, amount: 350 });
    assert.equal(d1.status, 201, JSON.stringify(d1.body));
    assert.equal(await owed(s1), 150, 'a bigger expense: the attendant owes 50 less');
    const d2 = await correct('drawer_expense', { error_kind: 'wrong_category', target_id: ids.x2, category: 'Security' });
    assert.equal(d2.status, 201, JSON.stringify(d2.body));
    assert.deepEqual([d2.preview.shifts[0].change, (await db('shift_expenses').where({ id: added(d2) }).first()).category], [0, 'Security']);
    const d3 = await correct('drawer_expense', { error_kind: 'duplicate', target_id: added(d1), charge_to: 'station' });
    assert.equal(d3.status, 201, JSON.stringify(d3.body));
    const d4 = await correct('drawer_expense', { error_kind: 'missing', shift_id: s3, amount: 150, category: 'Cleaning', description: 'Receipt found later' });
    assert.equal(d4.status, 201, JSON.stringify(d4.body));
    console.log('PASS drawer expenses: wrong amount, wrong category, never paid, missing');

    // ---- Cash and M-Pesa ----
    const e1 = await correct('collection', { error_kind: 'wrong_split', shift_id: s2, amount: 1000, payment_method: 'mpesa' });
    assert.equal(e1.status, 201, JSON.stringify(e1.body));
    const rate = Number((await db('mpesa_fee_config').where('effective_date', '<=', today).orderBy('effective_date', 'desc').first())?.fee_value ?? 0.55);
    const fee = (g: number) => Math.round(g * (rate / 100) * 100) / 100;
    assert.equal(Number(e1.data.lines[1].fee_delta), Math.round((fee(7000) - fee(6000)) * 100) / 100);
    assert(e1.preview.effects.includes('Cash KES 14,200.00 → KES 13,200.00; M-Pesa KES 6,000.00 → KES 7,000.00.'), JSON.stringify(e1.preview.effects));
    assert.equal(e1.preview.shifts[0].change, 0);
    assert.equal((await preview('collection', { error_kind: 'wrong_split', shift_id: s2, amount: 13201, payment_method: 'mpesa' })).body.code, 'AMOUNT_EXCEEDS_SPLIT', 'counted after the first move');
    const e2 = await correct('collection', { error_kind: 'wrong_split', shift_id: s2, amount: 500, payment_method: 'cash' });
    assert.equal(e2.status, 201, JSON.stringify(e2.body));
    console.log('PASS cash and M-Pesa: the split and the fee move, the result does not; never more than was recorded');

    // ---- The shifts as closed, and their corrected results ----
    for (const [key, shift] of [['s1', s1], ['s2', s2], ['s3', s3]] as const) {
      const v = await view(shift);
      for (const figure of ['variance', 'total_credits', 'total_credit_receipts', 'total_expenses', 'total_cash', 'total_mpesa']) {
        assert.equal(v[figure], (before as any)[key][figure], `${key} ${figure} as closed`);
      }
      for (const list of ['shift_credits', 'credit_receipts', 'expenses']) {
        assert.deepEqual(v[list].map((r: any) => r.id).sort(), (before as any)[key][list].map((r: any) => r.id).sort(), `${key} ${list} as closed`);
      }
    }
    const corrected = async (shiftId: number) => (await view(shiftId)).record_corrections;
    assert.deepEqual([(await corrected(s1)).change, (await corrected(s1)).corrected_variance], [-2600, -3000]);
    assert.deepEqual([(await corrected(s2)).change, (await corrected(s2)).corrected_variance], [1300, 1500]);
    assert.deepEqual([(await corrected(s3)).change, (await corrected(s3)).corrected_variance], [2100, 2100]);
    assert.deepEqual([await owed(s1), await owed(s2), await owed(s3)], [150, 0, 0]);
    const asAttendant = await view(s1, attendantSession);
    assert(asAttendant.record_corrections.lines.length > 0);
    assert.equal(asAttendant.record_corrections.lines[0].party_name, undefined);
    console.log('PASS the shifts keep their figures and lists as closed; corrected results add up');

    // ---- Undo ----
    const undo = async (c: any, headers = phoneAdmin) => call('POST', `/corrections/${c.data.id}/undo`, headers, { reason_note: 'Made in error, putting it back' });
    const g1 = await undo(b1);
    assert.equal(g1.status, 201, JSON.stringify(g1.body));
    assert.deepEqual([await owes(alpha), await holds(alpha)], [200, 0], "the sale is back and Alpha's 300 credit pays it");
    assert.equal((await corrected(s1)).change, -2100);
    assert.match((await undo(b2)).body.error, /corrected again by C-/);
    const g3 = await undo(d2);
    assert.equal(g3.status, 201, JSON.stringify(g3.body));
    assert.equal((await db('shift_expenses').where({ id: ids.x2 }).first()).deleted_at, null);
    assert.match((await undo(c1x)).body.error, /corrected again by C-/);
    assert.match((await undo(e1)).body.error, /Undo that first/, 'a later split correction depends on it');
    assert.equal((await undo(e2)).status, 201);
    assert.equal((await undo(e1)).status, 201);
    const g6 = await undo(c5x);
    assert.equal(g6.status, 201, JSON.stringify(g6.body));
    assert.equal(await owes(beta), 1500, 'back to the 500 payment');
    console.log('PASS undo: sales, expenses, payments and splits come back; blocked when something depends on them');

    // ---- Every balance still adds up ----
    for (const account of [alpha, beta, gamma]) {
      const sum: any = await db('credits').where({ account_id: account }).whereNull('deleted_at').where('balance', '>', 0).sum({ t: 'balance' }).first();
      assert.equal(await owes(account), Number(sum.t || 0), `account ${account} balance is its open credits`);
    }
    for (const payment of await db('credit_payments').whereIn('account_id', [alpha, beta, gamma])) {
      const applied: any = await db('credit_payment_allocations').where({ payment_id: payment.id }).whereNull('reversed_at').sum({ t: 'amount_applied' }).first();
      if (payment.status === 'posted') assert.equal(Number(applied.t || 0) + Number(payment.unapplied_amount || 0), Number(payment.amount), `payment ${payment.id} adds up`);
      else assert.equal(Number(applied.t || 0), 0, `reversed payment ${payment.id} pays nothing`);
    }
    console.log('PASS every customer balance and payment still adds up');

    // ---- An open shift's records are fixed on the shift; the daily report lists the day's corrections ----
    const [s4] = await db('shifts').insert({ employee_id: attendant, compensation_plan_id: plan, shift_date: today, start_time: new Date().toISOString(), status: 'open', wage_paid: 0 });
    const onOpen = await sale(s4, alpha, 100);
    assert.equal((await preview('credit_sale', { error_kind: 'duplicate', target_id: onOpen })).body.code, 'SHIFT_OPEN');
    const daily = ok(await call('GET', `/reports/daily?date=${today}`), 200);
    assert.equal(daily.record_corrections.length, Number((await db('corrections').count({ n: 'id' }).first() as any).n));
    console.log('PASS open shifts are fixed on the shift; the daily report lists the day\'s corrections');
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
