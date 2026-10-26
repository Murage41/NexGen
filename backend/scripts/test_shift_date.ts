import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Opening a shift on its real day. The date is today unless the admin picks
// another; it can never be in the future, before the last closed shift (the
// meter readings continue from that close), or inside calculated payroll.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-shift-date-'));
  process.env.NEXGEN_DATA_DIR = directory;
  const { default: db } = await import('../src/database');
  const { generateToken } = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { default: shifts } = await import('../src/routes/shifts');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const day = getKenyaDate();
    const daysAgo = (n: number) => {
      const date = new Date(`${day}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - n);
      return date.toISOString().slice(0, 10);
    };
    const [admin] = await db('employees').insert({ name: 'Date Test Admin', role: 'admin', active: true, daily_wage: 0 });
    const [employee] = await db('employees').insert({ name: 'Date Test Attendant', role: 'attendant', active: true, daily_wage: 0 });
    const [plan] = await db('employee_compensation_plans').insert({ employee_id: employee, name: 'Monthly pay', pay_schedule: 'monthly', effective_from: '2020-01-01', version: 1, status: 'active' });
    await db('employee_compensation_components').insert({ plan_id: plan, component_type: 'fixed_per_shift', amount: 500 });
    const [tank] = await db('tanks').insert({ label: 'Date Test Tank', fuel_type: 'petrol', capacity_litres: 1000, current_stock_litres: 500 });
    const [pump] = await db('pumps').insert({ label: 'Date Test Pump', nozzle_label: 'D1', fuel_type: 'petrol', tank_id: tank, active: true, initial_litres: 100, initial_amount: 20000 });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 200, effective_date: '2020-01-01' });
    const [stock] = await db('tank_stock_adjustments').insert({ tank_id: tank, litres_change: 500, reason: 'opening_balance_correction_gain', notes: 'Synthetic costed opening stock', adjustment_date: '2020-01-01', adjustment_timestamp: '2020-01-01T00:00:00Z', cost_per_litre: 150, total_cost: 75000 });
    await db('tank_adjustment_batches').insert({ adjustment_id: stock, tank_id: tank, fuel_type: 'petrol', original_litres: 500, remaining_litres: 500, cost_per_litre: 150, date: '2020-01-01' });
    const app = express(); app.use(express.json()); app.use('/shifts', shifts);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const as = (role: 'admin' | 'attendant') => ({ Authorization: `Bearer ${generateToken(role === 'admin' ? admin : employee, role)}`, 'Content-Type': 'application/json' });
    const call = async (method: string, url: string, body?: any, role: 'admin' | 'attendant' = 'admin') => {
      const response = await fetch(base + url, { method, headers: as(role), body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); let json: any;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: response.status, body: json };
    };
    const ok = (response: any) => { assert(response.status < 300 && response.body.success, JSON.stringify(response)); return response.body.data; };
    const opening = { employee_id: Number(employee), compensation_plan_id: Number(plan), opening_cash_amount: 1000, opening_mpesa_amount: 0 };
    const open = (shift_date?: string) => call('POST', '/shifts', shift_date === undefined ? opening : { ...opening, shift_date });
    let meterLitres = 100;
    let meterAmount = 20000;
    // Sells 10 L (KES 2,000) and counts exactly what should remain.
    const sellAndClose = async (shift: any) => {
      meterLitres += 10; meterAmount += 2000;
      ok(await call('PUT', `/shifts/${shift.id}/readings`, { readings: [{ pump_id: pump, closing_litres: meterLitres, closing_amount: meterAmount }] }));
      ok(await call('PUT', `/shifts/${shift.id}/collections`, { cash_amount: 3000, mpesa_amount: 0, reconciliation_basis: 'balances_v1' }));
      const fresh = ok(await call('GET', `/shifts/${shift.id}`));
      ok(await call('PUT', `/shifts/${shift.id}/close`, {
        wage_paid: 0, reconciliation_basis: 'balances_v1', expected_funds_revision: Number(fresh.funds_revision || 0),
        reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true },
      }));
      const closed = ok(await call('GET', `/shifts/${shift.id}`));
      assert.equal(Number(closed.variance), 0, 'a dated shift reconciles like any other');
    };

    // Shape and range checks refuse before anything is written.
    for (const bad of ['2026-02-30', '24-10-2026', 'yesterday']) {
      assert.equal((await open(bad)).status, 400, `invalid date ${bad}`);
    }
    const future = await open(daysAgo(-1));
    assert.equal(future.status, 400);
    assert.match(future.body.error, /future/);
    assert.equal((await call('POST', '/shifts', { ...opening, shift_date: daysAgo(3) }, 'attendant')).status, 403, 'only admins open shifts');
    assert.equal(Number((await db('shifts').count({ n: 'id' }).first())?.n), 0);

    // A missed shift: with nothing closed yet, any past day is allowed.
    const missed = ok(await open(daysAgo(3)));
    assert.equal(missed.shift_date, daysAgo(3));
    const missedReading = await db('pump_readings').where({ shift_id: missed.id }).first();
    assert.equal(Number(missedReading.opening_litres), 100, 'the first shift starts from the pump set-up readings');
    await sellAndClose(missed);

    // Earlier than the last closed shift is refused: readings would run backwards.
    const before = await open(daysAgo(4));
    assert.equal(before.status, 400);
    assert.match(before.body.error, /last closed shift/);

    // Calculated payroll still blocks its days.
    const [period] = await db('payroll_periods').insert({ name: 'Synthetic month', pay_schedule: 'monthly', period_start: daysAgo(2), period_end: daysAgo(2), status: 'calculated' });
    assert.equal((await open(daysAgo(2))).status, 409);
    await db('payroll_periods').where({ id: period }).update({ status: 'void' });

    // The same day as the last close, or a later one, continues its readings.
    const next = ok(await open(daysAgo(2)));
    assert.equal(next.shift_date, daysAgo(2));
    const nextReading = await db('pump_readings').where({ shift_id: next.id }).first();
    assert.equal(Number(nextReading.opening_litres), 110, 'opening continues the last closed reading');
    await sellAndClose(next);

    // No date still means today, and idempotent replays keep the same shift.
    const todays = ok(await call('POST', '/shifts', opening));
    assert.equal(todays.shift_date, day);
    assert.equal(todays.start_time.slice(0, 4), day.slice(0, 4), 'start time is the real opening time');

    console.log('shift date: all checks passed');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
