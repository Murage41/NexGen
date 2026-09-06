import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import knex from 'knex';
import { getDataDirectory } from '../src/utils/dataDirectory';
import { verifiedDatabaseBackup } from '../src/services/databaseBackup';

async function main() {
  const filename = path.join(getDataDirectory(), 'nexgen.db');
  if (!fs.existsSync(filename))
    throw new Error(`Database does not exist: ${filename}`);
  const db = knex({
    client: 'sqlite3',
    connection: { filename },
    useNullAsDefault: true,
  });
  try {
    await db.raw('PRAGMA busy_timeout = 15000');
    // No migrations run here. The snapshot includes committed WAL transactions.
    const backup = await verifiedDatabaseBackup(
      db,
      path.join(getDataDirectory(), 'backups'),
    );
    console.log(JSON.stringify(backup, null, 2));
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
