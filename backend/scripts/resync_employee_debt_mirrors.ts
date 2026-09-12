// Recomputes every employee's credit_accounts.balance from staff_debts.
//
// credit_accounts.balance for an employee is a cache of
//   SUM(staff_debts.balance) WHERE status = 'outstanding'
// It drifts if any code path writes staff_debts without re-syncing afterwards.
// One such path existed between 2026-09-10 and 2026-09-12: a shift close wrote
// the shift's own shortfall AFTER the sync ran, leaving every affected
// employee's Credits page short by exactly that shortfall while the Employees
// page (which computes live) stayed correct. The ordering is fixed in
// services/shiftSettlement.ts; this script repairs balances written before that.
//
// Safe to run at any time: it only rewrites a derived cache, never a record of
// fact, so it needs no audit trail and is idempotent. Run with --apply to
// commit; without it, prints what would change and rolls back.

import sqlite3 from 'sqlite3';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const dbPath = path.join(__dirname, '..', 'data', 'nexgen.db');

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function main() {
  const db = new sqlite3.Database(dbPath);
  const run = (sql: string, params: any[] = []): Promise<{ changes: number }> =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (this: any, err) {
        if (err) reject(err); else resolve({ changes: this.changes });
      });
    });
  const all = (sql: string, params: any[] = []): Promise<any[]> =>
    new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

  (async () => {
    await run('BEGIN IMMEDIATE');
    try {
      const accounts = await all(
        `SELECT ca.id, ca.employee_id, ca.name, ca.balance,
                (SELECT COALESCE(SUM(balance), 0) FROM staff_debts
                  WHERE employee_id = ca.employee_id AND status = 'outstanding') AS truth
           FROM credit_accounts ca
          WHERE ca.type = 'employee' AND ca.deleted_at IS NULL
          ORDER BY ca.id`,
      );

      let drifted = 0;
      for (const account of accounts) {
        const stored = round2(Number(account.balance || 0));
        const truth = round2(Number(account.truth || 0));
        if (stored === truth) {
          console.log(`  ok      ${account.name}: ${stored}`);
          continue;
        }
        drifted += 1;
        console.log(`  DRIFT   ${account.name}: stored ${stored} -> ${truth} (${round2(truth - stored) >= 0 ? '+' : ''}${round2(truth - stored)})`);
        const updated = await run('UPDATE credit_accounts SET balance = ? WHERE id = ? AND balance = ?', [truth, account.id, account.balance]);
        if (updated.changes !== 1) throw new Error(`Failed to update account #${account.id} (changed concurrently?)`);
      }

      // Employees carrying debt with no mirror account at all.
      const missing = await all(
        `SELECT sd.employee_id, e.name, ROUND(SUM(sd.balance), 2) AS truth
           FROM staff_debts sd JOIN employees e ON e.id = sd.employee_id
          WHERE sd.status = 'outstanding'
            AND NOT EXISTS (SELECT 1 FROM credit_accounts ca
                             WHERE ca.employee_id = sd.employee_id AND ca.type = 'employee' AND ca.deleted_at IS NULL)
          GROUP BY sd.employee_id, e.name HAVING SUM(sd.balance) > 0`,
      );
      for (const row of missing) {
        drifted += 1;
        console.log(`  MISSING ${row.name}: creating mirror account at ${row.truth}`);
        await run(
          `INSERT INTO credit_accounts (employee_id, type, name, balance) VALUES (?, 'employee', ?, ?)`,
          [row.employee_id, row.name, row.truth],
        );
      }

      console.log(`\n${drifted === 0 ? 'No drift found.' : `${drifted} account(s) corrected.`}`);

      if (APPLY) {
        await run('COMMIT');
        console.log('*** APPLIED AND COMMITTED ***');
      } else {
        await run('ROLLBACK');
        console.log('*** DRY RUN - rolled back. Re-run with --apply to commit. ***');
      }
    } catch (err: any) {
      await run('ROLLBACK').catch(() => {});
      console.error('\n*** FAILED, ROLLED BACK ***', err.message);
      process.exitCode = 1;
    } finally {
      db.close();
    }
  })();
}

main();
