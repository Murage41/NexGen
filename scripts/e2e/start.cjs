// Starts one part of the isolated test stack against the scratch copy of the
// data in <repo>/.e2e-data (see scripts/e2e/copy-db.cjs). The environment is set
// here in code on purpose: a cmd `set "X=Y"` inside .claude/launch.json
// arguments was once mangled by argument quoting, the variable was lost, and the
// backend migrated the real dev database. This wrapper refuses to run unless the
// data folder is the scratch one.
//
//   node scripts/e2e/start.cjs backend   -> API on 3099 using .e2e-data only
//   node scripts/e2e/start.cjs desktop   -> desktop renderer on 5183 talking to 3099
//   node scripts/e2e/start.cjs mobile    -> mobile app on 5174 talking to 3099
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const dataDir = path.join(root, '.e2e-data');
const realDataDir = path.join(root, 'backend', 'data');
const mode = process.argv[2];

const env = { ...process.env };
let cwd;
let args;
if (mode === 'backend') {
  if (path.resolve(dataDir).toLowerCase() === path.resolve(realDataDir).toLowerCase()) {
    throw new Error('Refusing to use the real data folder.');
  }
  if (!fs.existsSync(path.join(dataDir, 'nexgen.db'))) {
    throw new Error(`No scratch database at ${dataDir}. Run: node scripts/e2e/copy-db.cjs`);
  }
  env.NEXGEN_DATA_DIR = dataDir;
  env.PORT = '3099';
  cwd = path.join(root, 'backend');
  args = [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'];
  console.log(`[e2e] database folder: ${env.NEXGEN_DATA_DIR}`);
} else if (mode === 'desktop' || mode === 'mobile') {
  env.VITE_API_URL = 'http://localhost:3099/api';
  cwd = path.join(root, mode);
  args = [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', mode === 'desktop' ? '5183' : '5174', '--strictPort'];
} else {
  throw new Error('mode must be backend, desktop or mobile');
}
const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
