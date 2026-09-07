import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

async function main() {
  process.env.NEXGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-payroll-report-test-'));
  const {default: db} = await import('../src/database');
  let server: any;
  try {
    await db.migrate.latest();
    const [employee] = await db('employees').insert({name: 'Report test', role: 'admin', active: true, pin: 'test', daily_wage: 800});
    const [pump] = await db('pumps').insert({label: 'Report test', nozzle_label: 'Test', fuel_type: 'petrol', active: true});
    const [plan] = await db('employee_compensation_plans').insert({employee_id: employee, name: 'Test daily', pay_schedule: 'daily', effective_from: '2026-08-01', version: 1, status: 'active'});
    await db('employee_compensation_components').insert({plan_id: plan, component_type: 'fixed_per_shift', amount: 800});
    async function shift(date: string, wage: number, explicitCash: number | null, deduction: number) {
      const [id] = await db('shifts').insert({employee_id: employee, compensation_plan_id: plan, shift_date: date, start_time: date+'T06:00:00Z', status: 'closed', wage_paid: wage, direct_wage_cash_amount: explicitCash});
      await db('pump_readings').insert({shift_id: id, pump_id: pump, amount_sold: 10000, litres_sold: 50});
      await db('shift_collections').insert({shift_id: id, cash_amount: 9200, mpesa_amount: 0, credits_amount: 0, total_collected: 9200});
      if (deduction) await db('wage_deductions').insert({shift_id: id, employee_id: employee, original_wage: 800, deduction_amount: deduction, final_wage: 800-deduction, reason: 'Test recovery'});
      return id;
    }
    const modern = await shift('2026-08-01', 443.14, 443.14, 356.86);
    const legacy = await shift('2026-08-02', 800, null, 356.86);
    const noCash = await shift('2026-08-03', 0, null, 0.62);
    const {generateToken, requireAuth} = await import('../src/middleware/requireAdmin');
    const app = express(); app.use(requireAuth);
    app.use('/reports', (await import('../src/routes/reports')).default);
    app.use('/shifts', (await import('../src/routes/shifts')).default);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const token = generateToken(employee, 'admin');
    async function get(url: string) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {headers: {Authorization: `Bearer ${token}`}});
      const body: any = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body.data;
    }
    for (const [id, date, expectedVariance] of [[modern, '2026-08-01', -356.86], [legacy, '2026-08-02', 0], [noCash, '2026-08-03', -800]] as const) {
      const detail = await get(`/shifts/${id}`);
      const report = await get(`/reports/daily?date=${date}`);
      assert.equal(detail.variance, expectedVariance);
      assert.equal(report.shifts[0].variance, detail.variance, 'Daily report must match shift accountability; deductions are not extra cash.');
    }
    const cf = await get('/reports/cash-flow?from=2026-08-01&to=2026-08-01');
    assert.equal(cf.outflows.wages_paid, 443.14);
    assert.equal(cf.inflows.drawer_payouts_already_reflected, 443.14);
    assert.equal(Math.round(cf.net_cash_flow * 100) / 100, 9200, 'Retained cash must not lose the wage twice.');
    // Add a separate historical payroll drawer payout and a back-office payment.
    const [period] = await db('payroll_periods').insert({name: 'Test', pay_schedule: 'monthly', period_start: '2026-07-01', period_end: '2026-07-31', status: 'paid'});
    const [run] = await db('payroll_runs').insert({period_id: period, status: 'paid'});
    const [line] = await db('payroll_lines').insert({run_id: run, employee_id: employee, gross_earnings: 300, net_pay: 300, paid_amount: 300, balance_due: 0, status: 'paid'});
    await db('payroll_payments').insert([
      {payroll_line_id: line, employee_id: employee, shift_id: modern, amount: 100, payment_method: 'cash', payment_date: '2026-08-01', status: 'posted'},
      {payroll_line_id: line, employee_id: employee, shift_id: null, amount: 200, payment_method: 'bank_transfer', payment_date: '2026-08-01', status: 'posted'},
    ]);
    await db('shift_expenses').insert({shift_id: modern, category: 'Test', amount: 50});
    const after = await get('/reports/cash-flow?from=2026-08-01&to=2026-08-01');
    assert.equal(after.inflows.drawer_payouts_already_reflected, 593.14);
    assert.equal(Math.round(after.net_cash_flow * 100) / 100, 9000, 'Only the outside-drawer bank payment further reduces retained cash.');
    const [mirror] = await db('payroll_payments').insert({payroll_line_id: line, employee_id: employee, shift_id: modern, amount: 443.14, payment_method: 'cash', payment_date: '2026-08-01', status: 'posted', reference: `SHIFT-WAGE:${modern}`});
    const mirrored = await get('/reports/cash-flow?from=2026-08-01&to=2026-08-01');
    assert.equal(mirrored.outflows.wages_paid, 743.14, 'A payroll mirror must replace, not duplicate, its shift wage.');
    assert.equal(mirrored.inflows.drawer_payouts_already_reflected, 593.14, 'The mirrored wage was already removed from drawer collections.');
    assert.equal(Math.round(mirrored.net_cash_flow * 100) / 100, 9000);
    await db('payroll_payments').where({id: mirror}).update({status: 'reversed'});
    const unmirrored = await get('/reports/cash-flow?from=2026-08-01&to=2026-08-01');
    assert.equal(unmirrored.outflows.wages_paid, 743.14, 'An unposted mirror must not hide the saved shift cash payment.');
    assert.equal((await db('shift_collections').where({shift_id: modern}).first()).cash_amount, 9200);
    assert.equal((await db('wage_deductions').where({shift_id: modern}).first()).deduction_amount, 356.86);
    const [staffAccount] = await db('credit_accounts').insert({name: 'Employee debt', type: 'employee', employee_id: employee, balance: 75});
    await db('staff_debts').insert({employee_id: employee, shift_id: modern, original_deficit: 75, deducted_from_wage: 0, carried_forward: 75, balance: 75, status: 'outstanding'});
    const {detectDrift} = await import('../src/services/driftDetector');
    assert.equal((await detectDrift()).accounts.drift_count, 0, 'Employee balances must be checked against staff debt, not customer credit.');
    await db('credit_accounts').where({id: staffAccount}).update({balance: 74});
    assert.equal((await detectDrift()).accounts.drift_count, 1, 'Real account drift must still be detected.');
    assert.equal((await db('credit_accounts').where({id: staffAccount}).first()).balance, 74, 'Drift checking is read-only.');
    console.log('PASS: legacy/modern/zero-cash shift and daily report agreement; cash flow counts drawer wages, payroll and expenses once, with bank payments separate.');
  } finally { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await db.destroy(); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
