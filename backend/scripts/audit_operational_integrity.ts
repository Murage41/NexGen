import db from '../src/database';
import { runOperationalIntegrityCheck } from '../src/services/operationalIntegrity';

async function main() {
  const report = await runOperationalIntegrityCheck(db);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
