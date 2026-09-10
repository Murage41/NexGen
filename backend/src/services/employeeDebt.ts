import type { Knex } from 'knex';
import { createHash } from 'crypto';
import Decimal from 'decimal.js-light';

export type Connection = Knex | Knex.Transaction;
export const money = (value: any) =>
  new Decimal(value || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
export function settlementError(message: string, status = 409) {
  return Object.assign(new Error(message), {
    httpStatus: status,
    http: status,
  });
}
export function positiveMoney(value: any, allowZero = false) {
  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    (!allowZero && amount === 0) ||
    money(amount) !== amount
  ) {
    throw settlementError(
      'Enter a valid amount with no more than two decimal places.',
      400,
    );
  }
  return amount;
}

export async function employeeDebtSummary(employeeId: number, db: Connection) {
  const debts = await db('staff_debts')
    .where({ employee_id: employeeId })
    .orderBy('created_at')
    .orderBy('id');
  const eligible = debts.filter(
    (d) =>
      d.status === 'outstanding' &&
      (d.recovery_status || 'confirmed') === 'confirmed' &&
      money(d.balance) > 0,
  );
  return {
    debts,
    outstanding: money(debts.reduce((s, d) => s + Number(d.balance || 0), 0)),
    recoverable: money(
      eligible.reduce((s, d) => s + Number(d.balance || 0), 0),
    ),
    eligible,
  };
}

export async function syncEmployeeDebt(employeeId: number, db: Connection) {
  const { outstanding } = await employeeDebtSummary(employeeId, db);
  const account = await db('credit_accounts')
    .where({ employee_id: employeeId, type: 'employee' })
    .first();
  if (account)
    await db('credit_accounts')
      .where({ id: account.id })
      .update({ balance: outstanding });
  else if (outstanding > 0) {
    const employee = await db('employees').where({ id: employeeId }).first();
    await db('credit_accounts').insert({
      employee_id: employeeId,
      type: 'employee',
      name: employee.name,
      balance: outstanding,
    });
  }
  return outstanding;
}

export async function recoveryPreview(
  employeeId: number,
  available: number,
  db: Connection,
  context: unknown = null,
) {
  const summary = await employeeDebtSummary(employeeId, db);
  const employee = await db('employees').where({ id: employeeId }).first();
  const limit = Number(employee?.recovery_limit_percent ?? 100);
  const capacity = money((Math.max(0, available) * limit) / 100);
  const proposed = money(Math.min(summary.recoverable, capacity));
  const version = createHash('sha256')
    .update(
      JSON.stringify({
        debts: summary.debts.map((d) => [
          d.id,
          money(d.balance),
          d.status,
          d.recovery_status,
        ]),
        available: money(available),
        limit,
        context,
      }),
    )
    .digest('hex');
  let remaining = proposed;
  return {
    ...summary,
    available: money(Math.max(0, available)),
    limit_percent: limit,
    proposed,
    version,
    allocations: summary.eligible
      .map((d) => {
        const amount = money(Math.min(remaining, Number(d.balance)));
        remaining = money(remaining - amount);
        return {
          staff_debt_id: d.id,
          shift_id: d.shift_id,
          amount,
          balance_after: money(d.balance - amount),
        };
      })
      .filter((a) => a.amount > 0),
  };
}

export function validateRecoveryDecision(preview: any, decision: any) {
  if (!decision || decision.version !== preview.version)
    throw settlementError(
      'Debt or available pay changed. Refresh and review recovery again.',
    );
  const amount = positiveMoney(decision.amount, true);
  if (amount > preview.proposed)
    throw settlementError(
      `Recovery cannot exceed KES ${preview.proposed.toFixed(2)}.`,
    );
  if (amount > 0 && !String(decision.authorization_reference || '').trim())
    throw settlementError(
      'Enter an authorization reference for this recovery.',
      400,
    );
  if (
    amount < preview.proposed &&
    String(decision.reason || '').trim().length < 3
  )
    throw settlementError(
      'Enter a reason for reducing or deferring recovery.',
      400,
    );
  return amount;
}

export async function allocateEmployeeDebt(
  employeeId: number,
  amount: number,
  source: {
    table:
      | 'payroll_debt_allocations'
      | 'shift_staff_debt_allocations'
      | 'staff_debt_receipt_allocations';
    fields: Record<string, any>;
  },
  db: Knex.Transaction,
) {
  const summary = await employeeDebtSummary(employeeId, db);
  let remaining = positiveMoney(amount);
  if (remaining > summary.recoverable)
    throw settlementError(
      'Recovery exceeds confirmed outstanding debt. Refresh and review again.',
    );
  for (const debt of summary.eligible) {
    if (remaining <= 0) break;
    const applied = money(Math.min(remaining, Number(debt.balance)));
    const balance = money(Number(debt.balance) - applied);
    // Compare-and-swap on the balance just read: a concurrent allocation (e.g. a
    // double-clicked payroll approve/void, or a shift-close recovery racing a
    // payroll recovery for the same employee) that already moved this row makes
    // the update affect 0 rows instead of silently double-deducting/restoring.
    const updated = await db('staff_debts')
      .where({ id: debt.id, balance: debt.balance })
      .update({ balance, status: balance === 0 ? 'cleared' : 'outstanding' });
    if (updated !== 1) {
      throw settlementError(
        'This debt was changed by another operation. Refresh and try again.',
      );
    }
    await db(source.table).insert({
      ...source.fields,
      staff_debt_id: debt.id,
      amount: applied,
    });
    remaining = money(remaining - applied);
  }
  await syncEmployeeDebt(employeeId, db);
}

export async function reverseDebtAllocations(
  table: string,
  where: Record<string, any>,
  db: Knex.Transaction,
) {
  const rows = await db(table).where(where).whereNull('reversed_at');
  const employees = new Set<number>();
  for (const row of rows) {
    const debt = await db('staff_debts')
      .where({ id: row.staff_debt_id })
      .first();
    if (!debt)
      throw settlementError(
        'The original debt is missing; reversal cannot proceed.',
      );
    await db('staff_debts')
      .where({ id: debt.id })
      .update({
        balance: money(Number(debt.balance) + Number(row.amount)),
        status: 'outstanding',
      });
    await db(table).where({ id: row.id }).update({ reversed_at: db.fn.now() });
    employees.add(Number(debt.employee_id));
  }
  for (const id of employees) await syncEmployeeDebt(id, db);
}
