import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// A closed shift is never changed. A mistake found later is fixed by moving an
// amount between the accounts it affects (customers, employees, the station),
// both sides always matching. Checks every kind of mistake, that the named
// shift's credit is settled first, that a moved credit ages from its shift,
// that relief on an attendant's own shift re-works what paid it (money paid
// becomes credit), that employees are never moved to or from the station,
// that the shift's figures never move, that no cash is reported, and refusals.
// Runs on a private temporary database; never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-balance-moves-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'balance-moves-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { getVarianceStatement, postShiftVariance, recordVarianceRepayment, varianceActivity } = await import('../src/services/employeeVariances');
  const { readAccountBalance } = await import('../src/services/accountBalance');
  const { customerCreditBalance } = await import('../src/services/receivablePayments');
  const { getReceivableActivity, getDirectReceivableCashInflows } = await import('../src/services/receivableReporting');
  const { auditReceivableIntegrity } = await import('../src/services/receivableIntegrity');
  const { overdueBeyond } = await import('../src/services/creditLimits');
  const { stationMoveTotals } = await import('../src/services/balanceMoves');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: creditAccountsRouter } = await import('../src/routes/creditAccounts');
  const { default: balanceMovesRouter } = await import('../src/routes/balanceMoves');
  const { default: authRouter } = await import('../src/routes/auth');
  const { default: payrollRouter } = await import('../src/routes/payroll');

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const today = getKenyaDate();
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const employee = async (name: string, role = 'attendant', pin = 'test-only') =>
      (await db('employees').insert({ name, daily_wage: 0, pin, role, active: true }))[0] as number;
    const attendant = await employee('Day Attendant');
    const other = await employee('Night Attendant');
    const relief = await employee('Relief Attendant');
    const admin = await employee('Owner Admin', 'admin', hashPin('4821'));
    const [tank] = await db('tanks').insert({ label: 'Petrol Tank', fuel_type: 'petrol', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'Pump 1', nozzle_label: 'P1', fuel_type: 'petrol', tank_id: tank, active: true });
    const customer = async (name: string, billing_mode = 'money') =>
      (await db('credit_accounts').insert({ name, type: 'customer', billing_mode, balance: 0 }))[0] as number;
    const kau = await customer('Kau');
    const diwafa = await customer('Diwafa');
    const blossom = await customer('Blossom', 'invoice');
    const closedShift = async (employeeId: number, date: string, variance: number) => {
      const [id] = await db('shifts').insert({ employee_id: employeeId, shift_date: date, start_time: `${date}T06:00:00Z`, status: 'closed', end_time: `${date}T18:00:00Z`, wage_paid: 0 });
      await db.transaction((trx) => postShiftVariance(trx, { id, employee_id: employeeId, shift_date: date }, variance, null));
      return id as number;
    };
    const credit = async (shiftId: number, accountId: number, amount: number, createdAt: string) => {
      const [id] = await db('credits').insert({ customer_name: 'x', amount, balance: amount, shift_id: shiftId, status: 'outstanding', account_id: accountId, created_at: createdAt });
      await db('shift_credits').insert({ shift_id: shiftId, customer_name: 'x', amount, credit_id: id });
      await db('credit_accounts').where({ id: accountId }).update({ balance: await readAccountBalance(accountId, db) });
      return id as number;
    };

    // S0 (yesterday): Kau took 700 on credit; balanced. S1 (today): sales
    // 10,000, cash 7,000, 2,000 credit to Kau (really Diwafa's), short 1,000.
    const s0 = await closedShift(attendant, yesterday, 0);
    const oldKauCredit = await credit(s0, kau, 700, `${yesterday} 08:00:00`);
    const s1 = await closedShift(attendant, today, -1000);
    await db('pump_readings').insert({ shift_id: s1, pump_id: pump, closing_litres: 50, closing_amount: 10000, litres_sold: 50, amount_sold: 10000 });
    await db('shift_collections').insert({ shift_id: s1, cash_amount: 7000, mpesa_amount: 0, credits_amount: 2000, total_collected: 7000 });
    const s1KauCredit = await credit(s1, kau, 2000, new Date().toISOString().replace('T', ' ').slice(0, 19));
    // Relief attendant: S2 short 500, covered by S3's 500 surplus, same month.
    const s2 = await closedShift(relief, today, -500);
    await closedShift(relief, today, 500);
    // Night attendant: S4 short 200.
    const s4 = await closedShift(other, today, -200);
    const [openShift] = await db('shifts').insert({ employee_id: other, shift_date: today, start_time: `${today}T18:00:00Z`, status: 'open', wage_paid: 0 });

    const app = express();
    app.use(express.json());
    app.use('/shifts', shiftsRouter);
    app.use('/credit-accounts', creditAccountsRouter);
    app.use('/balance-moves', balanceMovesRouter);
    app.use('/auth', authRouter);
    app.use('/payroll', payrollRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const call = async (method: string, url: string, body?: any, key?: string) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key || `test-${Math.random().toString(36).slice(2)}-${Date.now()}`,
          'x-desktop-key': process.env.DESKTOP_KEY!,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const approval = async (fields: Record<string, unknown>) => {
      const r = await call('POST', '/auth/verify-pin', { purpose: 'balance_move', employee_id: admin, pin: '4821', ...fields });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.data.approval_token as string;
    };
    type P = ['customer' | 'employee' | 'station', number | null];
    const move = async (from: P, to: P, amount: number, shiftId: number | null, reason = 'test move') => {
      const fields = { from_kind: from[0], from_id: from[1], to_kind: to[0], to_id: to[1], shift_id: shiftId, amount };
      return call('POST', '/balance-moves', { ...fields, reason, approval_token: await approval(fields) });
    };
    const ok = async (...args: Parameters<typeof move>) => {
      const r = await move(...args);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.data;
    };
    const refused = async (label: string, pending: Promise<{ status: number; body: any }>, status?: number) => {
      const r = await pending;
      assert.notEqual(r.status, 201, `${label} must be refused`);
      if (status) assert.equal(r.status, status, `${label}: ${JSON.stringify(r.body)}`);
    };
    const owes = (accountId: number) => readAccountBalance(accountId, db);
    const cached = async (accountId: number) => Number((await db('credit_accounts').where({ id: accountId }).first()).balance);
    const statement = (id: number) => getVarianceStatement(db, id);
    const creditBalance = async (id: number) => Number((await db('credits').where({ id }).first()).balance);
    const shiftSnapshot = async () => {
      const r = await call('GET', `/shifts/${s1}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const d = r.body.data;
      return JSON.stringify({
        status: d.status, credits: d.shift_credits, receipts: d.credit_receipts, collections: d.collections,
        readings: d.readings, close: d.close_reconciliation,
        shiftRows: await db('shift_credits').where({ shift_id: s1 }),
        // balance/status on the credit are settlement state any later payment moves.
        shiftCredits: (await db('credits').where({ shift_id: s1 })).map(({ balance, status, ...rest }: any) => rest),
        shiftPayments: await db('credit_payments').where({ shift_id: s1 }),
        collectionsRow: await db('shift_collections').where({ shift_id: s1 }),
        shiftEntries: await db('employee_variance_entries').where({ shift_id: s1, entry_type: 'shift' }),
      });
    };
    const before = await shiftSnapshot();
    const cashBefore = await getDirectReceivableCashInflows(db, today, today);

    // 1. Correction routes refuse.
    for (const url of [`/shifts/${s1}/corrections`, `/shifts/${s1}/corrections/preview`, `/shifts/${s1}/invoice-consumption/1/correct`]) {
      assert.equal((await call('POST', url, {})).status, 410, url);
    }
    console.log('PASS correction routes refuse (410)');

    // 2. Credit on the wrong customer: Kau -> Diwafa, naming S1. S1's credit is
    // settled, not Kau's older one; Diwafa's credit ages from S1.
    await ok(['customer', kau], ['customer', diwafa], 2000, s1, 'Credit recorded on Kau, was Diwafa');
    assert.equal(await creditBalance(s1KauCredit), 0, "the named shift's credit is settled");
    assert.equal(await creditBalance(oldKauCredit), 700, 'the older credit is still owed');
    assert.equal(await owes(kau), 700);
    assert.equal(await owes(diwafa), 2000);
    assert.equal(await cached(kau), 700, 'cache follows');
    assert.equal(await cached(diwafa), 2000, 'cache follows');
    const diwafaAccount = await db('credit_accounts').where({ id: diwafa }).first();
    // A limit of -1 days puts the cutoff at tomorrow: everything dated today counts.
    const overdue = await overdueBeyond(diwafaAccount, -1, today, db);
    assert.equal(overdue?.overdue_amount, 2000, 'a moved credit counts for credit age limits');
    assert.equal(overdue?.oldest_due_date, today, 'it ages from its shift');
    console.log('PASS credit on the wrong customer (named shift first, aged from shift)');

    // 3. Payment on the wrong customer: Kau really paid 1,000, recorded on
    // Diwafa. Kau owes 700, so 300 is credit on Kau's account.
    await ok(['customer', kau], ['customer', diwafa], 1000, null, 'Payment recorded on Diwafa, was Kau');
    assert.equal(await owes(kau), 0);
    assert.equal(await customerCreditBalance(kau, db), 300, "money that exists stays the customer's");
    assert.equal(await owes(diwafa), 3000);
    console.log('PASS payment on the wrong customer -> credit on account');

    // 4. Customer <-> employee needs the employee's own shift.
    await refused('customer to employee without a shift', move(['customer', diwafa], ['employee', attendant], 100, null), 400);
    await refused("customer to employee on someone else's shift", move(['customer', diwafa], ['employee', attendant], 100, s2), 400);
    console.log("PASS customer <-> employee must name the employee's shift");

    // 5. Made-up credit that hid a shortage: Diwafa -> attendant on S1. It
    // corrects S1's variance on the attendant's ledger; the shift is unchanged.
    await ok(['customer', diwafa], ['employee', attendant], 800, s1, 'Made-up credit hid a shortage');
    let a = await statement(attendant);
    const s1Row = () => a.rows.find((r: any) => r.shift_id === s1)!;
    assert.equal(a.totals.owes, 1800);
    assert.equal(s1Row().shortage, 1800, "S1's shortage on the ledger after the move");
    assert.equal(s1Row().closed_shortage, 1000, 'as closed');
    console.log('PASS customer -> attendant corrects their shift');

    // 6. The attendant pays 1,800. Then a payment recorded on S1 never came
    // in: attendant -> Diwafa 300. S1's shortage is 1,500, so 300 of what they
    // paid is their credit: it pays their next shortage.
    await db.transaction((trx) => recordVarianceRepayment(trx, attendant, { amount: 1800, payment_method: 'cash', date: today }, admin));
    await ok(['employee', attendant], ['customer', diwafa], 300, s1, 'Payment recorded that never came in');
    a = await statement(attendant);
    assert.deepEqual([a.totals.owes, a.totals.credit], [0, 300], 'money paid for nothing is credit');
    assert.equal(s1Row().shortage, 1500);
    assert.equal(await owes(diwafa), 2500);
    console.log('PASS attendant -> customer after payment: credit');

    // 7. A surplus never pays a shortage: the relief attendant owes S2's 500
    // although S3 was 500 over. Then a credit given but not recorded on S2:
    // relief -> Kau 500. The shortage is gone; nothing becomes credit.
    assert.equal((await statement(relief)).totals.owes, 500, 'a surplus never pays a shortage');
    await ok(['employee', relief], ['customer', kau], 500, s2, 'Credit given but not recorded');
    const r = await statement(relief);
    assert.deepEqual([r.totals.owes, r.totals.credit, r.rows[0].shortage], [0, 0, 0]);
    assert.equal(await owes(kau), 200, "Kau's 300 credit on account pays part of the new credit");
    assert.equal(await customerCreditBalance(kau, db), 0);
    console.log('PASS surplus ignored; relief on their shift clears the shortage');

    // 8. Repayment on the wrong employee: the night attendant paid 100, recorded
    // on the day attendant. It pays the night attendant's own shortage (S4).
    await ok(['employee', other], ['employee', attendant], 100, null, 'Repayment recorded on the wrong employee');
    const o = await statement(other);
    assert.equal(o.totals.owes, 100, "the payer's 100 pays their own shortage");
    a = await statement(attendant);
    assert.deepEqual([a.totals.owes, a.totals.credit], [0, 200], 'taken from their credit');
    console.log('PASS employee -> employee');

    // 9. The station writes off a customer's debt, never beyond what is owed.
    // Employees are never written off or raised by the station.
    await refused('write-off beyond what the customer owes', move(['customer', diwafa], ['station', null], 5000, null), 409);
    await ok(['customer', diwafa], ['station', null], 2500, null, 'Customer will not pay');
    assert.equal(await owes(diwafa), 0);
    assert.equal(await customerCreditBalance(diwafa, db), 0, 'a write-off never creates credit');
    await refused('employee to the station', move(['employee', other], ['station', null], 100, s4), 400);
    await refused('station to an employee', move(['station', null], ['employee', other], 50, null), 400);
    assert.equal((await statement(other)).totals.owes, 100);
    assert.deepEqual(await stationMoveTotals(db, today, today), { customers_written_off: 2500, customers_raised: 0 });
    console.log('PASS station writes off customers only');

    // 10. Shift unchanged; no cash; reports agree; integrity clean.
    assert.equal(await shiftSnapshot(), before, 'the closed shift is unchanged');
    const cashAfter = await getDirectReceivableCashInflows(db, today, today);
    assert.equal(cashAfter.money_credit_payments, cashBefore.money_credit_payments, 'no customer cash from moves');
    assert.equal(cashAfter.employee_debt_repayments, cashBefore.employee_debt_repayments + 1800, 'only the real repayment');
    const activity = await getReceivableActivity(db, today, today);
    assert.equal(activity.money_payments_received, 0, 'a move is not a payment');
    assert.equal(activity.money_credits_issued, 2000, "only S1's credit was issued today");
    // Onto customers 2000 + 1000 + 300 + 500 = 3800; off 2000 + 1000 + 800 + 2500 = 6300.
    assert.equal(activity.money_balance_adjustments, -2500);
    const shiftView = await call('GET', `/shifts/${s1}`);
    assert.equal(shiftView.body.data.balance_moves.length, 3, 'S1 lists the moves that name it');
    const listed = await call('GET', `/balance-moves?from=${today}&to=${today}`);
    assert.equal(listed.body.data.length, 7);
    const variances = await varianceActivity(db, today, today);
    assert.equal(variances.corrections, 800 - 300 - 500, 'moves on own shifts are corrections');
    assert.equal(variances.moved, -100 + 100, 'moves between employees');
    assert.equal(variances.waived, 0, 'nothing is written off');
    const audit: any = await auditReceivableIntegrity(db);
    assert.equal(audit.issues?.length ?? 0, 0, JSON.stringify(audit.issues));
    console.log('PASS shift unchanged, no cash, reports and integrity agree');

    // 11. Refusals, and one approval covers exactly one move.
    await refused('invoice customer', move(['customer', blossom], ['customer', kau], 10, null), 400);
    await refused('station to station', move(['station', null], ['station', null], 10, null), 400);
    await refused('same account', move(['customer', kau], ['customer', kau], 10, null), 400);
    await refused('no reason', move(['customer', kau], ['customer', diwafa], 10, null, ''), 400);
    await refused('open shift reference', move(['customer', kau], ['customer', diwafa], 10, openShift), 409);
    const fields = { from_kind: 'customer', from_id: kau, to_kind: 'customer', to_id: diwafa, shift_id: s1, amount: 10 };
    const token = await approval(fields);
    await refused('approval for another amount', call('POST', '/balance-moves', { ...fields, amount: 999, reason: 'tampered', approval_token: token }), 403);
    await refused('approval for another shift', call('POST', '/balance-moves', { ...fields, shift_id: null, reason: 'tampered', approval_token: token }), 403);
    await refused('no PIN on the desktop', call('POST', '/balance-moves', { ...fields, reason: 'no pin' }), 400);
    // A retry with the same key replays the move rather than posting it twice.
    const key = `retry-${Date.now()}`;
    const first = await call('POST', '/balance-moves', { ...fields, reason: 'retry', approval_token: await approval(fields) }, key);
    const again = await call('POST', '/balance-moves', { ...fields, reason: 'retry', approval_token: await approval(fields) }, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(again.body.data.id, first.body.data.id, 'the same move, not a second one');
    console.log('PASS refusals; approval bound to the move; retries replay');
  } finally {
    server?.close();
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
