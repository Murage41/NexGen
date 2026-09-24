// Adds a throwaway administrator to the SCRATCH database only, so approvals
// (name + PIN) can be exercised in the desktop app during an E2E run. Refuses to
// run against anything but <repo>/.e2e-data.
//
//   NEXGEN_DATA_DIR="$PWD/.e2e-data" node node_modules/tsx/dist/cli.mjs scripts/e2e/add-test-admin.ts
//
// Name "E2E Test Admin", PIN 9731. Never create this on a real database.
import path from 'node:path';

const dir = path.resolve(process.env.NEXGEN_DATA_DIR || '');
if (path.basename(dir) !== '.e2e-data') throw new Error(`Refusing: NEXGEN_DATA_DIR is ${dir}, not the .e2e-data scratch folder.`);

async function main() {
  const { default: db } = await import('../../backend/src/database');
  const { hashPin } = await import('../../backend/src/services/pinSecurity');
  const existing = await db('employees').where({ name: 'E2E Test Admin' }).first();
  if (!existing) {
    await db('employees').insert({ name: 'E2E Test Admin', daily_wage: 0, pin: hashPin('9731'), role: 'admin', active: true });
  }
  console.log(await db('employees').where({ name: 'E2E Test Admin' }).first('id', 'role'));
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
