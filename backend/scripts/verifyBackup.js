const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const backupPath = process.argv[2];

if (!backupPath) {
  console.error('Usage: node backend/scripts/verifyBackup.js <path-to-backup.db>');
  process.exit(2);
}

const resolved = path.resolve(backupPath);
if (!fs.existsSync(resolved)) {
  console.error(`Backup file not found: ${resolved}`);
  process.exit(2);
}

const db = new sqlite3.Database(resolved, sqlite3.OPEN_READONLY);

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function close() {
  return new Promise((resolve, reject) => {
    db.close((err) => err ? reject(err) : resolve());
  });
}

(async () => {
  try {
    const integrity = await get('PRAGMA integrity_check');
    const integrityValue = integrity && Object.values(integrity)[0];
    const tables = await all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    const migrationsTable = tables.some((row) => row.name === 'knex_migrations');
    let latestMigration = null;

    if (migrationsTable) {
      latestMigration = await get('SELECT name, batch FROM knex_migrations ORDER BY id DESC LIMIT 1');
    }

    const result = {
      ok: integrityValue === 'ok' && migrationsTable,
      file: resolved,
      size_bytes: fs.statSync(resolved).size,
      integrity_check: integrityValue,
      table_count: tables.length,
      has_knex_migrations: migrationsTable,
      latest_migration: latestMigration,
      checked_at: new Date().toISOString(),
    };

    console.log(JSON.stringify(result, null, 2));
    await close();
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    try { await close(); } catch {}
    console.error(`Backup verification failed: ${err.message}`);
    process.exit(1);
  }
})();
