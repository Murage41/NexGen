import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Credit customers (M5): created only in Credits, optional KRA PIN, opt-in
// credit and repayment limits that warn and need an administrator's approval
// rather than refusing outright. Runs on a private temporary database; never
// touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-credit-limits-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'credit-limits-test-desktop-key-00';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { evaluateCreditLimits, addDays } = await import('../src/services/creditLimits');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const migration = await import('../migrations/20260913_044_credit_customer_limits');
  const { default: authRouter } = await import('../src/routes/auth');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: creditAccountsRouter } = await import('../src/routes/creditAccounts');

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    await migration.up(db);
    console.log('PASS migration is repeatable');

    const today = getKenyaDate();
    const person = async (name: string, role: 'admin' | 'attendant', pin: string) => {
      const [id] = await db('employees').insert({ name, daily_wage: 0, pin: hashPin(pin), role, active: true });
      return id as number;
    };
    const owner = await person('Owner Admin', 'admin', '4821');
    const attendant = await person('Day Attendant', 'attendant', '9999');
    const [tankId] = await db('tanks').insert({ label: 'Diesel Tank', fuel_type: 'diesel', capacity_litres: 10000 });
    await db('pumps').insert({ label: 'Diesel Pump', nozzle_label: 'Nozzle', fuel_type: 'diesel', tank_id: tankId, active: true });
    await db('fuel_prices').insert({ fuel_type: 'diesel', price_per_litre: 200, effective_date: '2020-01-01' });
    const shiftOn = async (date: string, status: string) => {
      const [id] = await db('shifts').insert({ employee_id: attendant, shift_date: date, start_time: `${date}T06:00:00Z`, status });
      return id as number;
    };
    const openShift = await shiftOn(today, 'open');

    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
    app.use('/shifts', shiftsRouter);
    app.use('/credit-accounts', creditAccountsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const attendantSession = { Authorization: `Bearer ${auth.generateToken(attendant, 'attendant')}` };
    const adminSession = { Authorization: `Bearer ${auth.generateToken(owner, 'admin')}` };
    const call = async (method: string, url: string, headers: Record<string, string>, body?: any) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const pinToken = async (headers: Record<string, string>, body: any) => {
      const result = await call('POST', '/auth/verify-pin', headers, { ...body, employee_id: owner, pin: '4821' });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body.data.approval_token as string;
    };

    // ---- A. Customers are created properly in Credits ----
    const create = (body: any, headers: Record<string, string> = desktop) => call('POST', '/credit-accounts', headers, body);
    assert.match((await create({ name: 'Kau' })).body.error, /phone is required/);
    assert.match((await create({ name: 'Kau', phone: '0712345678', kra_pin: '12345678901' })).body.error, /KRA PIN must be a letter, 9 digits and a letter/);
    assert.match((await create({ name: 'Kau', phone: '12' })).body.error, /valid phone number/);
    assert.equal((await create({ name: 'Kau', phone: '0712345678' }, attendantSession)).status, 403, 'only admins create customers');
    const kau = await create({ name: 'Kau', phone: '0712 345-678', kra_pin: ' a012345678z ', credit_limit: 5000, credit_age_limit_days: 30 });
    assert.equal(kau.status, 201, JSON.stringify(kau.body));
    assert.equal(kau.body.data.phone, '0712345678');
    assert.equal(kau.body.data.kra_pin, 'A012345678Z');
    assert.equal(Number(kau.body.data.credit_limit), 5000);
    assert.equal(kau.body.data.credit_age_limit_days, 30);
    assert.equal(kau.body.data.payment_terms_days, 0, 'money credits fall due the day they are given');
    const kauId = kau.body.data.id;
    assert.equal((await create({ name: '  kau ', phone: '0722000000' })).status, 409, 'names are unique ignoring case and spaces');
    const invoiceCustomer = await create({ name: 'Blossom Co', phone: '+254700000001', billing_mode: 'invoice', payment_terms_days: 14 });
    assert.equal(invoiceCustomer.status, 201);
    assert.equal(invoiceCustomer.body.data.payment_terms_days, 14);
    assert.equal(invoiceCustomer.body.data.credit_limit, null, 'limits are opt-in');
    assert.equal(invoiceCustomer.body.data.kra_pin, null);
    const blossomId = invoiceCustomer.body.data.id;

    // A customer from before phones were required stays editable without one.
    const [legacyId] = await db('credit_accounts').insert({ name: 'Mbuvi', type: 'customer', balance: 0 });
    assert.equal((await call('PUT', `/credit-accounts/${legacyId}`, desktop, { credit_limit: null, kra_pin: '' })).status, 200);
    assert.equal((await call('PUT', `/credit-accounts/${kauId}`, desktop, { phone: '' })).body.error, 'phone is required', 'a phone on file cannot be removed');
    assert.equal((await call('PUT', `/credit-accounts/${kauId}`, desktop, { name: 'MBUVI' })).status, 409);
    console.log('PASS customer creation: required phone, KRA PIN format, unique names, admin only, legacy customers editable');

    // ---- B. Shift credit entry no longer creates customers ----
    const credit = (body: any, headers: Record<string, string>) => call('POST', `/shifts/${openShift}/credits`, headers, body);
    const before = await db('credit_accounts').count({ n: 'id' }).first();
    for (const headers of [desktop, attendantSession, adminSession]) {
      const result = await credit({ customer_name: 'Brand New Customer', amount: 100 }, headers);
      assert.equal(result.status, 400);
      assert.equal(result.body.code, 'CUSTOMER_NOT_FOUND');
    }
    assert.deepEqual(await db('credit_accounts').count({ n: 'id' }).first(), before, 'no account was created');
    const [employeeAccount] = await db('credit_accounts').insert({ name: 'Day Attendant', type: 'employee', employee_id: attendant, balance: 0 });
    assert.equal((await credit({ account_id: employeeAccount, amount: 100 }, desktop)).body.code, 'CUSTOMER_NOT_FOUND', 'an employee account is not a credit customer');
    console.log('PASS shift credit entry is select-only for everyone');

    // ---- C. Customers without limits are unaffected ----
    const oldShift = await shiftOn(addDays(today, -60), 'closed');
    await db('credits').insert({ customer_name: 'Mbuvi', amount: 9000, balance: 9000, shift_id: oldShift, status: 'outstanding', account_id: legacyId });
    const legacyCredit = await credit({ account_id: legacyId, amount: 10000 }, attendantSession);
    assert.equal(legacyCredit.status, 201, JSON.stringify(legacyCredit.body));
    assert.equal(legacyCredit.body.data.customer_name, 'Mbuvi');
    assert.equal(await db('credit_limit_overrides').count({ n: 'id' }).first().then((r: any) => Number(r.n)), 0);
    console.log('PASS a 60-day-old debt and a large credit need no approval when no limit is set');

    // ---- D. Money customer limits: warn, then approve ----
    const fortyDaysAgo = await shiftOn(addDays(today, -40), 'closed');
    await db('credits').insert({ customer_name: 'Kau', amount: 3000, balance: 3000, shift_id: fortyDaysAgo, status: 'outstanding', account_id: kauId });
    const creditCount = async () => Number((await db('credits').where({ account_id: kauId }).count({ n: 'id' }).first() as any).n);

    const ageOnly = await credit({ account_id: kauId, amount: 1000 }, attendantSession);
    assert.equal(ageOnly.status, 409);
    assert.equal(ageOnly.body.code, 'CREDIT_LIMIT_BREACH');
    assert.deepEqual(ageOnly.body.details.breaches.map((b: any) => b.rule), ['repayment_limit'], '4,000 is within the 5,000 limit');
    assert.equal(ageOnly.body.details.breaches[0].days_past_due, 40);
    assert.match(ageOnly.body.error, /unpaid for 40 days/);

    const both = await credit({ account_id: kauId, amount: 2500 }, attendantSession);
    assert.equal(both.status, 409);
    assert.deepEqual(both.body.details.breaches.map((b: any) => b.rule), ['credit_limit', 'repayment_limit']);
    assert.equal(both.body.details.exposure_after, 5500);
    assert.equal(await creditCount(), 1, 'a warning writes nothing');

    assert.match((await credit({ account_id: kauId, amount: 2500, limit_override: true }, attendantSession)).body.error, /administrator must approve/, 'an attendant cannot approve their own override');
    const overrideFor2500 = { purpose: 'credit_override', account_id: kauId, shift_id: openShift, amount: 2500 };
    const tokenFor2500 = await pinToken(attendantSession, overrideFor2500);
    assert.match(
      (await credit({ account_id: kauId, amount: 3000, limit_override: true, approval_token: tokenFor2500 }, attendantSession)).body.error,
      /no longer matches/,
      'approval of KES 2,500 cannot approve KES 3,000',
    );
    const approved = await credit({ account_id: kauId, amount: 2500, limit_override: true, approval_token: tokenFor2500 }, attendantSession);
    assert.equal(approved.status, 201, JSON.stringify(approved.body));
    const override = await db('credit_limit_overrides').orderBy('id', 'desc').first();
    assert.equal(override.account_id, kauId);
    assert.equal(override.shift_id, openShift);
    assert.equal(override.approved_by_employee_id, owner);
    assert.equal(override.approved_by_name, 'Owner Admin');
    assert.equal(override.recorded_by_employee_id, attendant);
    assert.equal(Number(override.amount), 2500);
    assert.equal(override.credit_id, (await db('credits').where({ account_id: kauId }).orderBy('id', 'desc').first()).id);
    assert.deepEqual(JSON.parse(override.breaches).map((b: any) => b.rule), ['credit_limit', 'repayment_limit']);

    const byAdmin = await credit({ account_id: kauId, amount: 100, limit_override: true }, adminSession);
    assert.equal(byAdmin.status, 201, 'a signed-in admin approves as themselves');
    const adminOverride = await db('credit_limit_overrides').orderBy('id', 'desc').first();
    assert.equal(adminOverride.approved_by_employee_id, owner);
    assert.equal(adminOverride.recorded_by_employee_id, owner);
    assert.match((await credit({ account_id: kauId, amount: 100, limit_override: true }, desktop)).body.error, /Select the approving administrator/, 'the desktop needs a PIN');
    const desktopToken = await pinToken(desktop, { purpose: 'credit_override', account_id: kauId, shift_id: openShift, amount: 100 });
    assert.equal((await credit({ account_id: kauId, amount: 100, limit_override: true, approval_token: desktopToken }, desktop)).status, 201);
    assert.equal((await db('credit_limit_overrides').orderBy('id', 'desc').first()).recorded_by_employee_id, null, 'the desktop records no person');
    console.log('PASS money limits: 409 with figures, nothing written, override needs a matching admin approval, recorded with who and why');

    // Repayment boundary: more than the limit, not equal to it.
    const [edgeId] = await db('credit_accounts').insert({ name: 'Edge', type: 'customer', balance: 0, credit_age_limit_days: 30 });
    const edgeShift = await shiftOn(addDays(today, -30), 'closed');
    await db('credits').insert({ customer_name: 'Edge', amount: 50, balance: 50, shift_id: edgeShift, status: 'outstanding', account_id: edgeId });
    const edge = await db('credit_accounts').where({ id: edgeId }).first();
    assert.equal((await evaluateCreditLimits(edge, 1, db, today)).breaches.length, 0, '30 days unpaid is within a 30-day limit');
    assert.equal((await evaluateCreditLimits(edge, 1, db, addDays(today, 1))).breaches[0].rule, 'repayment_limit', '31 days is over it');
    await db('credits').where({ account_id: edgeId }).update({ balance: 0, status: 'paid' });
    assert.equal((await evaluateCreditLimits(edge, 1, db, addDays(today, 100))).breaches.length, 0, 'paid credit never ages');
    console.log('PASS repayment limit boundary and paid credits');

    // ---- E. Invoice customer limits ----
    await call('PUT', `/credit-accounts/${blossomId}`, desktop, { credit_limit: 10000, credit_age_limit_days: 7 });
    const ninetyDaysAgo = await shiftOn(addDays(today, -90), 'closed');
    await db('invoice_consumption').insert([
      { account_id: blossomId, shift_id: ninetyDaysAgo, fuel_type: 'diesel', litres: 30, retail_price_at_time: 200, retail_amount: 6000, entry_status: 'active' },
      { account_id: blossomId, shift_id: ninetyDaysAgo, fuel_type: 'diesel', litres: 250, retail_price_at_time: 200, retail_amount: 50000, entry_status: 'reversed' },
    ]);
    const [invoiceId] = await db('customer_invoices').insert({
      account_id: blossomId, invoice_number: 'CINV-TEST-1', from_date: addDays(today, -60), to_date: addDays(today, -30),
      issue_date: addDays(today, -19), due_date: addDays(today, -5), status: 'issued', total_amount: 2000, balance: 2000,
    });
    const consume = (body: any, headers: Record<string, string>) => call('POST', `/shifts/${openShift}/invoice-consumption`, headers, body);
    const within = await consume({ account_id: blossomId, fuel_type: 'diesel', litres: 5 }, attendantSession);
    assert.equal(within.status, 201, `6,000 unbilled + 2,000 invoiced + 1,000 is within 10,000, and 5 days past due is within 7; reversed and aged unbilled entries do not count: ${JSON.stringify(within.body)}`);

    const overLimit = await consume({ account_id: blossomId, fuel_type: 'diesel', litres: 15 }, attendantSession);
    assert.equal(overLimit.status, 409);
    assert.deepEqual(overLimit.body.details.breaches.map((b: any) => b.rule), ['credit_limit']);
    assert.equal(overLimit.body.details.exposure_before, 9000);
    assert.equal(overLimit.body.details.exposure_after, 12000);

    await db('customer_invoices').where({ id: invoiceId }).update({ due_date: addDays(today, -9) });
    const overdue = await consume({ account_id: blossomId, fuel_type: 'diesel', litres: 15 }, desktop);
    assert.deepEqual(overdue.body.details.breaches.map((b: any) => b.rule), ['credit_limit', 'repayment_limit']);
    assert.match(overdue.body.error, /9 days past due/);

    const litresToken = await pinToken(desktop, { purpose: 'consumption_override', account_id: blossomId, shift_id: openShift, fuel_type: 'diesel', litres: 15 });
    assert.match(
      (await consume({ account_id: blossomId, fuel_type: 'diesel', litres: 16, limit_override: true, approval_token: litresToken }, desktop)).body.error,
      /no longer matches/,
    );
    const approvedFuel = await consume({ account_id: blossomId, fuel_type: 'diesel', litres: 15, limit_override: true, approval_token: litresToken }, desktop);
    assert.equal(approvedFuel.status, 201, JSON.stringify(approvedFuel.body));
    const fuelOverride = await db('credit_limit_overrides').orderBy('id', 'desc').first();
    assert.equal(fuelOverride.invoice_consumption_id, approvedFuel.body.data.id);
    assert.equal(fuelOverride.credit_id, null);
    assert.equal(Number(fuelOverride.amount), 3000, 'the retail value priced by the server');
    console.log('PASS invoice limits: unbilled fuel counts, reversed entries and unbilled age do not, overdue invoices do, override bound to litres');

    // ---- F. What the Credits screens read ----
    const list = (await call('GET', '/credit-accounts?type=customer', desktop)).body.data;
    const kauRow = list.find((a: any) => a.id === kauId);
    assert.equal(kauRow.kra_pin, 'A012345678Z');
    assert.deepEqual(kauRow.credit_check.breaches.map((b: any) => b.rule), ['credit_limit', 'repayment_limit']);
    assert.equal(list.find((a: any) => a.id === legacyId).credit_check, undefined, 'no status for customers without limits');
    const detail = (await call('GET', `/credit-accounts/${kauId}`, desktop)).body.data;
    assert.equal(detail.limit_overrides.length, 3);
    assert.equal(detail.limit_overrides[0].breaches[0].rule, 'credit_limit', 'breaches are returned parsed');
    assert.deepEqual(
      detail.limit_overrides.map((o: any) => [o.approved_by_name, o.recorded_by_name]),
      [['Owner Admin', null], ['Owner Admin', 'Owner Admin'], ['Owner Admin', 'Day Attendant']],
      'newest first: desktop records no person; a signed-in admin or attendant is named',
    );
    assert.equal(detail.credit_check.exposure_before, 5700, '3,000 owed + 2,500 + 100 + 100 approved; the refused desktop attempt wrote nothing');
    const attendantList = (await call('GET', '/credit-accounts', attendantSession)).body.data;
    assert(attendantList.every((a: any) => a.type === 'customer'), 'attendants still see customers only');
    assert(attendantList.every((a: any) => !('kra_pin' in a)), 'attendants do not receive KRA PINs');
    assert(attendantList.find((a: any) => a.id === kauId).credit_check, 'attendants can see a customer is over their limit');
    const attendantDetail = (await call('GET', `/credit-accounts/${kauId}`, attendantSession)).body.data;
    assert(!('kra_pin' in attendantDetail) && attendantDetail.limit_overrides.length === 0, 'nor KRA PINs or approval history in detail');
    console.log('PASS account list and detail carry limits, live status and override history');

    assert.equal((await db.raw('PRAGMA integrity_check'))[0].integrity_check, 'ok');
    assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
