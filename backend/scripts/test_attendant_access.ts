import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// What attendants can see (M6): signs in as an attendant and checks every
// route an attendant could reach returns only the allowed fields, or 403 where
// the figures are the owner's. Runs on a private temporary database; never
// touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-attendant-access-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'attendant-access-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const routers: Record<string, any> = {
    '/pumps': (await import('../src/routes/pumps')).default,
    '/tanks': (await import('../src/routes/tanks')).default,
    '/tank-dips': (await import('../src/routes/tankDips')).default,
    '/shifts': (await import('../src/routes/shifts')).default,
    '/expenses': (await import('../src/routes/expenses')).default,
    '/dashboard': (await import('../src/routes/dashboard')).default,
    '/credit-accounts': (await import('../src/routes/creditAccounts')).default,
    '/customer-invoices': (await import('../src/routes/customerInvoices')).default,
  };

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const today = getKenyaDate();
    const person = async (name: string, role: 'admin' | 'attendant', pin: string) => {
      const [id] = await db('employees').insert({ name, daily_wage: 0, pin: hashPin(pin), role, active: true });
      return id as number;
    };
    const owner = await person('Owner Admin', 'admin', '4821');
    const onShift = await person('Day Attendant', 'attendant', '9999');
    const offShift = await person('Night Attendant', 'attendant', '8888');
    const [tankId] = await db('tanks').insert({ label: 'Petrol Tank', fuel_type: 'petrol', capacity_litres: 20000, current_stock_litres: 12000 });
    const [pumpId] = await db('pumps').insert({ label: 'Petrol Pump', nozzle_label: 'A', fuel_type: 'petrol', tank_id: tankId, active: true });
    await db('fuel_prices').insert({ fuel_type: 'petrol', price_per_litre: 200, effective_date: '2020-01-01' });

    // An older closed shift, then the latest one with the cost of the fuel it sold.
    const [olderShift] = await db('shifts').insert({ employee_id: offShift, shift_date: '2025-12-31', start_time: '2025-12-31T06:00:00Z', end_time: '2025-12-31T18:00:00Z', status: 'closed' });
    await db('pump_readings').insert({ shift_id: olderShift, pump_id: pumpId, opening_litres: 500, closing_litres: 1000, opening_amount: 100000, closing_amount: 200000, litres_sold: 500, amount_sold: 100000 });
    const [closedShift] = await db('shifts').insert({ employee_id: onShift, shift_date: '2026-01-01', start_time: '2026-01-01T06:00:00Z', end_time: '2026-01-01T18:00:00Z', status: 'closed' });
    await db('pump_readings').insert({ shift_id: closedShift, pump_id: pumpId, opening_litres: 1000, closing_litres: 1500, opening_amount: 200000, closing_amount: 300000, litres_sold: 500, amount_sold: 100000 });
    await db('shift_collections').insert({ shift_id: closedShift, cash_amount: 99000, mpesa_amount: 0 });
    await db('shift_tank_snapshots').insert({ shift_id: closedShift, tank_id: tankId, opening_stock_litres: 12500, sales_litres: 500, closing_stock_litres: 12000, cogs: 90000 });

    // Today's open shift: the pumps say 20,000; 19,000 has been handed in so far.
    const [openShift] = await db('shifts').insert({ employee_id: onShift, shift_date: today, start_time: `${today}T06:00:00Z`, status: 'open' });
    await db('pump_readings').insert({ shift_id: openShift, pump_id: pumpId, opening_litres: 1500, closing_litres: 1600, opening_amount: 300000, closing_amount: 320000, litres_sold: 100, amount_sold: 20000 });
    await db('shift_collections').insert({ shift_id: openShift, cash_amount: 19000, mpesa_amount: 0 });

    // Customers: two money customers with limits, one without, one invoice customer.
    const customer = async (row: any) => (await db('credit_accounts').insert({ type: 'customer', billing_mode: 'money', ...row }))[0] as number;
    const customerA = await customer({ name: 'Customer A', phone: '0712000001', kra_pin: 'A123456789B', credit_limit: 10000, balance: 3000 });
    const customerB = await customer({ name: 'Customer B', phone: '0712000002', credit_limit: 5000, balance: 6000 });
    const customerC = await customer({ name: 'Customer C', phone: '0712000003', balance: 500 });
    const invoiceCo = await customer({ name: 'Invoice Co', phone: '0712000004', billing_mode: 'invoice', payment_terms_days: 14, balance: 250000 });
    for (const [account, name, amount] of [[customerA, 'Customer A', 3000], [customerB, 'Customer B', 6000], [customerC, 'Customer C', 500]] as const) {
      await db('credits').insert({ customer_name: name, amount, balance: amount, shift_id: closedShift, status: 'outstanding', account_id: account });
    }
    const [ownAccount] = await db('credit_accounts').insert({ name: 'Day Attendant', type: 'employee', employee_id: onShift, balance: 0 });
    const [otherAccount] = await db('credit_accounts').insert({ name: 'Night Attendant', type: 'employee', employee_id: offShift, balance: 0 });

    const app = express();
    app.use(express.json());
    app.use(auth.requireAuth);
    for (const [mount, router] of Object.entries(routers)) app.use(mount, router);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const attendant = { Authorization: `Bearer ${auth.generateToken(onShift, 'attendant')}` };
    const otherAttendant = { Authorization: `Bearer ${auth.generateToken(offShift, 'attendant')}` };
    const admin = { Authorization: `Bearer ${auth.generateToken(owner, 'admin')}` };
    const get = async (url: string, headers: Record<string, string>) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { headers });
      return { status: response.status, body: await response.json() as any };
    };
    const onlyKeys = (row: any, allowed: string[], label: string) => {
      const extra = Object.keys(row).filter((key) => !allowed.includes(key));
      assert.deepEqual(extra, [], `${label}: unexpected fields ${extra.join(', ')}`);
    };

    // ---- A. Customers: money customers' credit; invoice customers by name only ----
    const list = await get('/credit-accounts', attendant);
    assert.equal(list.status, 200);
    const byName = new Map(list.body.data.map((a: any) => [a.name, a]));
    assert.deepEqual(list.body.data.map((a: any) => a.name), ['Customer A', 'Customer B', 'Customer C', 'Invoice Co'], 'customers only, by name');
    const moneyFields = ['id', 'name', 'type', 'billing_mode', 'outstanding_balance', 'credit_on_account', 'credit_limit', 'credit_age_limit_days', 'available_credit', 'credit_check'];
    for (const name of ['Customer A', 'Customer C', 'Customer B']) onlyKeys(byName.get(name), moneyFields, name);
    assert.deepEqual(Object.keys(byName.get('Invoice Co') as any).sort(), ['billing_mode', 'id', 'name', 'type'], 'an invoice customer is a name to choose, nothing more');
    const rowA: any = byName.get('Customer A');
    assert.equal(rowA.outstanding_balance, 3000);
    assert.equal(rowA.available_credit, 7000, 'limit 10,000 less 3,000 owed');
    assert.deepEqual(rowA.credit_check, { breaches: [] });
    const rowB: any = byName.get('Customer B');
    assert.equal(rowB.available_credit, 0, 'never negative');
    assert.deepEqual(rowB.credit_check.breaches.map((b: any) => b.rule), ['credit_limit'], 'the attendant sees Customer B is over the limit');
    onlyKeys(rowB.credit_check.breaches[0], ['rule', 'message'], 'breach');
    assert.equal((byName.get('Customer C') as any).available_credit, null, 'no limit, no figure');
    const adminList = (await get('/credit-accounts', admin)).body.data;
    const adminInvoiceCo = adminList.find((a: any) => a.id === invoiceCo);
    assert.equal(adminInvoiceCo.phone, '0712000004');
    assert.equal(adminInvoiceCo.outstanding_balance, 250000, 'administrators still see everything');
    assert.equal(adminList.find((a: any) => a.id === customerA).kra_pin, 'A123456789B');
    console.log('PASS customer list: money customers\' credit, invoice customers by name, no phones');

    for (const id of [customerA, invoiceCo]) {
      for (const suffix of ['', '/statement']) {
        assert.equal((await get(`/credit-accounts/${id}${suffix}`, attendant)).status, 403, `customer ${id}${suffix} is for administrators`);
        assert.equal((await get(`/credit-accounts/${id}${suffix}`, admin)).status, 200);
      }
    }
    assert.equal((await get(`/credit-accounts/${ownAccount}`, attendant)).status, 200, 'an attendant reads their own account');
    assert.equal((await get(`/credit-accounts/${ownAccount}/statement`, attendant)).status, 200);
    assert.equal((await get(`/credit-accounts/${otherAccount}`, attendant)).status, 403, 'but not a colleague\'s');
    assert.equal((await get(`/credit-accounts/${otherAccount}/statement`, attendant)).status, 403);
    console.log('PASS customer detail and statements are for administrators; own account stays open');

    // ---- B. Tanks and pumps: levels yes, stock value and variance no ----
    const tanks = await get('/tanks', attendant);
    assert.equal(tanks.status, 200);
    assert.equal(Number(tanks.body.data[0].current_stock_litres), 12000, 'fuel level');
    onlyKeys(tanks.body.data[0], ['id', 'label', 'fuel_type', 'capacity_litres', 'current_stock_litres', 'created_at'], 'tank');
    for (const url of [`/tanks/${tankId}/stock-summary`, `/tanks/${tankId}/ledger`, `/tanks/${tankId}/adjustments`, '/tank-dips', `/tank-dips/trends?tank_id=${tankId}`]) {
      assert.equal((await get(url, attendant)).status, 403, `${url} is for administrators`);
    }
    for (const url of [`/tanks/${tankId}/stock-summary`, `/tanks/${tankId}/ledger`, `/tanks/${tankId}/adjustments`, '/tank-dips']) {
      assert.equal((await get(url, admin)).status, 200, `${url} still works for administrators`);
    }
    const pumps = await get('/pumps', attendant);
    assert.equal(pumps.status, 200);
    assert.equal(Number(pumps.body.data[0].last_closing_litres), 1500, 'last closed shift\'s meter');
    assert.equal(Number(pumps.body.data[0].last_closing_amount), 300000);
    console.log('PASS tanks show levels only; dips, ledger and stock summary are for administrators; pumps show the last reading');

    // ---- C. Station figures ----
    for (const url of ['/customer-invoices', '/customer-invoices/customers/monitor', `/customer-invoices/customers/${invoiceCo}/consumption`, '/customer-invoices/payments', '/customer-invoices/accounting-events', '/customer-invoices/1', '/expenses']) {
      assert.equal((await get(url, attendant)).status, 403, `${url} is for administrators`);
    }
    assert.equal((await get('/customer-invoices', admin)).status, 200);
    assert.equal((await get('/expenses', admin)).status, 200);
    assert.equal((await get('/expenses/categories', attendant)).status, 200, 'attendants still pick an expense category');

    const home = await get('/dashboard', otherAttendant);
    assert.equal(home.status, 200);
    assert.deepEqual(Object.keys(home.body.data).sort(), ['current_shift', 'stale_open_shifts'], 'no sales, collections, variance or weekly chart');
    onlyKeys(home.body.data.current_shift, ['id', 'employee_id', 'shift_date', 'start_time', 'status', 'employee_name', 'open_duration_hours', 'is_stale'], 'current shift');
    assert.equal(home.body.data.current_shift.employee_name, 'Day Attendant', 'who is on');
    const adminHome = (await get('/dashboard', admin)).body.data;
    assert.equal(adminHome.today_sales, 20000, 'administrators keep the full home screen');
    console.log('PASS home screen shows the shift status only; invoices and station spending are for administrators');

    // ---- D. A blind open shift; closed shifts unchanged ----
    const blind = ['expected_sales', 'expected_shift_total', 'sales_accounted', 'sales_variance', 'total_accounted', 'variance'];
    const open = await get(`/shifts/${openShift}`, attendant);
    assert.equal(open.status, 200);
    for (const field of blind) assert(!(field in open.body.data), `open shift hides ${field}`);
    assert.equal(open.body.data.total_cash, 19000, 'what they recorded stays visible');
    assert.equal(Number(open.body.data.readings[0].closing_amount), 320000);
    const adminOpen = (await get(`/shifts/${openShift}`, admin)).body.data;
    assert.equal(adminOpen.variance, -1000, 'the administrator sees the running shortage');
    assert.equal(adminOpen.expected_sales, 20000);
    assert.equal((await get(`/shifts/${openShift}`, otherAttendant)).status, 403, 'only their own shift');
    const closed = (await get(`/shifts/${closedShift}`, attendant)).body.data;
    assert.equal(closed.variance, -1000, 'a closed shift shows its result, shortage included');
    assert.equal(closed.expected_sales, 100000);
    const summary = (await get(`/shifts/${closedShift}/tank-summary`, attendant)).body.data;
    assert(!('cogs' in summary.tanks[0]), 'the cost of fuel sold is for administrators');
    assert.equal(Number(summary.tanks[0].closing_stock_litres), 12000);
    assert.equal(Number((await get(`/shifts/${closedShift}/tank-summary`, admin)).body.data.tanks[0].cogs), 90000);
    const history = (await get('/shifts', attendant)).body.data.shifts;
    const openRow = history.find((s: any) => s.id === openShift);
    assert(openRow.variance == null && openRow.expected_sales == null, 'the shift list carries no running figures');
    console.log('PASS open shift is blind for its attendant; closed shifts show the result; no fuel cost');

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
