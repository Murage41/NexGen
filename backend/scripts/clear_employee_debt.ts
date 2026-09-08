import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import { getDataDirectory } from '../src/utils/dataDirectory';
import { verifiedDatabaseBackup } from '../src/services/databaseBackup';
import { clearRecordedEmployeeDebt } from '../src/services/clearRecordedEmployeeDebt';
import type { DebtClearance } from '../src/services/clearRecordedEmployeeDebt';

async function main() {
  const args = process.argv.slice(2);
  const arg = (key: string) => { const index = args.indexOf(key); return index < 0 ? '' : args[index + 1] || ''; };
  const input = {
    employeeId: Number(arg('--employee')),
    expectedDebts: arg('--expected-debts').split(',').filter(Boolean).map(pair => {
      const values = pair.split(':');
      if (values.length !== 2) throw new Error('Use --expected-debts id:amount,id:amount');
      return {id: Number(values[0]), balance: Number(values[1])};
    }),
    reason: arg('--reason'),
  };
  await runEmployeeDebtClearance(input, {database: arg('--database'), apply: args.includes('--apply')});
}

export async function runEmployeeDebtClearance(input: DebtClearance, options: {database?: string; apply?: boolean} = {}) {
  const filename = path.resolve(options.database || path.join(getDataDirectory(), 'nexgen.db'));
  if (!fs.existsSync(filename)) throw new Error(`Database not found: ${filename}`);
  const db = knex({client: 'sqlite3', connection: {filename}, useNullAsDefault: true, pool: {min: 1, max: 1}});
  try {
    await db.raw('PRAGMA busy_timeout = 5000');
    await db.raw('PRAGMA foreign_keys = ON');
    const preview = await clearRecordedEmployeeDebt(db, input);
    console.log(JSON.stringify({database: filename, ...preview}, null, 2));
    if (!options.apply || preview.status === 'already_cleared') return;
    const directory = path.join(path.dirname(filename), 'backups');
    const backup = await verifiedDatabaseBackup(db, directory);
    const auditPath = path.join(directory, `employee-debt-clearance-${randomUUID()}.json`);
    const audit = {database: filename, backup, input, before: preview, status: 'prepared', prepared_at: new Date().toISOString()};
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), {flag: 'wx'});
    console.log(JSON.stringify({verifiedBackup: backup.path, auditFile: auditPath}));
    const result = await clearRecordedEmployeeDebt(db, input, true);
    try { fs.writeFileSync(auditPath, JSON.stringify({...audit, status: 'applied', result, completed_at: new Date().toISOString()}, null, 2)); }
    catch (error) {
      console.error('Clearance completed, but the final audit file could not be updated. The prepared audit and backup remain. Do not restore over newer data.');
      throw error;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { await db.destroy(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
