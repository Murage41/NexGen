import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

async function main() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nexgen-settlement-test-'),
  );
  process.env.NEXGEN_DATA_DIR = directory;
  const { default: db } = await import('../src/database');
  const {
    calculatePayrollRun,
    previewPayrollRun,
    approvePayrollRun,
    getPayrollRun,
    voidPayrollRun,
    refreshPayrollLine,
  } = await import('../src/services/payroll');
  const { savePayrollRecovery, recordPayrollPayment, addPayrollDeduction } =
    await import('../src/services/payrollMutations');
  const { payrollRecoveryPreview } = await import(
    '../src/services/payrollDetails'
  );
  const { shiftRecoveryPreview, postShiftRecovery } = await import(
    '../src/services/shiftSettlement'
  );
  const { employeeDebtSummary } = await import('../src/services/employeeDebt');
  const {
    recordEmployeeDebtReceipt,
    reverseEmployeeDebtReceipt,
    employeeDebtHistory,
  } = await import('../src/services/employeePay');
  const { generateShiftEarnings } = await import(
    '../src/services/compensation'
  );
  const { getTotalPayrollCashOutflow } = await import(
    '../src/services/payrollAccounting'
  );
  const { verifiedDatabaseBackup } = await import(
    '../src/services/databaseBackup'
  );
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const employee = async (
      name: string,
      schedule: string,
      components: any[],
    ) => {
      const [id] = await db('employees').insert({
        name,
        daily_wage: 0,
        pin: 'test-only',
        role: 'attendant',
        active: true,
      });
      const [plan] = await db('employee_compensation_plans').insert({
        employee_id: id,
        name,
        pay_schedule: schedule,
        effective_from: '2026-08-01',
        version: 1,
        status: 'active',
      });
      await db('employee_compensation_components').insert(
        components.map((c) => ({ ...c, plan_id: plan })),
      );
      return { id, plan };
    };
    const shift = async (person: any, date: string, cash = 0) => {
      const [id] = await db('shifts').insert({
        employee_id: person.id,
        compensation_plan_id: person.plan,
        shift_date: date,
        start_time: `${date}T06:00:00Z`,
        status: 'closed',
        wage_paid: cash,
      });
      return db('shifts').where({ id }).first();
    };
    const debt = async (person: any, source: any, amount: number) => {
      const [id] = await db('staff_debts').insert({
        employee_id: person.id,
        shift_id: source.id,
        original_deficit: amount,
        carried_forward: amount,
        balance: amount,
        status: 'outstanding',
      });
      return id;
    };
    const earn = async (source: any, readings: any[] = []) =>
      db.transaction((trx) =>
        generateShiftEarnings(source, readings, '2026-09-01T06:00:00Z', trx),
      );
    const review = async (runId: number, lineId: number, amount: number) => {
      const p = await payrollRecoveryPreview(lineId, db);
      await db.transaction((trx) =>
        savePayrollRecovery(
          runId,
          lineId,
          {
            version: p.version,
            amount,
            authorization_reference: 'TEST-AUTH',
            reason: 'Agreed instalment',
          },
          null,
          trx,
        ),
      );
    };
    const monthly = await employee('Monthly test', 'monthly', [
      { component_type: 'fixed_per_shift', amount: 800 },
    ]);
    const first = await shift(monthly, '2026-08-01');
    await earn(first);
    // Reproduce the zero-cash deduction row that previously invented a payment.
    await db('wage_deductions').insert({
      shift_id: first.id,
      employee_id: monthly.id,
      original_wage: 800,
      deduction_amount: 0.62,
      final_wage: 799.38,
    });
    const second = await shift(monthly, '2026-08-02');
    await earn(second);
    const debtId = await debt(monthly, first, 1000);
    const runId = await calculatePayrollRun(
      {
        name: 'August test',
        pay_schedule: 'monthly',
        period_start: '2026-08-01',
        period_end: '2026-08-31',
      },
      db,
      '2026-09-01',
    );
    let run = await getPayrollRun(runId, db);
    const line = run.lines[0];
    assert.equal(line.shift_count, 2);
    assert.equal(line.paid_amount, 0);
    assert.equal(line.balance_due, 1599.38);
    assert.equal(
      await getTotalPayrollCashOutflow('2026-08-01', '2026-08-31', db),
      0,
    );
    await assert.rejects(
      () => approvePayrollRun(runId, null, db),
      /review|Refresh/i,
    );
    await review(runId, line.id, 400);
    assert.equal(
      (await employeeDebtSummary(monthly.id, db)).outstanding,
      1000,
      'Draft recovery must not change debt',
    );
    await db.transaction((trx) =>
      recordEmployeeDebtReceipt(
        monthly.id,
        {
          amount: 100,
          date: '2026-09-01',
          payment_method: 'cash',
          reference: 'R-1',
        },
        null,
        trx,
      ),
    );
    await assert.rejects(() => approvePayrollRun(runId, null, db), /changed/i);
    await review(runId, line.id, 400);
    await approvePayrollRun(runId, null, db);
    assert.equal((await employeeDebtSummary(monthly.id, db)).outstanding, 500);
    await db.transaction((trx) =>
      recordPayrollPayment(
        line.id,
        { amount: 300, payment_method: 'cash', payment_date: '2026-09-01' },
        null,
        trx,
      ),
    );
    run = await getPayrollRun(runId, db);
    assert.equal(run.lines[0].shift_details[0].deductions, 400.62);
    assert.equal(run.lines[0].shift_details[0].paid, 300);
    assert.equal(run.lines[0].shift_details[0].remaining, 99.38);
    assert.equal(run.lines[0].shift_details[1].remaining, 800);
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          recordPayrollPayment(
            line.id,
            { amount: 900, payment_method: 'cash', payment_date: '2026-09-01' },
            null,
            trx,
          ),
        ),
      /exceeds/i,
    );
    await assert.rejects(
      () => voidPayrollRun(runId, 'Test void', db),
      /Reverse all/,
    );
    const p = await db('payroll_payments')
      .where({ payroll_line_id: line.id, status: 'posted' })
      .first();
    await db.transaction(async (trx) => {
      await trx('payroll_payments')
        .where({ id: p.id })
        .update({ status: 'reversed', reversed_at: trx.fn.now() });
      await refreshPayrollLine(line.id, trx);
    });
    await voidPayrollRun(runId, 'Test reversal', db);
    assert.equal((await employeeDebtSummary(monthly.id, db)).outstanding, 900);
    const receipt = await db('credit_payments')
      .where({ payment_type: 'staff_debt' })
      .first();
    await db.transaction((trx) =>
      reverseEmployeeDebtReceipt(receipt.id, 'Test reversal', trx),
    );
    assert.equal((await employeeDebtSummary(monthly.id, db)).outstanding, 1000);
    const history = await employeeDebtHistory(monthly.id, db);
    assert.equal(
      history.debts.find((d) => d.id === debtId).historical_adjustment,
      0,
    );
    console.log(
      'PASS zero-cash import, explicit recovery, stale approval, partial settlement, receipt and reversal reconciliation',
    );

    for (const [schedule, start, end] of [
      ['weekly', '2026-08-01', '2026-08-07'],
      ['biweekly', '2026-08-01', '2026-08-14'],
    ]) {
      const person = await employee(`${schedule} hybrid`, schedule, [
        { component_type: 'fixed_per_shift', amount: 100 },
        { component_type: 'sales_percentage', rate: 1 },
        { component_type: 'litre_rate', rate: 2 },
      ]);
      const source = await shift(person, start);
      await earn(source, [
        { amount_sold: 10000, litres_sold: 50, fuel_type: 'petrol' },
      ]);
      await debt(person, source, 1000);
      const id = await calculatePayrollRun(
        {
          name: schedule,
          pay_schedule: schedule as any,
          period_start: start,
          period_end: end,
        },
        db,
        '2026-09-01',
      );
      const detail = await getPayrollRun(id, db);
      const l = detail.lines.find((l: any) => l.employee_id === person.id);
      assert.equal(l.gross_earnings, 300);
      assert.equal(l.shift_count, 1);
      assert.equal(l.earnings.length, 3);
      await review(id, l.id, 300);
      await approvePayrollRun(id, null, db);
      assert.equal((await employeeDebtSummary(person.id, db)).outstanding, 700);
      const late = await shift(person, '2026-08-03');
      await earn(late, [{ amount_sold: 10000, litres_sold: 50 }]);
      const supplement = await calculatePayrollRun(
        {
          name: 'Late shifts',
          supplement_of: id,
          pay_schedule: schedule as any,
          period_start: start,
          period_end: end,
        },
        db,
        '2026-09-01',
      );
      const supplementRun = await getPayrollRun(supplement, db);
      assert.equal(supplementRun.lines.length, 1);
      assert.equal(supplementRun.lines[0].shift_count, 1);
      assert.equal(supplementRun.lines[0].shift_details[0].shift_id, late.id);
      assert.equal(supplementRun.gross_total, 300);
      await review(supplement, supplementRun.lines[0].id, 0);
      await approvePayrollRun(supplement, null, db);
    }
    const daily = await employee('Daily commission', 'daily', [
      { component_type: 'sales_percentage', rate: 5 },
    ]);
    const old = await shift(daily, '2026-08-15');
    await debt(daily, old, 200);
    const today = await shift(daily, '2026-08-16');
    const readings = [{ amount_sold: 10000, fuel_type: 'diesel' }];
    const preview = await shiftRecoveryPreview(today, readings, 100, -50, db);
    assert.equal(preview.gross, 500);
    assert.equal(preview.proposed, 250);
    await db.transaction((trx) =>
      postShiftRecovery(
        today,
        readings,
        100,
        -50,
        {
          version: preview.version,
          amount: 250,
          authorization_reference: 'AUTH',
        },
        'Counted shortage',
        trx,
      ),
    );
    assert.equal((await employeeDebtSummary(daily.id, db)).outstanding, 0);
    const dailyDeduction = await db('wage_deductions')
      .where({ shift_id: today.id })
      .first();
    assert.equal(dailyDeduction.deduction_amount, 250);
    await earn(today, readings);
    assert.equal(
      await getTotalPayrollCashOutflow('2026-08-16', '2026-08-16', db),
      100,
    );
    console.log(
      'PASS weekly/fortnightly hybrid recovery and daily commission recovery from old plus new debt',
    );

    const fixed = await employee('Daily fixed', 'daily', [
      { component_type: 'fixed_per_shift', amount: 800 },
    ]);
    const previous = await shift(fixed, '2026-08-19');
    await debt(fixed, previous, 300);
    const closing = await shift(fixed, '2026-08-20');
    await db('wage_deductions').insert({
      shift_id: closing.id,
      employee_id: fixed.id,
      original_wage: 800,
      deduction_amount: 100,
      final_wage: 700,
    });
    const dailyPreview = await shiftRecoveryPreview(closing, [], 500, -50, db);
    assert.equal(dailyPreview.proposed, 200);
    await db.transaction((trx) =>
      postShiftRecovery(
        closing,
        [],
        500,
        -50,
        {
          version: dailyPreview.version,
          amount: 200,
          authorization_reference: 'AUTH',
        },
        'Old and current shortage',
        trx,
      ),
    );
    assert.equal(
      (await db('wage_deductions').where({ shift_id: closing.id }).first())
        .deduction_amount,
      300,
      'Existing deduction must be preserved',
    );
    assert.equal((await employeeDebtSummary(fixed.id, db)).outstanding, 150);
    const salary = await employee('Periodic salary', 'monthly', [
      {
        component_type: 'fixed_periodic',
        amount: 62000,
        maximum_amount: 31000,
      },
    ]);
    await db('employees')
      .where({ id: salary.id })
      .update({
        employment_start_date: '2026-08-05',
        employment_end_date: '2026-08-15',
        active: false,
      });
    const salaryPreview = await previewPayrollRun(
      {
        pay_schedule: 'monthly',
        period_start: '2026-08-01',
        period_end: '2026-08-31',
      },
      db,
      '2026-09-01',
    );
    assert.equal(
      salaryPreview.lines.find((l: any) => l.employee_id === salary.id)
        .gross_earnings,
      11000,
    );
    assert.equal(
      salaryPreview.lines.find((l: any) => l.employee_id === salary.id)
        .shift_count,
      0,
    );
    console.log(
      'PASS preserved prior deductions, supplemental shift isolation and salary proration through employment end',
    );

    // Authentication and idempotency are exercised through the real router on a private test database.
    const { default: router } = await import('../src/routes/payroll');
    const { generateToken } = await import('../src/middleware/requireAdmin');
    const { default: shiftsRouter } = await import('../src/routes/shifts');
    const { default: employeesRouter } = await import(
      '../src/routes/employees'
    );
    const { default: creditAccountsRouter } = await import('../src/routes/creditAccounts');
    const app = express();
    app.use(express.json());
    app.use('/payroll', router);
    app.use('/shifts', shiftsRouter);
    app.use('/employees', employeesRouter);
    app.use('/credit-accounts', creditAccountsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const request = (
      url: string,
      token: string,
      method = 'GET',
      body?: any,
      key?: string,
    ) =>
      fetch(`http://127.0.0.1:${port}/payroll${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const token = generateToken(monthly.id, 'attendant');
    assert.equal((await request(`/employees/${daily.id}`, token)).status, 403);
    assert.equal((await request('/runs', token)).status, 403);
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${port}/shifts/${today.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${port}/employees`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
      403,
    );
    const otherAccount = await db('credit_accounts').where({ employee_id: fixed.id, type: 'employee' }).first();
    for (const suffix of ['', '/statement']) {
      const response = await fetch(`http://127.0.0.1:${port}/credit-accounts/${otherAccount.id}${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 403, 'Credit-account detail and printed statement must enforce employee ownership');
    }
    const self = (await (
      await request(`/me?employee_id=${daily.id}`, token)
    ).json()) as any;
    assert.equal(self.data.employee.id, monthly.id);
    assert(
      self.data.runs.every((r: any) =>
        r.lines.every((l: any) => l.employee_id === monthly.id),
      ),
    );
    const [admin] = await db('employees').insert({
      name: 'Test admin',
      daily_wage: 0,
      pin: 'test-only',
      role: 'admin',
      active: true,
    });
    const adminToken = generateToken(admin, 'admin');
    const body = {
      amount: 50,
      date: '2026-09-01',
      payment_method: 'cash',
      reference: 'RETRY',
    };
    const results = await Promise.all([
      request(
        `/employees/${monthly.id}/receipts`,
        adminToken,
        'POST',
        body,
        'test-retry-123',
      ),
      request(
        `/employees/${monthly.id}/receipts`,
        adminToken,
        'POST',
        body,
        'test-retry-123',
      ),
    ]);
    assert(results.every((r) => r.status === 200));
    assert.equal((await employeeDebtSummary(monthly.id, db)).outstanding, 950);
    assert.equal(
      (
        await request(
          `/employees/${monthly.id}/receipts`,
          adminToken,
          'POST',
          { ...body, amount: 51 },
          'test-retry-123',
        )
      ).status,
      409,
    );
    const competing = await Promise.all([
      request(
        `/employees/${monthly.id}/receipts`,
        adminToken,
        'POST',
        { ...body, amount: 600, reference: 'ONE' },
        'competing-one',
      ),
      request(
        `/employees/${monthly.id}/receipts`,
        adminToken,
        'POST',
        { ...body, amount: 600, reference: 'TWO' },
        'competing-two',
      ),
    ]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await employeeDebtSummary(monthly.id, db)).outstanding,
      350,
      'Concurrent distinct receipts cannot over-repay debt',
    );
    assert.equal(
      (await db('credit_payments').where({ amount: 600, status: 'posted' }))
        .length,
      1,
      'Rejected receipt and its allocations roll back together',
    );
    const backup = await verifiedDatabaseBackup(
      db,
      path.join(directory, 'backups'),
    );
    assert(fs.statSync(backup.path).size > 0);
    assert.equal(
      (await db.raw('PRAGMA integrity_check'))[0].integrity_check,
      'ok',
    );
    assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);
    console.log(
      'PASS private My Pay, prohibited cross-employee access, concurrent retry protection, verified backup and database integrity',
    );
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await db.destroy();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
