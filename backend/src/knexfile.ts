import type { Knex } from 'knex';
import { getDatabasePath, getMigrationExtension, getMigrationsDir } from './runtimePaths';

const config: Knex.Config = {
  client: 'sqlite3',
  connection: {
    filename: getDatabasePath(),
  },
  pool: {
    afterCreate: (conn: any, done: (err: Error | null, conn?: any) => void) => {
      conn.run('PRAGMA foreign_keys = ON', (foreignKeyErr: Error | null) => {
        if (foreignKeyErr) return done(foreignKeyErr, conn);
        conn.run('PRAGMA busy_timeout = 5000', (busyTimeoutErr: Error | null) => {
          done(busyTimeoutErr, conn);
        });
      });
    },
  },
  useNullAsDefault: true,
  migrations: {
    directory: getMigrationsDir(),
    extension: getMigrationExtension(),
  },
  seeds: {
    directory: process.env.NEXGEN_SEEDS_DIR,
    extension: 'ts',
  },
};

export default config;
