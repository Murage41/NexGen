import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Absolute closing totals correct counted money, not a transfer between methods.
// Fixed amounts below are checked through the real correction and shift routes.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-closing-total-corrections-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'closing-total-corrections-private-test-key';
  const { default: db } = await import('../src/database');
  const auth = await import('../src/middleware/requireAdmin');
  const { hashPin } = await import('../src/services/pinSecurity');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { readShiftFinancials } = await import('../src/services/shiftFinancials');
  const { getVarianceStatement } = await import('../src/services/employeeVariances');
  const { default: shifts } = await import('../src/routes/shifts');
  const { default: corrections } = await import('../src/routes/corrections');
  const { default: reports } = await import('../src/routes/reports');
  const { default: dashboard } = await import('../src/routes/dashboard');
  const { default: authentication } = await import('../src/routes/auth');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const day = getKenyaDate();
    const legacyDay = '2020-02-03';
    const [admin] = await db('employees').insert({ name: 'Closing Test Admin', role: 'admin', pin: hashPin('5371'), active: true, daily_wage: 0 });
    const [attendant] = await db('employees').insert({ name: 'Closing Test Attendant', role: 'attendant', pin: hashPin('5372'), active: true, daily_wage: 600 });
    const [other] = await db('employees').insert({ name: 'Other Closing Attendant', role: 'attendant', active: true, daily_wage: 0 });
    const [payPlan] = await db('employee_compensation_plans').insert({ employee_id: attendant, name: 'Daily test pay', pay_schedule: 'daily', effective_from: '2010-01-01', version: 1, status: 'active' });
    await db('employee_compensation_components').insert({ plan_id: payPlan, component_type: 'fixed_per_shift', amount: 600 });
    const [tank] = await db('tanks').insert({ label: 'Closing Test Tank', fuel_type: 'petrol', capacity_litres: 1000, current_stock_litres: 500 });
    const [pump] = await db('pumps').insert({ label: 'Closing Test Pump', nozzle_label: 'A4', fuel_type: 'petrol', tank_id: tank, active: true });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 200, effective_date: '2010-01-01' });
    const [stock] = await db('tank_stock_adjustments').insert({ tank_id: tank, litres_change: 500, reason: 'opening_balance_correction_gain', notes: 'Synthetic costed opening stock', adjustment_date: '2010-01-01', adjustment_timestamp: '2010-01-01T00:00:00Z', cost_per_litre: 150, total_cost: 75000 });
    await db('tank_adjustment_batches').insert({ adjustment_id: stock, tank_id: tank, fuel_type: 'petrol', original_litres: 500, remaining_litres: 500, cost_per_litre: 150, date: '2010-01-01' });
    const app = express(); app.use(express.json()); app.use('/auth', authentication); app.use(auth.requireAuth);
    app.use('/shifts', shifts); app.use('/corrections', corrections); app.use('/reports', reports); app.use('/dashboard', dashboard);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const mobile = { Authorization: `Bearer ${auth.generateToken(Number(admin), 'admin')}` };
    const own = { Authorization: `Bearer ${auth.generateToken(Number(attendant), 'attendant')}` };
    const another = { Authorization: `Bearer ${auth.generateToken(Number(other), 'attendant')}` };
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const call = async (method: string, url: string, body?: any, headers: Record<string, string> = mobile) => {
      const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, body: data, replayed: response.headers.get('Idempotency-Replayed') };
    };
    const ok = (response: any, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); assert.equal(response.body.success, true); return response.body.data; };
    const reason = { reason_code: 'office_mistake', reason_note: 'Checked the counted handover money and the signed book' };
    const collection = (id: number, cash: number, mpesa: number, extra: Record<string, unknown> = {}) => ({ record_type: 'collection', error_kind: 'wrong_amount', shift_id: id, cash_amount: cash, mpesa_amount: mpesa, ...reason, ...extra });
    const amend = async (request: any, headers = mobile, key?: string) => {
      const body = { ...reason, ...request };
      const preview = ok(await call('POST', '/corrections/preview', body, headers));
      const approval = headers === desktop ? { approval_token: ok(await call('POST', '/auth/verify-pin', { employee_id: admin, pin: '5371', purpose: 'correction', plan_hash: preview.plan_hash }, desktop)).approval_token } : {};
      const posted = ok(await call('POST', '/corrections', { ...body, plan_hash: preview.plan_hash, ...approval }, { ...headers, ...(key ? { 'Idempotency-Key': key } : {}) }), 201);
      return { preview, posted, body: { ...body, plan_hash: preview.plan_hash, ...approval } };
    };
    const undo = async (id: number) => ok(await call('POST', `/corrections/${id}/undo`, reason), 201);
    const view = async (id: number, original = false, headers = mobile) => ok(await call('GET', `/shifts/${id}${original ? '?view=original' : ''}`, undefined, headers));
    const close = async (id: number, balances = false) => {
      const detail = await view(id);
      ok(await call('PUT', `/shifts/${id}/close`, { wage_paid: 600, ...(balances ? { reconciliation_basis: 'balances_v1', expected_funds_revision: detail.funds_revision } : {}), reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true } }));
    };

    // Legacy receipt totals: 10,000 sales, 400 expense and 600 wages paid;
    // 6,000 cash + 3,000 M-Pesa is balanced under the preserved legacy basis.
    const [legacyId] = await db('shifts').insert({ employee_id: attendant, compensation_plan_id: payPlan, shift_date: legacyDay, start_time: `${legacyDay}T05:00:00Z`, status: 'open', wage_paid: 0 });
    const legacy = Number(legacyId);
    await db('pump_readings').insert({ shift_id: legacy, pump_id: pump, opening_litres: 0, opening_amount: 0, closing_litres: 50, closing_amount: 10000, litres_sold: 50, amount_sold: 10000 });
    ok(await call('POST', `/shifts/${legacy}/expenses`, { category: 'other', description: 'Synthetic legacy drawer expense', amount: 400 }), 201);
    ok(await call('PUT', `/shifts/${legacy}/collections`, { cash_amount: 6000, mpesa_amount: 3000 }));
    await close(legacy);
    assert.equal((await view(legacy)).variance, 0);

    // Balance basis: 5,000 opening + 10,000 sales + 500 debt receipt + 1,000
    // top-up - 1,000 credit - 2,000 invoice fuel - 400 expense - 600 wage
    // - 2,500 bank transfer = 10,000 expected closing; inferred receipts 7,500.
    const opened = ok(await call('POST', '/shifts', { employee_id: attendant, compensation_plan_id: payPlan, opening_cash_amount: 2000, opening_mpesa_amount: 3000 }), 201);
    const id = Number(opened.id);
    const initialReading = (await view(id)).readings[0];
    ok(await call('PUT', `/shifts/${id}/readings`, { readings: [{ pump_id: pump, closing_litres: Number(initialReading.opening_litres) + 50, closing_amount: Number(initialReading.opening_amount) + 10000 }] }));
    const [customer] = await db('credit_accounts').insert({ name: 'Closing Test Customer', type: 'customer', billing_mode: 'money' });
    const [fleet] = await db('credit_accounts').insert({ name: 'Closing Test Fleet', type: 'customer', billing_mode: 'invoice' });
    await db('credits').insert({ account_id: customer, customer_name: 'Closing Test Customer', amount: 500, balance: 500, status: 'outstanding', created_at: '2010-01-01T00:00:00Z' });
    ok(await call('POST', `/shifts/${id}/credit-receipts`, { account_id: customer, amount: 500, payment_method: 'cash' }), 201);
    ok(await call('POST', `/shifts/${id}/credits`, { account_id: customer, amount: 1000 }), 201);
    ok(await call('POST', `/shifts/${id}/invoice-consumption`, { account_id: fleet, pump_id: pump, fuel_type: 'petrol', litres: 10 }), 201);
    ok(await call('POST', `/shifts/${id}/expenses`, { category: 'other', description: 'Synthetic balance-basis drawer expense', amount: 400 }), 201);
    await amend({ record_type: 'shift_funds', error_kind: 'missing', shift_id: id, category: 'added', source: 'station_bank_safe', payment_method: 'cash', amount: 1000, reference: 'A4-TOPUP', description: 'Additional float provided from station safe' });
    await amend({ record_type: 'shift_funds', error_kind: 'missing', shift_id: id, category: 'removed', source: 'station_bank_safe', payment_method: 'mpesa', amount: 2500, reference: 'A4-BANK', description: 'M-Pesa transferred into station bank account' });
    ok(await call('PUT', `/shifts/${id}/collections`, { cash_amount: 4500, mpesa_amount: 5500, reconciliation_basis: 'balances_v1' }));
    await close(id, true);
    const later = ok(await call('POST', '/shifts', { employee_id: attendant, compensation_plan_id: payPlan, opening_cash_amount: 1200, opening_mpesa_amount: 800 }), 201);
    const original = await view(id, true);
    assert.deepEqual([original.total_cash, original.total_mpesa, original.variance, original.inferred_collections], [4500, 5500, 0, 7500]);

    const stableTables = ['shifts', 'shift_collections', 'shift_close_reconciliations', 'pump_readings', 'shift_tank_snapshots', 'tank_stock_ledger', 'tanks', 'tank_stock_adjustments', 'tank_adjustment_batches', 'delivery_batches', 'batch_consumption', 'credits', 'shift_credits', 'credit_payments', 'credit_payment_allocations', 'invoice_consumption', 'customer_invoices', 'invoice_lines', 'invoice_adjustment_notes', 'shift_expenses', 'payroll_payments', 'employee_earnings', 'wage_deductions', 'shift_funds_movements', 'stored_documents'];
    const stable = async () => {
      const out: Record<string, any> = {};
      for (const table of stableTables) out[table] = await db(table).orderBy('id');
      out.customer_accounts = await db('credit_accounts').where({ type: 'customer' }).orderBy('id');
      return out;
    };
    const checkProtectedCorrection = async (request: any, headers = mobile, key?: string) => {
      const before = await stable(); const result = await amend(request, headers, key);
      assert.deepEqual(await stable(), before, 'a closing-total correction only appends correction/approved variance history');
      return result;
    };
    const parseCsv = (text: string) => {
      text = text.replace(/^\uFEFF/, '');
      const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
      for (let n = 0; n < text.length; n++) {
        const c = text[n];
        if (c === '"') { if (quoted && text[n + 1] === '"') { cell += '"'; n++; } else quoted = !quoted; }
        else if (!quoted && c === ',') { row.push(cell); cell = ''; }
        else if (!quoted && (c === '\r' || c === '\n')) { if (c === '\r' && text[n + 1] === '\n') n++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += c;
      }
      row.push(cell); rows.push(row); return rows;
    };
    const crossViews = async (cash: number, mpesa: number) => {
      const variance = Math.round((cash + mpesa - 10000) * 100) / 100;
      const inferred = 7500 + variance;
      const current = await view(id);
      const financial = (await readShiftFinancials(db, [id])).get(id)!;
      assert.deepEqual([current.total_cash, current.total_mpesa, current.variance, current.inferred_collections], [cash, mpesa, variance, inferred]);
      assert.deepEqual([financial.current.total_cash, financial.current.total_mpesa, financial.current.variance], [cash, mpesa, variance]);
      assert.deepEqual([current.collections.cash_amount, current.collections.mpesa_amount], [cash, mpesa]);
      assert.deepEqual([current.opening_cash_amount, current.opening_mpesa_amount, current.funds_added_total, current.funds_removed_total], [2000, 3000, 1000, 2500]);
      const saved = await view(id, true);
      assert.deepEqual([saved.total_cash, saved.total_mpesa, saved.variance, saved.inferred_collections], [4500, 5500, 0, 7500]);
      for (const endpoint of [`/reports/daily?date=${day}`, `/reports/monthly?month=${day.slice(0, 7)}`]) {
        const report = ok(await call('GET', endpoint));
        assert.deepEqual([report.closing_cash, report.closing_mpesa, report.inferred_collections, report.expected_receipts], [cash, mpesa, inferred, 7500], endpoint);
        assert.deepEqual([report.total_cash, report.total_mpesa, report.net_profit], [null, null, 1500], 'no opening or corrected count becomes extra profit');
        if (report.shifts) {
          const row = report.shifts.find((s: any) => Number(s.id) === id);
          assert.deepEqual([row.variance, row.inferred_collections], [variance, inferred]);
        }
      }
      const dash = ok(await call('GET', '/dashboard'));
      assert.deepEqual([dash.today_collections.closing_cash, dash.today_collections.closing_mpesa, dash.today_collections.inferred_collections, dash.today_variance, dash.today_net_profit], [cash, mpesa, inferred, variance, 1500]);
      const flow = ok(await call('GET', `/reports/cash-flow?from=${day}&to=${day}`));
      assert.deepEqual([flow.inflows.balance_shift_inferred_collections, flow.outflows.shift_expenses, flow.outflows.wages_paid, flow.net_cash_flow], [inferred, 400, 600, inferred - 1000]);
      const csv = parseCsv((await call('GET', '/shifts/export.csv')).body);
      const row = csv.find((r, index) => index > 0 && Number(r[0]) === id)!;
      const at = (name: string) => Number(row[csv[0].indexOf(name)]);
      assert.deepEqual([at('Current Cash Received / Closing Balance'), at('Current M-Pesa Received / Closing Balance'), at('Current Variance'), at('Current Collections Inferred From Counted Funds')], [cash, mpesa, variance, inferred]);
      assert.deepEqual([at('Original Cash Received / Closing Balance'), at('Original M-Pesa Received / Closing Balance'), at('Original Variance')], [4500, 5500, 0]);
      assert.deepEqual((await view(Number(later.id))).opening_funds, { cash_amount: 1200, mpesa_amount: 800 }, 'later shift opening is independent');
      assert.equal((await call('GET', `/shifts/${id}`, undefined, own)).status, 200);
    };
    await crossViews(4500, 5500);

    // Strict numeric contracts reject fields that an old split form cannot supply.
    for (const invalid of [undefined, null, '', '100', false, Infinity, -Infinity, NaN, -1, 0.001, 100_000_001]) {
      for (const field of ['cash_amount', 'mpesa_amount']) {
        const response = await call('POST', '/corrections/preview', { ...collection(id, 4501, 5501), [field]: invalid });
        assert.equal(response.body.code, 'INVALID_AMOUNT', `${field}: ${String(invalid)}`);
      }
    }
    assert.equal((await call('POST', '/corrections/preview', collection(id, 4500, 5500))).body.code, 'NO_CHANGE');
    assert.equal((await call('POST', '/corrections/preview', collection(Number(later.id), 0, 0))).body.code, 'SHIFT_OPEN');
    assert.equal((await call('POST', '/corrections/preview', collection(id, 4600, 5500), own)).status, 403);
    assert.equal((await call('POST', '/corrections/preview', collection(id, 4600, 5500), another)).status, 403);
    const missingChoiceBody = collection(id, 4400, 5500);
    const missingChoice = ok(await call('POST', '/corrections/preview', missingChoiceBody));
    assert.equal(missingChoice.needs_choice, true);
    assert.equal((await call('POST', '/corrections', { ...missingChoiceBody, plan_hash: missingChoice.plan_hash })).body.code, 'CHOICE_REQUIRED');
    const desktopBody = collection(id, 4600, 5500);
    const desktopPreview = ok(await call('POST', '/corrections/preview', desktopBody, desktop));
    assert.equal((await call('POST', '/corrections', { ...desktopBody, plan_hash: desktopPreview.plan_hash }, desktop)).status, 400);
    const wrongToken = ok(await call('POST', '/auth/verify-pin', { employee_id: admin, pin: '5371', purpose: 'correction', plan_hash: '0'.repeat(64) }, desktop)).approval_token;
    assert.equal((await call('POST', '/corrections', { ...desktopBody, plan_hash: desktopPreview.plan_hash, approval_token: wrongToken }, desktop)).status, 403);
    console.log('PASS strict totals and admin/mobile/desktop approval contracts');

    const ownShortage = await checkProtectedCorrection(collection(id, 4400, 5500, { charge_to: 'attendant' }));
    const varianceEntry = await db('employee_variance_entries').where({ record_correction_id: ownShortage.posted.id }).first();
    assert.equal(Number(varianceEntry.amount), 100, 'only the approved worsening is charged');
    assert.equal((await getVarianceStatement(db, Number(attendant))).rows.find(row => row.shift_id === id)?.owed, 100);
    await undo(ownShortage.posted.id); await crossViews(4500, 5500);

    // Each method changes independently; the result is the sum of differences.
    for (const [cash, mpesa, delta] of [[4700, 5500, 200], [4300, 5500, -400], [4300, 5700, 200], [4300, 5300, -400], [4800, 5600, 800], [0, 5600, -4800], [0, 0, -5600]] as number[][]) {
      const correction = await checkProtectedCorrection(collection(id, cash, mpesa, { charge_to: 'station' }));
      assert.equal(correction.preview.shifts[0].change, delta);
      assert(correction.posted.lines.every((line: any) => line.category === 'closing_total'));
      await crossViews(cash, mpesa);
    }
    const reset = await checkProtectedCorrection(collection(id, 4500, 5500));
    await crossViews(4500, 5500);
    const exact = await checkProtectedCorrection(collection(id, 4500.01, 5499.99), desktop, 'a4-count-exact-key');
    assert.equal(exact.preview.shifts[0].change, 0);
    const countBeforeReplay = Number((await db('corrections').count({ n: 'id' }).first() as any).n);
    const replay = await call('POST', '/corrections', exact.body, { ...desktop, 'Idempotency-Key': 'a4-count-exact-key' });
    assert.equal(ok(replay, 201).id, exact.posted.id);
    assert.equal(Number((await db('corrections').count({ n: 'id' }).first() as any).n), countBeforeReplay);
    assert.equal((await call('POST', '/corrections', { ...exact.body, cash_amount: 4501 }, { ...desktop, 'Idempotency-Key': 'a4-count-exact-key' })).status, 409);
    await crossViews(4500.01, 5499.99);
    console.log('PASS independent cash/M-Pesa changes, zero, exact cents, approved responsibility and idempotent replay across every read surface');

    // A later absolute correction or old split depends on the earlier count.
    const dependent = await checkProtectedCorrection(collection(id, 4550.01, 5499.99));
    assert.equal((await call('POST', `/corrections/${exact.posted.id}/undo`, reason)).body.code, 'UNDO_BLOCKED');
    await undo(dependent.posted.id);
    const split = await amend({ record_type: 'collection', error_kind: 'wrong_split', shift_id: id, amount: 100, payment_method: 'mpesa' });
    assert.equal((await call('POST', `/corrections/${exact.posted.id}/undo`, reason)).body.code, 'UNDO_BLOCKED');
    await undo(split.posted.id); await undo(exact.posted.id); await crossViews(4500, 5500);
    await undo(reset.posted.id); await crossViews(0, 0);
    await checkProtectedCorrection(collection(id, 4500, 5500)); await crossViews(4500, 5500);

    // Even a change which was subsequently undone invalidates a saved preview.
    const interferences = [
      () => amend(collection(id, 4510, 5500)),
      () => amend({ record_type: 'opening_funds', error_kind: 'wrong_amount', shift_id: id, payment_method: 'cash', amount: 2010, charge_to: 'station' }),
      () => amend({ record_type: 'shift_funds', error_kind: 'missing', shift_id: id, category: 'removed', source: 'station_bank_safe', payment_method: 'cash', amount: 10, reference: 'A4-STALE', description: 'Synthetic cash transfer during approval review' }),
      () => amend({ record_type: 'drawer_expense', error_kind: 'missing', shift_id: id, amount: 10, category: 'other', description: 'Synthetic expense during approval review' }),
      async () => {
        const receipt = await db('credit_payments').where({ shift_id: id, status: 'posted' }).whereNull('deleted_at').first();
        return amend({ record_type: 'debt_receipt', error_kind: 'wrong_amount', target_id: receipt.id, amount: 510, charge_to: 'station' });
      },
    ];
    for (const interfere of interferences) {
      const request = collection(id, 4520, 5500); const preview = ok(await call('POST', '/corrections/preview', request));
      const changed = await interfere(); await undo(changed.posted.id);
      assert.equal((await call('POST', '/corrections', { ...request, plan_hash: preview.plan_hash })).body.code, 'PLAN_CHANGED');
      await crossViews(4500, 5500);
    }
    console.log('PASS dependent undo, old split compatibility and stale preview after collection/opening/funds/expense/receipt changes plus undo');

    const legacyCorrections: number[] = [];
    for (const [cash, mpesa, delta] of [[6200, 3000, 200], [5900, 3000, -300], [5900, 3300, 300], [5900, 2800, -500], [6100, 3100, 500], [0, 0, -9200]]) {
      const old = await checkProtectedCorrection(collection(legacy, cash, mpesa, { charge_to: 'station' }));
      legacyCorrections.push(old.posted.id);
      assert.equal(old.preview.shifts[0].change, delta);
      assert.deepEqual([(await view(legacy)).total_cash, (await view(legacy)).total_mpesa, (await view(legacy)).variance], [cash, mpesa, cash + mpesa - 9000]);
      const legacyDaily = ok(await call('GET', `/reports/daily?date=${legacyDay}`));
      const legacyMonth = ok(await call('GET', '/reports/monthly?month=2020-02'));
      assert.deepEqual([legacyDaily.total_cash, legacyDaily.total_mpesa, legacyMonth.total_cash, legacyMonth.total_mpesa], [cash, mpesa, cash, mpesa]);
      assert.equal(ok(await call('GET', `/reports/cash-flow?from=${legacyDay}&to=${legacyDay}`)).net_cash_flow, cash + mpesa);
      assert.deepEqual([(await view(legacy, true)).total_cash, (await view(legacy, true)).total_mpesa, (await view(legacy, true)).variance], [6000, 3000, 0]);
    }
    for (const correction of legacyCorrections.reverse()) await undo(correction);
    assert.deepEqual([(await view(legacy)).total_cash, (await view(legacy)).total_mpesa, (await view(legacy)).variance], [6000, 3000, 0]);

    // Historical snapshot evidence is authoritative even if an old source row
    // differs or is absent; A4 must use the exact same base as A2's reader.
    const edge = async (source: boolean, snapshot: boolean, expense = 0, balances = false) => {
      const edgeDay = balances ? '2018-03-04' : '2019-01-02';
      const [edgeId] = await db('shifts').insert({ employee_id: attendant, shift_date: edgeDay, start_time: `${edgeDay}T00:00:00Z`, status: 'closed', wage_paid: 0,
        ...(balances ? { reconciliation_basis: 'balances_v1', opening_cash_amount: 20, opening_mpesa_amount: 30 } : {}) });
      if (source) await db('shift_collections').insert({ shift_id: edgeId, cash_amount: 999, mpesa_amount: 888, credits_amount: 0, total_collected: 1887 });
      if (snapshot) await db('shift_close_reconciliations').insert({ shift_id: edgeId, readings_reviewed: true, collections_reviewed: true, entries_reviewed: true, expected_sales: balances ? 100 : 150, expected_shift_total: 150, cash_received: 100, mpesa_received: 50, credit_receipts: 0, credits_issued: 0, invoice_consumption: 0, expenses: expense, direct_wage_payment: 0, payroll_payments: 0, total_accounted: 150 + expense, variance: expense, variance_type: expense ? 'surplus' : 'balanced', approved_by_role: 'admin', approved_at: `${edgeDay}T00:00:00Z`,
        ...(balances ? { reconciliation_basis: 'balances_v1', opening_cash_amount: 20, opening_mpesa_amount: 30, funds_added_cash: 0, funds_added_mpesa: 0, funds_added_total: 0, funds_removed_cash: 0, funds_removed_mpesa: 0, funds_removed_total: 0, drawer_business_payouts: 0, expected_closing: 150, inferred_collections: 100, expected_receipts: 100 } : {}) });
      return Number(edgeId);
    };
    for (const hasSource of [true, false]) {
      const edgeId = await edge(hasSource, true);
      const corrected = await checkProtectedCorrection(collection(edgeId, 120, 50));
      assert.equal(corrected.preview.shifts[0].change, 20);
      assert.deepEqual([(await view(edgeId)).total_cash, (await view(edgeId)).total_mpesa, (await view(edgeId)).variance], [120, 50, 20]);
      assert.deepEqual([(await view(edgeId, true)).total_cash, (await view(edgeId, true)).total_mpesa], [100, 50]);
      await undo(corrected.posted.id);
      assert.deepEqual([(await view(edgeId)).total_cash, (await view(edgeId)).total_mpesa, (await view(edgeId)).variance], [100, 50, 0]);
    }
    const changedSources = await edge(true, true, 25);
    assert.equal((await view(changedSources)).variance, 0, 'current active expenses are zero although the snapshot recorded 25');
    const changedSourceCorrection = await checkProtectedCorrection(collection(changedSources, 120, 50));
    assert.deepEqual(changedSourceCorrection.preview.shifts.map((s: any) => [s.as_closed, s.earlier, s.change, s.corrected]), [[25, -25, 20, 20]], 'preview starts from shared current evidence, not snapshot plus only new correction lines');
    assert.equal((await view(changedSources)).variance, 20);
    await undo(changedSourceCorrection.posted.id);
    assert.equal((await view(changedSources)).variance, 0);

    const sourceOnly = await edge(true, false);
    const sourceOnlyCorrection = await checkProtectedCorrection(collection(sourceOnly, 1000, 888));
    assert.deepEqual(sourceOnlyCorrection.preview.shifts.map((s: any) => [s.earlier, s.change, s.corrected]), [[1887, 1, 1888]]);
    assert.deepEqual([(await view(sourceOnly)).total_cash, (await view(sourceOnly)).total_mpesa, (await view(sourceOnly)).variance], [1000, 888, 1888]);
    assert.equal((await call('GET', `/shifts/${sourceOnly}?view=original`)).status, 409);
    await undo(sourceOnlyCorrection.posted.id);
    assert.equal((await view(sourceOnly)).total_cash, 999);

    const snapshotOnlyBalance = await edge(false, true, 0, true);
    const originalBalanceSnapshot = await db('shift_close_reconciliations').where({ shift_id: snapshotOnlyBalance }).first();
    const snapshotOnlyCorrection = await checkProtectedCorrection(collection(snapshotOnlyBalance, 120, 50));
    assert.deepEqual([(await view(snapshotOnlyBalance)).collection_count_recorded, (await view(snapshotOnlyBalance)).variance, (await view(snapshotOnlyBalance)).inferred_collections], [true, 20, 120]);
    for (const url of ['/reports/daily?date=2018-03-04', '/reports/monthly?month=2018-03']) {
      const report = ok(await call('GET', url));
      assert.deepEqual([report.closing_cash, report.closing_mpesa, report.inferred_collections, report.expected_receipts], [120, 50, 120, 100], 'saved balance snapshot is counted evidence without synthesizing a source row');
    }
    const snapshotOnlyFlow = ok(await call('GET', '/reports/cash-flow?from=2018-03-04&to=2018-03-04'));
    assert.deepEqual([snapshotOnlyFlow.inflows.balance_shift_inferred_collections, snapshotOnlyFlow.net_cash_flow], [120, 120]);
    assert.equal((await db('shift_collections').where({ shift_id: snapshotOnlyBalance })).length, 0);
    assert.deepEqual(await db('shift_close_reconciliations').where({ shift_id: snapshotOnlyBalance }).first(), originalBalanceSnapshot);
    await undo(snapshotOnlyCorrection.posted.id);
    assert.deepEqual([(await view(snapshotOnlyBalance)).total_cash, (await view(snapshotOnlyBalance)).variance, (await view(snapshotOnlyBalance)).inferred_collections], [100, 0, 100]);
    const unavailable = await edge(false, false);
    assert.equal((await call('POST', '/corrections/preview', collection(unavailable, 0, 0))).body.code, 'NO_COLLECTIONS');
    const beforeReads = await stable(); await crossViews(4500, 5500); assert.deepEqual(await stable(), beforeReads);
    assert.deepEqual(await db.raw('PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
    assert.equal((await db.raw('PRAGMA foreign_key_check')).length, 0);
    console.log('PASS legacy close preserved, authoritative/missing-source snapshots, no invented evidence, no writes on read, protected business data and integrity');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await db.destroy(); fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
