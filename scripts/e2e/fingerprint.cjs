// Proves the real dev database was not touched by a test run: SHA-256 of
// backend/data/nexgen.db and its -wal (the -shm index file is ignored; readers
// may rewrite it).
//
//   node scripts/e2e/fingerprint.cjs save    -> .e2e-data/real-db.fingerprint
//   node scripts/e2e/fingerprint.cjs check   -> REAL-DB-UNCHANGED, or exit 1
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const realDir = path.join(root, 'backend', 'data');
const saved = path.join(root, '.e2e-data', 'real-db.fingerprint');

function fingerprint() {
  return ['nexgen.db', 'nexgen.db-wal']
    .map((name) => {
      const file = path.join(realDir, name);
      const hash = fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'absent';
      return `${hash} ${name}`;
    })
    .join('\n');
}

function saveFingerprint() {
  fs.mkdirSync(path.dirname(saved), { recursive: true });
  fs.writeFileSync(saved, fingerprint());
}

module.exports = { saveFingerprint };

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === 'save') {
    saveFingerprint();
    console.log(fingerprint());
  } else if (mode === 'check') {
    if (!fs.existsSync(saved)) throw new Error('No saved fingerprint. Run: node scripts/e2e/fingerprint.cjs save');
    if (fs.readFileSync(saved, 'utf8') === fingerprint()) {
      console.log('REAL-DB-UNCHANGED');
    } else {
      console.error('REAL DATABASE CHANGED. Stop and tell the owner.\nSaved:\n' + fs.readFileSync(saved, 'utf8') + '\nNow:\n' + fingerprint());
      process.exit(1);
    }
  } else {
    throw new Error('mode must be save or check');
  }
}
