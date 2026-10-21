import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import knexFactory from 'knex';

// Historical edge cases for the shared, read-only shift financial view.
// Expected amounts are fixed examples, not calls to the production formula.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-shift-financial-views-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'shift-financial-views-test-desktop-key';
  const { default: db } = await import('../src/database');
  const { readShiftFinancials } = await import('../src/services/shiftFinancials');
  const { exportShiftHistory, normalizeShiftHistoryQuery } = await import('../src/services/shiftHistory');
  const { getRecordedShiftWagesPaid } = await import('../src/services/payrollAccounting');
  const auth = await import('../src/middleware/requireAdmin');
  const { default: shiftsRouter } = await import('../src/routes/shifts');
  const { default: reportsRouter } = await import('../src/routes/reports');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const date = '2026-08-01';
    const [employee] = await db('employees').insert({ name: 'Financial View Attendant', daily_wage: 800, role: 'attendant', active: true });
    const [otherEmployee] = await db('employees').insert({ name: 'Other Attendant', daily_wage: 800, role: 'attendant', active: true });
    const [moneyAccount] = await db('credit_accounts').insert({ name: 'Settled Customer', type: 'customer', billing_mode: 'money' });
    const [invoiceAccount] = await db('credit_accounts').insert({ name: 'Issued Fleet', type: 'customer', billing_mode: 'invoice' });
    const [tank] = await db('tanks').insert({ label: 'Financial View Tank', fuel_type: 'petrol', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'Active Pump', nozzle_label: 'A', tank_id: tank, fuel_type: 'petrol', active: true });
    const [retiredPump] = await db('pumps').insert({ label: 'Retired Pump', nozzle_label: 'R', tank_id: tank, fuel_type: 'petrol', active: false });
    const shift = async (status = 'closed', wage = 0, directCash: number | null = 0) =>
      Number((await db('shifts').insert({ employee_id: employee, shift_date: date, start_time: `${date}T06:00:00Z`,
        end_time: status === 'closed' ? `${date}T18:00:00Z` : null, status, wage_paid: wage, direct_wage_cash_amount: directCash }))[0]);
    const legacy = await shift('closed', 800, null);
    const backfilled = await shift();
    const explicitZero = await shift('closed', 0, 0);
    const cachedOnly = await shift();
    const correctedEmpty = await shift();
    const legacyRemoved = await shift();
    const open = await shift('open');
    const unprovenDate = '2026-07-31';
    const [unprovenWage] = await db('shifts').insert({ employee_id: employee, shift_date: unprovenDate,
      start_time: `${unprovenDate}T06:00:00Z`, end_time: `${unprovenDate}T18:00:00Z`, status: 'closed',
      wage_paid: null, direct_wage_cash_amount: null });
    await db('pump_readings').insert([
      { shift_id: legacy, pump_id: pump, litres_sold: 90, amount_sold: 9000 },
      { shift_id: legacy, pump_id: retiredPump, litres_sold: 10, amount_sold: 1000 },
      // An old close was backfilled with a 1,000 expected-sales baseline, but
      // retained meters establish 1,500 of physical sales. Reports must not
      // turn the saved reconciliation baseline into sales revenue.
      { shift_id: backfilled, pump_id: pump, litres_sold: 15, amount_sold: 1500 },
      { shift_id: explicitZero, pump_id: pump, litres_sold: 10, amount_sold: 1000 },
      { shift_id: explicitZero, pump_id: retiredPump, litres_sold: 5, amount_sold: 500 },
      { shift_id: cachedOnly, pump_id: pump, litres_sold: 10, amount_sold: 1000 },
      { shift_id: correctedEmpty, pump_id: pump, litres_sold: 10, amount_sold: 1000 },
      { shift_id: legacyRemoved, pump_id: pump, litres_sold: 10, amount_sold: 1000 },
      { shift_id: open, pump_id: pump, litres_sold: 10, amount_sold: 1000 },
      { shift_id: unprovenWage, pump_id: pump, litres_sold: 10, amount_sold: 1000 },
    ]);
    await db('shift_collections').insert([
      // The legacy aggregate credit cache is intentionally wrong. A paid sale
      // still counts as the sale recorded in this shift, not zero remaining debt.
      { shift_id: legacy, cash_amount: 7000, mpesa_amount: 500, credits_amount: 9999, total_collected: 17499 },
      { shift_id: backfilled, cash_amount: 1000, mpesa_amount: 0, credits_amount: 0, total_collected: 1000 },
      { shift_id: explicitZero, cash_amount: 1500, mpesa_amount: 0, credits_amount: 0, total_collected: 1500 },
      { shift_id: cachedOnly, cash_amount: 750, mpesa_amount: 0, credits_amount: 250, total_collected: 1000 },
      { shift_id: correctedEmpty, cash_amount: 750, mpesa_amount: 0, credits_amount: 250, total_collected: 1000 },
      { shift_id: legacyRemoved, cash_amount: 750, mpesa_amount: 0, credits_amount: 250, total_collected: 1000 },
      { shift_id: open, cash_amount: 1000, mpesa_amount: 0, credits_amount: 0, total_collected: 1000 },
      { shift_id: unprovenWage, cash_amount: 1000, mpesa_amount: 0, credits_amount: 0, total_collected: 1000 },
    ]);
    const [paidCredit] = await db('credits').insert({ account_id: moneyAccount, shift_id: legacy, customer_name: 'Settled Customer', amount: 1000, balance: 0, status: 'paid' });
    await db('shift_credits').insert({ shift_id: legacy, credit_id: paidCredit, customer_name: 'Settled Customer', amount: 1000 });
    const [removedLegacyCredit] = await db('credits').insert({ account_id: moneyAccount, shift_id: legacyRemoved, customer_name: 'Settled Customer',
      amount: 250, balance: 0, status: 'reversed', deleted_at: `${date}T19:00:00Z` });
    await db('shift_credits').insert({ shift_id: legacyRemoved, credit_id: removedLegacyCredit, customer_name: 'Settled Customer', amount: 250,
      deleted_at: `${date}T19:00:00Z` });
    await db('shift_expenses').insert([
      { shift_id: legacy, category: 'Cleaning', amount: 200 },
      { shift_id: legacy, category: 'Discarded', amount: 999, deleted_at: `${date}T19:00:00Z` },
    ]);
    await db('wage_deductions').insert({ shift_id: legacy, employee_id: employee,
      original_wage: 800, deduction_amount: 200, final_wage: 600, reason: 'Historical wage recovery' });
    const [period] = await db('payroll_periods').insert({ name: 'Historical Payroll', pay_schedule: 'monthly', period_start: '2026-07-01', period_end: '2026-07-31', status: 'paid' });
    const [run] = await db('payroll_runs').insert({ period_id: period, status: 'paid' });
    const [line] = await db('payroll_lines').insert({ run_id: run, employee_id: employee, gross_earnings: 900, net_pay: 900, paid_amount: 900, balance_due: 0, status: 'paid' });
    await db('payroll_payments').insert([
      { payroll_line_id: line, employee_id: employee, shift_id: legacy, amount: 600, payment_method: 'cash', payment_date: date, status: 'posted', reference: `SHIFT-WAGE:${legacy}` },
      { payroll_line_id: line, employee_id: employee, shift_id: legacy, amount: 100, payment_method: 'cash', payment_date: date, status: 'posted' },
      { payroll_line_id: line, employee_id: employee, shift_id: legacy, amount: 50, payment_method: 'mpesa', payment_date: date, status: 'reversed' },
    ]);
    const [invoice] = await db('customer_invoices').insert({ account_id: invoiceAccount, invoice_number: 'CINV-TEST-SOURCE', from_date: date, to_date: date,
      issue_date: null, due_date: date, status: 'draft', total_amount: 665, balance: 0 });
    const [invoiceLine] = await db('invoice_lines').insert({ invoice_id: invoice, fuel_type: 'petrol', total_litres: 7, agreed_price: 95, line_total: 665 });
    const [legacyHeader] = await db('shift_accountability_adjustments').insert({ shift_id: legacy, adjustment_type: 'historical_invoice_consumption_repair',
      amount_delta: 280, variance_before: -100, variance_after: 180, reason: 'Historical source corrections already reflected in active rows' });
    const [backfilledHeader] = await db('shift_accountability_adjustments').insert({ shift_id: backfilled, adjustment_type: 'historical_invoice_consumption_repair',
      amount_delta: 200, variance_before: 500, variance_after: 700, reason: 'Included before snapshot was backfilled' });
    const consumption = async (shiftId: number, amount: number, extra: Record<string, unknown> = {}) =>
      Number((await db('invoice_consumption').insert({ shift_id: shiftId, account_id: invoiceAccount, pump_id: pump, tank_id: tank,
        fuel_type: 'petrol', litres: amount / 100, retail_price_at_time: 100, retail_amount: amount, entry_status: 'active', ...extra }))[0]);
    const originalFuel = await consumption(legacy, 500, { entry_status: 'reversed', deleted_at: `${date}T19:00:00Z`, reversed_by_correction_id: legacyHeader, invoice_line_id: invoiceLine });
    const replacementFuel = await consumption(legacy, 700, { correction_of_id: originalFuel, created_by_correction_id: legacyHeader, invoice_line_id: invoiceLine });
    await db('customer_invoices').where({ id: invoice }).update({ issue_date: date, status: 'paid' });
    await consumption(legacy, 999, { entry_status: 'reversed', deleted_at: `${date}T19:00:00Z` });
    await consumption(backfilled, 500, { entry_status: 'reversed', deleted_at: `${date}T19:00:00Z`, reversed_by_correction_id: backfilledHeader });
    const backfilledFuel = await consumption(backfilled, 700, { created_by_correction_id: backfilledHeader });
    const [oldReceipt] = await db('credit_payments').insert({ account_id: moneyAccount, shift_id: legacy, amount: 200, date,
      payment_method: 'cash', payment_type: 'account', status: 'reversed', reversed_by_correction_id: legacyHeader });
    await db('credit_payments').insert([
      { account_id: moneyAccount, shift_id: legacy, amount: 120, date, payment_method: 'mpesa', payment_type: 'account', status: 'posted', created_by_correction_id: legacyHeader, correction_of_id: oldReceipt },
      { account_id: moneyAccount, shift_id: legacy, amount: 999, date, payment_method: 'cash', payment_type: 'account', status: 'posted', deleted_at: `${date}T19:00:00Z` },
    ]);
    const [split] = await db('corrections').insert({ number: 'C-TEST-SPLIT', record_type: 'collection', error_kind: 'wrong_split', reason_code: 'other',
      reason_note: 'Correct tender classification', posting_date: date, effective_date: date, plan_hash: 'test-fixture', effects_json: '[]' });
    const [removedCredit] = await db('corrections').insert({ number: 'C-TEST-CREDIT', record_type: 'credit_sale', error_kind: 'duplicate', reason_code: 'other',
      reason_note: 'Remove imported credit', posting_date: date, effective_date: date, plan_hash: 'test-fixture-credit', effects_json: '[]' });
    await db('correction_lines').insert([
      { correction_id: split, seq: 1, shift_id: legacy, record_type: 'collection', action: 'reverse', method: 'cash', amount: 200, shift_effect: 0 },
      { correction_id: split, seq: 2, shift_id: legacy, record_type: 'collection', action: 'add', method: 'mpesa', amount: 200, shift_effect: 0 },
      { correction_id: removedCredit, seq: 1, shift_id: correctedEmpty, record_type: 'credit_sale', action: 'reverse', amount: 250, shift_effect: -250 },
    ]);
    const snapshot = async (shiftId: number, isBackfilled: boolean, fields: Record<string, number>) => {
      await db('shift_close_reconciliations').insert({ shift_id: shiftId, readings_reviewed: true, collections_reviewed: true, entries_reviewed: true,
        expected_sales: 1000, expected_shift_total: 1000, cash_received: 1000, mpesa_received: 0, credit_receipts: 0, credits_issued: 0,
        invoice_consumption: 0, expenses: 0, direct_wage_payment: 0, payroll_payments: 0, total_accounted: 1000, variance: 0,
        variance_type: 'balanced', approved_by_role: isBackfilled ? 'backfill' : 'admin', approved_at: `${date}T18:00:00Z`, backfilled: isBackfilled, ...fields });
    };
    await snapshot(legacy, false, { expected_sales: 10000, expected_shift_total: 10200, cash_received: 7000, mpesa_received: 500,
      credit_receipts: 200, credits_issued: 1000, invoice_consumption: 500, expenses: 200, direct_wage_payment: 800, payroll_payments: 100, total_accounted: 10100, variance: -100 });
    await snapshot(backfilled, true, { invoice_consumption: 700, total_accounted: 1700, variance: 700 });
    await snapshot(Number(unprovenWage), true, { direct_wage_payment: 800, total_accounted: 1800, variance: 800 });
    // These are responsibility changes only. They must not be added to sales,
    // collections or variance a second time by the shared financial reader.
    await db('employee_variance_entries').insert([
      { employee_id: employee, entry_type: 'shift', shift_id: legacy, entry_date: date, amount: 100, reason: 'Original shortage' },
      { employee_id: employee, entry_type: 'correction', shift_id: legacy, entry_date: date, amount: -50, reason: 'Historical balance responsibility move' },
      { employee_id: employee, entry_type: 'correction', shift_id: legacy, entry_date: date, amount: 300, reason: 'Historical invoice note responsibility' },
    ]);
    const tables = ['shifts', 'pump_readings', 'shift_collections', 'shift_credits', 'credits', 'credit_accounts', 'credit_payments',
      'invoice_consumption', 'customer_invoices', 'invoice_lines', 'invoice_adjustment_notes', 'invoice_accounting_events',
      'shift_close_reconciliations', 'shift_accountability_adjustments', 'corrections', 'correction_lines', 'employee_variance_entries',
      'wage_deductions', 'employee_earnings', 'payroll_payments', 'payroll_lines', 'tanks', 'delivery_batches', 'batch_consumption'];
    const stored = async () => {
      const rows: Record<string, any[]> = {};
      for (const table of tables) rows[table] = await db(table).orderBy('id');
      return rows;
    };
    const before = await stored();
    const all = await readShiftFinancials(db, [legacy, backfilled, explicitZero, cachedOnly, correctedEmpty, legacyRemoved, open, Number(unprovenWage)]);
    const current = all.get(legacy)!;
    assert.deepEqual([current.current.expected_sales, current.current.total_cash, current.current.total_mpesa,
      current.current.total_credits, current.current.total_invoice_consumption, current.current.total_credit_receipts,
      current.current.total_expenses, current.current.total_payroll_payments, current.current.total_accounted,
      current.current.expected_shift_total, current.current.variance],
    [10000, 6800, 700, 1000, 700, 120, 200, 100, 10300, 10120, 180],
    'retired-pump sales, paid credit, active issued fuel and legacy replacements count once; responsibility changes do not alter source totals');
    assert.deepEqual([current.current.credit_receipts_cash, current.current.credit_receipts_mpesa, current.current.sales_cash, current.current.sales_mpesa], [0, 120, 6800, 580]);
    assert.deepEqual([current.reconciliation_wage, current.actual_wage_paid, current.wage_deduction, current.drawer_payroll_paid], [800, 600, 200, 100], 'legacy gross wage reconciles, real net cash is retained, and its payroll mirror is not paid twice');
    assert.deepEqual([current.invoice_petrol_litres, current.invoice_diesel_litres], [7, 0]);
    assert.deepEqual(current.invoiceConsumption.map((row: any) => row.id), [replacementFuel]);
    assert.deepEqual([current.original!.total_cash, current.original!.total_invoice_consumption, current.original!.total_credit_receipts, current.original!.variance], [7000, 500, 200, -100]);
    assert.deepEqual([all.get(backfilled)!.original!.total_invoice_consumption, all.get(backfilled)!.current.total_invoice_consumption,
      all.get(backfilled)!.original!.variance, all.get(backfilled)!.current.variance], [700, 700, 700, 700], 'a backfilled snapshot already includes the old source correction');
    assert.deepEqual([all.get(explicitZero)!.current.employee_wage, all.get(explicitZero)!.actual_wage_paid, all.get(explicitZero)!.current.variance], [0, 0, 0], 'explicit zero wages must not fall back to the employee daily rate');
    assert.equal(all.get(explicitZero)!.current.expected_sales, 1500, 'a legacy shift without a snapshot retains sales from a now-inactive pump');
    assert.deepEqual([all.get(cachedOnly)!.current.total_credits, all.get(cachedOnly)!.current.variance], [250, 0], 'legacy aggregate-only credit remains evidence when no source rows exist');
    assert.deepEqual([all.get(correctedEmpty)!.current.total_credits, all.get(correctedEmpty)!.current.variance], [0, -250], 'after a credit was removed, an empty source set does not revive its old cached total');
    assert.deepEqual([all.get(legacyRemoved)!.current.total_credits, all.get(legacyRemoved)!.current.variance], [0, -250],
      'a last legacy credit deleted before modern correction history must not revive the cached credit total');
    assert.equal(all.get(explicitZero)!.original, null, 'a missing snapshot is not invented');
    assert.equal(all.get(open)!.original, null);
    assert.deepEqual([all.get(Number(unprovenWage))!.current.employee_wage, all.get(Number(unprovenWage))!.actual_wage_paid], [800, 0],
      'a backfilled reconciliation wage cannot establish that any wage cash was actually paid');
    assert.equal(await getRecordedShiftWagesPaid(unprovenDate, unprovenDate, db), 0,
      'the existing payroll cash helper likewise has no payment evidence for a null saved wage');
    assert.equal((await readShiftFinancials(db, [])).size, 0);
    const fromRows = await readShiftFinancials(db, await db('shifts').whereIn('id', [legacy, backfilled]));
    assert.deepEqual(fromRows.get(legacy)!.current, current.current, 'batch reader accepts the caller shift rows and ids consistently');
    const exported = await exportShiftHistory(db, normalizeShiftHistoryQuery({ from: date, to: date, status: 'closed' }));
    const legacyExport: any = exported.rows.find((row: any) => Number(row.id) === legacy);
    assert.deepEqual([legacyExport.cash_received, legacyExport.invoice_consumption, legacyExport.variance,
      legacyExport.current_cash_received, legacyExport.current_invoice_consumption, legacyExport.current_variance,
      legacyExport.original_close_available], [7000, 500, -100, 6800, 700, 180, true],
    'export preserves original columns and identifies corrected financial values separately');
    const noCloseExport: any = exported.rows.find((row: any) => Number(row.id) === explicitZero);
    assert.deepEqual([noCloseExport.variance, noCloseExport.current_variance, noCloseExport.original_close_available], [null, 0, false]);

    const app = express();
    app.use(express.json());
    app.use(auth.requireAuth);
    app.use('/shifts', shiftsRouter);
    app.use('/reports', reportsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const port = (server.address() as any).port;
    const get = async (url: string, headers: Record<string, string> = { 'x-desktop-key': process.env.DESKTOP_KEY! }) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { headers });
      return { status: response.status, body: await response.json() as any };
    };
    const original = await get(`/shifts/${legacy}?view=original`);
    assert.equal(original.status, 200, JSON.stringify(original.body));
    assert.deepEqual([original.body.data.variance, original.body.data.total_invoice_consumption, original.body.data.total_credit_receipts], [-100, 500, 200]);
    assert.deepEqual(original.body.data.invoice_consumption.map((row: any) => row.id), [originalFuel]);
    assert.deepEqual(original.body.data.credit_receipts.map((row: any) => row.id), [oldReceipt]);
    const currentDetail = await get(`/shifts/${legacy}`);
    assert.equal(currentDetail.status, 200, JSON.stringify(currentDetail.body));
    assert.deepEqual([currentDetail.body.data.employee_wage, currentDetail.body.data.actual_wage_paid,
      currentDetail.body.data.variance, currentDetail.body.data.record_corrections.current_variance,
      currentDetail.body.data.record_corrections.corrected_variance], [800, 600, 180, 180, -100],
    'the API distinguishes actual wage cash from saved reconciliation pay and uses the shared current variance for its banner');
    const backfilledOriginal = await get(`/shifts/${backfilled}?view=original`);
    assert.equal(backfilledOriginal.status, 200, JSON.stringify(backfilledOriginal.body));
    assert.deepEqual(backfilledOriginal.body.data.invoice_consumption.map((row: any) => row.id), [backfilledFuel], 'backfilled original lists include old correction replacements');
    const daily = await get(`/reports/daily?date=${date}`);
    assert.equal(daily.status, 200, JSON.stringify(daily.body));
    const backfilledDay = daily.body.data.shifts.find((row: any) => Number(row.id) === backfilled);
    assert.deepEqual([backfilledDay.total_sales, backfilledDay.expected_sales, backfilledDay.expected_shift_total,
      backfilledDay.variance, backfilledDay.original_financials.expected_sales], [1500, 1000, 1000, 700, 1000],
    'daily physical sales come from meters while shift accountability preserves the backfilled baseline');
    assert.equal(daily.body.data.total_sales, 17000, 'daily revenue includes all physical sales, including retired-pump sales and the differing backfilled close');
    const unprovenCashFlow = await get(`/reports/cash-flow?from=${unprovenDate}&to=${unprovenDate}`);
    assert.equal(unprovenCashFlow.status, 200, JSON.stringify(unprovenCashFlow.body));
    assert.deepEqual([unprovenCashFlow.body.data.outflows.wages_paid,
      unprovenCashFlow.body.data.inflows.drawer_payouts_already_reflected, unprovenCashFlow.body.data.net_cash_flow], [0, 0, 1000],
    'cash flow must not manufacture an 800 wage payment or gross-receipt reconstruction from a backfilled snapshot');
    assert.equal((await get(`/shifts/${explicitZero}?view=original`)).status, 409, 'no snapshot means no original view');
    assert.equal((await get(`/shifts/${open}?view=original`)).status, 409, 'open shifts cannot claim an original close');
    const own = { Authorization: `Bearer ${auth.generateToken(employee, 'attendant')}` };
    const other = { Authorization: `Bearer ${auth.generateToken(otherEmployee, 'attendant')}` };
    assert.equal((await get(`/shifts/${legacy}`, other)).status, 403);
    assert.equal((await get(`/shifts/${legacy}?view=original`, other)).status, 403);
    const ownClosed = await get(`/shifts/${legacy}`, own);
    assert.equal(ownClosed.status, 200);
    assert.equal(ownClosed.body.data.variance, 180);
    const blindOpen = await get(`/shifts/${open}`, own);
    assert.equal(blindOpen.status, 200);
    assert.equal(Object.hasOwn(blindOpen.body.data, 'variance'), false, 'attendant open-shift view remains blind');
    assert.deepEqual(await stored(), before, 'service and current/original API views must leave every source, account, payroll and history row unchanged');
    // Commit a complete expense correction between the detailed expense list
    // and the following credit list. WAL allows the writer to commit while a
    // reader retains its earlier snapshot. No timers or scheduling race are
    // needed: intercept one query boundary in this isolated test process.
    await db.raw('PRAGMA journal_mode = WAL');
    const writer = knexFactory({ client: 'sqlite3', connection: { filename: path.join(directory, 'nexgen.db') },
      pool: { min: 0, max: 1 }, useNullAsDefault: true });
    const expense = await db('shift_expenses').where({ shift_id: legacy, category: 'Cleaning' }).first();
    const queryPrototype = Object.getPrototypeOf(db.client);
    const hadOwnQuery = Object.hasOwn(queryPrototype, 'query');
    const executeQuery = queryPrototype.query;
    let attempted = false;
    let committed = false;
    try {
      queryPrototype.query = async function (connection: any, query: any) {
        if (!attempted && /select[\s\S]*from `shift_credits`/.test(query.sql)
          && query.bindings?.includes(legacy)) {
          attempted = true;
          await writer.transaction(async (trx) => {
            const [correction] = await trx('corrections').insert({ number: 'C-TEST-CONCURRENT', record_type: 'drawer_expense', error_kind: 'wrong_amount',
              reason_code: 'other', reason_note: 'Receipt corrected during a simultaneous detail request', posting_date: date, effective_date: date,
              plan_hash: 'test-concurrent', effects_json: '[]' });
            await trx('shift_expenses').where({ id: expense.id }).update({ deleted_at: `${date}T20:00:00Z`, reversed_by_record_correction_id: correction });
            const [replacement] = await trx('shift_expenses').insert({ shift_id: legacy, category: 'Cleaning', amount: 300, created_by_record_correction_id: correction });
            await trx('correction_lines').insert([
              { correction_id: correction, seq: 1, shift_id: legacy, record_type: 'drawer_expense', target_id: expense.id, action: 'reverse', amount: 200, shift_effect: -200 },
              { correction_id: correction, seq: 2, shift_id: legacy, record_type: 'drawer_expense', target_id: expense.id, created_record_id: replacement, action: 'add', amount: 300, shift_effect: 300 },
            ]);
          });
          committed = true;
        }
        return executeQuery.call(this, connection, query);
      };
      const duringCorrection = await get(`/shifts/${legacy}`);
      assert.equal(duringCorrection.status, 200, JSON.stringify(duringCorrection.body));
      assert(attempted && committed, 'the independent writer must commit before the detail request resumes');
      assert.deepEqual([duringCorrection.body.data.total_expenses,
        duringCorrection.body.data.expenses.map((row: any) => Number(row.amount)),
        duringCorrection.body.data.total_accounted, duringCorrection.body.data.variance,
        duringCorrection.body.data.record_corrections.current_variance], [200, [200], 10300, 180, 180],
      'one detail response must retain one complete financial snapshot despite a concurrent correction');
      assert(!duringCorrection.body.data.record_corrections.lines.some((row: any) => row.number === 'C-TEST-CONCURRENT'),
        'correction history must share the financial snapshot too');
    } finally {
      if (hadOwnQuery) queryPrototype.query = executeQuery;
      else delete queryPrototype.query;
      await writer.destroy();
    }
    const afterCorrection = await get(`/shifts/${legacy}`);
    assert.equal(afterCorrection.status, 200, JSON.stringify(afterCorrection.body));
    assert.deepEqual([afterCorrection.body.data.total_expenses,
      afterCorrection.body.data.expenses.map((row: any) => Number(row.amount)),
      afterCorrection.body.data.total_accounted, afterCorrection.body.data.variance], [300, [300], 10400, 280],
    'the next request sees the entire committed correction');
    const originalAfterCorrection = await get(`/shifts/${legacy}?view=original`);
    assert.deepEqual([originalAfterCorrection.body.data.total_expenses, originalAfterCorrection.body.data.variance], [200, -100],
      'concurrent financial correction does not rewrite the original close');
    console.log('PASS shared current/original view: historical sources, backfilled close, responsibility-only entries, inactive pump, paid sources, wages/mirrors and permissions');
    console.log('PASS simultaneous correction and detail GET retain consistent lists, totals and history without changing the original close');
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
