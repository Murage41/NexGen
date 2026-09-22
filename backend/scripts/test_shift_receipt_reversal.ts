import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Removing a debt payment recorded on an open shift by mistake. Payments are
// reversed, never deleted: the customer owes the amount again, it leaves the
// shift's drawer and every report, and the record stays with who, when and why.
// Admin-only and open-shift-only, like removing a shift credit. Runs on a
// private temporary database; never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-receipt-reversal-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'receipt-reversal-test-desktop-key';
  const { default: db } = await import('../src/database');
  const auth = await import('../src/middleware/requireAdmin');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { recordEmployeeDebtReceipt } = await import('../src/services/employeePay');
  const { getVarianceStatement, postShiftVariance } = await import('../src/services/employeeVariances');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: creditAccountsRouter } = await import('../src/routes/creditAccounts');

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const today = getKenyaDate();
    const [attendant] = await db('employees').insert({ name: 'Day Attendant', daily_wage: 0, pin: 'test-only', role: 'attendant', active: true });
    const shift = async (date: string, status: string) => {
      const [id] = await db('shifts').insert({ employee_id: attendant, shift_date: date, start_time: `${date}T06:00:00Z`, status });
      return id as number;
    };
    const earlier = await shift('2026-09-01', 'closed');
    const open = await shift(today, 'open');
    const [customer] = await db('credit_accounts').insert({ name: 'Kau', type: 'customer', billing_mode: 'money', balance: 0 });
    const [olderCredit] = await db('credits').insert({ customer_name: 'Kau', amount: 1000, balance: 1000, shift_id: earlier, status: 'outstanding', account_id: customer });
    const [newerCredit] = await db('credits').insert({ customer_name: 'Kau', amount: 500, balance: 500, shift_id: earlier, status: 'outstanding', account_id: customer });

    const app = express();
    app.use(express.json());
    app.use('/shifts', shiftsRouter);
    app.use('/credit-accounts', creditAccountsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const attendantSession = { Authorization: `Bearer ${auth.generateToken(attendant, 'attendant')}` };
    const call = async (method: string, url: string, headers: Record<string, string>, body?: any) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const balances = async () => (await db('credits').whereIn('id', [olderCredit, newerCredit]).orderBy('id')).map((c: any) => [Number(c.balance), c.status]);
    const cached = async () => Number((await db('credit_accounts').where({ id: customer }).first()).balance);

    // An attendant takes 1,200 on their open shift: settles the older credit
    // and 200 of the newer one.
    const receipt = await call('POST', `/shifts/${open}/credit-receipts`, attendantSession, { account_id: customer, amount: 1200, payment_method: 'cash' });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
    const paymentId = receipt.body.data.id;
    assert.deepEqual(await balances(), [[0, 'paid'], [300, 'partial']]);
    assert.equal(await cached(), 300);
    assert.equal((await call('GET', `/shifts/${open}`, desktop)).body.data.credit_receipts.length, 1, 'the shift lists it');

    // ---- Who may remove it ----
    assert.equal((await call('POST', `/shifts/${open}/credit-receipts/${paymentId}/reverse`, attendantSession)).status, 403, 'attendants cannot remove payments');
    assert.equal((await call('POST', `/shifts/${earlier}/credit-receipts/${paymentId}/reverse`, desktop)).status, 400, 'a closed shift cannot be changed');
    const otherOpen = await db('shifts').insert({ employee_id: attendant, shift_date: today, start_time: `${today}T07:00:00Z`, status: 'open' }).then(([id]: any) => id);
    assert.equal((await call('POST', `/shifts/${otherOpen}/credit-receipts/${paymentId}/reverse`, desktop)).status, 404, 'only from the shift that recorded it');
    await db('shifts').where({ id: otherOpen }).delete();
    console.log('PASS only an administrator can remove a payment, and only from its own open shift');

    // ---- Removing it ----
    const removed = await call('POST', `/shifts/${open}/credit-receipts/${paymentId}/reverse`, desktop);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(await balances(), [[1000, 'outstanding'], [500, 'outstanding']], 'exactly the credits it settled are owed again');
    assert.equal(await cached(), 1500, 'the balance is recomputed');
    const row = await db('credit_payments').where({ id: paymentId }).first();
    assert.equal(row.status, 'reversed', 'kept on record, not deleted');
    assert.equal(row.reversal_reason, `Removed from open shift #${open}`);
    assert(row.reversed_at);
    const allocations = await db('credit_payment_allocations').where({ payment_id: paymentId });
    assert(allocations.length === 2 && allocations.every((a: any) => a.reversed_at), 'its allocations are reversed');
    const shiftView = (await call('GET', `/shifts/${open}`, desktop)).body.data;
    assert.equal(shiftView.credit_receipts.length, 0, 'it leaves the shift');
    const detail = (await call('GET', `/credit-accounts/${customer}`, desktop)).body.data;
    assert.equal(detail.payments.length, 0, 'and the customer statement');
    assert.equal((await call('POST', `/shifts/${open}/credit-receipts/${paymentId}/reverse`, desktop)).status, 409, 'it cannot be removed twice');
    console.log('PASS a removed payment is reversed: the customer owes it again, it leaves the shift and statement, and stays on record');

    // The customer can then pay correctly.
    const again = await call('POST', `/shifts/${open}/credit-receipts`, attendantSession, { account_id: customer, amount: 1500, payment_method: 'mpesa' });
    assert.equal(again.status, 201);
    assert.equal(await cached(), 0);
    console.log('PASS the correct payment can be recorded afterwards');

    // ---- A variance repayment taken into the drawer ----
    const [debtShift] = await db('shifts').insert({ employee_id: attendant, shift_date: '2026-09-02', start_time: '2026-09-02T06:00:00Z', status: 'closed' });
    await db.transaction((trx) => postShiftVariance(trx, { id: debtShift, employee_id: attendant, shift_date: '2026-09-02' }, -400, null));
    const staffReceipt = await db.transaction((trx) =>
      recordEmployeeDebtReceipt(attendant, { amount: 250, payment_method: 'cash', date: today, reference: 'R-1', shift_id: open }, null, trx),
    );
    assert.equal((await getVarianceStatement(db, attendant)).totals.owes, 150);
    const staffRemoved = await call('POST', `/shifts/${open}/credit-receipts/${staffReceipt.id}/reverse`, desktop);
    assert.equal(staffRemoved.status, 200, JSON.stringify(staffRemoved.body));
    assert.equal((await getVarianceStatement(db, attendant)).totals.owes, 400, 'the employee owes it again');
    const entry = await db('employee_variance_entries').where({ payment_id: staffReceipt.id }).first();
    assert.equal(entry.status, 'reversed', 'the repayment stays on record, marked reversed');
    console.log('PASS a variance repayment taken into the drawer is reversed the same way');

    // ---- Closed shifts keep their reconciled drawer ----
    await db('shifts').where({ id: open }).update({ status: 'closed' });
    const later = await call('POST', `/shifts/${open}/credit-receipts/${again.body.data.id}/reverse`, desktop);
    assert.equal(later.status, 400, 'once the shift closes, its payments are corrected, not removed');
    assert.equal((await db('credit_payments').where({ id: again.body.data.id }).first()).status, 'posted');
    console.log('PASS a closed shift refuses removal; its drawer stays as reconciled');

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
