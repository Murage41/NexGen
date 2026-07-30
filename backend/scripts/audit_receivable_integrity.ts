import db from '../src/database';
import { auditReceivableIntegrity } from '../src/services/receivableIntegrity';

async function main() {
  try {
    const report = await auditReceivableIntegrity(db);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      console.log('No data was changed. Review flagged rows before recording corrective entries.');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
