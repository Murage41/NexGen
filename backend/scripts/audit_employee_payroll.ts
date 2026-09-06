import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import knex, { Knex } from 'knex';
import { money } from '../src/services/employeeDebt';

async function audit(db: Knex.Transaction) {
  const integrity = await db.raw('PRAGMA integrity_check');
  const foreignKeys = await db.raw('PRAGMA foreign_key_check');
  const employees = await db('employees').select('id', 'name');
  const lines = await db('payroll_lines as l')
    .join('payroll_runs as r', 'l.run_id', 'r.id')
    .select('l.*', 'r.status as run_status');
  const payments = await db('payroll_payments');
  const deductions = await db('payroll_deductions');
  const debts = await db('staff_debts');
  const accounts = await db('credit_accounts').where({ type: 'employee' });
  const shifts = await db('shifts');
  const warnings: any[] = [];
  for (const payment of payments.filter(
    (p) => p.status === 'posted' && /^SHIFT-WAGE:/.test(p.reference || ''),
  )) {
    const shift = shifts.find((s) => s.id === payment.shift_id);
    const deduction = await db('wage_deductions')
      .where({ shift_id: payment.shift_id })
      .whereNull('deleted_at')
      .first();
    const supported =
      shift?.direct_wage_cash_amount ??
      Math.max(
        0,
        Number(shift?.wage_paid || 0) -
          Number(deduction?.deduction_amount || 0),
      );
    if (!shift || money(supported) !== money(payment.amount))
      warnings.push({
        kind: 'shift_payment_mismatch',
        payment_id: payment.id,
        shift_id: payment.shift_id,
        employee_id: payment.employee_id,
        imported: payment.amount,
        recorded_cash: money(supported),
      });
  }
  const totals = employees.map((employee) => {
    const employeeLines = lines.filter(
      (l) => l.employee_id === employee.id && l.run_status !== 'void',
    );
    const debt = money(
      debts
        .filter((d) => d.employee_id === employee.id)
        .reduce((s, d) => s + Number(d.balance), 0),
    );
    const accountBalance = money(
      accounts
        .filter((a) => a.employee_id === employee.id)
        .reduce((s, a) => s + Number(a.balance), 0),
    );
    if (debt !== accountBalance)
      warnings.push({
        kind: 'debt_account_mismatch',
        employee_id: employee.id,
        debt,
        account_balance: accountBalance,
      });
    const sum = (field: string) =>
      money(employeeLines.reduce((s, l) => s + Number(l[field] || 0), 0));
    return {
      ...employee,
      gross: sum('gross_earnings'),
      deductions: sum('total_deductions'),
      paid: sum('paid_amount'),
      wages_due: sum('balance_due'),
      debt,
      account_balance: accountBalance,
    };
  });
  for (const line of lines.filter((l) => l.run_status !== 'void')) {
    const paid = money(
      payments
        .filter((p) => p.payroll_line_id === line.id && p.status === 'posted')
        .reduce((s, p) => s + Number(p.amount), 0),
    );
    const deducted = money(
      deductions
        .filter((d) => d.payroll_line_id === line.id && d.status !== 'reversed')
        .reduce((s, d) => s + Number(d.amount), 0),
    );
    if (
      paid !== money(line.paid_amount) ||
      deducted !== money(line.total_deductions) ||
      paid + deducted > money(line.gross_earnings)
    )
      warnings.push({
        kind: 'payroll_totals_mismatch',
        line_id: line.id,
        employee_id: line.employee_id,
        paid,
        deducted,
        gross: line.gross_earnings,
      });
  }
  return {
    generated_at: new Date().toISOString(),
    integrity,
    foreign_keys: foreignKeys,
    employees: totals,
    warnings,
    note: 'Read-only inventory. Warnings require source records; this report makes no financial corrections.',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--database');
  if (index < 0 || !args[index + 1])
    throw new Error(
      'Usage: npm run audit:employee-payroll -- --database <verified-snapshot.db>',
    );
  const filename = path.resolve(args[index + 1]);
  if (!fs.existsSync(filename))
    throw new Error(`Database does not exist: ${filename}`);
  const db = knex({
    client: 'sqlite3',
    connection: { filename },
    useNullAsDefault: true,
  });
  // Knex's SQLite flags are additive to READWRITE; explicitly open the audit connection read-only.
  db.client.acquireRawConnection = () =>
    new Promise<sqlite3.Database>((resolve, reject) => {
      const connection = new sqlite3.Database(
        filename,
        sqlite3.OPEN_READONLY,
        (error) => (error ? reject(error) : resolve(connection)),
      );
    });
  try {
    await db.raw('PRAGMA query_only = ON');
    const report = await db.transaction(audit);
    console.log(JSON.stringify({ database: filename, ...report }, null, 2));
    if (
      report.integrity.length !== 1 ||
      report.integrity[0].integrity_check !== 'ok' ||
      report.foreign_keys.length
    )
      process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
