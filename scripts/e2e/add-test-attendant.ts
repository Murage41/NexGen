// Adds a throwaway attendant to the SCRATCH database only, so the attendant's
// phone views (M6) can be checked during an E2E run. Refuses to run against
// anything but <repo>/.e2e-data. Open a shift for them from the e2e desktop app
// (or POST /api/shifts) to see the open-shift screens.
//
//   NEXGEN_DATA_DIR="$PWD/.e2e-data" node node_modules/tsx/dist/cli.mjs scripts/e2e/add-test-attendant.ts
//
// Name "E2E Test Attendant", PIN 9732. Never create this on a real database.
import path from 'node:path';

const dir = path.resolve(process.env.NEXGEN_DATA_DIR || '');
if (path.basename(dir) !== '.e2e-data') throw new Error(`Refusing: NEXGEN_DATA_DIR is ${dir}, not the .e2e-data scratch folder.`);

async function main() {
  const { default: db } = await import('../../backend/src/database');
  const { hashPin } = await import('../../backend/src/services/pinSecurity');
  const existing = await db('employees').where({ name: 'E2E Test Attendant' }).first();
  if (!existing) {
    await db('employees').insert({ name: 'E2E Test Attendant', daily_wage: 0, pin: hashPin('9732'), role: 'attendant', active: true });
  }
  console.log(await db('employees').where({ name: 'E2E Test Attendant' }).first('id', 'role'));
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
