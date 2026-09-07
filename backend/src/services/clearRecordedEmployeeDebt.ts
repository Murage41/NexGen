import type { Knex } from 'knex';
import { createHash } from 'node:crypto';

export interface DebtClearance {
  employeeId: number;
  expectedDebts: {id: number; balance: number}[];
  reason: string;
}
const cents = (value: any) => Math.round(Number(value) * 100);
function requireCondition(value: any, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function inventory(db: Knex.Transaction) {
  const tables = await db('sqlite_master').where({type: 'table'}).whereNot('name', 'like', 'sqlite_%').orderBy('name');
  const rows: Record<string, any[]> = {};
  for (const {name} of tables) rows[name] = await db(name);
  return rows;
}
function hash(rows: any[]) {
  const normalized = rows.map(row => JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]]))).sort();
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

// Administrative clearance of an already-settled historical balance. This does not
// post a receipt, alter payroll or recompute any shift's reconciliation.
export async function clearRecordedEmployeeDebt(db: Knex, input: DebtClearance, apply = false) {
  requireCondition(Number.isInteger(input.employeeId) && input.employeeId > 0, 'Invalid employee ID.');
  requireCondition(input.reason.trim().length >= 20, 'A detailed reason is required.');
  requireCondition(input.expectedDebts.length > 0 && new Set(input.expectedDebts.map(d => d.id)).size === input.expectedDebts.length, 'Expected debt IDs must be nonempty and unique.');
  requireCondition(input.expectedDebts.every(d => Number.isInteger(d.id) && d.id > 0 && Number.isFinite(d.balance) && d.balance > 0 && Math.abs(cents(d.balance) / 100 - d.balance) < 0.000001), 'Invalid expected debt amounts.');
  return db.transaction(async trx => {
    const integrity = await trx.raw('PRAGMA integrity_check');
    requireCondition(integrity.length === 1 && integrity[0].integrity_check === 'ok', 'Database integrity check failed.');
    requireCondition((await trx.raw('PRAGMA foreign_key_check')).length === 0, 'Foreign-key check failed.');
    const employee = await trx('employees').where({id: input.employeeId}).select('id', 'name').first();
    requireCondition(employee, 'Employee not found.');
    const debts = await trx('staff_debts').where({employee_id: input.employeeId}).orderBy('id');
    const expectedIds = new Set(input.expectedDebts.map(d => d.id));
    const selected = debts.filter(d => expectedIds.has(d.id));
    requireCondition(selected.length === expectedIds.size, 'Expected debts do not all belong to this employee.');
    requireCondition(!debts.some(d => !expectedIds.has(d.id) && cents(d.balance) !== 0), 'Additional debt exists. Stop and review a fresh backup.');
    const accounts = await trx('credit_accounts').where({employee_id: input.employeeId, type: 'employee'});
    requireCondition(accounts.length === 1 && !accounts[0].deleted_at, 'Expected one active employee debt account.');
    const account = accounts[0];
    if (selected.every(d => cents(d.balance) === 0 && d.status === 'cleared')) {
      requireCondition(cents(account.balance) === 0, 'Debts are cleared but the account differs. Review before changing anything.');
      return {status: 'already_cleared', employee, changed: false};
    }
    for (const expected of input.expectedDebts) {
      const actual = selected.find(d => d.id === expected.id);
      requireCondition(actual?.status === 'outstanding' && cents(actual.balance) === cents(expected.balance), `Debt #${expected.id} changed. No clearance applied.`);
    }
    const totalCents = selected.reduce((s, d) => s + cents(d.balance), 0);
    requireCondition(cents(account.balance) === totalCents, 'Account and debt balances disagree.');
    const result = {status: apply ? 'cleared' : 'preview_only', employee, amount: totalCents / 100, debtsBefore: selected, accountBefore: account, reason: input.reason, payrollAndReconciliationUnchanged: true};
    if (!apply) return result;
    const before = await inventory(trx);
    await trx('staff_debts').where({employee_id: input.employeeId}).whereIn('id', [...expectedIds]).update({status: 'cleared', balance: 0});
    await trx('credit_accounts').where({id: account.id}).update({balance: 0});
    const reviewIds: number[] = [];
    if (await trx.schema.hasTable('staff_debt_reviews')) {
      for (const debt of selected) {
        const [id] = await trx('staff_debt_reviews').insert({staff_debt_id: debt.id, status: debt.recovery_status || 'confirmed', reason: `Administrative clearance of KES ${Number(debt.balance).toFixed(2)} to zero. ${input.reason} No new cash receipt or payroll deduction posted.`, actor_id: null});
        reviewIds.push(id);
      }
    }
    const after = await inventory(trx);
    for (const table of Object.keys(before)) {
      const unrelated = (rows: any[]) => rows.filter(row => {
        if (table === 'staff_debts') return !expectedIds.has(row.id);
        if (table === 'credit_accounts') return row.id !== account.id;
        if (table === 'staff_debt_reviews') return !reviewIds.includes(row.id);
        return true;
      });
      requireCondition(hash(unrelated(before[table])) === hash(unrelated(after[table])), `Unexpected change outside debt clearance: ${table}`);
    }
    for (const old of selected) {
      const actual = after.staff_debts.find(d => d.id === old.id);
      requireCondition(hash([actual]) === hash([{...old, balance: 0, status: 'cleared'}]), 'Unexpected debt field change.');
    }
    requireCondition(hash([after.credit_accounts.find(a => a.id === account.id)]) === hash([{...account, balance: 0}]), 'Unexpected account field change.');
    requireCondition((await trx.raw('PRAGMA foreign_key_check')).length === 0, 'Post-clearance reference check failed.');
    return {...result, debtBalanceAfter: 0, reviewIds, unrelatedRowsVerified: true};
  });
}
