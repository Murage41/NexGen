import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Retiring M-Pesa fees must preserve gross collections and old stored facts.
// Run real routes on a private temporary database with the fee configuration
// table removed, so any remaining runtime dependency fails visibly.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-mpesa-fee-removal-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'mpesa-fee-removal-test-desktop-key';
  const { default: db } = await import('../src/database');
  const auth = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: dashboardRouter } = await import('../src/routes/dashboard');
  const { default: reportsRouter } = await import('../src/routes/reports');
  let server: ReturnType<express.Express['listen']> | undefined;

  const retiredKeys = new Set([
    'mpesa_fee', 'mpesa_net', 'total_mpesa_fee', 'total_mpesa_net',
    'mtd_mpesa_fees', 'fee_delta',
  ]);
  const noFees = (value: unknown, label: string) => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert(!retiredKeys.has(key), `${label}.${key} exposes a retired fee field`);
      noFees(nested, `${label}.${key}`);
    }
  };

  try {
    await db.migrate.latest();
    await db.schema.dropTable('mpesa_fee_config');
    const today = getKenyaDate();
    const [employee] = await db('employees').insert({ name: 'Fee Removal Attendant', daily_wage: 0, role: 'attendant', active: true });
    const [plan] = await db('employee_compensation_plans').insert({
      employee_id: employee, name: 'Daily zero', pay_schedule: 'daily', effective_from: '2020-01-01', version: 1, status: 'active',
    });
    await db('employee_compensation_components').insert({ plan_id: plan, component_type: 'fixed_per_shift', amount: 0 });
    const [tank] = await db('tanks').insert({ label: 'Fee Test Petrol', fuel_type: 'petrol', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'Fee Test Pump', nozzle_label: 'A', fuel_type: 'petrol', tank_id: tank, active: true });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 200, effective_date: '2020-01-01' });

    const app = express();
    app.use(express.json());
    app.use(auth.requireAuth);
    app.use('/shifts', shiftsRouter);
    app.use('/dashboard', dashboardRouter);
    app.use('/reports', reportsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const port = (server.address() as any).port;
    const call = async (method: string, url: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-desktop-key': process.env.DESKTOP_KEY! },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result: any = await response.json();
      assert.equal(response.status, 200, `${method} ${url}: ${JSON.stringify(result)}`);
      noFees(result, url);
      return result;
    };
    const makeShift = async (openingLitres: number, closingLitres: number) => {
      const [id] = await db('shifts').insert({
        employee_id: employee, compensation_plan_id: plan, shift_date: today,
        start_time: new Date().toISOString(), status: 'open', wage_paid: 0,
      });
      await db('pump_readings').insert({
        shift_id: id, pump_id: pump, opening_litres: openingLitres, closing_litres: closingLitres,
        opening_amount: openingLitres * 200, closing_amount: closingLitres * 200,
        litres_sold: closingLitres - openingLitres, amount_sold: (closingLitres - openingLitres) * 200,
      });
      return Number(id);
    };
    const close = (id: number) => call('PUT', `/shifts/${id}/close`, {
      wage_paid: 0, reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true },
    });

    const first = await makeShift(0, 100);
    await db('shift_collections').insert({
      shift_id: first, cash_amount: 10000, mpesa_amount: 10000,
      credits_amount: 0, total_collected: 20000, mpesa_fee: 777, mpesa_net: 1,
    });
    const before = (await call('GET', `/shifts/${first}`)).data;
    assert.deepEqual([before.total_cash, before.total_mpesa, before.total_accounted, before.variance], [10000, 10000, 20000, 0]);

    const saved = await call('PUT', `/shifts/${first}/collections`, {
      cash_amount: 11000, mpesa_amount: 9000, expected_revision: 0,
      // Old cached clients must not be able to restore fee calculation.
      mpesa_fee: 999, mpesa_net: 2,
    });
    assert.deepEqual([saved.data.cash_amount, saved.data.mpesa_amount, saved.data.total_collected, saved.revision], [11000, 9000, 20000, 1]);
    const stored = await db('shift_collections').where({ shift_id: first }).first();
    assert.deepEqual([Number(stored.mpesa_fee), Number(stored.mpesa_net)], [777, 1], 'saving gross totals must preserve legacy fee/net columns unchanged');
    await close(first);
    const closed = (await call('GET', `/shifts/${first}`)).data;
    assert.deepEqual([closed.total_cash, closed.total_mpesa, closed.total_accounted, closed.variance], [11000, 9000, 20000, 0]);
    assert.equal(Number(closed.close_reconciliation.mpesa_received), 9000, 'close snapshot must use gross M-Pesa');
    console.log('PASS collections read/save/close ignore stale historical fees, preserve gross money and never rewrite legacy fee columns');

    const second = await makeShift(100, 150);
    const inserted = await call('PUT', `/shifts/${second}/collections`, { cash_amount: 6000, mpesa_amount: 4000, expected_revision: 0 });
    assert.deepEqual([inserted.data.cash_amount, inserted.data.mpesa_amount, inserted.data.total_collected], [6000, 4000, 10000]);
    await close(second);
    const dashboard = (await call('GET', '/dashboard')).data;
    assert.deepEqual([
      dashboard.today_collections.cash, dashboard.today_collections.mpesa,
      dashboard.today_collections.expected_total_received, dashboard.today_variance,
      dashboard.today_sales, dashboard.today_net_profit,
    ], [17000, 13000, 30000, 0, 30000, 30000]);
    const daily = (await call('GET', `/reports/daily?date=${today}`)).data;
    assert.deepEqual([
      daily.total_cash, daily.total_mpesa, daily.expected_total_received,
      daily.total_sales, daily.gross_profit, daily.net_profit,
    ], [17000, 13000, 30000, 30000, 30000, 30000]);
    assert.equal(daily.shifts.length, 2);
    assert.deepEqual(daily.shifts.map((shift: any) => [shift.collections.mpesa_amount, shift.variance]), [[9000, 0], [4000, 0]], 'daily nested collections must retain gross amounts');
    const cashFlow = (await call('GET', `/reports/cash-flow?from=${today}&to=${today}`)).data;
    assert.deepEqual([cashFlow.inflows.shift_cash_received, cashFlow.inflows.shift_mpesa_received, cashFlow.net_cash_flow], [17000, 13000, 30000]);
    const legacyAfterReports = await db('shift_collections').where({ shift_id: first }).first();
    assert.deepEqual([Number(legacyAfterReports.mpesa_fee), Number(legacyAfterReports.mpesa_net)], [777, 1]);
    console.log('PASS new collections, dashboard, daily nested rows, profit and cash flow use gross M-Pesa with no fee configuration');
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
