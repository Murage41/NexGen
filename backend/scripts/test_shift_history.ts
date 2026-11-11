import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Edit history on open shifts: a save that changes a reading or a count keeps
// who, when and old -> new; a save that changes nothing keeps nothing; the
// History shows a sitting of saves as one line; removals are kept; rows can
// never be changed or deleted.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-shift-history-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'shift-history-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { generateToken } = await import('../src/middleware/requireAdmin');
  const { default: shifts } = await import('../src/routes/shifts');
  const { groupShiftHistory } = await import('../src/services/shiftEdits');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();

    // ── Grouping (pure) ──────────────────────────────────────────────
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 8, minute)).toISOString();
    const row = (id: number, kind: string, employee: number | null, minute: number, changes: any[]) =>
      ({ id, kind, employee_id: employee, employee_name: employee ? `E${employee}` : null, created_at: at(minute), changes });
    const p = (from: number | null, to: number | null) => [{ key: '1:litres', label: 'Petrol litres', from, to }];
    let groups = groupShiftHistory([row(1, 'readings', 7, 0, p(100, 101)), row(2, 'readings', 7, 1, p(101, 110)), row(3, 'readings', 7, 9, p(110, 112))]);
    assert.equal(groups.length, 1, 'a sitting of saves is one line');
    assert.deepEqual([groups[0].changes[0].from, groups[0].changes[0].to], [100, 112], 'first old value, last new value');
    assert.equal(groups[0].first, true);
    assert.equal(groups[0].occurred_at, at(9), 'the line carries the last save time');
    groups = groupShiftHistory([row(1, 'readings', 7, 0, p(100, 110)), row(2, 'readings', 7, 30, p(110, 120))]);
    assert.equal(groups.length, 2, 'saves more than 10 minutes apart are separate lines');
    assert.equal(groups[1].first, false, 'the second line is a change');
    groups = groupShiftHistory([row(1, 'readings', 7, 0, p(100, 110)), row(2, 'readings', 8, 1, p(110, 120))]);
    assert.equal(groups.length, 2, 'another person starts a new line');
    assert.equal(groups[1].actor, 'E8');
    groups = groupShiftHistory([row(1, 'readings', 7, 0, p(100, 110)), row(2, 'readings', 7, 2, p(110, 100))]);
    assert.equal(groups.length, 0, 'a figure that ends where it started drops out');
    groups = groupShiftHistory([row(1, 'removed', null, 0, [{ key: 'e1', label: 'Expense · Fuel', from: 50, to: null }]), row(2, 'removed', null, 1, [{ key: 'e2', label: 'Expense · Oil', from: 60, to: null }])]);
    assert.equal(groups.length, 2, 'removals are never merged');
    assert.equal(groups[0].actor, 'Station PC');

    // ── Through the routes ───────────────────────────────────────────
    const [admin] = await db('employees').insert({ name: 'History Admin', role: 'admin', active: true, daily_wage: 0 });
    const [employee] = await db('employees').insert({ name: 'History Attendant', role: 'attendant', active: true, daily_wage: 0 });
    const [plan] = await db('employee_compensation_plans').insert({ employee_id: employee, name: 'Monthly pay', pay_schedule: 'monthly', effective_from: '2020-01-01', version: 1, status: 'active' });
    await db('employee_compensation_components').insert({ plan_id: plan, component_type: 'fixed_per_shift', amount: 500 });
    const [tank] = await db('tanks').insert({ label: 'History Tank', fuel_type: 'petrol', capacity_litres: 1000, current_stock_litres: 500 });
    const [pump] = await db('pumps').insert({ label: 'History Pump', nozzle_label: 'H1', fuel_type: 'petrol', tank_id: tank, active: true, initial_litres: 100, initial_amount: 20000 });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 200, effective_date: '2020-01-01' });
    const app = express(); app.use(express.json()); app.use('/shifts', shifts);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const headers = (who: 'admin' | 'attendant' | 'pc') => (who === 'pc'
      ? { 'x-desktop-key': process.env.DESKTOP_KEY!, 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${generateToken(who === 'admin' ? admin : employee, who)}`, 'Content-Type': 'application/json' });
    const call = async (method: string, url: string, body?: any, who: 'admin' | 'attendant' | 'pc' = 'attendant') => {
      const response = await fetch(base + url, { method, headers: headers(who), body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); let json: any;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: response.status, body: json };
    };
    const ok = (response: any) => { assert(response.status < 300 && response.body.success, JSON.stringify(response)); return response.body.data; };
    const shift = ok(await call('POST', '/shifts', { employee_id: Number(employee), compensation_plan_id: Number(plan), opening_cash_amount: 1000, opening_mpesa_amount: 0 }, 'admin'));
    const sid = Number(shift.id);
    const historyRows = () => db('shift_history').where({ shift_id: sid }).orderBy('id');
    const timeline = async () => (ok(await call('GET', `/shifts/${sid}`, undefined, 'admin'))).activity_timeline as any[];
    const readings = (litres: number, amount: number, who: 'admin' | 'attendant' | 'pc' = 'attendant') =>
      call('PUT', `/shifts/${sid}/readings`, { readings: [{ pump_id: pump, closing_litres: litres, closing_amount: amount }] }, who);

    ok(await readings(110, 22000));
    let rows = await historyRows();
    assert.equal(rows.length, 1, 'a reading save that changes something is kept');
    assert.equal(rows[0].kind, 'readings');
    assert.equal(Number(rows[0].employee_id), Number(employee), 'who saved it');
    const changes = JSON.parse(rows[0].changes);
    assert.deepEqual(changes.map((c: any) => [c.label, c.from, c.to]), [['History Pump litres', 100, 110], ['History Pump KES', 20000, 22000]]);

    ok(await readings(110, 22000));
    assert.equal((await historyRows()).length, 1, 'a save that changes nothing keeps nothing');

    ok(await readings(120, 24000));
    assert.equal((await historyRows()).length, 2, 'every real save is kept');
    let events = await timeline();
    const recorded = events.filter((e) => e.type === 'readings_recorded');
    assert.equal(recorded.length, 1, 'the sitting shows as one line');
    assert.equal(recorded[0].actor, 'History Attendant');
    assert.equal(events.some((e) => e.type === 'readings_changed'), false);

    // Another person (the station PC) changes a reading: a separate "changed" line.
    ok(await readings(118, 23600, 'pc'));
    events = await timeline();
    const changed = events.find((e) => e.type === 'readings_changed');
    assert(changed, 'a change by someone else is its own line');
    assert.equal(changed.actor, 'Station PC');
    assert.deepEqual(changed.lines, ['History Pump litres: 120 → 118', 'History Pump KES: 24,000 → 23,600']);

    // Cash and M-Pesa: first count, then a change.
    const money = (cash: number, mpesa: number, who: 'admin' | 'attendant' | 'pc' = 'attendant') =>
      call('PUT', `/shifts/${sid}/collections`, { cash_amount: cash, mpesa_amount: mpesa, reconciliation_basis: 'balances_v1' }, who);
    ok(await money(3000, 500));
    ok(await money(3000, 500));
    ok(await money(3400, 500, 'admin'));
    events = await timeline();
    assert.equal(events.find((e) => e.type === 'money_counted')?.description, 'Cash 3,000 · M-Pesa 500');
    assert.deepEqual(events.find((e) => e.type === 'money_changed')?.lines, ['Cash: 3,000 → 3,400'], 'only what changed');
    assert.equal(events.find((e) => e.type === 'money_changed')?.actor, 'History Admin');
    assert.equal((await db('shift_history').where({ shift_id: sid, kind: 'money' })).length, 2);

    // Expenses: each one is a line with who; removing one is kept.
    const expense = ok(await call('POST', `/shifts/${sid}/expenses`, { category: 'Generator Fuel', description: 'Diesel', amount: 700 }));
    events = await timeline();
    const line = events.find((e) => e.id === `expense-${expense.id}`);
    assert.equal(line?.actor, 'History Attendant');
    assert.equal(line?.amount, 700);
    ok(await call('DELETE', `/shifts/${sid}/expenses/${expense.id}`, undefined, 'admin'));
    events = await timeline();
    const removed = events.find((e) => e.type === 'entry_removed');
    assert.equal(removed?.title, 'Expense removed');
    assert.equal(removed?.description, 'Generator Fuel');
    assert.equal(removed?.amount, 700);
    assert.equal(events.some((e) => e.id === `expense-${expense.id}`), false, 'a removed expense is not shown as live');

    // Credit sales and invoice fuel: removing one is kept, and a litres change.
    const [moneyCustomer] = await db('credit_accounts').insert({ name: 'Money Customer', type: 'customer', billing_mode: 'money', balance: 0 });
    const [invoiceCustomer] = await db('credit_accounts').insert({ name: 'Invoice Customer', type: 'customer', billing_mode: 'invoice', balance: 0 });
    const credit = ok(await call('POST', `/shifts/${sid}/credits`, { account_id: moneyCustomer, amount: 450 }, 'admin'));
    const creditRow = await db('shift_credits').where({ shift_id: sid }).whereNull('deleted_at').first();
    ok(await call('DELETE', `/shifts/${sid}/credits/${creditRow.id ?? credit.id}`, undefined, 'admin'));
    const fuel = ok(await call('POST', `/shifts/${sid}/invoice-consumption`, { account_id: invoiceCustomer, fuel_type: 'petrol', litres: 5, pump_id: pump }, 'admin'));
    ok(await call('PUT', `/shifts/${sid}/invoice-consumption/${fuel.id}`, { litres: 6 }, 'admin'));
    ok(await call('DELETE', `/shifts/${sid}/invoice-consumption/${fuel.id}`, undefined, 'admin'));
    events = await timeline();
    const creditRemoved = events.find((e) => e.title === 'Credit sale removed');
    assert.equal(creditRemoved?.description, 'Money Customer');
    assert.equal(creditRemoved?.amount, 450);
    assert.deepEqual(events.find((e) => e.type === 'entry_changed')?.lines, ['Invoice fuel litres · Invoice Customer: 5 → 6']);
    assert.equal(events.find((e) => e.title === 'Invoice fuel removed')?.description, 'Invoice Customer · 6 L');

    // Latest first.
    assert.equal(events[events.length - 1].type, 'shift_opened');

    // Opening readings changed by an admin.
    ok(await call('PUT', `/shifts/${sid}/opening-readings`, { readings: [{ pump_id: pump, opening_litres: 99, opening_amount: 19800 }] }, 'admin'));
    events = await timeline();
    assert.deepEqual(events.find((e) => e.type === 'opening_changed')?.lines, ['History Pump opening litres: 100 → 99', 'History Pump opening KES: 20,000 → 19,800']);

    // Debt payments: an attendant sees only their own being removed, as with
    // the receipts themselves. Customers' stay visible on the shift.
    const { recordVarianceRepayment } = await import('../src/services/employeeVariances');
    const [other] = await db('employees').insert({ name: 'Other Attendant', role: 'attendant', active: true, daily_wage: 0 });
    const day = shift.shift_date;
    const reverseStaffPayment = async (who: number) => {
      await db('employee_variance_entries').insert({ employee_id: who, entry_type: 'correction', entry_date: day, amount: 500, reason: 'Test shortage', status: 'posted' });
      const receipt: any = await db.transaction((trx) => recordVarianceRepayment(trx, who, { amount: 200, payment_method: 'cash', date: day, shift_id: sid }, Number(admin)));
      const paymentId = Number(receipt?.payment?.id ?? receipt?.id ?? receipt?.payment_id);
      ok(await call('POST', `/shifts/${sid}/credit-receipts/${paymentId}/reverse`, { reason: 'Wrong person' }, 'admin'));
    };
    await reverseStaffPayment(Number(other));
    const debtLines = async (who: 'admin' | 'attendant') => (ok(await call('GET', `/shifts/${sid}`, undefined, who))).activity_timeline
      .filter((e: any) => e.title === 'Debt payment removed').map((e: any) => e.description);
    assert.deepEqual(await debtLines('admin'), ['Other Attendant'], 'the admin sees it');
    assert.deepEqual(await debtLines('attendant'), [], 'another employee\'s payment stays hidden');
    await reverseStaffPayment(Number(employee));
    assert.deepEqual(await debtLines('attendant'), ['History Attendant'], 'their own is shown');

    // Rows are facts.
    await assert.rejects(db('shift_history').where({ shift_id: sid }).update({ kind: 'x' }), /cannot be changed/);
    await assert.rejects(db('shift_history').where({ shift_id: sid }).del(), /cannot be deleted/);

    // A refused save keeps nothing.
    const before = (await historyRows()).length;
    const refused = await call('PUT', `/shifts/${sid}/readings`, { readings: [{ pump_id: pump, closing_litres: 130, closing_amount: 26000 }], expected_revision: 0 });
    assert.notEqual(refused.status, 200);
    assert.equal((await historyRows()).length, before, 'a stale save writes no history');

    console.log('shift history: all checks passed');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
