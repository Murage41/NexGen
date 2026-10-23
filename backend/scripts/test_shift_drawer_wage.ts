import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// The wage an attendant takes from the drawer, on shifts that count opening
// funds (balances_v1). A daily-paid plan starts from what the shift earned;
// a weekly/monthly plan pays nothing from the drawer. Every component type
// (fixed per shift, sales percentage, litre rate with a minimum) is covered.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-drawer-wage-'));
  process.env.NEXGEN_DATA_DIR = directory;
  const { default: db } = await import('../src/database');
  const { generateToken } = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { default: shifts } = await import('../src/routes/shifts');
  const { employeePayStatement } = await import('../src/services/employeePay');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const day = getKenyaDate();
    const [admin] = await db('employees').insert({ name: 'Wage Test Admin', role: 'admin', active: true, daily_wage: 0 });
    const addPlan = async (name: string, pay_schedule: string, components: any[]) => {
      const [employee] = await db('employees').insert({ name, role: 'attendant', active: true, daily_wage: 0 });
      const [plan] = await db('employee_compensation_plans').insert({ employee_id: employee, name: `${name} pay`, pay_schedule, effective_from: '2020-01-01', version: 1, status: 'active' });
      for (const component of components) await db('employee_compensation_components').insert({ plan_id: plan, ...component });
      return { employee: Number(employee), plan: Number(plan) };
    };
    const daily = await addPlan('Daily Fixed Attendant', 'daily', [{ component_type: 'fixed_per_shift', amount: 800 }]);
    const monthly = await addPlan('Monthly Fixed Attendant', 'monthly', [{ component_type: 'fixed_per_shift', amount: 800 }]);
    const commission = await addPlan('Daily Commission Attendant', 'daily', [
      { component_type: 'sales_percentage', rate: 1 },
      { component_type: 'litre_rate', rate: 1, fuel_type: 'petrol', minimum_amount: 120 },
    ]);
    const [tank] = await db('tanks').insert({ label: 'Wage Test Tank', fuel_type: 'petrol', capacity_litres: 1000, current_stock_litres: 500 });
    const [pump] = await db('pumps').insert({ label: 'Wage Test Pump', nozzle_label: 'W1', fuel_type: 'petrol', tank_id: tank, active: true });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 200, effective_date: '2020-01-01' });
    const [stock] = await db('tank_stock_adjustments').insert({ tank_id: tank, litres_change: 500, reason: 'opening_balance_correction_gain', notes: 'Synthetic costed opening stock', adjustment_date: day, adjustment_timestamp: '2020-01-01T00:00:00Z', cost_per_litre: 150, total_cost: 75000 });
    await db('tank_adjustment_batches').insert({ adjustment_id: stock, tank_id: tank, fuel_type: 'petrol', original_litres: 500, remaining_litres: 500, cost_per_litre: 150, date: '2020-01-01' });
    const app = express(); app.use(express.json()); app.use('/shifts', shifts);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const headers = { Authorization: `Bearer ${generateToken(admin, 'admin')}`, 'Content-Type': 'application/json' };
    const call = async (method: string, url: string, body?: any) => {
      const response = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); let json: any;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: response.status, body: json };
    };
    const ok = (response: any) => { assert(response.status < 300 && response.body.success, JSON.stringify(response)); return response.body.data; };
    const close = (shift: any, wage: number) => call('PUT', `/shifts/${shift.id}/close`, {
      wage_paid: wage, reconciliation_basis: 'balances_v1', expected_funds_revision: Number(shift.funds_revision || 0),
      reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true },
    });
    const owedFor = async (employee: number, shiftId: number) =>
      (await employeePayStatement(employee, db)).accrued_shift_details.find((row: any) => Number(row.shift_id) === shiftId);

    // Every shift opens with KES 1,000 cash, sells 50 L for KES 10,000, and
    // counts exactly what should remain after the wage actually taken.
    let meterLitres = 0;
    let meterAmount = 0;
    const runShift = async (who: { employee: number; plan: number }, wageTaken: number) => {
      const opened = ok(await call('POST', '/shifts', { employee_id: who.employee, compensation_plan_id: who.plan, opening_cash_amount: 1000, opening_mpesa_amount: 0 }));
      assert.equal(opened.reconciliation_basis, 'balances_v1');
      meterLitres += 50; meterAmount += 10000;
      ok(await call('PUT', `/shifts/${opened.id}/readings`, { readings: [{ pump_id: pump, closing_litres: meterLitres, closing_amount: meterAmount }] }));
      const remaining = 1000 + 10000 - wageTaken;
      ok(await call('PUT', `/shifts/${opened.id}/collections`, { cash_amount: remaining - 5000, mpesa_amount: 5000, reconciliation_basis: 'balances_v1' }));
      return ok(await call('GET', `/shifts/${opened.id}`));
    };

    // Daily fixed pay: the drawer wage starts at the 800 earned, so the open
    // shift is not shown 800 short, and closing with it balances.
    const fixed = await runShift(daily, 800);
    assert.equal(fixed.gross_earning_preview, 800);
    assert.equal(fixed.default_direct_wage_payment, 800, 'daily pay starts at the shift earnings');
    assert.equal(fixed.employee_wage, 800);
    assert.equal(fixed.variance, 0, 'the open shift counts the daily wage');
    ok(await close(fixed, 800));
    const fixedClosed = ok(await call('GET', `/shifts/${fixed.id}`));
    assert.deepEqual([fixedClosed.variance, fixedClosed.wage_paid, fixedClosed.direct_wage_cash_amount], [0, 800, 800]);
    assert.equal((await owedFor(daily.employee, Number(fixed.id)))?.remaining, 0, 'nothing left owed when the full wage was taken');

    // Daily fixed pay, part taken: the admin enters 500; the shift balances
    // and the other 300 stays owed in payroll. More than earned is refused.
    const partial = await runShift(daily, 500);
    assert.equal(partial.default_direct_wage_payment, 800);
    assert.equal(partial.variance, 300, 'until the admin enters 500, the default 800 shows 300 over');
    assert.equal((await close(partial, 900)).status, 400, 'a drawer wage above the shift earnings is refused');
    ok(await close(partial, 500));
    const partialClosed = ok(await call('GET', `/shifts/${partial.id}`));
    assert.deepEqual([partialClosed.variance, partialClosed.wage_paid], [0, 500]);
    assert.equal((await owedFor(daily.employee, Number(partial.id)))?.remaining, 300, 'the unpaid part stays owed');

    // Monthly pay: nothing leaves the drawer; the 800 accrues for payroll.
    const periodic = await runShift(monthly, 0);
    assert.equal(periodic.gross_earning_preview, 800);
    assert.equal(periodic.default_direct_wage_payment, 0, 'monthly pay is not taken from the drawer');
    assert.equal(periodic.variance, 0);
    assert.equal((await close(periodic, 800)).status, 400, 'monthly pay cannot be paid from the drawer');
    ok(await close(periodic, 0));
    const periodicClosed = ok(await call('GET', `/shifts/${periodic.id}`));
    assert.deepEqual([periodicClosed.variance, periodicClosed.wage_paid], [0, 0]);
    assert.equal((await owedFor(monthly.employee, Number(periodic.id)))?.remaining, 800, 'monthly earnings wait for payroll');

    // Daily commission: 1% of 10,000 plus 50 L at 1 with a 120 minimum = 220.
    const earned = await runShift(commission, 220);
    assert.equal(earned.gross_earning_preview, 220);
    assert.equal(earned.default_direct_wage_payment, 220, 'commission plans start at what the readings earned');
    assert.equal(earned.variance, 0);
    ok(await close(earned, 220));
    const earnedClosed = ok(await call('GET', `/shifts/${earned.id}`));
    assert.deepEqual([earnedClosed.variance, earnedClosed.wage_paid], [0, 220]);
    assert.equal((await owedFor(commission.employee, Number(earned.id)))?.remaining, 0);

    console.log('Drawer wage tests passed: daily fixed (full and part), monthly, commission with minimum.');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
