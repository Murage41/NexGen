import path from 'path';
import type { Knex } from 'knex';

const config: Knex.Config = {
  client: 'sqlite3',
  connection: {
    filename: path.join(__dirname, '..', 'data', 'nexgen.db'),
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
