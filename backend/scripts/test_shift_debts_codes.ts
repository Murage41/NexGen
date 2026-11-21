import assert from 'assert';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Update #28: payment codes (required for M-Pesa and bank, never used twice,
// added once to older payments) and debts entered in litres or amount at the
// shift's pump price, with no pump choice.

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-shift-debts-codes-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'shift-debts-codes-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { recordInvoicePayment, reverseMoneyAccountPayment } = await import('../src/services/receivablePayments');
  const { paymentCode } = await import('../src/services/paymentReference');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: paymentCodesRouter } = await import('../src/routes/paymentCodes');
  const auth = await import('../src/middleware/requireAdmin');

  let server: any;
  try {
    await db.migrate.latest();
    const today = getKenyaDate();
    const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    const [attendant] = await db('employees').insert({ name: 'Day Attendant', daily_wage: 0, pin: 'test-only', role: 'attendant', active: true });
    const [dieselTank] = await db('tanks').insert({ label: 'Diesel A', fuel_type: 'diesel', capacity_litres: 10000 });
    const [dieselTank2] = await db('tanks').insert({ label: 'Diesel B', fuel_type: 'diesel', capacity_litres: 10000 });
    await db('pumps').insert([
      { label: 'D1', nozzle_label: 'D', fuel_type: 'diesel', tank_id: dieselTank, active: true },
      { label: 'D2', nozzle_label: 'D', fuel_type: 'diesel', tank_id: dieselTank2, active: true },
    ]);
    await db('fuel_prices').insert([
      { fuel_type: 'diesel', price_per_litre: 227, effective_date: daysAgo(60) },
      { fuel_type: 'petrol', price_per_litre: 216, effective_date: daysAgo(60) },
    ]);
    const customer = async (name: string, mode: 'money' | 'invoice' = 'money') =>
      Number((await db('credit_accounts').insert({ name, type: 'customer', billing_mode: mode, balance: 0, payment_terms_days: 0 }))[0]);
    const money = await customer('Kamau Builders');
    const billed = await customer('Sample Transport', 'invoice');
    const [closed] = await db('shifts').insert({ employee_id: attendant, shift_date: daysAgo(3), start_time: `${daysAgo(3)}T06:00:00Z`, end_time: `${daysAgo(3)}T18:00:00Z`, status: 'closed', wage_paid: 0 });
    await db('credits').insert({ customer_name: 'Kamau Builders', amount: 20000, balance: 20000, shift_id: closed, status: 'outstanding', account_id: money });
    const [open] = await db('shifts').insert({ employee_id: attendant, shift_date: today, start_time: `${today}T06:00:00Z`, status: 'open', wage_paid: 0 });

    const app = express();
    app.use(express.json());
    app.use(auth.requireAuth);
    app.use('/shifts', shiftsRouter);
    app.use('/payment-codes', paymentCodesRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const port = server.address().port;
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const call = async (method: string, url: string, body?: any, headers: Record<string, string> = desktop) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };

    // ---- 1. Codes on payments ----
    assert.equal(paymentCode('cash', 'ANYTHING'), null, 'cash keeps no code');
    assert.equal(paymentCode('mpesa', ' sk l4abcd12 '), 'SKL4ABCD12', 'capitals, no spaces');
    const receipt = (body: any) => call('POST', `/shifts/${open}/credit-receipts`, { account_id: money, amount: 1000, ...body });
    assert.equal((await receipt({ payment_method: 'mpesa' })).body.code, 'PAYMENT_CODE_REQUIRED', 'M-Pesa needs its code');
    assert.equal((await receipt({ payment_method: 'mpesa', reference: 'ABC123' })).body.code, 'PAYMENT_CODE_INVALID', 'an M-Pesa code is 10 characters');
    const paid = await receipt({ payment_method: 'mpesa', reference: 'skl4abcd12' });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    const paidRow = await db('credit_payments').where({ shift_id: open, status: 'posted' }).first();
    assert.equal(paidRow.reference, 'SKL4ABCD12');
    const twice = await receipt({ payment_method: 'mpesa', reference: 'SKL4ABCD12' });
    assert.deepEqual([twice.status, twice.body.code], [409, 'PAYMENT_CODE_USED'], 'the same code twice is refused');
    assert.equal((await receipt({ payment_method: 'cash' })).status, 201, 'cash needs no code');
    // Across tables: an invoice payment can't reuse a debt payment's code.
    await db('customer_invoices').insert({ account_id: billed, invoice_number: 'INV-T-1', from_date: daysAgo(10), to_date: daysAgo(10), issue_date: daysAgo(9), due_date: daysAgo(9), status: 'issued', total_amount: 5000, balance: 5000 });
    await assert.rejects(() => recordInvoicePayment(db, { accountId: billed, amount: 500, paymentMethod: 'mpesa', paymentDate: today, reference: 'SKL4ABCD12' }), (err: any) => err.code === 'PAYMENT_CODE_USED');
    await assert.rejects(() => recordInvoicePayment(db, { accountId: billed, amount: 500, paymentMethod: 'bank', paymentDate: today }), (err: any) => err.code === 'PAYMENT_CODE_REQUIRED');
    // A reversed payment frees its code for the corrected entry.
    await reverseMoneyAccountPayment(db, { paymentId: Number(paidRow.id), reason: 'Entered on the wrong customer' } as any);
    assert.equal((await receipt({ payment_method: 'mpesa', reference: 'SKL4ABCD12' })).status, 201, 'a reversed payment frees its code');
    console.log('PASS M-Pesa and bank codes are required, shaped, unique across payments, and freed by a reversal');

    // ---- 2. Add code on an older payment ----
    const [old] = await db('credit_payments').insert({ account_id: money, amount: 700, payment_method: 'mpesa', payment_type: 'account', date: daysAgo(3), status: 'posted', shift_id: closed });
    const [oldCash] = await db('credit_payments').insert({ account_id: money, amount: 300, payment_method: 'cash', payment_type: 'account', date: daysAgo(3), status: 'posted', shift_id: closed });
    const added = await call('POST', '/payment-codes', { kind: 'debt_payment', id: old, reference: 'qk12ab34cd' });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const oldRow = await db('credit_payments').where({ id: old }).first();
    assert.deepEqual([oldRow.reference, Number(oldRow.amount), oldRow.date], ['QK12AB34CD', 700, daysAgo(3)], 'only the code is written, on a closed shift too');
    assert.equal((await call('POST', '/payment-codes', { kind: 'debt_payment', id: old, reference: 'QK12AB34CE' })).body.code, 'PAYMENT_CODE_SET', 'once');
    assert.equal((await call('POST', '/payment-codes', { kind: 'debt_payment', id: oldCash, reference: 'QK12AB34CE' })).body.code, 'PAYMENT_CODE_NOT_NEEDED');
    assert.equal((await call('POST', '/payment-codes', { kind: 'debt_payment', id: oldCash + 1000, reference: 'QK12AB34CE' })).status, 404);
    assert.equal((await call('POST', '/payment-codes', { kind: 'supplier_payment', id: 1, reference: 'X' })).status, 404);
    const attendantSession = { Authorization: `Bearer ${auth.generateToken(attendant, 'attendant')}` };
    assert.equal((await call('POST', '/payment-codes', { kind: 'debt_payment', id: old, reference: 'QK12AB34CF' }, attendantSession)).status, 403, 'administrators only');
    console.log('PASS an older M-Pesa or bank payment gets its code once; nothing else changes');

    // ---- 3. Debts in litres or amount, no pump choice ----
    const shift = (await call('GET', `/shifts/${open}`)).body.data;
    assert.deepEqual([shift.pump_prices.diesel, shift.pump_prices.petrol], [227, 216], 'the shift carries its pump prices');
    const credit = (body: any) => call('POST', `/shifts/${open}/credits`, { account_id: money, ...body });
    const byAmount = await credit({ fuel_type: 'diesel', amount: 10000, litres: 44.053 });
    assert.equal(byAmount.status, 201, JSON.stringify(byAmount.body));
    const saleA = await db('shift_credits').where({ shift_id: open }).orderBy('id', 'desc').first();
    assert.deepEqual([Number(saleA.amount), saleA.fuel_type, Number(saleA.litres), Number(saleA.unit_price)], [10000, 'diesel', 44.053, 227], 'kept exactly as shown');
    assert.match(saleA.description, /^Diesel 44\.053 L at 227\.00$/);
    assert.equal((await credit({ fuel_type: 'petrol', litres: 20 })).status, 201, 'litres alone work out the amount');
    const saleB = await db('shift_credits').where({ shift_id: open }).orderBy('id', 'desc').first();
    assert.deepEqual([Number(saleB.amount), Number(saleB.litres)], [4320, 20]);
    const wrong = await credit({ fuel_type: 'diesel', amount: 10000, litres: 50 });
    assert.deepEqual([wrong.status, wrong.body.code], [409, 'PRICE_MISMATCH'], 'figures that disagree with the pump price are refused');
    assert.equal((await credit({ fuel_type: 'other', amount: 1500 })).status, 201, 'Other is an amount only');
    const other = await db('shift_credits').where({ shift_id: open }).orderBy('id', 'desc').first();
    assert.deepEqual([other.fuel_type, other.litres], [null, null]);
    assert.equal((await credit({ fuel_type: 'diesel' })).status, 400, 'litres or amount is needed');
    // An invoice customer's fill by amount: no pump asked, though two pumps sell diesel.
    const fill = await call('POST', `/shifts/${open}/invoice-consumption`, { account_id: billed, fuel_type: 'diesel', amount: 5000, litres: 22.026 });
    assert.equal(fill.status, 201, JSON.stringify(fill.body));
    assert.deepEqual([Number(fill.body.data.retail_amount), Number(fill.body.data.litres), Number(fill.body.data.retail_price_at_time)], [5000, 22.026, 227]);
    assert.equal((await call('POST', `/shifts/${open}/invoice-consumption`, { account_id: billed, fuel_type: 'diesel', litres: 10 })).body.data.retail_amount, 2270);
    console.log('PASS debts in litres or amount at the pump price, kept as shown; Other is an amount; no pump choice');
  } finally {
    server?.close();
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('shift debts and codes: all checks passed');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
