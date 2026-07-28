import knex from 'knex';
import config from './knexfile';
import fs from 'fs';
import { getDataDirectory } from './utils/dataDirectory';

// Ensure data directory exists
export const dataDir = getDataDirectory();
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = knex(config);

export default db;
