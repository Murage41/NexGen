import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearRecordedEmployeeDebt } from '../src/services/clearRecordedEmployeeDebt';

async function main() {
  process.env.NEXGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-clearance-test-'));
  const {default: db} = await import('../src/database');
  try {
    await db.migrate.latest();
    const [person] = await db('employees').insert({name: 'Clearance test', pin: 'test', role: 'attendant', daily_wage: 800, active: true});
    const [other] = await db('employees').insert({name: 'Unrelated employee', pin: 'test', role: 'attendant', daily_wage: 800, active: true});
    const [shift] = await db('shifts').insert({employee_id: person, shift_date: '2026-08-01', start_time: '2026-08-01T06:00:00Z', status: 'closed', wage_paid: 800});
    await db('shift_collections').insert({shift_id: shift, cash_amount: 10000, mpesa_amount: 5000, credits_amount: 0, total_collected: 15000});
    const balances = [1.26, 428.56, 40.31, 74.47, 4196.92];
    const expectedDebts = [];
    for (const balance of balances) {
      const [id] = await db('staff_debts').insert({employee_id: person, shift_id: shift, original_deficit: balance, carried_forward: balance, deducted_from_wage: 0, balance, status: 'outstanding'});
      expectedDebts.push({id, balance});
    }
    await db('credit_accounts').insert({employee_id: person, type: 'employee', name: 'Clearance test', balance: 4741.52});
    const [otherAccount] = await db('credit_accounts').insert({employee_id: other, type: 'employee', name: 'Unrelated employee', balance: 123});
    const plan = {employeeId: person, expectedDebts, reason: 'Owner confirmed historical settlement outside this database; clear balance only.'};
    const preview = await clearRecordedEmployeeDebt(db, plan);
    assert.equal(preview.status, 'preview_only');
    assert.equal((await db('staff_debts').where({id: expectedDebts[0].id}).first()).balance, 1.26);
    await assert.rejects(clearRecordedEmployeeDebt(db, {...plan, expectedDebts: expectedDebts.map((d, i) => i ? d : {...d, balance: 2})}, true), /changed/);
    const [newDebt] = await db('staff_debts').insert({employee_id: person, shift_id: shift, original_deficit: 2, carried_forward: 2, balance: 2, status: 'outstanding'});
    await assert.rejects(clearRecordedEmployeeDebt(db, plan, true), /Additional debt/);
    await db('staff_debts').where({id: newDebt}).delete();
    // Force a failure after debt updates and prove the transaction restores them.
    await db.raw("CREATE TRIGGER fail_clearance BEFORE UPDATE ON credit_accounts BEGIN SELECT RAISE(ABORT, 'forced rollback'); END");
    await assert.rejects(clearRecordedEmployeeDebt(db, plan, true), /forced rollback/);
    assert.equal((await db('staff_debts').where({id: expectedDebts[0].id}).first()).balance, 1.26);
    await db.raw('DROP TRIGGER fail_clearance');
    const result = await clearRecordedEmployeeDebt(db, plan, true);
    assert.equal(result.status, 'cleared');
    assert.equal((await db('credit_accounts').where({employee_id: person}).first()).balance, 0);
    assert.equal((await db('credit_accounts').where({id: otherAccount}).first()).balance, 123);
    assert.equal((await db('shift_collections').where({shift_id: shift}).first()).cash_amount, 10000);
    assert.equal((await db('shifts').where({id: shift}).first()).wage_paid, 800);
    assert.equal((await db('credit_payments')).length, 0);
    assert.equal((await db('payroll_payments')).length, 0);
    assert.equal((await db('staff_debt_reviews')).length, 5);
    assert.equal((await clearRecordedEmployeeDebt(db, plan, true)).status, 'already_cleared');
    assert.equal((await db('staff_debt_reviews')).length, 5);
    console.log('PASS: preview, stale debt refusal, new-debt refusal, rollback, exact clearance, unrelated-row preservation and repeat safety.');
  } finally { await db.destroy(); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
