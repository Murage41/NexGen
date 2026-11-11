import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The employee's account: shortages as one dated list (latest first, red adds,
// green takes off, the top line's balance is what is owed), and what has been
// paid to them. Surpluses are the station's and never appear.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-employee-account-'));
  process.env.NEXGEN_DATA_DIR = directory;
  const { default: db } = await import('../src/database');
  const { computeVarianceStatement } = await import('../src/services/employeeVariances');
  const { employeePayStatement } = await import('../src/services/employeePay');
  const { getKenyaDate } = await import('../src/utils/timezone');
  try {
    await db.migrate.latest();

    let id = 0;
    const entry = (entry_type: string, amount: number, day: number, extra: any = {}) => ({
      id: ++id, employee_id: 1, entry_type, amount, entry_date: `2026-10-${String(day).padStart(2, '0')}`,
      created_at: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`, status: 'posted', ...extra,
    });
    const statement = computeVarianceStatement([
      entry('shift', 1000, 1, { shift_id: 1, shift_date: '2026-10-01' }),
      entry('repayment', -400, 2, { payment_id: 9, method: 'mpesa', reference: 'QK1' }),
      entry('shift', -50, 3, { shift_id: 2, shift_date: '2026-10-03' }),
      entry('shift', 300, 4, { shift_id: 3, shift_date: '2026-10-04' }),
      entry('correction', -100, 5, { shift_id: 3, shift_date: '2026-10-04' }),
      entry('correction', 80, 6, { shift_id: 2, shift_date: '2026-10-03' }),
    ] as any, '2026-10-31');
    const ledger = statement.ledger;
    assert.deepEqual(ledger.map((l) => [l.title, l.amount, l.balance]), [
      ['Shortage raised by a correction', 30, 830],
      ['Shortage reduced by a correction', -100, 800],
      ['Shortage', 300, 900],
      ['Paid', -400, 600],
      ['Shortage', 1000, 1000],
    ], 'latest first, running balance, surplus left out');
    assert.equal(ledger[0].balance, statement.totals.net, 'the top balance is what is owed');
    assert.equal(ledger[3].payment_id, 9);
    assert.equal(ledger[3].method, 'mpesa');

    // Paying too much leaves a credit, which the next shortage uses.
    id = 0;
    const credit = computeVarianceStatement([
      entry('shift', 100, 1, { shift_id: 1, shift_date: '2026-10-01' }),
      entry('repayment', -150, 2, { payment_id: 1 }),
    ] as any, '2026-10-31');
    assert.equal(credit.ledger[0].balance, -50);
    assert.equal(credit.ledger[0].balance, credit.totals.net);

    // A write-off with nothing to clear moved no debt, so it is not a line.
    id = 0;
    const nothing = computeVarianceStatement([
      entry('waiver', -100, 1),
      entry('shift', 40, 2, { shift_id: 1, shift_date: '2026-10-02' }),
    ] as any, '2026-10-31');
    assert.deepEqual(nothing.ledger.map((l) => l.title), ['Shortage']);
    assert.equal(nothing.ledger[0].balance, nothing.totals.net);

    // Records from the old system sort by their own date, not the load time.
    id = 0;
    const old = computeVarianceStatement([
      entry('shift', 200, 20, { shift_id: 2, shift_date: '2026-10-20' }),
      entry('shift', 100, 5, { shift_id: 1, shift_date: '2026-10-05', legacy_source: 'staff_debts', created_at: '2026-10-25T10:00:00.000Z' }),
    ] as any, '2026-10-31');
    assert.deepEqual(old.ledger.map((l) => [l.shift_id, l.precision]), [[2, 'time'], [1, 'date']]);

    // SQLite's plain timestamps are UTC.
    id = 0;
    const plainTime = computeVarianceStatement([
      entry('shift', 10, 1, { shift_id: 1, shift_date: '2026-10-01', created_at: '2026-10-01 05:30:00' }),
    ] as any, '2026-10-31');
    assert.equal(new Date(plainTime.ledger[0].at).toISOString(), '2026-10-01T05:30:00.000Z');

    // What has been paid.
    const today = getKenyaDate();
    const [employee] = await db('employees').insert({ name: 'Account Test', role: 'attendant', active: true, daily_wage: 0 });
    const [period] = await db('payroll_periods').insert({ name: 'Test month', pay_schedule: 'monthly', period_start: '2020-01-01', period_end: '2020-01-31', status: 'approved' });
    const [run] = await db('payroll_runs').insert({ period_id: period, status: 'approved' });
    const [line] = await db('payroll_lines').insert({ run_id: run, employee_id: employee, gross_earnings: 1000, net_pay: 1000, paid_amount: 700, balance_due: 300, status: 'partially_paid' });
    const pay = (amount: number, payment_date: string, status = 'posted', reference: string | null = null) =>
      db('payroll_payments').insert({ payroll_line_id: line, employee_id: employee, amount, payment_method: 'mpesa', payment_date, reference, status });
    await pay(500, today);
    await pay(200, '2020-02-01', 'posted', 'SHIFT-WAGE:1');
    await pay(999, today, 'reversed');
    const account = await employeePayStatement(Number(employee), db);
    assert.deepEqual(account.paid_history.map((p) => [p.amount, p.from_till, p.run_name]), [[500, false, 'Test month'], [200, true, 'Test month']], 'latest first, reversed left out');
    assert.equal(account.paid_this_month, 500, 'only this month, only what stands');
    assert.equal(account.in_payroll_unpaid, 300);

    // A payroll not yet approved holds its shifts, so its pay counts; a void one does not.
    const addRun = async (name: string, start: string, status: string, due: number) => {
      const [p] = await db('payroll_periods').insert({ name, pay_schedule: 'monthly', period_start: start, period_end: start, status });
      const [r] = await db('payroll_runs').insert({ period_id: p, status });
      await db('payroll_lines').insert({ run_id: r, employee_id: employee, gross_earnings: due, net_pay: due, balance_due: due, status: 'unpaid' });
    };
    await addRun('Calculated', '2020-03-01', 'calculated', 100);
    await addRun('Void', '2020-04-01', 'void', 50);
    assert.equal((await employeePayStatement(Number(employee), db)).in_payroll_unpaid, 400);

    console.log('employee account: all checks passed');
  } finally {
    await db.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
