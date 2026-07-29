import knex from 'knex';
import config from './knexfile';
import { ensureDataDirectory } from './utils/dataDirectory';

// Ensure data directory exists
export const dataDir = ensureDataDirectory();

const db = knex(config);

export default db;
