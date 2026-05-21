import fs from 'fs';
import path from 'path';
import knex, { Knex } from 'knex';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const keepPumpInitials = args.has('--keep-pump-initials');

const cwd = process.cwd();
const backendRoot = fs.existsSync(path.join(cwd, 'src', 'knexfile.ts'))
  ? cwd
  : path.join(cwd, 'backend');
const dbPath = path.join(backendRoot, 'data', 'nexgen.db');
const backupDir = path.join(backendRoot, 'data', 'backups', 'fresh-start');

const tablesToClear = [
  'supplier_payment_allocations',
  'supplier_payments',
  'supplier_invoices',
  'invoice_payment_allocations',
  'invoice_payments',
  'invoice_lines',
  'customer_invoices',
  'invoice_consumption',
  'credit_payments',
  'credits',
  'staff_debts',
  'wage_deductions',
  'shift_credits',
  'shift_expenses',
  'shift_collections',
  'pump_readings',
  'shift_tank_snapshots',
  'batch_consumption',
  'delivery_batches',
  'fuel_deliveries',
  'tank_adjustment_batch_effects',
  'tank_adjustment_batches',
  'tank_stock_adjustments',
  'tank_dips',
  'tank_stock_ledger',
  'expenses',
  'invoices',
  'cogs_corrections',
  'shifts',
];

const setupTablesToReport = [
  'employees',
  'tanks',
  'pumps',
  'fuel_prices',
  'credit_accounts',
  'suppliers',
  'mpesa_fee_config',
];

const db = knex({
  client: 'sqlite3',
  connection: { filename: dbPath },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn: any, done: (err: Error | null, conn?: any) => void) => {
      conn.run('PRAGMA busy_timeout = 5000', (busyTimeoutErr: Error | null) => {
        done(busyTimeoutErr, conn);
      });
    },
  },
});

function kenyaTimestamp() {
  return new Date()
    .toLocaleString('sv-SE', { timeZone: 'Africa/Nairobi' })
    .replace(/[-: ]/g, '')
    .slice(0, 14);
}

async function tableExists(table: string, conn: Knex = db) {
  return conn.schema.hasTable(table);
}

async function columnExists(table: string, column: string, conn: Knex = db) {
  return conn.schema.hasColumn(table, column);
}

async function rowCount(table: string, conn: Knex = db) {
  if (!(await tableExists(table, conn))) return null;
  const row = await conn(table).count({ count: '*' }).first();
  return Number(row?.count || 0);
}

async function collectCounts(tables: string[], conn: Knex = db) {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const count = await rowCount(table, conn);
    if (count !== null) counts[table] = count;
  }
  return counts;
}

function printCounts(title: string, counts: Record<string, number>) {
  console.log(`\n${title}`);
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table}: ${count}`);
  }
}

async function createBackup() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });
  await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');

  const backupPath = path.join(backupDir, `nexgen-before-fresh-start-${kenyaTimestamp()}.db`);
  fs.copyFileSync(dbPath, backupPath);
  const { size } = fs.statSync(backupPath);
  console.log(`\nBackup created: ${backupPath} (${size} bytes)`);
  return backupPath;
}

async function resetOperationalData() {
  const deleted: Record<string, number> = {};

  await db.raw('PRAGMA foreign_keys = OFF');
  try {
    await db.transaction(async (trx) => {
      for (const table of tablesToClear) {
        if (!(await tableExists(table, trx))) continue;
        const before = await rowCount(table, trx);
        await trx(table).delete();
        deleted[table] = before || 0;
      }

      if (await columnExists('credit_accounts', 'balance', trx)) {
        await trx('credit_accounts').update({ balance: 0 });
      }

      if (await columnExists('tanks', 'current_stock_litres', trx)) {
        await trx('tanks').update({ current_stock_litres: 0 });
      }

      if (!keepPumpInitials) {
        const hasInitialLitres = await columnExists('pumps', 'initial_litres', trx);
        const hasInitialAmount = await columnExists('pumps', 'initial_amount', trx);
        if (hasInitialLitres || hasInitialAmount) {
          const update: Record<string, number> = {};
          if (hasInitialLitres) update.initial_litres = 0;
          if (hasInitialAmount) update.initial_amount = 0;
          await trx('pumps').update(update);
        }
      }

      if (await tableExists('sqlite_sequence', trx)) {
        await trx('sqlite_sequence').whereIn('name', tablesToClear).delete();
      }
    });
  } finally {
    await db.raw('PRAGMA foreign_keys = ON');
  }

  return deleted;
}

async function verifyDatabase() {
  const integrityRows = await db.raw('PRAGMA integrity_check');
  const integrity = Array.isArray(integrityRows) && integrityRows[0]?.integrity_check
    ? integrityRows[0].integrity_check
    : JSON.stringify(integrityRows);

  const foreignKeyRows = await db.raw('PRAGMA foreign_key_check');
  const foreignKeyIssues = Array.isArray(foreignKeyRows) ? foreignKeyRows.length : 0;

  return { integrity, foreignKeyIssues };
}

async function main() {
  console.log('NexGen fresh-start reset');
  console.log(`Database: ${dbPath}`);
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Pump initial readings: ${keepPumpInitials ? 'preserve' : 'reset to 0'}`);

  const beforeOperational = await collectCounts(tablesToClear);
  const beforeSetup = await collectCounts(setupTablesToReport);
  printCounts('Operational rows before reset', beforeOperational);
  printCounts('Setup rows to preserve', beforeSetup);

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to create a backup and reset operational data.');
    return;
  }

  const backupPath = await createBackup();
  const deleted = await resetOperationalData();
  const afterOperational = await collectCounts(tablesToClear);
  const afterSetup = await collectCounts(setupTablesToReport);
  const verification = await verifyDatabase();

  printCounts('Deleted rows', deleted);
  printCounts('Operational rows after reset', afterOperational);
  printCounts('Setup rows preserved', afterSetup);
  console.log(`\nIntegrity check: ${verification.integrity}`);
  console.log(`Foreign key issues: ${verification.foreignKeyIssues}`);
  console.log(`Backup file: ${backupPath}`);

  if (verification.integrity !== 'ok' || verification.foreignKeyIssues > 0) {
    throw new Error('Database reset completed but verification failed.');
  }
}

main()
  .catch((err) => {
    console.error(`\nFresh-start reset failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
