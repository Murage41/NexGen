// One-off, guarded correction for shifts 103 and 105 (Mutati), where debt
// recovery was recorded via the old wage-withholding mechanism instead of as
// a repayment - corrupting each shift's own variance, and (for shift 105)
// creating a phantom staff debt from the corrupted negative variance.
//
// Restores: wage_paid/direct_wage_cash_amount to the full amount actually
// paid (800 both shifts); reverses the two incorrect wage_deductions +
// shift_staff_debt_allocations rows; re-records both repayments (120, 350)
// as proper staff-debt receipts (credit_payments + staff_debt_receipt_allocations,
// same mechanism "Collect Payment" already uses correctly) with no shift_id
// so they correctly have no effect on either shift's variance; voids the
// phantom debt #20; recomputes both shift_close_reconciliations and the
// employee's credit_accounts mirror.
//
// Everything is one transaction - it either fully applies or fully rolls back.
// Every write is logged with its before/after value. Run with --apply to
// commit; without it, runs the same logic and always rolls back at the end,
// so you can review the printed before/after values first.

import sqlite3 from 'sqlite3';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const dbPath = path.join(__dirname, '..', 'data', 'nexgen.db');

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function main() {
  const db = new sqlite3.Database(dbPath);
  const run = (sql: string, params: any[] = []): Promise<{ changes: number; lastID: number }> =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (this: any, err) {
        if (err) reject(err); else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  const get = (sql: string, params: any[] = []): Promise<any> =>
    new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
  const all = (sql: string, params: any[] = []): Promise<any[]> =>
    new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

  const log: string[] = [];
  const p = (msg: string) => { log.push(msg); console.log(msg); };

  (async () => {
    await run('BEGIN IMMEDIATE');
    try {
      let shift105AdjustmentId: number | null = null;
      for (const shiftId of [103, 105]) {
        p(`\n=== Shift ${shiftId} ===`);

        const shift = await get('SELECT * FROM shifts WHERE id = ?', [shiftId]);
        if (!shift) throw new Error(`Shift ${shiftId} not found`);
        if (shift.status !== 'closed') throw new Error(`Shift ${shiftId} is not closed - aborting`);

        const wd = await get("SELECT * FROM wage_deductions WHERE shift_id = ? AND deleted_at IS NULL AND reason LIKE 'Debt recovery:%'", [shiftId]);
        if (!wd) throw new Error(`Shift ${shiftId}: expected wage_deductions row not found - aborting`);
        p(`Found wage_deduction #${wd.id}: original_wage=${wd.original_wage}, deduction_amount=${wd.deduction_amount}, final_wage=${wd.final_wage}`);

        const alloc = await get('SELECT * FROM shift_staff_debt_allocations WHERE shift_id = ? AND wage_deduction_id = ? AND reversed_at IS NULL', [shiftId, wd.id]);
        if (!alloc) throw new Error(`Shift ${shiftId}: expected shift_staff_debt_allocations row not found - aborting`);
        p(`Found allocation #${alloc.id}: staff_debt_id=${alloc.staff_debt_id}, amount=${alloc.amount}`);

        const debt = await get('SELECT * FROM staff_debts WHERE id = ?', [alloc.staff_debt_id]);
        p(`Debt #${debt.id} current balance: ${debt.balance} (before reversal)`);

        // 1. Reverse the allocation and restore the debt balance it reduced.
        const reverseAllocResult = await run('UPDATE shift_staff_debt_allocations SET reversed_at = ? WHERE id = ? AND reversed_at IS NULL', [new Date().toISOString(), alloc.id]);
        if (reverseAllocResult.changes !== 1) throw new Error(`Shift ${shiftId}: failed to reverse allocation #${alloc.id}`);
        const restoredBalance = round2(Number(debt.balance) + Number(alloc.amount));
        const restoreResult = await run('UPDATE staff_debts SET balance = ?, status = ? WHERE id = ? AND balance = ?', [restoredBalance, 'outstanding', debt.id, debt.balance]);
        if (restoreResult.changes !== 1) throw new Error(`Shift ${shiftId}: compare-and-swap failed restoring debt #${debt.id} balance (concurrent change?)`);
        p(`Reversed allocation #${alloc.id}; debt #${debt.id} balance restored ${debt.balance} -> ${restoredBalance}`);

        // 2. Soft-delete the wage_deduction row (it represented an incorrect withholding).
        const wdResult = await run('UPDATE wage_deductions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [new Date().toISOString(), wd.id]);
        if (wdResult.changes !== 1) throw new Error(`Shift ${shiftId}: failed to soft-delete wage_deduction #${wd.id}`);
        p(`Soft-deleted wage_deduction #${wd.id}`);

        // 3. Restore the shift's wage fields to the full amount actually paid.
        const fullWage = wd.original_wage;
        const shiftUpdateResult = await run('UPDATE shifts SET wage_paid = ?, direct_wage_cash_amount = ? WHERE id = ?', [fullWage, fullWage, shiftId]);
        if (shiftUpdateResult.changes !== 1) throw new Error(`Shift ${shiftId}: failed to restore wage_paid`);
        p(`shifts.wage_paid / direct_wage_cash_amount restored: ${shift.wage_paid} -> ${fullWage}`);

        // 4. Re-record the repayment via the correct mechanism (no shift_id -
        //    see shiftSettlement.ts for why - this must never affect variance).
        const account = await get("SELECT * FROM credit_accounts WHERE employee_id = ? AND type = 'employee'", [shift.employee_id]);
        if (!account) throw new Error(`Shift ${shiftId}: no employee credit_account found for employee ${shift.employee_id}`);
        const insertPayment = await run(
          `INSERT INTO credit_payments (account_id, credit_id, amount, payment_method, payment_type, date, notes, status, created_by_employee_id)
           VALUES (?, NULL, ?, 'cash', 'staff_debt', ?, ?, 'posted', NULL)`,
          [account.id, wd.deduction_amount, shift.shift_date, `Shift #${shiftId} close recovery (corrected 2026-09-10, was incorrectly recorded as wage withholding)`],
        );
        const paymentId = insertPayment.lastID;
        p(`Inserted credit_payments #${paymentId}: amount=${wd.deduction_amount}, payment_type=staff_debt, no shift_id`);

        // 5. Allocate the receipt against the (now-restored) oldest eligible
        //    debt, FIFO, mirroring allocateEmployeeDebt's own logic exactly.
        let remaining = Number(wd.deduction_amount);
        const eligible = await all("SELECT * FROM staff_debts WHERE employee_id = ? AND status = 'outstanding' AND balance > 0 AND recovery_status = 'confirmed' ORDER BY created_at ASC", [shift.employee_id]);
        for (const d of eligible) {
          if (remaining <= 0) break;
          const applied = round2(Math.min(remaining, Number(d.balance)));
          const newBalance = round2(Number(d.balance) - applied);
          const allocResult = await run('UPDATE staff_debts SET balance = ?, status = ? WHERE id = ? AND balance = ?', [newBalance, newBalance === 0 ? 'cleared' : 'outstanding', d.id, d.balance]);
          if (allocResult.changes !== 1) throw new Error(`Shift ${shiftId}: compare-and-swap failed allocating against debt #${d.id}`);
          await run('INSERT INTO staff_debt_receipt_allocations (payment_id, staff_debt_id, amount) VALUES (?, ?, ?)', [paymentId, d.id, applied]);
          p(`Allocated ${applied} against debt #${d.id}: balance ${d.balance} -> ${newBalance}`);
          remaining = round2(remaining - applied);
        }
        if (remaining > 0.005) throw new Error(`Shift ${shiftId}: ${remaining} could not be allocated - not enough outstanding debt found. Aborting.`);

        // 6. Recompute this shift's close_reconciliation with the corrected wage.
        const recon = await get('SELECT * FROM shift_close_reconciliations WHERE shift_id = ?', [shiftId]);
        const newTotalAccounted = round2(Number(recon.total_accounted) + (fullWage - Number(wd.final_wage)));
        const newVariance = round2(newTotalAccounted - Number(recon.expected_shift_total));
        const reconResult = await run(
          `UPDATE shift_close_reconciliations SET direct_wage_payment = ?, total_accounted = ?, variance = ?, variance_type = ? WHERE shift_id = ?`,
          [fullWage, newTotalAccounted, newVariance, newVariance > 0.005 ? 'surplus' : newVariance < -0.005 ? 'deficit' : 'balanced', shiftId],
        );
        if (reconResult.changes !== 1) throw new Error(`Shift ${shiftId}: failed to update shift_close_reconciliations`);
        p(`shift_close_reconciliations: total_accounted ${recon.total_accounted} -> ${newTotalAccounted}, variance ${recon.variance} -> ${newVariance}`);

        // 7. Audit trail for the correction itself.
        const adjInsert = await run(
          `INSERT INTO shift_accountability_adjustments (shift_id, adjustment_type, reference_id, amount_delta, variance_before, variance_after, reason, created_by_employee_id)
           VALUES (?, 'recovery_mechanism_correction', ?, ?, ?, ?, ?, NULL)`,
          [shiftId, wd.id, round2(newVariance - Number(recon.variance)), recon.variance, newVariance,
            `Corrected 2026-09-10: recovery of KES ${wd.deduction_amount} was recorded as wage withholding (wage_paid ${wd.final_wage} instead of ${fullWage}), which silently subtracted the repayment from this shift's own variance a second time. Restored full wage and re-recorded the repayment as a proper staff-debt receipt (credit_payments #${paymentId}) with zero effect on variance. See production-readiness session 2026-09-10.`],
        );
        p(`Logged shift_accountability_adjustments #${adjInsert.lastID} for shift ${shiftId}`);
        if (shiftId === 105) shift105AdjustmentId = adjInsert.lastID;
      }

      // Void the phantom debt created from shift 105's corrupted negative variance.
      const phantom = await get('SELECT * FROM staff_debts WHERE shift_id = 105 AND original_deficit = 338.96');
      if (!phantom) throw new Error('Expected phantom debt from shift 105 not found - aborting');
      p(`\n=== Voiding phantom debt #${phantom.id} (balance ${phantom.balance}) ===`);
      const voidResult = await run("UPDATE staff_debts SET status = 'voided', balance = 0 WHERE id = ? AND balance = ?", [phantom.id, phantom.balance]);
      if (voidResult.changes !== 1) throw new Error(`Failed to void phantom debt #${phantom.id}`);
      if (!shift105AdjustmentId) throw new Error('shift105AdjustmentId not captured - aborting');
      await run(
        `INSERT INTO staff_debt_adjustments (shift_id, staff_debt_id, accountability_adjustment_id, adjustment_type, amount, balance_before, balance_after, status, reason, created_by_employee_id)
         VALUES (105, ?, ?, 'phantom_debt_removal', ?, ?, 0, 'applied', ?, NULL)`,
        [phantom.id, shift105AdjustmentId, -phantom.balance, phantom.balance,
          "This debt never existed - created from shift 105's corrupted negative variance (the same repayment double-counted via the wage-withholding recovery bug). Voided as part of the 2026-09-10 recovery-mechanism correction; see shift_accountability_adjustments for shift 105."],
      );
      p(`Voided debt #${phantom.id}`);

      // Recompute the employee's credit_accounts mirror from the now-corrected staff_debts.
      const outstanding = await get("SELECT COALESCE(SUM(balance), 0) as total FROM staff_debts WHERE employee_id = 4 AND status = 'outstanding'");
      const accountUpdate = await run("UPDATE credit_accounts SET balance = ? WHERE employee_id = 4 AND type = 'employee'", [outstanding.total]);
      p(`\ncredit_accounts (Mutati) balance recomputed to: ${outstanding.total} (${accountUpdate.changes} row updated)`);

      // Final verification: print the full final state of everything touched.
      p('\n=== Final verification ===');
      for (const shiftId of [103, 105]) {
        const recon = await get('SELECT * FROM shift_close_reconciliations WHERE shift_id = ?', [shiftId]);
        p(`Shift ${shiftId}: direct_wage_payment=${recon.direct_wage_payment}, total_accounted=${recon.total_accounted}, variance=${recon.variance} (${recon.variance_type})`);
      }
      const debt18 = await get('SELECT * FROM staff_debts WHERE id = 18');
      p(`Debt #18 final balance: ${debt18.balance}`);
      const allDebts = await all('SELECT id, status, balance FROM staff_debts WHERE employee_id = 4 ORDER BY id');
      p(`All Mutati debts: ${JSON.stringify(allDebts)}`);

      const integrity = await get('PRAGMA integrity_check');
      p(`integrity_check: ${JSON.stringify(integrity)}`);
      const fkCheck = await all('PRAGMA foreign_key_check');
      p(`foreign_key_check: ${fkCheck.length === 0 ? 'clean' : JSON.stringify(fkCheck)}`);

      if (APPLY) {
        await run('COMMIT');
        p('\n*** APPLIED AND COMMITTED ***');
      } else {
        await run('ROLLBACK');
        p('\n*** DRY RUN - rolled back, nothing was committed. Re-run with --apply to commit. ***');
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
