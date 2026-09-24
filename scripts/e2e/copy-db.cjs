// Makes a fresh scratch copy of the dev database for end-to-end testing:
// <repo>/backend/data/nexgen.db -> <repo>/.e2e-data/nexgen.db, through a
// read-only VACUUM INTO (a consistent copy that includes the WAL, without
// writing to the original). Also saves the original's fingerprint so
// `node scripts/e2e/fingerprint.cjs check` can prove it was never touched.
//
//   node scripts/e2e/copy-db.cjs
const fs = require('fs');
const path = require('path');
const { saveFingerprint } = require('./fingerprint.cjs');

const root = path.resolve(__dirname, '..', '..');
const sqlite3 = require(path.join(root, 'node_modules', 'sqlite3'));
const source = path.join(root, 'backend', 'data', 'nexgen.db');
const dataDir = path.join(root, '.e2e-data');
const target = path.join(dataDir, 'nexgen.db');

if (!fs.existsSync(source)) throw new Error(`No dev database at ${source}`);
fs.mkdirSync(dataDir, { recursive: true });
for (const f of ['nexgen.db', 'nexgen.db-wal', 'nexgen.db-shm']) {
  const p = path.join(dataDir, f);
  if (fs.existsSync(p)) fs.rmSync(p);
}
saveFingerprint();
const db = new sqlite3.Database(source, sqlite3.OPEN_READONLY, (err) => {
  if (err) throw err;
  db.run(`VACUUM INTO '${target.replace(/\\/g, '/').replace(/'/g, "''")}'`, (e) => {
    if (e) throw e;
    db.close();
    console.log(`[e2e] copied to ${target} (${fs.statSync(target).size} bytes)`);
  });
});
