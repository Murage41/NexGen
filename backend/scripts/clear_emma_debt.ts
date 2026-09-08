import { runEmployeeDebtClearance } from './clear_employee_debt';

// Owner-authorized historical settlement only. Never discover and clear newer debts.
async function main() {
  const args = process.argv.slice(2);
  let database: string | undefined;
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--database' && args[i + 1] && !args[i + 1].startsWith('--')) database = args[++i];
    else throw new Error('Usage: npm run clear:emma-debt --workspace=backend -- [--apply] [--database PATH]');
  }
  await runEmployeeDebtClearance({
    employeeId: 3,
    expectedEmployeeName: 'Ema Kasyoka',
    expectedDebts: [
      {id: 11, shiftId: 78, balance: 1.26},
      {id: 12, shiftId: 81, balance: 428.56},
      {id: 13, shiftId: 86, balance: 40.31},
      {id: 15, shiftId: 88, balance: 74.47},
      {id: 17, shiftId: 92, balance: 4196.92},
    ],
    reason: 'Owner confirms these historical debts were settled from August pay. Clear debt balance and status only; preserve payroll, cash and all shift reconciliations.',
  }, {database, apply});
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
