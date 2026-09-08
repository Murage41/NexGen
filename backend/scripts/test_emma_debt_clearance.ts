import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-emma-clearance-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  const {default: db} = await import('../src/database');
  try {
    await db.migrate.latest();
    await db('employees').insert({id: 3, name: 'Ema Kasyoka', role: 'attendant', pin: 'test', active: true});
    await db('credit_accounts').insert({id: 13, employee_id: 3, type: 'employee', name: 'Ema Kasyoka', balance: 4741.52});
    for (const [id, shiftId, balance] of [[11,78,1.26],[12,81,428.56],[13,86,40.31],[15,88,74.47],[17,92,4196.92]]) {
      await db('shifts').insert({id: shiftId, employee_id: 3, shift_date: '2026-08-01', start_time: '2026-08-01T06:00:00Z', status: 'closed', wage_paid: 0});
      await db('staff_debts').insert({id, employee_id: 3, shift_id: shiftId, original_deficit: balance, carried_forward: balance, balance, status: 'outstanding'});
    }
    function run(args: string[], status = 0) {
      const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), path.join(__dirname, 'clear_emma_debt.ts'), ...args], {encoding: 'utf8', env: process.env, timeout: 30000});
      assert.equal(result.status, status, result.stderr + result.stdout);
      return result.stdout + result.stderr;
    }
    assert.match(run([]), /preview_only/);
    assert.equal(Number((await db('credit_accounts').where({id: 13}).first()).balance), 4741.52);
    await db('employees').where({id: 3}).update({name: 'Different employee'});
    assert.match(run(['--apply'], 1), /identity differs/);
    await db('employees').where({id: 3}).update({name: 'Ema Kasyoka'});
    await db('staff_debts').where({id: 11}).update({shift_id: 81});
    assert.match(run(['--apply'], 1), /different shift/);
    await db('staff_debts').where({id: 11}).update({shift_id: 78});
    await db('staff_debts').insert({id: 18, employee_id: 3, shift_id: 92, original_deficit: 20, carried_forward: 20, balance: 20, status: 'outstanding'});
    assert.match(run(['--apply'], 1), /Additional debt/);
    await db('staff_debts').where({id: 18}).delete();
    const shiftsBefore = await db('shifts').orderBy('id');
    assert.match(run(['--apply']), /"unrelatedRowsVerified": true/);
    assert.equal(Number((await db('credit_accounts').where({id: 13}).first()).balance), 0);
    assert.ok((await db('staff_debts')).every(row => row.balance === 0 && row.status === 'cleared'));
    assert.deepEqual(await db('shifts').orderBy('id'), shiftsBefore);
    const files = fs.readdirSync(path.join(directory, 'backups'));
    const audit = JSON.parse(fs.readFileSync(path.join(directory, 'backups', files.find(f => f.endsWith('.json'))!), 'utf8'));
    assert.equal(audit.status, 'applied');
    assert.equal(audit.result.amount, 4741.52);
    assert.ok(fs.existsSync(audit.backup.path));
    assert.match(run(['--apply']), /already_cleared/);
    assert.deepEqual(fs.readdirSync(path.join(directory, 'backups')), files);
    console.log('PASS: Emma command preview, identity/shift/new-debt guards, backup, audited clearance, unchanged shifts and safe repeat.');
  } finally {await db.destroy();}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
