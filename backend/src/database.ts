import knex from 'knex';
import config from './knexfile';
import fs from 'fs';
import { getDataDir } from './runtimePaths';

// Ensure data directory exists
const dataDir = getDataDir();
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = knex(config);

export default db;
