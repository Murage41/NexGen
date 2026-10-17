import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// B1: a debt/receipt amendment changes customer allocations and expectations,
// while saved counted money, metered sales and physical stock stay fixed.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-customer-shift-corrections-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'customer-shift-corrections-private-test-key';
  const { default: db } = await import('../src/database');
  const auth = await import('../src/middleware/requireAdmin');
  const { hashPin } = await import('../src/services/pinSecurity');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { readShiftFinancials } = await import('../src/services/shiftFinancials');
  const { previewCorrection } = await import('../src/services/corrections');
  const { default: shifts } = await import('../src/routes/shifts');
  const { default: corrections } = await import('../src/routes/corrections');
  const { default: accounts } = await import('../src/routes/creditAccounts');
  const { default: reports } = await import('../src/routes/reports');
  const { default: dashboard } = await import('../src/routes/dashboard');
  const { default: authentication } = await import('../src/routes/auth');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const day = getKenyaDate();
    const [admin] = await db('employees').insert({ name: 'B1 Test Admin', role: 'admin', pin: hashPin('8421'), active: true, daily_wage: 0 });
    const [employee] = await db('employees').insert({ name: 'B1 Test Attendant', role: 'attendant', active: true, daily_wage: 0 });
    const [payPlan] = await db('employee_compensation_plans').insert({ employee_id: employee, name: 'Zero test wage', pay_schedule: 'daily', effective_from: '2010-01-01', version: 1, status: 'active' });
    await db('employee_compensation_components').insert({ plan_id: payPlan, component_type: 'fixed_per_shift', amount: 0 });
    const [tank] = await db('tanks').insert({ label: 'B1 Test Tank', fuel_type: 'petrol', capacity_litres: 5000, current_stock_litres: 3000 });
    const [pump] = await db('pumps').insert({ label: 'B1 Test Pump', nozzle_label: 'B1', fuel_type: 'petrol', tank_id: tank, active: true });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 200, effective_date: '2010-01-01' });
    const [stock] = await db('tank_stock_adjustments').insert({ tank_id: tank, litres_change: 3000, reason: 'opening_balance_correction_gain', notes: 'Synthetic costed stock', adjustment_date: '2010-01-01', adjustment_timestamp: '2010-01-01T00:00:00Z', cost_per_litre: 150, total_cost: 450000 });
    await db('tank_adjustment_batches').insert({ adjustment_id: stock, tank_id: tank, fuel_type: 'petrol', original_litres: 3000, remaining_litres: 3000, cost_per_litre: 150, date: '2010-01-01' });
    const [invoiceOnly] = await db('credit_accounts').insert({ name: 'B1 Invoice Only Customer', type: 'customer', billing_mode: 'invoice', balance: 0 });
    const app = express(); app.use(express.json()); app.use('/auth', authentication); app.use(auth.requireAuth);
    app.use('/shifts', shifts); app.use('/corrections', corrections); app.use('/credit-accounts', accounts); app.use('/reports', reports); app.use('/dashboard', dashboard);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const mobile = { Authorization: `Bearer ${auth.generateToken(Number(admin), 'admin')}` };
    const attendant = { Authorization: `Bearer ${auth.generateToken(Number(employee), 'attendant')}` };
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const call = async (method: string, url: string, body?: any, headers: Record<string, string> = mobile) => {
      const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); let value: any; try { value = JSON.parse(text); } catch { value = text; }
      return { status: response.status, body: value };
    };
    const ok = (response: any, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); assert.equal(response.body.success, true); return response.body.data; };
    const reason = { reason_code: 'office_mistake', reason_note: 'Checked the customer receipt and the signed issue book' };
    const preview = (body: any, headers = mobile) => call('POST', '/corrections/preview', { ...reason, ...body }, headers);
    const amend = async (request: any, headers = mobile, key?: string) => {
      const body = { ...reason, ...request }; const plan = ok(await preview(body, headers));
      const approval = headers === desktop ? { approval_token: ok(await call('POST', '/auth/verify-pin', { employee_id: admin, pin: '8421', purpose: 'correction', plan_hash: plan.plan_hash }, desktop)).approval_token } : {};
      const postedBody = { ...body, plan_hash: plan.plan_hash, ...approval };
      const data = ok(await call('POST', '/corrections', postedBody, { ...headers, ...(key ? { 'Idempotency-Key': key } : {}) }), 201);
      return { plan, data, body: postedBody };
    };
    const undo = async (id: number) => ok(await call('POST', `/corrections/${id}/undo`, reason), 201);
    const view = async (id: number, original = false) => ok(await call('GET', `/shifts/${id}${original ? '?view=original' : ''}`));
    const account = async (id: number) => ok(await call('GET', `/credit-accounts/${id}`));
    const customer = async (label: string, amount: number) => {
      const [id] = await db('credit_accounts').insert({ name: label, type: 'customer', billing_mode: 'money', balance: amount });
      const [credit] = await db('credits').insert({ account_id: id, customer_name: label, amount, balance: amount, status: 'outstanding', created_at: '2010-01-01T00:00:00Z' });
      return { id: Number(id), credit: Number(credit) };
    };
    let sequence = 0;
    const fixture = async (balances: boolean, saleAmount = 200) => {
      const number = ++sequence; const shiftDay = balances ? day : '2020-02-03';
      const a = await customer(`B1 Fictional Customer A${number}`, 500); const b = await customer(`B1 Fictional Customer B${number}`, 400);
      let id: number;
      if (balances) id = Number(ok(await call('POST', '/shifts', { employee_id: employee, compensation_plan_id: payPlan, opening_cash_amount: 200, opening_mpesa_amount: 300 }), 201).id);
      else {
        const [inserted] = await db('shifts').insert({ employee_id: employee, compensation_plan_id: payPlan, shift_date: shiftDay, start_time: `${shiftDay}T05:00:00Z`, status: 'open', wage_paid: 0 });
        id = Number(inserted);
        const prior = await db('pump_readings').join('shifts', 'pump_readings.shift_id', 'shifts.id').where('shifts.status', 'closed').where('pump_readings.pump_id', pump).orderBy('shifts.id', 'desc').first('pump_readings.closing_litres', 'pump_readings.closing_amount');
        await db('pump_readings').insert({ shift_id: id, pump_id: pump, opening_litres: prior?.closing_litres || 0, opening_amount: prior?.closing_amount || 0, closing_litres: prior?.closing_litres || 0, closing_amount: prior?.closing_amount || 0, litres_sold: 0, amount_sold: 0 });
      }
      const reading = (await view(id)).readings[0];
      ok(await call('PUT', `/shifts/${id}/readings`, { readings: [{ pump_id: pump, closing_litres: Number(reading.opening_litres) + 5, closing_amount: Number(reading.opening_amount) + 1000 }] }));
      const sale = Number(ok(await call('POST', `/shifts/${id}/credits`, { account_id: a.id, amount: saleAmount }), 201).id);
      const receipt = Number(ok(await call('POST', `/shifts/${id}/credit-receipts`, { account_id: a.id, amount: 100, payment_method: 'cash' }), 201).id);
      // The historical fixture represents a receipt recorded on that old day;
      // its still-open row can be dated before taking the immutable close.
      if (!balances) await db('credit_payments').where({ id: receipt }).update({ date: shiftDay });
      ok(await call('POST', `/shifts/${id}/expenses`, { amount: 50, category: 'other', description: 'Synthetic drawer expense' }), 201);
      const mpesa = balances ? 550 : Math.min(350, 1050 - saleAmount);
      const cash = balances ? 1000 - saleAmount : 1050 - saleAmount - mpesa;
      ok(await call('PUT', `/shifts/${id}/collections`, { cash_amount: cash, mpesa_amount: mpesa, ...(balances ? { reconciliation_basis: 'balances_v1' } : {}) }));
      const live = await view(id);
      ok(await call('PUT', `/shifts/${id}/close`, { wage_paid: 0, ...(balances ? { reconciliation_basis: 'balances_v1', expected_funds_revision: live.funds_revision } : {}), reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true } }));
      const original = await view(id, true);
      assert.deepEqual([original.total_credits, original.total_credit_receipts, original.variance], [saleAmount, 100, 0]);
      return { id, balances, day: shiftDay, a, b, sale, receipt, cash, mpesa, original };
    };
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const physicalTables = ['shifts', 'shift_collections', 'shift_close_reconciliations', 'pump_readings', 'shift_tank_snapshots', 'tanks', 'tank_stock_ledger', 'tank_stock_adjustments', 'tank_adjustment_batches', 'delivery_batches', 'batch_consumption', 'invoice_consumption', 'customer_invoices', 'invoice_lines', 'invoice_adjustment_notes', 'employee_earnings', 'payroll_payments', 'wage_deductions', 'shift_funds_movements', 'stored_documents'];
    const protectedFacts = async () => {
      const result: Record<string, any> = {};
      for (const table of physicalTables) result[table] = await db(table).orderBy('id');
      result.credit_facts = await db('credits').select('id', 'account_id', 'shift_id', 'amount', 'customer_name', 'created_at').orderBy('id');
      result.receipt_facts = await db('credit_payments').select('id', 'account_id', 'shift_id', 'amount', 'payment_method', 'date').orderBy('id');
      return result;
    };
    const assertProtected = async (before: any) => {
      const after = await protectedFacts();
      for (const table of physicalTables) assert.deepEqual(after[table], before[table], table);
      for (const table of ['credit_facts', 'receipt_facts']) {
        const ids = new Set(before[table].map((row: any) => Number(row.id)));
        assert.deepEqual(after[table].filter((row: any) => ids.has(Number(row.id))), before[table], table);
      }
    };
    const reportFacts = async (f: Fixture) => {
      const daily = ok(await call('GET', `/reports/daily?date=${f.day}`));
      const monthly = ok(await call('GET', `/reports/monthly?month=${f.day.slice(0, 7)}`));
      const flow = ok(await call('GET', `/reports/cash-flow?from=${f.day}&to=${f.day}`));
      return { daily_profit: daily.net_profit, monthly_profit: monthly.net_profit, daily_inferred: daily.inferred_collections, monthly_inferred: monthly.inferred_collections, net_cash: flow.net_cash_flow };
    };
    const check = async (f: Fixture, credits = 200, receipts = 100, variance = credits - receipts - 100) => {
      const detail = await view(f.id); const shared = (await readShiftFinancials(db, [f.id])).get(f.id)!;
      assert.deepEqual([detail.total_cash, detail.total_mpesa, detail.total_credits, detail.total_credit_receipts, detail.variance], [f.cash, f.mpesa, credits, receipts, variance]);
      assert.deepEqual([shared.current.total_credits, shared.current.total_credit_receipts, shared.current.variance], [credits, receipts, variance]);
      assert.equal(detail.inferred_collections, 900, 'receipts were already inside the actual counted money');
      assert.equal(detail.expected_receipts, 1000 - credits + receipts);
      const original = await view(f.id, true);
      assert.deepEqual([original.total_cash, original.total_mpesa, original.total_credits, original.total_credit_receipts, original.variance], [f.cash, f.mpesa, 200, 100, 0]);
      const daily = ok(await call('GET', `/reports/daily?date=${f.day}`));
      const row = daily.shifts.find((shift: any) => Number(shift.id) === f.id);
      assert.deepEqual([row.shift_credits.reduce((sum: number, credit: any) => sum + Number(credit.amount), 0), row.total_credit_receipts, row.variance], [credits, receipts, variance]);
    };
    const postChecked = async (f: Fixture, request: any, headers = mobile, key?: string) => {
      const before = await protectedFacts(); const financial = await reportFacts(f);
      const result = await amend(request, headers, key);
      await assertProtected(before); assert.deepEqual(await reportFacts(f), financial, 'a debt/receipt correction is not a sale or a second receipt');
      return result;
    };
    const undoChecked = async (f: Fixture, id: number) => {
      const before = await protectedFacts(); const financial = await reportFacts(f); await undo(id);
      await assertProtected(before); assert.deepEqual(await reportFacts(f), financial);
    };
    const activePaid = async (accountId: number, creditId: number) => {
      const detail = await account(accountId); const credit = detail.credits.find((row: any) => Number(row.id) === creditId);
      return { paid: Number(credit.total_paid || 0), balance: Number(credit.balance), status: credit.status, held: Number(detail.credit_on_account || 0) };
    };
    const parseCsv = (text: string) => {
      text = text.replace(/^\uFEFF/, ''); const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
      for (let n = 0; n < text.length; n++) {
        const c = text[n];
        if (c === '"') { if (quoted && text[n + 1] === '"') { cell += '"'; n++; } else quoted = !quoted; }
        else if (!quoted && c === ',') { row.push(cell); cell = ''; }
        else if (!quoted && (c === '\r' || c === '\n')) { if (c === '\r' && text[n + 1] === '\n') n++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += c;
      }
      row.push(cell); rows.push(row); return rows;
    };
    const cases: Fixture[] = [];
    for (const balances of [false, true]) {
      const f = await fixture(balances); const destination = await fixture(balances); cases.push(f, destination);
      await check(f); assert.equal(Number((await account(f.a.id)).balance), 600);
      assert.deepEqual(await activePaid(f.a.id, f.a.credit), { paid: 100, balance: 400, status: 'partial', held: 0 });
      for (const [request, aOwes, bOwes, credit, variance] of [
        [{ error_kind: 'wrong_customer', target_id: f.sale, account_id: f.b.id }, 400, 600, 200, 0],
        [{ error_kind: 'wrong_amount', target_id: f.sale, amount: 250 }, 650, 400, 250, 50],
        [{ error_kind: 'wrong_amount', target_id: f.sale, amount: 150, charge_to: 'station' }, 550, 400, 150, -50],
        [{ error_kind: 'duplicate', target_id: f.sale, charge_to: 'station' }, 400, 400, 0, -200],
        [{ error_kind: 'missing', shift_id: f.id, account_id: f.b.id, amount: 150 }, 600, 550, 350, 150],
      ] as Array<[any, number, number, number, number]>) {
        const result = await postChecked(f, { record_type: 'credit_sale', ...request });
        assert.deepEqual([Number((await account(f.a.id)).balance), Number((await account(f.b.id)).balance)], [aOwes, bOwes]);
        await check(f, credit, 100, variance); await undoChecked(f, result.data.id); await check(f);
        assert.deepEqual([Number((await account(f.a.id)).balance), Number((await account(f.b.id)).balance)], [600, 400]);
      }
      const movedSale = await postChecked(f, { record_type: 'credit_sale', error_kind: 'wrong_shift', target_id: f.sale, shift_id: destination.id, charge_to: 'station' });
      await check(f, 0, 100, -200); await check(destination, 400, 100, 200);
      await undoChecked(f, movedSale.data.id); await check(f); await check(destination);
      for (const [request, aOwes, bOwes, receipt, variance] of [
        [{ error_kind: 'wrong_customer', target_id: f.receipt, account_id: f.b.id }, 700, 300, 100, 0],
        [{ error_kind: 'wrong_amount', target_id: f.receipt, amount: 150, charge_to: 'station' }, 550, 400, 150, -50],
        [{ error_kind: 'wrong_amount', target_id: f.receipt, amount: 50 }, 650, 400, 50, 50],
        [{ error_kind: 'wrong_method', target_id: f.receipt }, 600, 400, 100, 0],
        [{ error_kind: 'duplicate', target_id: f.receipt }, 700, 400, 0, 100],
        [{ error_kind: 'missing', shift_id: f.id, account_id: f.b.id, amount: 150, payment_method: 'mpesa', charge_to: 'station' }, 600, 250, 250, -150],
      ] as Array<[any, number, number, number, number]>) {
        const result = await postChecked(f, { record_type: 'debt_receipt', ...request });
        assert.equal(result.plan.shifts[0].change, variance, 'receipt expectation effect matches the current result');
        assert.deepEqual([Number((await account(f.a.id)).balance), Number((await account(f.b.id)).balance)], [aOwes, bOwes]);
        await check(f, 200, receipt, variance);
        assert.equal((await db('correction_lines').where({ correction_id: result.data.id, record_type: 'collection' })).length, 0);
        if (request.error_kind === 'wrong_customer') {
          assert.deepEqual(await activePaid(f.a.id, f.a.credit), { paid: 0, balance: 500, status: 'outstanding', held: 0 });
          assert.deepEqual(await activePaid(f.b.id, f.b.credit), { paid: 100, balance: 300, status: 'partial', held: 0 });
        }
        await undoChecked(f, result.data.id); await check(f);
        assert.deepEqual(await activePaid(f.a.id, f.a.credit), { paid: 100, balance: 400, status: 'partial', held: 0 });
      }
      const movedReceipt = await postChecked(f, { record_type: 'debt_receipt', error_kind: 'wrong_shift', target_id: f.receipt, shift_id: destination.id, charge_to: 'station' });
      await check(f, 200, 0, 100); await check(destination, 200, 200, -100);
      await undoChecked(f, movedReceipt.data.id); await check(f); await check(destination);
      if (balances) {
        const assertHeaders = async (credit: number, receipt: number, variance: number) => {
          const daily = ok(await call('GET', `/reports/daily?date=${day}`));
          const monthly = ok(await call('GET', `/reports/monthly?month=${day.slice(0, 7)}`));
          const dash = ok(await call('GET', '/dashboard'));
          assert.deepEqual([daily.total_credits, daily.total_credit_receipts, daily.inferred_collections, daily.expected_receipts, daily.net_profit], [credit + 200, receipt + 100, 1800, 2000 - credit - 200 + receipt + 100, 400]);
          assert.deepEqual([monthly.total_credits, monthly.credit_payments_received, monthly.inferred_collections, monthly.expected_receipts, monthly.net_profit], [credit + 200, receipt + 100, 1800, 2000 - credit - 200 + receipt + 100, 400]);
          assert.deepEqual([dash.today_collections.credits, dash.today_collections.credit_receipts, dash.today_collections.inferred_collections, dash.today_variance, dash.today_net_profit], [credit + 200, receipt + 100, 1800, variance, 400]);
          const csv = parseCsv((await call('GET', '/shifts/export.csv')).body);
          const row = csv.find((values, index) => index > 0 && Number(values[0]) === f.id)!;
          const at = (name: string) => Number(row[csv[0].indexOf(name)]);
          assert.deepEqual([at('Current Credits Issued'), at('Current Debt Receipts'), at('Current Variance')], [credit, receipt, variance]);
          assert.deepEqual([at('Original Credits Issued'), at('Original Debt Receipts'), at('Original Variance')], [200, 100, 0]);
        };
        const creditHeader = await postChecked(f, { record_type: 'credit_sale', error_kind: 'wrong_amount', target_id: f.sale, amount: 250 });
        await assertHeaders(250, 100, 50); await undoChecked(f, creditHeader.data.id); await assertHeaders(200, 100, 0);
        const receiptHeader = await postChecked(f, { record_type: 'debt_receipt', error_kind: 'wrong_amount', target_id: f.receipt, amount: 150, charge_to: 'station' });
        await assertHeaders(200, 150, -50); await undoChecked(f, receiptHeader.data.id); await assertHeaders(200, 100, 0);
      }
      console.log(`PASS ${balances ? 'balance' : 'legacy'} credit/receipt families, exact paid amounts, fixed counted funds, customer balances and original close`);
    }

    const f = cases[cases.length - 2];
    for (const recordType of ['credit_sale', 'debt_receipt']) {
      for (const invalid of [undefined, null, '', '100', false, -1, 0, 0.001, Infinity, NaN, 100_000_001]) {
        for (const errorKind of ['wrong_amount', 'missing']) {
          const request = { record_type: recordType, error_kind: errorKind, target_id: recordType === 'credit_sale' ? f.sale : f.receipt, shift_id: f.id, account_id: f.b.id, payment_method: 'cash', amount: invalid };
          assert.equal((await preview(request)).body.code, 'INVALID_AMOUNT', `${recordType} ${errorKind} ${String(invalid)}`);
        }
      }
      for (const invalid of [Infinity, -Infinity, NaN]) await assert.rejects(previewCorrection(db, { record_type: recordType, error_kind: 'wrong_amount', target_id: recordType === 'credit_sale' ? f.sale : f.receipt, amount: invalid }, day), (err: any) => err.code === 'INVALID_AMOUNT');
      assert.equal((await preview({ record_type: recordType, error_kind: 'missing', shift_id: f.id, account_id: invoiceOnly, payment_method: 'cash', amount: 1 })).body.code, 'NOT_MONEY_CUSTOMER');
      assert.equal((await preview({ record_type: recordType, error_kind: 'duplicate', target_id: recordType === 'credit_sale' ? f.sale : f.receipt }, attendant)).status, 403);
    }
    const worsening = { record_type: 'debt_receipt', error_kind: 'wrong_amount', target_id: f.receipt, amount: 150 };
    const withoutChoice = ok(await preview(worsening)); assert.equal(withoutChoice.needs_choice, true);
    assert.equal((await call('POST', '/corrections', { ...reason, ...worsening, plan_hash: withoutChoice.plan_hash })).body.code, 'CHOICE_REQUIRED');
    const beforeCharges = Number((await db('employee_variance_entries').where({ employee_id: employee }).sum({ n: 'amount' }).first() as any).n);
    const chosen = await postChecked(f, { ...worsening, charge_to: 'station' });
    assert.equal((await db('employee_variance_entries').where({ record_correction_id: chosen.data.id })).length, 0);
    await undoChecked(f, chosen.data.id);
    const charged = await postChecked(f, { ...worsening, charge_to: 'attendant' });
    assert.equal(Number((await db('employee_variance_entries').where({ record_correction_id: charged.data.id }).first()).amount), 50);
    await undoChecked(f, charged.data.id);
    assert.equal(Number((await db('employee_variance_entries').where({ employee_id: employee }).sum({ n: 'amount' }).first() as any).n), beforeCharges);
    const desktopRequest = { record_type: 'debt_receipt', error_kind: 'wrong_method', target_id: f.receipt };
    const desktopPreview = ok(await preview(desktopRequest, desktop));
    assert.equal((await call('POST', '/corrections', { ...reason, ...desktopRequest, plan_hash: desktopPreview.plan_hash }, desktop)).status, 400);
    const wrongToken = ok(await call('POST', '/auth/verify-pin', { employee_id: admin, pin: '8421', purpose: 'correction', plan_hash: '0'.repeat(64) }, desktop)).approval_token;
    assert.equal((await call('POST', '/corrections', { ...reason, ...desktopRequest, plan_hash: desktopPreview.plan_hash, approval_token: wrongToken }, desktop)).status, 403);
    const exact = await postChecked(f, desktopRequest, desktop, 'b1-customer-shift-replay');
    assert.equal(ok(await call('POST', '/corrections', exact.body, { ...desktop, 'Idempotency-Key': 'b1-customer-shift-replay' }), 201).id, exact.data.id);
    assert.equal((await call('POST', '/corrections', { ...exact.body, reason_note: 'A different request with the same replay key' }, { ...desktop, 'Idempotency-Key': 'b1-customer-shift-replay' })).status, 409);
    const replacement = exact.data.lines.find((line: any) => line.action === 'add').created_record_id;
    const laterCorrection = await postChecked(f, { record_type: 'debt_receipt', error_kind: 'wrong_method', target_id: replacement });
    assert.equal((await call('POST', `/corrections/${exact.data.id}/undo`, reason)).body.code, 'UNDO_BLOCKED');
    await undoChecked(f, laterCorrection.data.id); await undoChecked(f, exact.data.id); await check(f);
    console.log('PASS strict money, named/desktop approval, no automatic employee charge, idempotency and dependent undo');
    for (const recordType of ['credit_sale', 'debt_receipt']) {
      const oneCent = await postChecked(f, { record_type: recordType, error_kind: 'wrong_amount', target_id: recordType === 'credit_sale' ? f.sale : f.receipt, amount: 0.01, charge_to: 'station' });
      await check(f, recordType === 'credit_sale' ? 0.01 : 200, recordType === 'debt_receipt' ? 0.01 : 100, recordType === 'credit_sale' ? -199.99 : 99.99);
      await undoChecked(f, oneCent.data.id); await check(f);
    }

    // Approval binds account and shift history, including events whose net was undone.
    for (const recordType of ['credit_sale', 'debt_receipt']) {
      const request = { record_type: recordType, error_kind: 'wrong_amount', target_id: recordType === 'credit_sale' ? f.sale : f.receipt, amount: recordType === 'credit_sale' ? 250 : 150, charge_to: 'station' };
      for (const interference of [
        () => amend({ record_type: 'collection', error_kind: 'wrong_amount', shift_id: f.id, cash_amount: f.cash + 1, mpesa_amount: f.mpesa }),
        () => amend({ record_type: 'credit_sale', error_kind: 'missing', shift_id: f.id, account_id: f.a.id, amount: 1 }),
        () => amend({ record_type: 'debt_receipt', error_kind: 'wrong_method', target_id: f.receipt }),
      ]) {
        const plan = ok(await preview(request)); const changed = await interference(); await undo(changed.data.id);
        assert.equal((await call('POST', '/corrections', { ...reason, ...request, plan_hash: plan.plan_hash })).body.code, 'PLAN_CHANGED');
      }
      const plan = ok(await preview(request));
      ok(await call('POST', `/credit-accounts/${f.a.id}/payments`, { amount: 1, payment_method: 'cash', date: day }), 201);
      assert.equal((await call('POST', '/corrections', { ...reason, ...request, plan_hash: plan.plan_hash })).body.code, 'PLAN_CHANGED', 'an allocation-only customer change invalidates approval');
    }
    const unrelated = await customer('B1 Unrelated Customer', 100);
    const scopedRequest = { record_type: 'debt_receipt', error_kind: 'wrong_method', target_id: f.receipt };
    const scopedPlan = ok(await preview(scopedRequest));
    ok(await call('POST', `/credit-accounts/${unrelated.id}/payments`, { amount: 10, payment_method: 'cash', date: day }), 201);
    const scopedPost = ok(await call('POST', '/corrections', { ...reason, ...scopedRequest, plan_hash: scopedPlan.plan_hash }), 201);
    await undo(scopedPost.id);
    console.log('PASS stale previews after correction+undo and later customer payment allocation');

    const paid = await fixture(true);
    ok(await call('POST', `/credit-accounts/${paid.a.id}/payments`, { amount: 600, payment_method: 'cash', date: day }), 201);
    const paidSale = (await db('shift_credits').where({ id: paid.sale }).first()).credit_id;
    assert.deepEqual(await activePaid(paid.a.id, Number(paidSale)), { paid: 200, balance: 0, status: 'paid', held: 0 });
    await db('credit_accounts').where({ id: paid.a.id }).update({ credit_limit: 60 });
    const paidIncrease = await postChecked(paid, { record_type: 'credit_sale', error_kind: 'wrong_amount', target_id: paid.sale, amount: 250 });
    assert.equal(Boolean(paidIncrease.plan.needs_override), false, 'paid old amount is released as held credit; exposure only increases 50');
    assert.equal(Number((await account(paid.a.id)).balance), 50);
    const replacementSale = paidIncrease.data.lines.find((line: any) => line.action === 'add').created_record_id;
    const replacementCredit = Number((await db('shift_credits').where({ id: replacementSale }).first()).credit_id);
    assert.deepEqual(await activePaid(paid.a.id, replacementCredit), { paid: 200, balance: 50, status: 'partial', held: 0 });
    ok(await call('POST', `/credit-accounts/${paid.a.id}/payments`, { amount: 50, payment_method: 'cash', date: day }), 201);
    await undoChecked(paid, paidIncrease.data.id);
    assert.deepEqual(await activePaid(paid.a.id, Number(paidSale)), { paid: 200, balance: 0, status: 'paid', held: 50 }, 'later real money stays held rather than disappearing or becoming a refund');
    await db('credit_accounts').where({ id: paid.b.id }).update({ credit_limit: 450 });
    const limited = { record_type: 'credit_sale', error_kind: 'missing', shift_id: paid.id, account_id: paid.b.id, amount: 100 };
    const limitedPlan = ok(await preview(limited)); assert.equal(limitedPlan.needs_override, true);
    assert.equal((await call('POST', '/corrections', { ...reason, ...limited, plan_hash: limitedPlan.plan_hash })).body.code, 'OVERRIDE_REQUIRED');
    const override = await postChecked(paid, { ...limited, limit_override: true });
    assert.equal((await db('credit_limit_overrides').where({ account_id: paid.b.id })).length, 1);
    await undoChecked(paid, override.data.id);
    console.log('PASS paid-sale replacement, exposure delta, approved limit override and retained later money');

    const partlyPaid = await fixture(true, 1000);
    ok(await call('POST', `/credit-accounts/${partlyPaid.a.id}/payments`, { amount: 1200, payment_method: 'cash', date: day }), 201);
    const partlyCredit = Number((await db('shift_credits').where({ id: partlyPaid.sale }).first()).credit_id);
    assert.deepEqual(await activePaid(partlyPaid.a.id, partlyCredit), { paid: 800, balance: 200, status: 'partial', held: 0 });
    await db('credit_accounts').where({ id: partlyPaid.a.id }).update({ credit_limit: 600 });
    const partlyRequest = { record_type: 'credit_sale', error_kind: 'wrong_amount', target_id: partlyPaid.sale, amount: 1200 };
    const partlyCorrection = await postChecked(partlyPaid, partlyRequest);
    assert.equal(Boolean(partlyCorrection.plan.needs_override), false);
    assert.equal(Number((await account(partlyPaid.a.id)).balance), 400, '1,000 debt paid by 800 becomes 1,200 less the same 800');
    await undoChecked(partlyPaid, partlyCorrection.data.id);
    await db('credit_accounts').where({ id: partlyPaid.a.id }).update({ credit_limit: 300 });
    assert.equal(ok(await preview(partlyRequest)).needs_override, true);
    const genuineOverride = await postChecked(partlyPaid, { ...partlyRequest, limit_override: true });
    const audit = await db('credit_limit_overrides').where({ account_id: partlyPaid.a.id }).orderBy('id', 'desc').first();
    const breach = JSON.parse(audit.breaches).find((item: any) => item.rule === 'credit_limit');
    assert.deepEqual([Number(audit.amount), breach.exposure_before, breach.exposure_after], [200, 200, 400]);
    await undoChecked(partlyPaid, genuineOverride.data.id);
    await db('credit_accounts').where({ id: partlyPaid.a.id }).update({ credit_limit: 100 });
    const noIncrease = await postChecked(partlyPaid, { record_type: 'credit_sale', error_kind: 'wrong_shift', target_id: partlyPaid.sale, shift_id: cases[3].id, charge_to: 'station' });
    assert.equal(Boolean(noIncrease.plan.needs_override), false, 'an unchanged debt moved between shifts does not create exposure');
    await undoChecked(partlyPaid, noIncrease.data.id);

    const aged = await fixture(false, 1000);
    ok(await call('POST', `/credit-accounts/${aged.a.id}/payments`, { amount: 1400, payment_method: 'cash', date: day }), 201);
    await db('credit_accounts').where({ id: aged.a.id }).update({ credit_age_limit_days: 1 });
    const agedPreview = ok(await preview({ record_type: 'credit_sale', error_kind: 'wrong_amount', target_id: aged.sale, amount: 1200 }));
    assert.equal(agedPreview.needs_override, true, 'an increase to an old fully paid sale creates an overdue 200');
    assert(agedPreview.effects.some((text: string) => text.includes('200.00') && text.includes('unpaid')));
    const undoLimit = await fixture(true);
    const smaller = await postChecked(undoLimit, { record_type: 'credit_sale', error_kind: 'wrong_amount', target_id: undoLimit.sale, amount: 100, charge_to: 'station' });
    await db('credit_accounts').where({ id: undoLimit.a.id }).update({ credit_limit: 550 });
    assert.equal((await call('POST', `/corrections/${smaller.data.id}/undo`, reason)).body.code, 'UNDO_BLOCKED');
    await db('credit_accounts').where({ id: undoLimit.a.id }).update({ credit_limit: 700 });
    await undoChecked(undoLimit, smaller.data.id);
    console.log('PASS 1,000/800/1,200 exposure arithmetic, exact override audit, unchanged shift move, new overdue debt and undo limit guard');

    const held = await fixture(true);
    const overpayment = await postChecked(held, { record_type: 'debt_receipt', error_kind: 'missing', shift_id: held.id, account_id: held.b.id, amount: 900, payment_method: 'mpesa', charge_to: 'station' });
    assert.deepEqual(await activePaid(held.b.id, held.b.credit), { paid: 400, balance: 0, status: 'paid', held: 500 });
    const consuming = await postChecked(held, { record_type: 'credit_sale', error_kind: 'missing', shift_id: held.id, account_id: held.b.id, amount: 100 });
    assert.equal(Number((await account(held.b.id)).credit_on_account), 400);
    await undoChecked(held, overpayment.data.id);
    assert.deepEqual([Number((await account(held.b.id)).balance), Number((await account(held.b.id)).credit_on_account)], [500, 0], 'reverse exact allocations even after held credit paid a later debt');
    await undoChecked(held, consuming.data.id);
    assert.deepEqual(await activePaid(held.b.id, held.b.credit), { paid: 0, balance: 400, status: 'outstanding', held: 0 });
    const refundable = await fixture(true);
    const refundPayment = await postChecked(refundable, { record_type: 'debt_receipt', error_kind: 'missing', shift_id: refundable.id, account_id: refundable.b.id, amount: 900, payment_method: 'cash', charge_to: 'station' });
    ok(await call('POST', `/credit-accounts/${refundable.b.id}/refunds`, { amount: 100, method: 'cash', date: day }), 201);
    const refundedPaymentId = refundPayment.data.lines.find((line: any) => line.action === 'add').created_record_id;
    assert.equal((await preview({ record_type: 'debt_receipt', error_kind: 'wrong_amount', target_id: refundedPaymentId, amount: 800 })).body.code, 'PAYMENT_PARTLY_REFUNDED');
    assert.equal((await call('POST', `/corrections/${refundPayment.data.id}/undo`, reason)).body.code, 'UNDO_BLOCKED');
    assert.deepEqual(await activePaid(refundable.b.id, refundable.b.credit), { paid: 400, balance: 0, status: 'paid', held: 400 });
    console.log('PASS consumed held credit reverses its exact allocations; real refunded money blocks correction and undo');

    const broken = await fixture(true);
    ok(await call('POST', `/credit-accounts/${broken.a.id}/payments`, { amount: 500, payment_method: 'cash', date: day }), 201);
    const brokenCreditId = Number((await db('shift_credits').where({ id: broken.sale }).first()).credit_id);
    assert.deepEqual(await activePaid(broken.a.id, brokenCreditId), { paid: 100, balance: 100, status: 'partial', held: 0 });
    await db('credits').where({ id: brokenCreditId }).update({ balance: 101 });
    const brokenBefore = await protectedFacts();
    assert.equal((await preview({ record_type: 'credit_sale', error_kind: 'wrong_amount', target_id: broken.sale, amount: 250 })).body.code, 'CREDIT_ALLOCATION_INCOMPLETE');
    await assertProtected(brokenBefore);
    await db('credits').where({ id: brokenCreditId }).update({ balance: 100 });
    const brokenPayment = await db('credit_payments').where({ account_id: broken.a.id, shift_id: null, status: 'posted' }).orderBy('id', 'desc').first();
    await db('credit_payments').where({ id: brokenPayment.id }).update({ unapplied_amount: 1 });
    assert.equal((await preview({ record_type: 'credit_sale', error_kind: 'wrong_amount', target_id: broken.sale, amount: 250 })).body.code, 'CREDIT_ALLOCATION_INCOMPLETE', 'each contributing payment must retain its exact allocation/held/refund partition');
    assert.equal((await preview({ record_type: 'debt_receipt', error_kind: 'wrong_method', target_id: broken.receipt })).body.code, 'CREDIT_ALLOCATION_INCOMPLETE', 'the receipt must validate other payments contributing to the same allocated debt');
    await db('credit_payments').where({ id: brokenPayment.id }).update({ unapplied_amount: 0 });
    for (const changed of [{ deleted_at: new Date().toISOString() }, { account_id: broken.b.id }, { status: 'reversed' }]) {
      await db('credits').where({ id: broken.a.credit }).update(changed);
      const receiptBefore = await protectedFacts();
      assert.equal((await preview({ record_type: 'debt_receipt', error_kind: 'wrong_method', target_id: broken.receipt })).body.code, 'PAYMENT_ALLOCATION_INCOMPLETE');
      await assertProtected(receiptBefore);
      await db('credits').where({ id: broken.a.credit }).update({ deleted_at: null, account_id: broken.a.id, status: 'paid' });
    }
    await db('credits').where({ id: broken.a.credit }).update({ balance: 1 });
    assert.equal((await preview({ record_type: 'debt_receipt', error_kind: 'wrong_method', target_id: broken.receipt })).body.code, 'CREDIT_ALLOCATION_INCOMPLETE', 'never clamp a reversal against an inconsistent allocated debt');
    await db('credits').where({ id: broken.a.credit }).update({ balance: 0 });
    const badPair = await fixture(true);
    const pairedCreditId = Number((await db('shift_credits').where({ id: badPair.sale }).first()).credit_id);
    await db('shift_credits').insert({ shift_id: badPair.id, credit_id: pairedCreditId, customer_name: 'B1 duplicate imported source link', amount: 200 });
    const pairBefore = await protectedFacts();
    assert.equal((await preview({ record_type: 'credit_sale', error_kind: 'wrong_amount', target_id: badPair.sale, amount: 250 })).body.code, 'SALE_LINK_INCOMPLETE');
    await assertProtected(pairBefore);
    console.log('PASS credit/source pair and paid allocation partitions refuse corrupt history without repair');

    const changedAccounts = await fixture(true);
    const reassigned = await postChecked(changedAccounts, { record_type: 'debt_receipt', error_kind: 'wrong_customer', target_id: changedAccounts.receipt, account_id: changedAccounts.b.id });
    ok(await call('POST', `/credit-accounts/${changedAccounts.a.id}/payments`, { amount: 700, payment_method: 'cash', date: day }), 201);
    ok(await call('POST', `/credit-accounts/${changedAccounts.b.id}/payments`, { amount: 300, payment_method: 'cash', date: day }), 201);
    for (const accountId of [changedAccounts.a.id, changedAccounts.b.id]) {
      ok(await call('PUT', `/credit-accounts/${accountId}`, { billing_mode: 'invoice' }));
      assert.equal((await call('POST', `/corrections/${reassigned.data.id}/undo`, reason)).body.code, 'UNDO_BLOCKED');
      ok(await call('PUT', `/credit-accounts/${accountId}`, { billing_mode: 'money' }));
      await db('credit_accounts').where({ id: accountId }).update({ deleted_at: new Date().toISOString() });
      assert.equal((await call('POST', `/corrections/${reassigned.data.id}/undo`, reason)).body.code, 'UNDO_BLOCKED');
      await db('credit_accounts').where({ id: accountId }).update({ deleted_at: null });
    }
    const undoMoneyFacts = async () => {
      const facts: Record<string, any> = {};
      for (const table of ['credit_accounts', 'credits', 'credit_payments', 'credit_payment_allocations',
        'customer_refunds', 'customer_refund_allocations', 'corrections', 'correction_lines', 'employee_variance_entries']) {
        facts[table] = await db(table).orderBy('id');
      }
      return facts;
    };
    const refusesBrokenUndo = async () => {
      const before = await undoMoneyFacts();
      assert.equal((await call('POST', `/corrections/${reassigned.data.id}/undo`, reason)).body.code, 'UNDO_BLOCKED',
        'restoring a reversed receipt requires zero held money, no active allocation and no posted refund');
      assert.deepEqual(await undoMoneyFacts(), before, 'blocked undo must not repair or change financial history');
    };
    for (const held of [1, 0.001]) {
      await db('credit_payments').where({ id: changedAccounts.receipt }).update({ unapplied_amount: held });
      await refusesBrokenUndo();
      await db('credit_payments').where({ id: changedAccounts.receipt }).update({ unapplied_amount: 0 });
    }
    const [strayAllocation] = await db('credit_payment_allocations').insert({
      payment_id: changedAccounts.receipt, credit_id: changedAccounts.a.credit, amount_applied: 1,
    });
    await refusesBrokenUndo();
    await db('credit_payment_allocations').where({ id: strayAllocation }).update({ reversed_at: new Date().toISOString() });
    const [strayRefund] = await db('customer_refunds').insert({
      account_id: changedAccounts.a.id, amount: 1, method: 'cash', refund_date: day, status: 'posted',
      approved_by_employee_id: admin, approved_by_name: 'B1 Test Admin',
    });
    await db('customer_refund_allocations').insert({ refund_id: strayRefund, payment_id: changedAccounts.receipt, amount: 1 });
    await refusesBrokenUndo();
    await db('customer_refunds').where({ id: strayRefund }).update({ status: 'reversed' });
    await undoChecked(changedAccounts, reassigned.data.id);
    assert.deepEqual(await activePaid(changedAccounts.a.id, changedAccounts.a.credit), { paid: 500, balance: 0, status: 'paid', held: 100 });
    assert.deepEqual(await activePaid(changedAccounts.b.id, changedAccounts.b.credit), { paid: 300, balance: 100, status: 'partial', held: 0 });
    console.log('PASS receipt undo requires valid original and replacement money accounts and retains later genuine payments');

    const newCreditCustomer = await fixture(true);
    const addedCredit = await postChecked(newCreditCustomer, { record_type: 'credit_sale', error_kind: 'missing', shift_id: newCreditCustomer.id, account_id: newCreditCustomer.b.id, amount: 100 });
    ok(await call('POST', `/credit-accounts/${newCreditCustomer.b.id}/payments`, { amount: 500, payment_method: 'cash', date: day }), 201);
    const movedCreditCustomer = await fixture(true);
    const movedCredit = await postChecked(movedCreditCustomer, { record_type: 'credit_sale', error_kind: 'wrong_customer', target_id: movedCreditCustomer.sale, account_id: movedCreditCustomer.b.id });
    ok(await call('POST', `/credit-accounts/${movedCreditCustomer.b.id}/payments`, { amount: 600, payment_method: 'cash', date: day }), 201);
    for (const [caseFixture, correction, heldAmount] of [
      [newCreditCustomer, addedCredit, 100], [movedCreditCustomer, movedCredit, 200],
    ] as const) {
      const accountId = caseFixture.b.id;
      ok(await call('PUT', `/credit-accounts/${accountId}`, { billing_mode: 'invoice' }));
      assert.equal((await call('POST', `/corrections/${correction.data.id}/undo`, reason)).body.code, 'UNDO_BLOCKED', 'undo may not release hidden money credit into an invoice customer');
      ok(await call('PUT', `/credit-accounts/${accountId}`, { billing_mode: 'money' }));
      await db('credit_accounts').where({ id: accountId }).update({ deleted_at: new Date().toISOString() });
      assert.equal((await call('POST', `/corrections/${correction.data.id}/undo`, reason)).body.code, 'UNDO_BLOCKED');
      await db('credit_accounts').where({ id: accountId }).update({ deleted_at: null });
      await undoChecked(caseFixture, correction.data.id);
      assert.deepEqual(await activePaid(accountId, caseFixture.b.credit), { paid: 400, balance: 0, status: 'paid', held: heldAmount });
    }
    assert.equal(Number((await account(movedCreditCustomer.a.id)).balance), 600, 'the original customer debt is restored without consuming the other customer\'s real payment');
    console.log('PASS missing/reassigned paid-credit undo blocks converted/deleted replacement accounts and preserves real money after restoration');

    const historical = cases[0];
    const [inconsistent] = await db('shifts').insert({ employee_id: employee, shift_date: '2018-03-04', start_time: '2018-03-04T00:00:00Z', status: 'closed', wage_paid: 0 });
    await db('shift_collections').insert({ shift_id: inconsistent, cash_amount: 100, mpesa_amount: 50, credits_amount: 0, total_collected: 150 });
    await db('shift_close_reconciliations').insert({ shift_id: inconsistent, readings_reviewed: true, collections_reviewed: true, entries_reviewed: true, expected_sales: 150, expected_shift_total: 150, cash_received: 100, mpesa_received: 50, credit_receipts: 0, credits_issued: 0, invoice_consumption: 0, expenses: 25, direct_wage_payment: 0, payroll_payments: 0, total_accounted: 175, variance: 25, variance_type: 'surplus', approved_by_role: 'admin', approved_at: '2018-03-04T00:00:00Z' });
    const historicReceipt = await amend({ record_type: 'debt_receipt', error_kind: 'missing', shift_id: Number(inconsistent), account_id: historical.b.id, amount: 10, payment_method: 'cash', charge_to: 'station' });
    assert.deepEqual(historicReceipt.plan.shifts.map((s: any) => [s.as_closed, s.earlier, s.change, s.corrected]), [[25, -25, -10, -10]]);
    assert.equal((await view(Number(inconsistent))).variance, -10); await undo(historicReceipt.data.id);
    const later = ok(await call('POST', '/shifts', { employee_id: employee, compensation_plan_id: payPlan, opening_cash_amount: 1200, opening_mpesa_amount: 800 }), 201);
    const laterBefore = await db('shifts').where({ id: later.id }).first();
    const prior = await postChecked(paid, { record_type: 'debt_receipt', error_kind: 'wrong_method', target_id: paid.receipt });
    assert.deepEqual(await db('shifts').where({ id: later.id }).first(), laterBefore); await undoChecked(paid, prior.data.id);
    const beforeReads = await protectedFacts(); await view(paid.id); await reportFacts(paid); await account(paid.a.id);
    await assertProtected(beforeReads);
    assert.deepEqual(await db.raw('PRAGMA integrity_check'), [{ integrity_check: 'ok' }]); assert.equal((await db.raw('PRAGMA foreign_key_check')).length, 0);
    console.log('PASS shared-current historical baseline, later independent opening, protected facts, read-only views and database integrity');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await db.destroy(); fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
