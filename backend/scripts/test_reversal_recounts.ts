import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Undo and delete count figures again from their records (2026-11 audit):
// archiving a customer keeps their history; a paid supplier bill cannot be
// deleted; reversing a customer or supplier payment, or a shift's FIFO use,
// counts the debt, bill or fuel batch again instead of adding back; the drift
// check finds wrong stored figures in one pass; a late delivery updates the
// tank figures of the closed shifts after it; an open-shift credit with money
// paid on it is not half-removed. Private temporary database only.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-reversal-recounts-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'reversal-recounts-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { readShiftFinancials } = await import('../src/services/shiftFinancials');
  const { getReceivablePositionAsOf, getDirectReceivableCashInflows } = await import('../src/services/receivableReporting');
  const { recordMoneyAccountPayment, reverseMoneyAccountPayment } = await import('../src/services/receivablePayments');
  const { recomputeAccountBalance } = await import('../src/services/accountBalance');
  const { detectDrift } = await import('../src/services/driftDetector');
  const { runOperationalIntegrityCheck } = await import('../src/services/operationalIntegrity');
  const { computeBookStock, computeBookStockAtTimes, reverseBatchConsumption } = await import('../src/services/stockCalculator');
  const { default: creditAccountsRouter } = await import('../src/routes/creditAccounts');
  const { default: supplierInvoicesRouter } = await import('../src/routes/supplierInvoices');
  const { default: supplierPaymentsRouter } = await import('../src/routes/supplierPayments');
  const { default: fuelDeliveriesRouter } = await import('../src/routes/fuelDeliveries');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: customerInvoicesRouter } = await import('../src/routes/customerInvoices');
  const { createReservedInvoiceDraft } = await import('../src/services/invoiceDraftReservations');

  let server: any;
  try {
    await db.migrate.latest();
    const app = express();
    app.use(express.json());
    app.use('/credit-accounts', creditAccountsRouter);
    app.use('/supplier-invoices', supplierInvoicesRouter);
    app.use('/supplier-payments', supplierPaymentsRouter);
    app.use('/fuel-deliveries', fuelDeliveriesRouter);
    app.use('/shifts', shiftsRouter);
    app.use('/customer-invoices', customerInvoicesRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const port = server.address().port;
    const call = async (method: string, url: string, body?: any) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-desktop-key': process.env.DESKTOP_KEY! },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const [attendant] = await db('employees').insert({ name: 'Test Attendant', daily_wage: 0, pin: 'test-only', role: 'attendant', active: true });
    const closedShift = async (date: string, end = `${date}T18:00:00.000Z`) => {
      const [id] = await db('shifts').insert({ employee_id: attendant, shift_date: date, start_time: `${date}T06:00:00.000Z`, end_time: end, status: 'closed' });
      return Number(id);
    };

    // ---- 1. Archiving a paid-up customer keeps their history ----
    {
      // The till receipt is taken on an open shift, which then closes.
      const [shiftId] = await db('shifts').insert({ employee_id: attendant, shift_date: '2026-09-01', start_time: '2026-09-01T06:00:00.000Z', status: 'open' });
      const [customer] = await db('credit_accounts').insert({ name: 'Archive Stores', type: 'customer', billing_mode: 'money', balance: 0 });
      const [credit] = await db('credits').insert({ customer_name: 'Archive Stores', amount: 500, balance: 500, shift_id: null, status: 'outstanding', account_id: customer, created_at: '2026-08-30 09:00:00' });
      // Paid 300 at the till on the shift, 200 directly at the office later.
      const atTill = await recordMoneyAccountPayment(db, { accountId: Number(customer), amount: 300, paymentMethod: 'cash', paymentDate: '2026-09-01', shiftId });
      await db('shifts').where({ id: shiftId }).update({ status: 'closed', end_time: '2026-09-01T18:00:00.000Z' });
      await recordMoneyAccountPayment(db, { accountId: Number(customer), amount: 200, paymentMethod: 'mpesa', paymentDate: '2026-09-05' });
      assert.equal(Number((await db('credits').where({ id: credit }).first()).balance), 0);
      const shiftBefore = (await readShiftFinancials(db, [shiftId])).get(shiftId)!.current;
      const positionBefore = await getReceivablePositionAsOf(db, '2026-09-02');
      const inflowBefore = await getDirectReceivableCashInflows(db, '2026-09-01', '2026-09-30');
      assert.equal(shiftBefore.total_credit_receipts, 300);
      assert.equal(positionBefore.money_receivables, 200, 'owed 200 on 2 September');

      const archived = await call('DELETE', `/credit-accounts/${customer}`);
      assert.equal(archived.status, 200, JSON.stringify(archived.body));
      assert.ok((await db('credit_accounts').where({ id: customer }).first()).deleted_at, 'account archived');
      assert.equal((await db('credits').where({ id: credit }).first()).deleted_at, null, 'their debt is not removed');
      assert.equal((await db('credit_payments').where({ account_id: customer }).whereNotNull('deleted_at')).length, 0, 'their payments are not removed');
      const shiftAfter = (await readShiftFinancials(db, [shiftId])).get(shiftId)!.current;
      assert.equal(shiftAfter.total_credit_receipts, 300, 'the old shift still has the 300 it took');
      assert.equal(shiftAfter.variance, shiftBefore.variance, 'the old shift result does not change');
      assert.equal((await getReceivablePositionAsOf(db, '2026-09-02')).money_receivables, 200, 'history still shows what they owed then');
      assert.deepEqual(await getDirectReceivableCashInflows(db, '2026-09-01', '2026-09-30'), inflowBefore, 'cash received in the month does not change');
      assert.ok(atTill.payment, 'payment recorded');

      // The check counts the balance from the records, not the stored figure.
      const [owing] = await db('credit_accounts').insert({ name: 'Stale Cache Ltd', type: 'customer', billing_mode: 'money', balance: 0 });
      await db('credits').insert({ customer_name: 'Stale Cache Ltd', amount: 300, balance: 300, shift_id: null, status: 'outstanding', account_id: owing });
      const refused = await call('DELETE', `/credit-accounts/${owing}`);
      assert.equal(refused.status, 400, 'a customer who owes cannot be archived even when the stored balance says 0');
      assert.match(refused.body.error, /300\.00/);
      assert.equal((await db('credit_accounts').where({ id: owing }).first()).deleted_at, null);
    }

    // ---- 1b. An invoice customer with fuel still to bill stays ----
    {
      const [customer] = await db('credit_accounts').insert({ name: 'Monthly Haulers', type: 'customer', billing_mode: 'invoice', balance: 0, payment_terms_days: 30 });
      const fuel = (shiftId: number, litres: number, extra: Record<string, unknown> = {}) => db('invoice_consumption')
        .insert({ account_id: customer, shift_id: shiftId, fuel_type: 'diesel', litres, retail_price_at_time: 170, retail_amount: litres * 170, ...extra })
        .then(([id]) => Number(id));
      const first = await closedShift('2026-10-02');
      const second = await closedShift('2026-10-05');
      // Already billed on a paid invoice, and an entry a correction removed: neither is left to bill.
      const [paid] = await db('customer_invoices').insert({ account_id: customer, invoice_number: 'INV-HAUL-1', from_date: '2026-09-01', to_date: '2026-09-30', status: 'draft', total_amount: 1700, balance: 1700 });
      const [paidLine] = await db('invoice_lines').insert({ invoice_id: paid, fuel_type: 'diesel', total_litres: 10, agreed_price: 170, line_total: 1700 });
      await fuel(await closedShift('2026-09-10'), 10, { invoice_line_id: paidLine });
      await db('customer_invoices').where({ id: paid }).update({ issue_date: '2026-09-30', status: 'paid', balance: 0 });
      await fuel(first, 40, { deleted_at: '2026-10-03 08:00:00', entry_status: 'reversed' });
      await fuel(second, 30, { deleted_at: '2026-10-06 08:00:00' }); // removed before entries had a status
      const entries = [await fuel(first, 100), await fuel(first, 25.5), await fuel(second, 50)];

      const refused = await call('DELETE', `/credit-accounts/${customer}`);
      assert.equal(refused.status, 400, 'fuel not yet invoiced stops the removal');
      assert.equal(refused.body.code, 'INVOICE_WORK_LEFT');
      assert.match(refused.body.error, /175\.50 L of fuel not yet invoiced \(2 shifts, 2 Oct 2026 to 5 Oct 2026\)/);
      const switched = await call('PUT', `/credit-accounts/${customer}`, { billing_mode: 'money' });
      assert.equal(switched.status, 400, 'the same fuel stops a switch to money billing');
      assert.match(switched.body.error, /175\.50 L .* before switching them to money billing/);

      // Fuel on a shift still open counts too.
      const [open] = await db('shifts').insert({ employee_id: attendant, shift_date: '2026-10-09', start_time: '2026-10-09T06:00:00.000Z', status: 'open' });
      const onOpen = await fuel(Number(open), 20);
      assert.match((await call('DELETE', `/credit-accounts/${customer}`)).body.error, /195\.50 L .*3 shifts, 2 Oct 2026 to 9 Oct 2026/);
      await db('invoice_consumption').where({ id: onOpen }).update({ deleted_at: '2026-10-09 09:00:00', entry_status: 'deleted' });

      // A draft holds the fuel: still refused, now for the draft.
      const draft = await createReservedInvoiceDraft(db, { accountId: Number(customer), toDate: '2026-10-31' });
      const draftRefused = await call('DELETE', `/credit-accounts/${customer}`);
      assert.equal(draftRefused.status, 400, 'a draft invoice stops the removal');
      assert.match(draftRefused.body.error, /has a draft invoice/);
      assert.match((await call('PUT', `/credit-accounts/${customer}`, { billing_mode: 'money' })).body.error, /has a draft invoice/);

      // Deleting the draft puts the fuel back to bill; correcting it away lets the customer go.
      assert.equal((await call('DELETE', `/customer-invoices/${draft.invoice.id}`)).status, 200);
      assert.match((await call('DELETE', `/credit-accounts/${customer}`)).body.error, /175\.50 L/);
      await db('invoice_consumption').whereIn('id', entries).update({ deleted_at: '2026-10-20 08:00:00', entry_status: 'reversed' });
      const removed = await call('DELETE', `/credit-accounts/${customer}`);
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.ok((await db('credit_accounts').where({ id: customer }).first()).deleted_at, 'removed once nothing is left to bill');
    }

    // ---- 2. A paid supplier bill cannot be deleted ----
    const [supplier] = await db('suppliers').insert({ name: 'Test Supplier' });
    {
      const [bill] = await db('supplier_invoices').insert({ supplier_id: supplier, invoice_number: 'B-1', amount: 1000, balance: 1000, status: 'unpaid', created_at: '2026-09-01 08:00:00' });
      const pay = await call('POST', '/supplier-payments', { supplier_id: supplier, amount: 1000, payment_method: 'cash', payment_date: '2026-09-02' });
      assert.equal(pay.status, 201, JSON.stringify(pay.body));
      assert.equal(Number((await db('supplier_invoices').where({ id: bill }).first()).balance), 0);
      // Even if the stored balance wrongly said unpaid, the payment record refuses it.
      await db('supplier_invoices').where({ id: bill }).update({ balance: 1000 });
      const refused = await call('DELETE', `/supplier-invoices/${bill}`);
      assert.equal(refused.status, 400, 'a bill paid by a general payment is not deleted');
      assert.equal((await db('supplier_invoices').where({ id: bill }).first()).deleted_at, null);
      // Planted wrong figure: void must count the bill again, not add back.
      await db('supplier_invoices').where({ id: bill }).update({ balance: 50 });
      const voided = await call('DELETE', `/supplier-payments/${pay.body.data.id}`);
      assert.equal(voided.status, 200, JSON.stringify(voided.body));
      const after = await db('supplier_invoices').where({ id: bill }).first();
      assert.equal(Number(after.balance), 1000, 'bill counted again from its payments');
      assert.equal(after.status, 'unpaid');
      const deleted = await call('DELETE', `/supplier-invoices/${bill}`);
      assert.equal(deleted.status, 200, 'an unpaid bill can be deleted');

      // Partly paid by two payments; voiding one leaves the other on the bill.
      const [bill2] = await db('supplier_invoices').insert({ supplier_id: supplier, invoice_number: 'B-2', amount: 1000, balance: 1000, status: 'unpaid' });
      const p1 = await call('POST', '/supplier-payments', { supplier_id: supplier, invoice_id: bill2, amount: 400, payment_method: 'cash', payment_date: '2026-09-03' });
      const p2 = await call('POST', '/supplier-payments', { supplier_id: supplier, invoice_id: bill2, amount: 100, payment_method: 'cash', payment_date: '2026-09-04' });
      assert.equal(p1.status, 201); assert.equal(p2.status, 201);
      await db('supplier_invoices').where({ id: bill2 }).update({ balance: 300 });
      assert.equal((await call('DELETE', `/supplier-payments/${p1.body.data.id}`)).status, 200);
      const bill2After = await db('supplier_invoices').where({ id: bill2 }).first();
      assert.equal(Number(bill2After.balance), 900, '1000 less the 100 still paid');
      assert.equal(bill2After.status, 'partial');
    }

    // ---- 3. Reversing a customer payment counts each debt again ----
    {
      const [customer] = await db('credit_accounts').insert({ name: 'Recount Stores', type: 'customer', billing_mode: 'money', balance: 0 });
      const [debt] = await db('credits').insert({ customer_name: 'Recount Stores', amount: 1000, balance: 1000, shift_id: null, status: 'outstanding', account_id: customer });
      const first = await recordMoneyAccountPayment(db, { accountId: Number(customer), amount: 300, paymentMethod: 'cash', paymentDate: '2026-09-10' });
      await recordMoneyAccountPayment(db, { accountId: Number(customer), amount: 200, paymentMethod: 'cash', paymentDate: '2026-09-11' });
      assert.equal(Number((await db('credits').where({ id: debt }).first()).balance), 500);
      // Planted wrong figure (450 instead of 500): adding back 300 would give 750.
      await db('credits').where({ id: debt }).update({ balance: 450 });
      await reverseMoneyAccountPayment(db, { paymentId: Number(first.payment.id), reason: 'test reversal' });
      const row = await db('credits').where({ id: debt }).first();
      assert.equal(Number(row.balance), 800, '1000 less the 200 still paid');
      assert.equal(row.status, 'partial');
      assert.equal(Number((await db('credit_accounts').where({ id: customer }).first()).balance), 800);
    }

    // ---- 4. Reversing a shift's FIFO use counts each batch again ----
    const [tank] = await db('tanks').insert({ label: 'T1', fuel_type: 'petrol', capacity_litres: 20000 });
    const [pump] = await db('pumps').insert({ label: 'P1', nozzle_label: 'A', fuel_type: 'petrol', tank_id: tank, active: true });
    {
      const [delivery] = await db('fuel_deliveries').insert({ tank_id: tank, supplier: 'Test Supplier', supplier_id: supplier, litres: 1000, cost_per_litre: 150, total_cost: 150000, date: '2026-08-01', delivery_timestamp: '2026-08-01 00:00:00' });
      const [batch] = await db('delivery_batches').insert({ delivery_id: delivery, tank_id: tank, fuel_type: 'petrol', original_litres: 1000, remaining_litres: 500, cost_per_litre: 150, date: '2026-08-01' });
      const s1 = await closedShift('2026-08-02');
      const s2 = await closedShift('2026-08-03');
      await db('batch_consumption').insert([
        { batch_id: batch, shift_id: s1, tank_id: tank, litres_consumed: 300, cost_per_litre: 150, total_cost: 45000 },
        { batch_id: batch, shift_id: s2, tank_id: tank, litres_consumed: 200, cost_per_litre: 150, total_cost: 30000 },
      ]);
      // Planted wrong figure (450 instead of 500): adding back 300 would give 750.
      await db('delivery_batches').where({ id: batch }).update({ remaining_litres: 450 });
      await reverseBatchConsumption(s1, tank, db);
      assert.equal(Number((await db('delivery_batches').where({ id: batch }).first()).remaining_litres), 800, '1000 less the 200 still sold from it');
      assert.equal((await db('batch_consumption').where({ shift_id: s1 })).length, 0);
    }

    // ---- 5. The drift check: one pass gives the same book stock, and wrong figures are found ----
    {
      let seed = 7;
      const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
      const day = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString().slice(0, 10);
      for (let d = 0; d < 20; d++) {
        if (d % 5 === 0) await db('fuel_deliveries').insert({ tank_id: tank, supplier: 'Test Supplier', supplier_id: supplier, litres: 3000, cost_per_litre: 150, total_cost: 450000, date: day(d), delivery_timestamp: `${day(d)} 0${Math.floor(rand() * 9)}:30:00` });
        if (d % 7 === 3) await db('tank_stock_adjustments').insert({ tank_id: tank, litres_change: -Math.round(rand() * 50), reason: 'evaporation', notes: 'test', adjustment_date: day(d), adjustment_timestamp: `${day(d)}T10:00:00.000Z` });
        const s = await closedShift(day(d), d % 4 === 0 ? `${day(d)}T23:30:00.000Z` : `${day(d)}T18:00:00.000Z`);
        await db('pump_readings').insert({ shift_id: s, pump_id: pump, litres_sold: Math.round(rand() * 900), amount_sold: 0 });
        await db('tank_dips').insert({ tank_id: tank, measured_litres: 2000, dip_date: day(d), timestamp: d % 3 === 0 ? day(d) : `${day(d)} 07:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00`, book_stock_at_dip: 0, variance_litres: 0 });
      }
      // A dip at the very moment of a delivery counts that delivery, as computeBookStock does.
      const sameMoment = await db('fuel_deliveries').where({ tank_id: tank }).whereNotNull('delivery_timestamp').orderBy('id', 'desc').first();
      await db('tank_dips').insert({ tank_id: tank, measured_litres: 2000, dip_date: String(sameMoment.date).slice(0, 10), timestamp: sameMoment.delivery_timestamp, book_stock_at_dip: 0, variance_litres: 0 });
      const dips = await db('tank_dips').where({ tank_id: tank }).select('timestamp', 'dip_date', db.raw("datetime(CASE WHEN timestamp GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN timestamp || ' 23:59:59' ELSE timestamp END) as at"));
      const oneByOne = await Promise.all(dips.map((d: any) => computeBookStock(Number(tank), d.timestamp || d.dip_date)));
      const onePass = await computeBookStockAtTimes(Number(tank), dips.map((d: any) => d.at));
      onePass.forEach((value, index) => assert.ok(Math.abs(value - oneByOne[index]) < 0.001, `dip ${index}: one pass ${value} vs ${oneByOne[index]}`));

      // Every dip was saved with book stock 0, so every dip is reported.
      const report = await detectDrift();
      assert.equal(report.dips.drift_count, dips.length);
      // Plant one wrong debt, bill and batch figure.
      const [customer] = await db('credit_accounts').insert({ name: 'Drift Stores', type: 'customer', billing_mode: 'money', balance: 0 });
      const [debt] = await db('credits').insert({ customer_name: 'Drift Stores', amount: 1000, balance: 400, shift_id: null, status: 'partial', account_id: customer });
      await recomputeAccountBalance(Number(customer));
      const [bill] = await db('supplier_invoices').insert({ supplier_id: supplier, invoice_number: 'B-9', amount: 700, balance: 100, status: 'partial' });
      const [delivery] = await db('fuel_deliveries').insert({ tank_id: tank, supplier: 'Test Supplier', supplier_id: supplier, litres: 50, cost_per_litre: 150, total_cost: 7500, date: '2026-07-01', delivery_timestamp: '2026-07-01 00:00:00' });
      const [batch] = await db('delivery_batches').insert({ delivery_id: delivery, tank_id: tank, fuel_type: 'petrol', original_litres: 50, remaining_litres: 10, cost_per_litre: 150, date: '2026-07-01' });
      const planted = await detectDrift();
      const kinds = planted.stored_balances.drifted.map((row) => `${row.kind}:${row.id}`).sort();
      assert.deepEqual(kinds, [`credit:${debt}`, `delivery_batch:${batch}`, `supplier_bill:${bill}`].sort());
      assert.equal(planted.ok, false);
      const system = await runOperationalIntegrityCheck(db);
      assert.equal(system.ok, false);
      assert.equal(system.counts.stored_balance_issues, dips.length + 3, 'System check counts dips and records');
    }

    // ---- 6. A late delivery updates the tank figures of later closed shifts ----
    {
      const [tank2] = await db('tanks').insert({ label: 'T2', fuel_type: 'diesel', capacity_litres: 20000 });
      const [pump2] = await db('pumps').insert({ label: 'P2', nozzle_label: 'A', fuel_type: 'diesel', tank_id: tank2, active: true });
      const [first] = await db('fuel_deliveries').insert({ tank_id: tank2, supplier: 'Test Supplier', supplier_id: supplier, litres: 5000, cost_per_litre: 140, total_cost: 700000, date: '2026-06-01', delivery_timestamp: '2026-06-01 00:00:00' });
      const [firstBatch] = await db('delivery_batches').insert({ delivery_id: first, tank_id: tank2, fuel_type: 'diesel', original_litres: 5000, remaining_litres: 4000, cost_per_litre: 140, date: '2026-06-01' });
      const sA = await closedShift('2026-06-03');
      const sB = await closedShift('2026-06-05');
      await db('batch_consumption').insert([
        { batch_id: firstBatch, shift_id: sA, tank_id: tank2, litres_consumed: 400, cost_per_litre: 140, total_cost: 56000 },
        { batch_id: firstBatch, shift_id: sB, tank_id: tank2, litres_consumed: 600, cost_per_litre: 140, total_cost: 84000 },
      ]);
      await db('pump_readings').insert([{ shift_id: sA, pump_id: pump2, litres_sold: 400, amount_sold: 0 }, { shift_id: sB, pump_id: pump2, litres_sold: 600, amount_sold: 0 }]);
      await db('shift_tank_snapshots').insert([
        { shift_id: sA, tank_id: tank2, opening_stock_litres: 5000, deliveries_litres: 0, sales_litres: 400, closing_stock_litres: 4600, cogs: 56000 },
        { shift_id: sB, tank_id: tank2, opening_stock_litres: 4600, deliveries_litres: 0, sales_litres: 600, closing_stock_litres: 4000, cogs: 84000 },
      ]);
      // Recorded late: a delivery dated 4 June (between the two shifts).
      const late = await call('POST', '/fuel-deliveries', { tank_id: tank2, supplier_id: supplier, litres: 2000, cost_per_litre: 145, date: '2026-06-04' });
      assert.equal(late.status, 201, JSON.stringify(late.body));
      const a = await db('shift_tank_snapshots').where({ shift_id: sA, tank_id: tank2 }).first();
      const b = await db('shift_tank_snapshots').where({ shift_id: sB, tank_id: tank2 }).first();
      assert.deepEqual([Number(a.opening_stock_litres), Number(a.closing_stock_litres)], [5000, 4600], 'the shift before it is unchanged');
      assert.deepEqual([Number(b.opening_stock_litres), Number(b.deliveries_litres), Number(b.sales_litres), Number(b.closing_stock_litres)], [6600, 0, 600, 6000], 'the shift after it opens with the delivery');
      assert.equal(Number(b.cogs), 84000, 'FIFO still takes the older fuel first');
      // Deleting that delivery puts the figures back.
      const removed = await call('DELETE', `/fuel-deliveries/${late.body.data.id}`);
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      const b2 = await db('shift_tank_snapshots').where({ shift_id: sB, tank_id: tank2 }).first();
      assert.deepEqual([Number(b2.opening_stock_litres), Number(b2.closing_stock_litres)], [4600, 4000]);
    }

    // ---- 7. An open-shift credit with money paid on it is not half-removed ----
    {
      const [customer] = await db('credit_accounts').insert({ name: 'Open Shift Stores', type: 'customer', billing_mode: 'money', balance: 0 });
      const [openShift] = await db('shifts').insert({ employee_id: attendant, shift_date: '2026-11-12', start_time: '2026-11-12T06:00:00.000Z', status: 'open' });
      const sale = await call('POST', `/shifts/${openShift}/credits`, { account_id: customer, amount: 500, description: 'test' });
      assert.equal(sale.status, 201, JSON.stringify(sale.body));
      const creditId = sale.body.data.credit_id;
      const [payment] = await db('credit_payments').insert({ account_id: customer, amount: 100, payment_method: 'cash', date: '2026-11-12', status: 'posted', unapplied_amount: 0 });
      await db('credit_payment_allocations').insert({ payment_id: payment, credit_id: creditId, amount_applied: 100 });
      const refused = await call('DELETE', `/shifts/${openShift}/credits/${sale.body.data.id}`);
      assert.equal(refused.status, 409);
      assert.equal(refused.body.code, 'SHIFT_CREDIT_HAS_PAYMENT');
      assert.equal((await db('shift_credits').where({ id: sale.body.data.id }).first()).deleted_at, null, 'the shift keeps the sale');
      assert.equal((await db('credits').where({ id: creditId }).first()).deleted_at, null, 'the customer keeps the debt');
      // Without a payment it is removed as before.
      await db('credit_payment_allocations').where({ payment_id: payment }).update({ reversed_at: new Date().toISOString() });
      const removed = await call('DELETE', `/shifts/${openShift}/credits/${sale.body.data.id}`);
      assert.equal(removed.status, 200);
      assert.ok((await db('credits').where({ id: creditId }).first()).deleted_at);
    }

    console.log('reversal recounts: all checks passed');
  } finally {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
