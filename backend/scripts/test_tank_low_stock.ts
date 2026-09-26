import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Tank low-stock warning (M7): the fuel in each tank now (book stock less the
// open shift's sales), each tank's "order more at" level, the warning for both
// roles, and the open shift's tank card worked out exactly as its close
// records it (it once counted that day's deliveries twice). Runs on a private
// temporary database; never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-tank-low-stock-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'tank-low-stock-test-desktop-key-0';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { recomputeCache } = await import('../src/services/stockCalculator');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const migration = await import('../migrations/20260926_051_tank_reorder_level');
  const routers: Record<string, any> = {
    '/tanks': (await import('../src/routes/tanks')).default,
    '/shifts': (await import('../src/routes/shifts')).default,
    '/dashboard': (await import('../src/routes/dashboard')).default,
  };

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    await migration.up(db);
    console.log('PASS migration is repeatable');

    const sql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const now = Date.now();
    const hour = 3_600_000;
    const day = 24 * hour;
    const today = getKenyaDate();
    const person = async (name: string, role: 'admin' | 'attendant') =>
      (await db('employees').insert({ name, daily_wage: 0, pin: hashPin(role === 'admin' ? '4821' : '9999'), role, active: true }))[0] as number;
    const owner = await person('Owner Admin', 'admin');
    const attendantId = await person('Day Attendant', 'attendant');
    const tank = async (label: string, fuel_type: string, capacity_litres: number) =>
      (await db('tanks').insert({ label, fuel_type, capacity_litres }))[0] as number;
    const tankA = await tank('A Petrol', 'petrol', 10000);
    const tankB = await tank('B Diesel', 'diesel', 5000);
    const tankC = await tank('C Diesel', 'diesel', 6000);
    const pump = async (label: string, fuel_type: string, tank_id: number) =>
      (await db('pumps').insert({ label, nozzle_label: 'N', fuel_type, tank_id, active: true }))[0] as number;
    const pumpA = await pump('Pump A', 'petrol', tankA);
    const pumpB = await pump('Pump B', 'diesel', tankB);
    await db('fuel_prices').insert([
      { fuel_type: 'petrol', price_per_litre: 200, effective_date: '2020-01-01' },
      { fuel_type: 'diesel', price_per_litre: 190, effective_date: '2020-01-01' },
    ]);
    const deliver = (tank_id: number, litres: number, at: number) => db('fuel_deliveries').insert({
      tank_id, supplier: 'Test Supplier', litres, cost_per_litre: 150, total_cost: litres * 150,
      date: sql(at).slice(0, 10), delivery_timestamp: sql(at),
    });
    const reading = (shift_id: number, pump_id: number, sold: number, price: number) => db('pump_readings').insert({
      shift_id, pump_id, opening_litres: 0, closing_litres: sold, opening_amount: 0, closing_amount: sold * price, litres_sold: sold, amount_sold: sold * price,
    });

    // Five days ago: deliveries. Three days ago: a closed shift sold 1,000 L of
    // A and 500 L of B. Today: 5,000 L into A before the shift opened and
    // 1,000 L during it; the open shift has sold 600 L of A and 700 L of B.
    await deliver(tankA, 4000, now - 5 * day);
    await deliver(tankB, 2000, now - 5 * day);
    const [closedShift] = await db('shifts').insert({ employee_id: attendantId, shift_date: sql(now - 3 * day).slice(0, 10), start_time: new Date(now - 3 * day).toISOString(), end_time: sql(now - 3 * day + 10 * hour), status: 'closed' });
    await reading(closedShift, pumpA, 1000, 200);
    await reading(closedShift, pumpB, 500, 190);
    const shiftStart = now - 2 * hour;
    await deliver(tankA, 5000, shiftStart - hour);
    await deliver(tankA, 1000, shiftStart + 30 * 60_000);
    const [plan] = await db('employee_compensation_plans').insert({
      employee_id: attendantId, name: 'Monthly', pay_schedule: 'monthly', effective_from: '2026-01-01', version: 1, status: 'active',
    });
    await db('employee_compensation_components').insert({ plan_id: plan, component_type: 'fixed_per_shift', amount: 800 });
    const [openShift] = await db('shifts').insert({ employee_id: attendantId, compensation_plan_id: plan, shift_date: today, start_time: new Date(shiftStart).toISOString(), status: 'open', wage_paid: 0 });
    await reading(openShift, pumpA, 600, 200);
    await reading(openShift, pumpB, 700, 190);
    await db('shift_collections').insert({ shift_id: openShift, cash_amount: 600 * 200 + 700 * 190, mpesa_amount: 0 });
    for (const id of [tankA, tankB, tankC]) await recomputeCache(id, db);

    const app = express();
    app.use(express.json());
    app.use(auth.requireAuth);
    for (const [mount, router] of Object.entries(routers)) app.use(mount, router);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const attendant = { Authorization: `Bearer ${auth.generateToken(attendantId, 'attendant')}` };
    const admin = { Authorization: `Bearer ${auth.generateToken(owner, 'admin')}` };
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const call = async (method: string, url: string, headers: Record<string, string>, body?: any) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const tanksAs = async (headers: Record<string, string>) =>
      new Map((await call('GET', '/tanks', headers)).body.data.map((t: any) => [t.id, t]));

    // ---- A. Fuel in the tank now ----
    const seen = await tanksAs(attendant);
    const a: any = seen.get(tankA);
    const b: any = seen.get(tankB);
    assert.equal(Number(a.current_stock_litres), 9000, 'book stock: 4,000 + 5,000 + 1,000 - 1,000 sold by the closed shift');
    assert.equal(a.stock_now_litres, 8400, 'less the 600 L the open shift has sold');
    assert.equal(b.stock_now_litres, 800, '1,500 book less 700 sold now');
    assert.equal((seen.get(tankC) as any).stock_now_litres, 0);
    assert(!('avg_daily_litres' in a), 'sales per day are not for attendants');
    const adminTanks = await tanksAs(admin);
    assert.equal((adminTanks.get(tankA) as any).avg_daily_litres, 71.43, '1,000 L over the last 14 days');
    console.log('PASS fuel now is book stock less the open shift\'s sales; the daily-sales guide is for administrators');

    // ---- B. The open shift's tank card: each delivery counted once ----
    const card = new Map((await call('GET', `/shifts/${openShift}/tank-summary`, attendant)).body.data.tanks.map((t: any) => [t.tank_id, t]));
    assert.deepEqual(
      ['opening_stock_litres', 'deliveries_litres', 'sales_litres', 'closing_stock_litres'].map((k) => (card.get(tankA) as any)[k]),
      [8000, 1000, 600, 8400],
      'opening includes the delivery before the shift, only the one during it is added, closing is the fuel now',
    );
    assert.equal((card.get(tankB) as any).closing_stock_litres, 800);
    console.log('PASS the open shift\'s tank card no longer counts a delivery twice');

    // ---- C. Order levels ----
    const setLevel = (id: number, body: any, headers: Record<string, string> = admin) => call('PUT', `/tanks/${id}`, headers, body);
    assert.equal((await setLevel(tankB, { reorder_level_litres: 1000 }, attendant)).status, 403, 'administrators only');
    assert.equal((await setLevel(tankA, { reorder_level_litres: -1 })).status, 400);
    assert.match((await setLevel(tankA, { reorder_level_litres: 10001 })).body.error, /more than the tank holds/);
    assert.match((await setLevel(tankA, { label: 'Renamed' })).body.error, /while a shift is open/, 'name, fuel and size still wait for no open shift');
    const setA = await setLevel(tankA, { reorder_level_litres: 5000 });
    assert.equal(setA.status, 200, 'the order level can change during a shift');
    assert.equal(setA.body.data.label, 'A Petrol', 'nothing else changed');
    assert.equal(Number(setA.body.data.capacity_litres), 10000);
    assert.equal((await setLevel(tankB, { label: 'B Diesel', fuel_type: 'diesel', capacity_litres: 5000, reorder_level_litres: '1000' })).status, 200, 'the full form with unchanged details is fine');
    console.log('PASS order levels: administrators only, 0 to capacity, changeable during a shift');

    // ---- D. The warning, for both roles ----
    // B: book stock 1,500 is above its 1,000 level, but the fuel now (800) is below.
    const expected = [{ tank_id: tankB, label: 'B Diesel', fuel_type: 'diesel', stock_now_litres: 800, reorder_level_litres: 1000, capacity_litres: 5000 }];
    assert.deepEqual((await call('GET', '/dashboard', attendant)).body.data.low_stock, expected, 'attendants see it');
    assert.deepEqual((await call('GET', '/dashboard', admin)).body.data.low_stock, expected, 'administrators see it');
    await setLevel(tankC, { reorder_level_litres: '' });
    assert.equal(((await tanksAs(admin)).get(tankC) as any).reorder_level_litres, null, 'empty means no level');
    assert.equal((await setLevel(tankB, { reorder_level_litres: null })).status, 200);
    assert.deepEqual((await call('GET', '/dashboard', attendant)).body.data.low_stock, [], 'no level, no warning, even at 0 L');
    await setLevel(tankB, { reorder_level_litres: 1000 });
    console.log('PASS the warning uses the fuel now, shows for both roles, and only for tanks with a level');

    // ---- E. The close records what the open shift showed ----
    const closed = await call('PUT', `/shifts/${openShift}/close`, desktop, {
      wage_paid: 0,
      reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true },
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    const snapshot = await db('shift_tank_snapshots').where({ shift_id: openShift, tank_id: tankA }).first();
    assert.deepEqual(
      [snapshot.opening_stock_litres, snapshot.deliveries_litres, snapshot.sales_litres, snapshot.closing_stock_litres].map(Number),
      [8000, 1000, 600, 8400],
      'the close saved the same figures',
    );
    const after = await tanksAs(attendant);
    assert.equal(Number((after.get(tankA) as any).current_stock_litres), 8400, 'book stock took the sales at close');
    assert.equal((after.get(tankA) as any).stock_now_litres, 8400, 'and nothing is subtracted twice');
    assert.deepEqual((await call('GET', '/dashboard', admin)).body.data.low_stock.map((t: any) => t.tank_id), [tankB], 'still low after the close');
    console.log('PASS the close records the same movement the open shift showed');

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
