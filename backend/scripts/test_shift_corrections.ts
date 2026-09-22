import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Closed-shift corrections: a closed record is never edited. A correction
// reverses the original (kept on record), adds a linked replacement when there
// is one, follows the change through to the attendant's shortage, and leaves
// reports for earlier days as they were. Runs on a private temporary database;
// never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-shift-corrections-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'shift-corrections-test-desktop-key';
  const { default: db } = await import('../src/database');
  const auth = await import('../src/middleware/requireAdmin');
  const { hashPin } = await import('../src/services/pinSecurity');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { computeShiftAccountability } = await import('../src/services/shiftAccountability');
  const { getVarianceStatement, postShiftVariance } = await import('../src/services/employeeVariances');
  const { recordEmployeeDebtReceipt, employeePayStatement } = await import('../src/services/employeePay');
  const { readAccountBalance } = await import('../src/services/accountBalance');
  const { customerCreditBalance, applyCustomerCreditForShift } = await import('../src/services/receivablePayments');
  const { getReceivablePositionAsOf, getReceivableActivity } = await import('../src/services/receivableReporting');
  const { auditReceivableIntegrity } = await import('../src/services/receivableIntegrity');
  const { creditExposure } = await import('../src/services/creditLimits');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: creditAccountsRouter } = await import('../src/routes/creditAccounts');
  const { default: authRouter } = await import('../src/routes/auth');
  const { default: payrollRouter } = await import('../src/routes/payroll');
  const { default: reportsRouter } = await import('../src/routes/reports');

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const today = getKenyaDate();
    const person = async (name: string, role: 'admin' | 'attendant', pin = 'test-only') => {
      const [id] = await db('employees').insert({ name, daily_wage: 0, pin: pin === 'test-only' ? pin : hashPin(pin), role, active: true });
      return id as number;
    };
    const day = await person('Day Attendant', 'attendant');
    const night = await person('Night Attendant', 'attendant');
    const john = await person('John Pump', 'attendant');
    const admin = await person('Owner Admin', 'admin', '4821');
    const [tank] = await db('tanks').insert({ label: 'Petrol Tank', fuel_type: 'petrol', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'Pump 1', nozzle_label: 'P1', fuel_type: 'petrol', tank_id: tank, active: true });
    const customer = async (name: string, billing_mode: 'money' | 'invoice' = 'money') => {
      const [id] = await db('credit_accounts').insert({ name, type: 'customer', billing_mode, balance: 0 });
      return id as number;
    };
    const kau = await customer('Kau');
    const diwafa = await customer('Diwafa');
    const zawadi = await customer('Zawadi');
    const blossom = await customer('Blossom', 'invoice');
    const mugendi = await customer('Mugendi Stores', 'invoice');

    // ---- Shift helpers: the rows a real shift leaves, and a close that
    // records the snapshot and charges any shortage, as the close route does.
    const openShift = async (date: string, employee = day) => {
      const [id] = await db('shifts').insert({ employee_id: employee, shift_date: date, start_time: `${date}T06:00:00Z`, status: 'open', wage_paid: 0 });
      return id as number;
    };
    const sales = async (shiftId: number, amount: number, cash: number) => {
      await db('pump_readings').insert({ shift_id: shiftId, pump_id: pump, closing_litres: amount / 200, closing_amount: amount, litres_sold: amount / 200, amount_sold: amount });
      await db('shift_collections').insert({ shift_id: shiftId, cash_amount: cash, mpesa_amount: 0, credits_amount: 0, total_collected: cash });
    };
    const credit = async (shiftId: number, accountId: number, amount: number, date: string) => {
      const account = await db('credit_accounts').where({ id: accountId }).first();
      const [creditId] = await db('credits').insert({ customer_name: account.name, amount, balance: amount, shift_id: shiftId, status: 'outstanding', account_id: accountId, created_at: `${date} 08:00:00` });
      const [shiftCreditId] = await db('shift_credits').insert({ shift_id: shiftId, customer_name: account.name, amount, credit_id: creditId, created_at: `${date} 08:00:00` });
      await db('shift_collections').where({ shift_id: shiftId }).increment('credits_amount', amount);
      await db('credit_accounts').where({ id: accountId }).update({ balance: await readAccountBalance(accountId, db) });
      return { creditId: creditId as number, shiftCreditId: shiftCreditId as number };
    };
    const fuelOnAccount = async (shiftId: number, accountId: number, litres: number) => {
      const [id] = await db('invoice_consumption').insert({ account_id: accountId, shift_id: shiftId, pump_id: pump, tank_id: tank, fuel_type: 'petrol', litres, retail_price_at_time: 200, retail_amount: litres * 200, entry_status: 'active' });
      return id as number;
    };
    const liveAccountability = async (shiftId: number) => computeShiftAccountability({
      readings: await db('pump_readings').where({ shift_id: shiftId }),
      collections: await db('shift_collections').where({ shift_id: shiftId }).first(),
      shiftCredits: await db('shift_credits').where({ shift_id: shiftId }).whereNull('deleted_at'),
      invoiceConsumption: await db('invoice_consumption').where({ shift_id: shiftId }).whereNull('deleted_at'),
      creditReceipts: await db('credit_payments').where({ shift_id: shiftId, status: 'posted' }).whereNull('deleted_at'),
      expenses: [],
      employee_wage: 0,
      payrollPayments: [],
    });
    const close = async (shiftId: number) => {
      const a = await liveAccountability(shiftId);
      await db('shift_close_reconciliations').insert({
        shift_id: shiftId, readings_reviewed: true, collections_reviewed: true, entries_reviewed: true,
        expected_sales: a.expected_sales, expected_shift_total: a.expected_shift_total, cash_received: a.total_cash,
        mpesa_received: a.total_mpesa, credit_receipts: a.total_credit_receipts, credits_issued: a.total_credits,
        invoice_consumption: a.total_invoice_consumption, expenses: 0, direct_wage_payment: 0, payroll_payments: 0,
        total_accounted: a.total_accounted, variance: a.variance,
        variance_type: a.variance < 0 ? 'deficit' : a.variance > 0 ? 'surplus' : 'balanced', approved_at: new Date().toISOString(),
      });
      const shift = await db('shifts').where({ id: shiftId }).first();
      await db('shifts').where({ id: shiftId }).update({ status: 'closed', end_time: new Date().toISOString(), direct_wage_cash_amount: 0 });
      await db.transaction(async (trx) => {
        // As the close route does: the over/short goes to the attendant's
        // variances, then credit a customer holds pays this shift's credits.
        await postShiftVariance(trx, { id: shiftId, employee_id: Number(shift.employee_id), shift_date: shift.shift_date }, a.variance, null);
        await applyCustomerCreditForShift(trx, shiftId);
      });
      return a.variance;
    };

    const app = express();
    app.use(express.json());
    app.use('/shifts', shiftsRouter);
    app.use('/credit-accounts', creditAccountsRouter);
    app.use('/auth', authRouter);
    app.use('/payroll', payrollRouter);
    app.use('/reports', reportsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const attendantSession = { Authorization: `Bearer ${auth.generateToken(day, 'attendant')}` };
    const nightSession = { Authorization: `Bearer ${auth.generateToken(night, 'attendant')}` };
    const adminSession = { Authorization: `Bearer ${auth.generateToken(admin, 'admin')}` };
    const call = async (method: string, url: string, headers: Record<string, string>, body?: any) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const approval = async (purpose: string, fields: Record<string, unknown>) => {
      const r = await call('POST', '/auth/verify-pin', desktop, { purpose, employee_id: admin, pin: '4821', ...fields });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data.approval_token as string;
    };
    const preview = (shiftId: number, body: any, headers = desktop) =>
      call('POST', `/shifts/${shiftId}/corrections/preview`, headers, body);
    // Preview, approve at the desktop with the admin's PIN, post.
    const correct = async (shiftId: number, body: any) => {
      const p = await preview(shiftId, body);
      assert.equal(p.status, 200, JSON.stringify(p.body));
      const token = p.body.data.confirmation_token;
      const approval_token = await approval('shift_correction', { confirmation_token: token });
      const posted = await call('POST', `/shifts/${shiftId}/corrections`, desktop, { ...body, confirmation_token: token, approval_token });
      assert.equal(posted.status, 201, JSON.stringify(posted.body));
      assert.deepEqual(
        { ...posted.body.data, correction_id: undefined, confirmation_token: undefined },
        { ...p.body.data, correction_id: undefined, confirmation_token: undefined },
        'what was approved is exactly what was posted',
      );
      return posted.body.data;
    };
    const owed = (accountId: number) => readAccountBalance(accountId, db);
    const customerCredit = (accountId: number) => customerCreditBalance(accountId, db);
    const cached = async (accountId: number) => Number((await db('credit_accounts').where({ id: accountId }).first()).balance);
    const outstanding = async (employeeId: number) => (await getVarianceStatement(db, employeeId)).totals.owes;
    const corrections = () => db('shift_accountability_adjustments').where({ adjustment_type: 'shift_correction' });

    // S0: older credits that customers owe.
    const s0 = await openShift('2026-09-01');
    await sales(s0, 20000, 3000);
    await credit(s0, kau, 12000, '2026-09-01');
    await credit(s0, diwafa, 5000, '2026-09-01');
    assert.equal(await close(s0), 0);

    // ---- A. Wrong customer: the credit was Diwafa's, recorded for Kau ----
    const s1 = await openShift('2026-09-02');
    await sales(s1, 10000, 9000);
    const kauCredit = await credit(s1, kau, 1000, '2026-09-02');
    assert.equal(await close(s1), 0);

    const moved = await correct(s1, { entry_type: 'credit', entry_id: kauCredit.shiftCreditId, kind: 'wrong_customer', account_id: diwafa, note: 'Driver confirmed it was the Diwafa lorry' });
    assert.deepEqual(moved.accounts.map((a: any) => [a.name, a.owed_before, a.owed_after]), [['Kau', 13000, 12000], ['Diwafa', 5000, 6000]]);
    assert.deepEqual([moved.variance_before, moved.variance_after, moved.attendant.owes_before, moved.attendant.owes_after], [0, 0, 0, 0], 'the fuel was really sold on credit: the attendant is unaffected');
    const original = await db('credits').where({ id: kauCredit.creditId }).first();
    assert.equal(original.status, 'reversed');
    assert.equal(Number(original.amount), 1000, 'the original keeps its amount');
    assert(original.deleted_at && original.reversed_at);
    assert.equal(original.reversed_by_correction_id, moved.correction_id);
    const replacement = await db('credits').where({ correction_of_id: kauCredit.creditId }).first();
    assert.equal(replacement.account_id, diwafa);
    assert.equal(replacement.shift_id, s1, 'the replacement belongs to the same shift');
    assert.equal(replacement.created_by_correction_id, moved.correction_id);
    assert.deepEqual([await owed(kau), await cached(kau), await owed(diwafa), await cached(diwafa)], [12000, 12000, 6000, 6000]);
    const header = await db('shift_accountability_adjustments').where({ id: moved.correction_id }).first();
    assert.deepEqual(
      [header.entry_type, header.correction_kind, header.approved_by_name, header.posting_date, header.note, header.original_id, header.replacement_id],
      ['credit', 'wrong_customer', 'Owner Admin', today, 'Driver confirmed it was the Diwafa lorry', kauCredit.creditId, replacement.id],
    );
    assert.match(header.reason, /Credit of KES 1,000\.00 moved from Kau to Diwafa/);
    const s1View = (await call('GET', `/shifts/${s1}`, desktop)).body.data;
    assert.deepEqual(s1View.shift_credits.map((c: any) => [c.customer_name, Number(c.amount)]), [['Diwafa', 1000]]);
    assert.equal(s1View.corrections.length, 1);
    assert(s1View.activity_timeline.some((e: any) => e.type === 'shift_correction'), 'the correction is on the shift timeline');
    console.log('PASS a credit recorded for the wrong customer moves to the right one; the original stays on record');

    // Past positions are unchanged; the correction lands on its own date.
    const yesterday = new Date(Date.now() + 3 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
    for (const date of ['2026-09-02', '2026-09-10', yesterday]) {
      assert.equal((await getReceivablePositionAsOf(db as any, date)).money_receivables, 18000, `as of ${date} the original credit still stood`);
    }
    assert.equal((await getReceivablePositionAsOf(db as any, today)).money_receivables, 18000);
    const activity = await getReceivableActivity(db as any, '2026-09-01', today);
    assert.equal(activity.money_credits_issued, 19000, 'gross: the original, the other credits, and the replacement issued today');
    assert.equal(activity.money_credit_corrections, -1000, 'the reversal is its own line');
    const kauStatement = (await call('GET', `/credit-accounts/${kau}/statement`, desktop)).body.data;
    assert(kauStatement.some((e: any) => e.debit_amount === 1000), "Kau's statement keeps the original credit");
    assert(kauStatement.some((e: any) => e.credit_amount === 1000 && /Correction #\d+/.test(e.description)), '...and shows its reversal');
    assert.equal(kauStatement[kauStatement.length - 1].running_balance, 12000);
    console.log('PASS earlier receivable positions and statements are unchanged; the correction is dated when made');

    // ---- B. A credit that never happened: it was hiding a shortage ----
    const s2 = await openShift('2026-09-03');
    await sales(s2, 10000, 8000);
    const fake = await credit(s2, kau, 2000, '2026-09-03');
    assert.equal(await close(s2), 0, 'the fake credit made the drawer balance');
    const voidedCredit = await correct(s2, { entry_type: 'credit', entry_id: fake.shiftCreditId, kind: 'not_valid' });
    assert.deepEqual([voidedCredit.variance_before, voidedCredit.variance_after], [0, -2000]);
    assert.deepEqual([voidedCredit.attendant.owes_before, voidedCredit.attendant.owes_after], [0, 2000], 'the money should have been in the drawer');
    assert.equal(await outstanding(day), 2000);
    assert.equal(await owed(kau), 12000);
    const added = await db('employee_variance_entries').where({ shift_id: s2, entry_type: 'correction' }).first();
    assert.deepEqual([Number(added.amount), added.correction_id, added.entry_date], [2000, voidedCredit.correction_id, today], 'a variance entry dated the day of the correction');
    console.log('PASS voiding a credit that never happened charges the attendant who recorded it');

    // ---- C. A payment that never came in: the attendant was charged for it ----
    const s3 = await openShift('2026-09-04', night);
    await sales(s3, 5000, 5000);
    const typed = await call('POST', `/shifts/${s3}/credit-receipts`, nightSession, { account_id: kau, amount: 1000, payment_method: 'cash' });
    assert.equal(typed.status, 201, JSON.stringify(typed.body));
    assert.equal(await close(s3), -1000, 'the typed payment made the drawer look short');
    await db.transaction((trx) => recordEmployeeDebtReceipt(night, { amount: 600, payment_method: 'cash', date: today, reference: 'R-1' }, null, trx));
    assert.equal(await outstanding(night), 400, 'they repaid 600 of that shortage');
    const voidedPayment = await correct(s3, { entry_type: 'payment', entry_id: typed.body.data.id, kind: 'not_valid' });
    assert.deepEqual([voidedPayment.variance_before, voidedPayment.variance_after], [-1000, 0]);
    assert.deepEqual(
      [voidedPayment.attendant.owes_before, voidedPayment.attendant.owes_after, voidedPayment.attendant.refundable_after],
      [400, 0, 600],
      'the unpaid 400 is cancelled and the 600 they paid can be paid back',
    );
    assert.equal(await owed(kau), 12000, 'Kau owes the 1,000 again');
    assert.equal((await db('credit_payments').where({ id: typed.body.data.id }).first()).status, 'reversed');
    assert.equal(await outstanding(night), 0);
    const pay = await employeePayStatement(night, db as any);
    assert.equal(pay.variances.totals.refundable, 600);

    // Paid back to them, with the admin's PIN: a cash outflow.
    const payBackBody = { amount: 600, method: 'cash', date: today, reference: 'Handed over at the office' };
    const keyed = (key: string) => ({ ...desktop, 'Idempotency-Key': key });
    const unapproved = await call('POST', `/payroll/employees/${night}/variances/refunds`, keyed(crypto.randomUUID()), payBackBody);
    assert.equal(unapproved.status, 400, 'the desktop needs an approver');
    const refundToken = await approval('variance_refund', { for_employee_id: night, method: 'cash', amount: 600 });
    const paidBack = await call('POST', `/payroll/employees/${night}/variances/refunds`, keyed(crypto.randomUUID()), { ...payBackBody, approval_token: refundToken });
    assert.equal(paidBack.status, 200, JSON.stringify(paidBack.body));
    assert.equal(paidBack.body.data.totals.refundable, 0);
    assert.equal(paidBack.body.data.events.find((e: any) => e.type === 'refund').approved_by_name, 'Owner Admin');
    const again = await call('POST', `/payroll/employees/${night}/variances/refunds`, keyed(crypto.randomUUID()), { ...payBackBody, approval_token: refundToken });
    assert.equal(again.status, 409, 'paid back once');
    const cashFlow = (await call('GET', `/reports/cash-flow?from=${today}&to=${today}`, desktop)).body.data;
    assert.equal(cashFlow.outflows.employee_refunds, 600);
    assert.equal((await employeePayStatement(night, db as any)).variances.totals.refundable, 0);
    console.log('PASS voiding a payment that never came in relieves the attendant; what they already repaid is paid back with approval');

    // A shortage that was written off, not repaid, is not refunded.
    const s3b = await openShift(today, night);
    await sales(s3b, 1000, 1000);
    const typedAgain = await call('POST', `/shifts/${s3b}/credit-receipts`, nightSession, { account_id: kau, amount: 500, payment_method: 'cash' });
    assert.equal(await close(s3b), -500);
    const waiveToken = await approval('variance_waiver', { for_employee_id: night, shift_id: s3b, amount: 500 });
    const waived = await call('POST', `/payroll/employees/${night}/variances/waivers`, keyed(crypto.randomUUID()), { amount: 500, shift_id: s3b, reason: 'Written off', approval_token: waiveToken });
    assert.equal(waived.status, 200, JSON.stringify(waived.body));
    const writtenOff = await correct(s3b, { entry_type: 'payment', entry_id: typedAgain.body.data.id, kind: 'not_valid' });
    assert.deepEqual(
      [writtenOff.attendant.owes_before, writtenOff.attendant.owes_after, writtenOff.attendant.refundable_after],
      [0, 0, 0],
      'nothing was paid, so nothing is paid back',
    );
    console.log('PASS relief for a shortage that was written off, not repaid, owes nothing back');

    // The day it happened still shows the shift as it was closed.
    const s3Day = (await call('GET', '/reports/daily?date=2026-09-04', desktop)).body.data;
    assert.equal(s3Day.shifts[0].total_credit_receipts, 1000, 'the daily report keeps the payment as closed');
    assert.equal(s3Day.shifts[0].variance, -1000);
    const todayReport = (await call('GET', `/reports/daily?date=${today}`, desktop)).body.data;
    assert(todayReport.corrections.some((c: any) => c.id === voidedPayment.correction_id), "today's report lists the correction");
    console.log('PASS the daily report shows a closed shift as closed, and corrections on the day they were made');

    // ---- D. Wrong amount: 10,000 typed for a 1,000 payment ----
    const s4 = await openShift('2026-09-05');
    await sales(s4, 2000, 3000);
    const typo = await call('POST', `/shifts/${s4}/credit-receipts`, attendantSession, { account_id: kau, amount: 10000, payment_method: 'cash' });
    assert.equal(typo.status, 201);
    assert.equal(await close(s4), -9000);
    assert.equal(await outstanding(day), 11000);
    const fixedAmount = await correct(s4, { entry_type: 'payment', entry_id: typo.body.data.id, kind: 'wrong_amount', amount: 1000 });
    assert.deepEqual(fixedAmount.accounts.map((a: any) => [a.name, a.owed_before, a.owed_after]), [['Kau', 2000, 11000]]);
    assert.deepEqual([fixedAmount.variance_before, fixedAmount.variance_after, fixedAmount.attendant.owes_before, fixedAmount.attendant.owes_after], [-9000, 0, 11000, 2000]);
    const replacedPayment = await db('credit_payments').where({ correction_of_id: typo.body.data.id }).first();
    assert.deepEqual([Number(replacedPayment.amount), replacedPayment.shift_id, replacedPayment.date, replacedPayment.status], [1000, s4, today, 'posted']);
    assert.equal(await outstanding(day), 2000);
    console.log('PASS a mistyped payment amount is corrected and the false shortage cancelled');

    // ---- E. Fuel on account ----
    const s5 = await openShift('2026-09-06');
    await sales(s5, 20000, 10000);
    const litres = await fuelOnAccount(s5, blossom, 50);
    assert.equal(await close(s5), 0);
    const fewer = await correct(s5, { entry_type: 'invoice_consumption', entry_id: litres, kind: 'wrong_amount', litres: 40 });
    assert.deepEqual([fewer.variance_after, fewer.attendant.owes_after - fewer.attendant.owes_before], [-2000, 2000]);
    const replacementEntry = await db('invoice_consumption').where({ correction_of_id: litres }).first();
    const toMugendi = await correct(s5, { entry_type: 'invoice_consumption', entry_id: replacementEntry.id, kind: 'wrong_customer', account_id: mugendi });
    assert.deepEqual(toMugendi.accounts.map((a: any) => [a.name, a.owed_before, a.owed_after]), [['Blossom', 8000, 0], ['Mugendi Stores', 0, 8000]]);
    assert.equal(toMugendi.variance_after, -2000, 'moving it does not change the drawer');
    const mugendiEntry = await db('invoice_consumption').where({ account_id: mugendi, shift_id: s5 }).whereNull('deleted_at').first();
    const tooMany = await preview(s5, { entry_type: 'invoice_consumption', entry_id: mugendiEntry.id, kind: 'wrong_amount', litres: 101 });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.error, /sold only 100\.00 L/);
    const [invoice] = await db('customer_invoices').insert({ account_id: mugendi, invoice_number: 'CINV-TEST-1', from_date: '2026-09-01', to_date: '2026-09-30', status: 'draft', total_amount: 0 });
    const [line] = await db('invoice_lines').insert({ invoice_id: invoice, fuel_type: 'petrol', total_litres: 40, agreed_price: 200, line_total: 8000 });
    await db('invoice_consumption').where({ id: mugendiEntry.id }).update({ invoice_line_id: line });
    const onInvoice = await preview(s5, { entry_type: 'invoice_consumption', entry_id: mugendiEntry.id, kind: 'not_valid' });
    assert.equal(onInvoice.status, 409);
    assert.equal(onInvoice.body.code, 'CONSUMPTION_INVOICED');
    await db('invoice_consumption').where({ id: mugendiEntry.id }).update({ invoice_line_id: null });
    const notSupplied = await correct(s5, { entry_type: 'invoice_consumption', entry_id: mugendiEntry.id, kind: 'not_valid' });
    assert.deepEqual([notSupplied.variance_after, notSupplied.attendant.owes_after - notSupplied.attendant.owes_before], [-10000, 8000]);
    const history = await db('invoice_consumption').where({ shift_id: s5 }).orderBy('id');
    assert.deepEqual(history.map((e: any) => e.entry_status), ['reversed', 'reversed', 'reversed'], 'every version is kept');
    console.log('PASS fuel on account: litres, customer and void, bounded by pump sales; invoiced litres go through the invoice');

    // ---- F. An employee repayment that was really a customer's payment ----
    const sj = await openShift('2026-09-01', john);
    await sales(sj, 500, 0);
    assert.equal(await close(sj), -500);
    const s6 = await openShift('2026-09-07');
    await sales(s6, 3000, 3300);
    const johnReceipt = await db.transaction((trx) => recordEmployeeDebtReceipt(john, { amount: 300, payment_method: 'cash', date: '2026-09-07', reference: 'R-2', shift_id: s6 }, null, trx));
    assert.equal(await close(s6), 0);
    assert.equal(await outstanding(john), 200);
    const rePayer = await correct(s6, { entry_type: 'payment', entry_id: johnReceipt.id, kind: 'wrong_customer', account_id: kau });
    assert.deepEqual(rePayer.accounts.map((a: any) => [a.name, a.owed_after]), [['John Pump', 500], ['Kau', 10700]]);
    assert.equal(await outstanding(john), 500, 'John owes the 300 again');
    assert.equal(rePayer.variance_after, 0, 'the drawer is unchanged');
    console.log("PASS a payment recorded for the wrong payer moves between an employee's debt and a customer");

    // ---- G. A customer left paid ahead keeps the money as credit on account ----
    const s7 = await openShift('2026-09-08');
    await sales(s7, 800, 0);
    const zawadiCredit = await credit(s7, zawadi, 800, '2026-09-08');
    await close(s7);
    const s8 = await openShift('2026-09-09');
    await sales(s8, 0, 800);
    const zawadiPaid = await call('POST', `/shifts/${s8}/credit-receipts`, attendantSession, { account_id: zawadi, amount: 800, payment_method: 'cash' });
    assert.equal(zawadiPaid.status, 201);
    await close(s8);
    const before = await corrections().count({ n: 'id' }).first();
    const lowerBody = { entry_type: 'credit', entry_id: zawadiCredit.shiftCreditId, kind: 'wrong_amount', amount: 500 };
    const lower = await preview(s7, lowerBody);
    assert.equal(lower.status, 200, JSON.stringify(lower.body));
    assert.deepEqual(
      lower.body.data.accounts.map((a: any) => [a.name, a.owed_after, a.credit_before, a.credit_after]),
      [['Zawadi', 0, 0, 300]],
      'the credit was 500, not 800: Zawadi paid 300 too much and keeps it as credit',
    );
    assert.equal((await db('credits').where({ id: zawadiCredit.creditId }).first()).status, 'paid', 'a preview changes nothing');
    assert.deepEqual(await corrections().count({ n: 'id' }).first(), before, 'and leaves no record');
    const lowered = await correct(s7, lowerBody);
    assert.equal(lowered.attendant.owes_after - lowered.attendant.owes_before, 300, 'the overstated 300 should have been in the drawer');
    assert.equal(await customerCredit(zawadi), 300);
    assert.equal(Number((await db('credit_payments').where({ id: zawadiPaid.body.data.id }).first()).unapplied_amount), 300, 'held on the payment that overpaid');

    // Held credit pays their next credit as soon as its shift closes.
    const s9 = await openShift('2026-09-10');
    await sales(s9, 200, 0);
    await credit(s9, zawadi, 200, '2026-09-10');
    assert.equal(await customerCredit(zawadi), 300, 'not while the shift is open');
    await close(s9);
    assert.deepEqual([await owed(zawadi), await customerCredit(zawadi)], [0, 100]);

    // A payment moved to a customer who owes less leaves them in credit too.
    const wanjiru = await customer('Wanjiru');
    await credit(s9, wanjiru, 300, '2026-09-10');
    const s10 = await openShift('2026-09-11');
    await sales(s10, 0, 500);
    const kauPays = await call('POST', `/shifts/${s10}/credit-receipts`, attendantSession, { account_id: kau, amount: 500, payment_method: 'cash' });
    await close(s10);
    const toWanjiru = await correct(s10, { entry_type: 'payment', entry_id: kauPays.body.data.id, kind: 'wrong_customer', account_id: wanjiru });
    assert.deepEqual(
      toWanjiru.accounts.map((a: any) => [a.name, a.owed_after, a.credit_after]),
      [['Kau', 10700, 0], ['Wanjiru', 0, 200]],
    );
    assert.equal((await getReceivablePositionAsOf(db as any, today)).money_customer_credits, 300, 'credit owed to customers is reported on its own');
    const wanjiruAccount = await db('credit_accounts').where({ id: wanjiru }).first();
    assert.equal(await creditExposure(wanjiruAccount, db as any), -200, 'credit held counts against their limit');
    const keepAccount = await call('DELETE', `/credit-accounts/${wanjiru}`, desktop);
    assert.equal(keepAccount.status, 400, 'a customer holding credit cannot be removed');
    assert.match(keepAccount.body.error, /holds KES 200\.00 in credit/);

    // Paying credit back: an administrator approves, and it is a cash outflow.
    const refundBody = { amount: 100, method: 'mpesa', reference: 'QX12' };
    const refundApproval = (amount: number) => approval('customer_refund', { account_id: zawadi, method: 'mpesa', amount });
    assert.equal((await call('POST', `/credit-accounts/${zawadi}/refunds`, desktop, refundBody)).status, 400, 'the desktop names the approver');
    const tooMuch = await call('POST', `/credit-accounts/${zawadi}/refunds`, desktop, { ...refundBody, amount: 150, approval_token: await refundApproval(150) });
    assert.equal(tooMuch.status, 409, 'no more than the credit held');
    const refunded = await call('POST', `/credit-accounts/${zawadi}/refunds`, desktop, { ...refundBody, approval_token: await refundApproval(100) });
    assert.equal(refunded.status, 201, JSON.stringify(refunded.body));
    assert.equal(refunded.body.data.approved_by_name, 'Owner Admin');
    const zawadiView = (await call('GET', `/credit-accounts/${zawadi}`, desktop)).body.data;
    assert.deepEqual([zawadiView.credit_on_account, zawadiView.refunds.length], [0, 1]);
    const zawadiStatement = (await call('GET', `/credit-accounts/${zawadi}/statement`, desktop)).body.data;
    assert(zawadiStatement.some((e: any) => /Refund of credit on account/.test(e.description) && e.debit_amount === 100));
    assert.equal(zawadiStatement[zawadiStatement.length - 1].running_balance, 0);
    const refundFlow = (await call('GET', `/reports/cash-flow?from=${today}&to=${today}`, desktop)).body.data;
    assert.equal(refundFlow.outflows.customer_refunds, 100);
    const lockedPayment = await preview(s8, { entry_type: 'payment', entry_id: zawadiPaid.body.data.id, kind: 'not_valid' });
    assert.equal(lockedPayment.status, 409, 'a payment whose credit was paid back cannot be reversed');
    assert.equal(lockedPayment.body.code, 'PAYMENT_PARTLY_REFUNDED');
    console.log('PASS a customer paid ahead keeps credit on account: applied at their next close, refundable with approval');

    // ---- H. A stale preview is refused; a signed-in admin approves as themselves ----
    const diwafaS0 = await db('shift_credits').where({ shift_id: s0, customer_name: 'Diwafa' }).first();
    const stalePreview = await preview(s0, { entry_type: 'credit', entry_id: diwafaS0.id, kind: 'wrong_amount', amount: 4000 });
    const staleApproval = await approval('shift_correction', { confirmation_token: stalePreview.body.data.confirmation_token });
    await credit(s7, diwafa, 100, '2026-09-08');
    const stale = await call('POST', `/shifts/${s0}/corrections`, desktop, { entry_type: 'credit', entry_id: diwafaS0.id, kind: 'wrong_amount', amount: 4000, confirmation_token: stalePreview.body.data.confirmation_token, approval_token: staleApproval });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, 'CORRECTION_STALE');
    assert.equal((await db('credits').where({ id: diwafaS0.credit_id }).first()).status, 'outstanding');
    const fresh = await preview(s0, { entry_type: 'credit', entry_id: diwafaS0.id, kind: 'wrong_amount', amount: 4000 }, adminSession);
    const byAdmin = await call('POST', `/shifts/${s0}/corrections`, adminSession, { entry_type: 'credit', entry_id: diwafaS0.id, kind: 'wrong_amount', amount: 4000, confirmation_token: fresh.body.data.confirmation_token });
    assert.equal(byAdmin.status, 201, JSON.stringify(byAdmin.body));
    assert.equal((await db('shift_accountability_adjustments').where({ id: byAdmin.body.data.correction_id }).first()).approved_by_name, 'Owner Admin');
    console.log('PASS a stale preview is refused; an administrator signed in on the phone approves as themselves');

    // ---- I. Who may correct, and when ----
    const body = { entry_type: 'credit', entry_id: diwafaS0.id, kind: 'not_valid' };
    assert.equal((await preview(s0, body, attendantSession)).status, 403, 'attendants cannot correct');
    const openOne = await openShift(today);
    await sales(openOne, 100, 100);
    assert.equal((await preview(openOne, body)).status, 400, 'an open shift is edited directly, not corrected');
    const target = await preview(s1, { entry_type: 'credit', entry_id: diwafaS0.id, kind: 'not_valid' });
    assert.equal(target.status, 404, 'only entries of that shift');
    const replacementShiftCredit = await db('shift_credits').where({ credit_id: replacement.id }).first();
    const unsigned = await preview(s1, { entry_type: 'credit', entry_id: replacementShiftCredit.id, kind: 'not_valid' });
    const noApprover = await call('POST', `/shifts/${s1}/corrections`, desktop, { entry_type: 'credit', entry_id: replacementShiftCredit.id, kind: 'not_valid', confirmation_token: unsigned.body.data.confirmation_token });
    assert.equal(noApprover.status, 400, 'the desktop must name the approving administrator');
    const otherDecision = await approval('shift_correction', { confirmation_token: stalePreview.body.data.confirmation_token });
    const wrongToken = await call('POST', `/shifts/${s1}/corrections`, desktop, { entry_type: 'credit', entry_id: replacementShiftCredit.id, kind: 'not_valid', confirmation_token: unsigned.body.data.confirmation_token, approval_token: otherDecision });
    assert.equal(wrongToken.status, 403, "an approval for one correction can't post another");
    assert.equal((await call('POST', `/shifts/${s1}/invoice-consumption/1/correct`, desktop, {})).status, 410, 'the old invoice-page correction is retired');
    const attendantView = (await call('GET', `/shifts/${s2}`, attendantSession)).body.data;
    assert.equal(attendantView.corrections.length, 1);
    assert.equal(attendantView.corrections[0].details.accounts, undefined, "customers' balances stay with administrators");
    const seen = attendantView.corrections[0].details.attendant;
    assert.deepEqual([seen.owes_before, seen.owes_after], [0, 2000], 'the attendant sees what it did to what they owe');
    console.log('PASS only administrators correct, only closed shifts, only with an approval for exactly that correction');

    // ---- J. Everything still adds up ----
    const log = (await call('GET', '/shifts/corrections', desktop)).body.data;
    assert.equal(log.length, (await corrections()).length, 'the corrections log lists every correction');
    const integrity = await auditReceivableIntegrity(db as any);
    assert.equal(integrity.issues.length, 0, JSON.stringify(integrity.issues));
    // ...and the audit notices a payment whose parts don't add up.
    const heldPayment = await db('credit_payments').where('unapplied_amount', '>', 0).first();
    await db('credit_payments').where({ id: heldPayment.id }).update({ unapplied_amount: Number(heldPayment.unapplied_amount) + 5 });
    const broken = await auditReceivableIntegrity(db as any);
    assert(broken.issues.some((i: any) => i.kind === 'payment_credit_mismatch' && i.record_id === heldPayment.id), JSON.stringify(broken.issues));
    await db('credit_payments').where({ id: heldPayment.id }).update({ unapplied_amount: heldPayment.unapplied_amount });
    assert.equal((await db.raw('PRAGMA integrity_check'))[0].integrity_check, 'ok');
    assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);
    console.log('PASS receivables integrity holds after every correction');
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
