import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-float-lifecycle-'));
  process.env.NEXGEN_DATA_DIR = directory;
  const { default: db } = await import('../src/database');
  const { generateToken, requireAuth } = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { default: shifts } = await import('../src/routes/shifts');
  const { default: reports } = await import('../src/routes/reports');
  const { default: dashboard } = await import('../src/routes/dashboard');
  const { default: corrections } = await import('../src/routes/corrections');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const day = getKenyaDate();
    const [admin] = await db('employees').insert({ name: 'Float Lifecycle Admin', role: 'admin', active: true, daily_wage: 0 });
    const [employee] = await db('employees').insert({ name: 'Float Lifecycle Attendant', role: 'attendant', active: true, daily_wage: 600 });
    const [other] = await db('employees').insert({ name: 'Other Float Attendant', role: 'attendant', active: true, daily_wage: 0 });
    const [plan] = await db('employee_compensation_plans').insert({ employee_id: employee, name: 'Daily test pay', pay_schedule: 'daily', effective_from: '2020-01-01', version: 1, status: 'active' });
    await db('employee_compensation_components').insert({ plan_id: plan, component_type: 'fixed_per_shift', amount: 600 });
    const [tank] = await db('tanks').insert({ label: 'Float Test Tank', fuel_type: 'petrol', capacity_litres: 1000, current_stock_litres: 500 });
    const [pump] = await db('pumps').insert({ label: 'Float Test Pump', nozzle_label: 'T1', fuel_type: 'petrol', tank_id: tank, active: true });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 200, effective_date: '2020-01-01' });
    const [stock] = await db('tank_stock_adjustments').insert({ tank_id: tank, litres_change: 500, reason: 'opening_balance_correction_gain', notes: 'Synthetic costed opening stock', adjustment_date: day, adjustment_timestamp: '2020-01-01T00:00:00Z', cost_per_litre: 150, total_cost: 75000 });
    await db('tank_adjustment_batches').insert({ adjustment_id: stock, tank_id: tank, fuel_type: 'petrol', original_litres: 500, remaining_litres: 500, cost_per_litre: 150, date: '2020-01-01' });
    const app = express(); app.use(express.json());
    app.use('/shifts', shifts); app.use('/reports', reports); app.use('/dashboard', requireAuth, dashboard); app.use('/corrections', corrections);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const headers = { Authorization: `Bearer ${generateToken(admin, 'admin')}`, 'Content-Type': 'application/json' };
    const call = async (method: string, url: string, body?: any, extra: Record<string, string> = {}) => {
      const response = await fetch(base + url, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); let json: any;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: response.status, body: json };
    };
    const ok = (response: any) => { assert(response.status < 300 && response.body.success, JSON.stringify(response)); return response.body.data; };
    const closeBody = (revision = 0, wage = 0) => ({ wage_paid: wage, reconciliation_basis: 'balances_v1', expected_funds_revision: revision,
      reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true } });
    const opening = { employee_id: employee, compensation_plan_id: plan, opening_cash_amount: 2000, opening_mpesa_amount: 3000 };
    assert.equal((await call('POST', '/shifts', { employee_id: employee, compensation_plan_id: plan })).status, 400);
    for (const amount of [-1, null, '100', 100000001, 0.001]) {
      assert.equal((await call('POST', '/shifts', { ...opening, opening_cash_amount: amount })).status, 400);
    }
    assert.equal((await call('POST', '/shifts', opening, { Authorization: `Bearer ${generateToken(employee, 'attendant')}` })).status, 403);
    const opened = ok(await call('POST', '/shifts', opening, { 'Idempotency-Key': 'float-open-lifecycle-1' }));
    const id = Number(opened.id);
    assert.equal(opened.reconciliation_basis, 'balances_v1');
    assert.equal(ok(await call('POST', '/shifts', opening, { 'Idempotency-Key': 'float-open-lifecycle-1' })).id, id);
    assert.equal((await call('POST', '/shifts', { ...opening, opening_cash_amount: 0 }, { 'Idempotency-Key': 'float-open-lifecycle-1' })).status, 409);
    assert.equal((await call('POST', '/shifts', opening)).status, 400);
    const uncounted = ok(await call('GET', `/shifts/${id}`));
    assert.equal(uncounted.collection_count_recorded, false);
    assert.deepEqual(uncounted.opening_funds, { cash_amount: 2000, mpesa_amount: 3000 });
    assert.equal((await call('PUT', `/shifts/${id}/close`, closeBody())).body.code, 'SHIFT_CLOSING_COUNT_REQUIRED');
    assert.equal(ok(await call('GET', `/reports/cash-flow?from=${day}&to=${day}`)).net_cash_flow, 0, 'opening alone moves no station cash');
    const own = ok(await call('GET', `/shifts/${id}`, undefined, { Authorization: `Bearer ${generateToken(employee, 'attendant')}` }));
    for (const key of ['variance', 'expected_closing', 'expected_receipts', 'inferred_collections', 'expected_sales']) assert.equal(Object.hasOwn(own, key), false, key);
    assert.equal(own.current_financials, null);
    assert.equal((await call('GET', `/shifts/${id}`, undefined, { Authorization: `Bearer ${generateToken(other, 'attendant')}` })).status, 403);
    ok(await call('PUT', `/shifts/${id}/readings`, { readings: [{ pump_id: pump, closing_litres: 50, closing_amount: 10000 }] }));
    const [account] = await db('credit_accounts').insert({ name: 'Float Money Customer', type: 'customer', billing_mode: 'money' });
    const [fleet] = await db('credit_accounts').insert({ name: 'Float Fleet Customer', type: 'customer', billing_mode: 'invoice' });
    await db('credits').insert({ account_id: account, customer_name: 'Float Money Customer', amount: 500, balance: 500, status: 'outstanding', created_at: '2020-01-01T00:00:00Z' });
    ok(await call('POST', `/shifts/${id}/credit-receipts`, { account_id: account, amount: 500, payment_method: 'cash' }));
    ok(await call('POST', `/shifts/${id}/credits`, { account_id: account, amount: 1000 }));
    ok(await call('POST', `/shifts/${id}/invoice-consumption`, { account_id: fleet, pump_id: pump, fuel_type: 'petrol', litres: 10 }));
    ok(await call('POST', `/shifts/${id}/expenses`, { category: 'other', description: 'Synthetic drawer expense', amount: 400 }));
    assert.equal(ok(await call('GET', `/shifts/${id}`)).collection_count_recorded, false, 'the credits cache is not an entered balance count');
    assert.equal((await call('PUT', `/shifts/${id}/close`, closeBody())).body.code, 'SHIFT_CLOSING_COUNT_REQUIRED');
    const counted = { cash_amount: 6000, mpesa_amount: 5500, reconciliation_basis: 'balances_v1' };
    assert.equal((await call('PUT', `/shifts/${id}/collections`, { cash_amount: 6000, mpesa_amount: 5500 })).body.code, 'SHIFT_BALANCE_CLIENT_REQUIRED');
    assert.equal((await call('PUT', `/shifts/${id}/collections`, { ...counted, reconciliation_basis: 'legacy' })).status, 409);
    ok(await call('PUT', `/shifts/${id}/collections`, counted));
    const reason = { reason_code: 'office_mistake', reason_note: 'Confirmed against the synthetic handover record' };
    const amend = async (request: any, key?: string) => {
      const body = { ...request, ...reason }; const preview = ok(await call('POST', '/corrections/preview', body));
      return ok(await call('POST', '/corrections', { ...body, plan_hash: preview.plan_hash }, key ? { 'Idempotency-Key': key } : {}));
    };
    const topup = await amend({ record_type: 'shift_funds', error_kind: 'missing', shift_id: id, payment_method: 'cash', amount: 1000,
      category: 'added', source: 'station_bank_safe', reference: 'SYNTHETIC-TOPUP', description: 'Extra float from the station safe' }, 'float-movement-lifecycle-1');
    assert.equal((await call('POST', `/shifts/${id}/cancel`, { reason: 'Synthetic attempt with real custody movement' })).body.code, 'SHIFT_HAS_FUNDS_MOVEMENTS');
    assert.equal((await call('PUT', `/shifts/${id}/close`, closeBody(0, 600))).body.code, 'STALE_SHIFT_FUNDS');
    ok(await call('POST', `/corrections/${topup.id}/undo`, reason));
    const ready = ok(await call('GET', `/shifts/${id}`));
    assert.equal(ready.funds_movements.length, 1);
    assert(ready.funds_movements[0].deleted_at);
    assert.equal((await call('PUT', `/shifts/${id}/close`, { ...closeBody(ready.funds_revision, 600), reconciliation_basis: undefined })).body.code, 'SHIFT_BALANCE_CLIENT_REQUIRED');
    ok(await call('PUT', `/shifts/${id}/close`, closeBody(ready.funds_revision, 600)));
    const closed = ok(await call('GET', `/shifts/${id}`));
    assert.deepEqual([closed.expected_closing, closed.inferred_collections, closed.expected_receipts, closed.variance], [11500, 7500, 7500, 0]);
    assert.deepEqual([closed.total_credits, closed.total_invoice_consumption, closed.total_expenses, closed.employee_wage], [1000, 2000, 400, 600]);
    assert.equal(closed.sales_cash, null); assert.equal(closed.sales_mpesa, null);
    const original = await db('shift_close_reconciliations').where({ shift_id: id }).first();
    assert.deepEqual([original.opening_cash_amount, original.opening_mpesa_amount, original.inferred_collections], [2000, 3000, 7500]);
    const stockBefore = JSON.stringify({ rows: await db('pump_readings'), batches: await db('tank_adjustment_batches'), tank: await db('tanks'), cogs: await db('batch_consumption'), earnings: await db('employee_earnings'), credits: await db('credits'), accounts: await db('credit_accounts') });
    const openingCorrection = await amend({ record_type: 'opening_funds', error_kind: 'wrong_amount', shift_id: id, payment_method: 'cash', amount: 2300, charge_to: 'station' });
    const corrected = ok(await call('GET', `/shifts/${id}`));
    assert.deepEqual([corrected.opening_funds.cash_amount, corrected.variance, corrected.inferred_collections], [2300, -300, 7200]);
    const asClosed = ok(await call('GET', `/shifts/${id}?view=original`));
    assert.deepEqual([asClosed.opening_funds.cash_amount, asClosed.variance, asClosed.inferred_collections], [2000, 0, 7500]);
    const split = await amend({ record_type: 'collection', error_kind: 'wrong_split', shift_id: id, amount: 700, payment_method: 'mpesa' });
    const splitDetail = ok(await call('GET', `/shifts/${id}`));
    assert.deepEqual([splitDetail.total_cash, splitDetail.total_mpesa, splitDetail.variance], [5300, 6200, -300]);
    ok(await call('POST', `/corrections/${split.id}/undo`, reason));
    for (const endpoint of [`/reports/daily?date=${day}`, `/reports/monthly?month=${day.slice(0, 7)}`]) {
      const report = ok(await call('GET', endpoint));
      assert.equal(report.inferred_collections, 7200, endpoint); assert.equal(report.expected_receipts, 7500, endpoint);
      assert.equal(report.total_cash, null, 'closing custody cannot be labelled channel receipts');
      assert.equal(report.total_mpesa, null);
      assert.equal(report.net_profit, 1500, 'opening changes do not change profit');
    }
    const dash = ok(await call('GET', '/dashboard'));
    assert.deepEqual([dash.today_collections.inferred_collections, dash.today_collections.cash, dash.today_collections.mpesa], [7200, null, null]);
    const flow = ok(await call('GET', `/reports/cash-flow?from=${day}&to=${day}`));
    assert.deepEqual([flow.inflows.balance_shift_inferred_collections, flow.outflows.shift_expenses, flow.outflows.wages_paid, flow.net_cash_flow], [7200, 400, 600, 6200]);
    assert.equal(await db('shift_close_reconciliations').where({ shift_id: id }).first().then(JSON.stringify), JSON.stringify(original));
    assert.equal(JSON.stringify({ rows: await db('pump_readings'), batches: await db('tank_adjustment_batches'), tank: await db('tanks'), cogs: await db('batch_consumption'), earnings: await db('employee_earnings'), credits: await db('credits'), accounts: await db('credit_accounts') }), stockBefore);
    ok(await call('POST', `/corrections/${openingCorrection.id}/undo`, reason));
    const second = ok(await call('POST', '/shifts', { ...opening, opening_cash_amount: 1200, opening_mpesa_amount: 800 }));
    assert.deepEqual(ok(await call('GET', `/shifts/${second.id}`)).opening_funds, { cash_amount: 1200, mpesa_amount: 800 });
    const earlier = await amend({ record_type: 'opening_funds', error_kind: 'wrong_amount', shift_id: id, payment_method: 'cash', amount: 2400, charge_to: 'station' });
    assert.deepEqual(ok(await call('GET', `/shifts/${second.id}`)).opening_funds, { cash_amount: 1200, mpesa_amount: 800 }, 'an earlier amendment never changes later opening declarations');
    ok(await call('POST', `/corrections/${earlier.id}/undo`, reason));
    const cashBeforeCancel = ok(await call('GET', `/reports/cash-flow?from=${day}&to=${day}`)).net_cash_flow;
    assert.equal(cashBeforeCancel, 6500, 'an uncounted later opening adds no income or outflow');
    ok(await call('POST', `/shifts/${second.id}/cancel`, { reason: 'Synthetic unused opening cancelled' }));
    const cancelled = ok(await call('GET', `/shifts/${second.id}`));
    assert.equal(cancelled.financial_view, 'cancelled');
    assert.equal(cancelled.variance, null); assert.equal(cancelled.inferred_collections, null);
    assert.equal(ok(await call('GET', `/reports/cash-flow?from=${day}&to=${day}`)).net_cash_flow, cashBeforeCancel);
    const csv = (await call('GET', '/shifts/export.csv')).body;
    assert(csv.includes('Current Collections Inferred From Counted Funds') && csv.includes('Original Opening Cash') && csv.includes('balances_v1'));
    const zero = ok(await call('POST', '/shifts', { ...opening, opening_cash_amount: 0, opening_mpesa_amount: 0 }));
    ok(await call('PUT', `/shifts/${zero.id}/collections`, { cash_amount: 0, mpesa_amount: 0, reconciliation_basis: 'balances_v1' }));
    assert.equal(ok(await call('GET', `/shifts/${zero.id}`)).collection_count_recorded, true);
    ok(await call('POST', `/shifts/${zero.id}/cancel`, { reason: 'Synthetic zero opening cancelled' }));
    console.log('PASS shift floats lifecycle: explicit independent openings, duplicate/stale/old-client guards, known counts, real close, corrections, crossreports, original evidence and unchanged physical/account records');
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
