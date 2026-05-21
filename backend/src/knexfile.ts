import path from 'path';
import type { Knex } from 'knex';

const config: Knex.Config = {
  client: 'sqlite3',
  connection: {
    filename: path.join(__dirname, '..', 'data', 'nexgen.db'),
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
    directory: path.join(__dirname, '..', 'migrations'),
    extension: 'ts',
  },
  seeds: {
    directory: path.join(__dirname, '..', 'seeds'),
    extension: 'ts',
  },
};

export default config;
