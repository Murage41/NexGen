# Employee repayments and detailed pay statements

This release applies one debt-recovery process to daily, weekly, fortnightly
(`biweekly`) and monthly plans. It supports per-shift wages, periodic salary,
sales commission, litre commission and combinations.

## Daily shift close

1. Check the readings, collections and expenses.
2. Enter **cash actually paid** to the employee. This is money removed from the
   drawer, not the gross wage or the amount you intended to pay.
3. Review the proposed recovery. It uses the compensation plan pinned to this
   shift, existing deductions, older confirmed debt and any current shortage.
4. Enter the authorized recovery amount and its authorization reference. A
   reduction or deferral needs a reason. Confirm recovery, then close the shift.

The close records the shortage, the recovery allocations and actual wage
payment together. Confirming a preview alone does not reduce debt. An existing
deduction is preserved. Unpaid compensation remains available for payroll.

Example: a shift earns KES 800, the employee receives KES 500, and KES 300 is
recovered from confirmed debt. Cash outflow is KES 500; compensation settled is
KES 800. If KES 800 was actually paid, there is no wage left to withhold.
Do not lower the recorded cash payment unless that is what actually happened.

## Weekly, fortnightly and monthly payroll

1. Calculate the completed payroll period.
2. Expand each employee's **Shifts, rates and recovery** section.
3. Check every included shift, the historical plan version and component amounts.
4. Review debt recovery. The proposal pays confirmed debts oldest first and is
   limited by unpaid compensation, other deductions and the employee's recovery
   limit. Record an authorization reference for a positive recovery, or a reason
   for reducing/defering the proposal.
5. Approve payroll. This posts the approved debt offset; the remaining net wages
   can then be paid in one or more installments.

If another receipt, deduction or recovery changed the balance after review,
approval requires a refreshed decision. Neither calculation nor saving a draft
decision changes the debt balance. Cash already paid and prior shift deductions
are recognized once.

The recovery percentage is a configurable operational limit, initially 100% of
available unpaid compensation. It does not establish authorization to deduct.
Use the agreed reference and limit for the employee concerned. Pending and
disputed debts are excluded from recovery until reviewed and confirmed.

## Separate repayments

From payroll, open the employee's full pay and debt statement. Administrators
can record a cash, M-Pesa or bank repayment with a date and receipt reference.
This clears debt without deducting wages again.

For cash or M-Pesa received in an open drawer shift, specify that shift and use
its work date. Include the money in recorded drawer collections. NexGen counts
it as debt receipts, separately from fuel sales. A receipt without a shift is a
direct receipt and is included in cash reporting once.

Use **Reverse** with a reason to correct an erroneous receipt. Payments tied to
a closed drawer require a shift accounting correction, since changing them
would change an already reconciled drawer. Reversing a wage payment does not
reverse a debt offset; voiding payroll restores its debt allocations after
ordinary payroll payments have been reversed.

## What employees and administrators can see

Employees open **My Pay** on mobile. Administrators open the corresponding
employee statement from payroll. Both see:

- Every included shift, date, plan version and earning component. A hybrid
  plan with three components still counts as one shift.
- Salary as a separate period amount, including proration days. Employment
  dates and component floors/caps apply before calendar-day proration.
- Each payment's date, method, reference and drawer where applicable.
- The earnings covered by new payroll payments and deductions, including
  partial settlements and remaining amounts.
- Debt-origin shifts, recoveries, separate repayment receipts, review changes
  and remaining balances.
- Earnings not yet in payroll, including recorded shift cash and deductions.

**Print statement** prints the current statement. Employees cannot change pay,
change debt or request another employee's statement. Linked shift routes also
check ownership. Drawer accountability totals remain operational totals, while
other employees' payment and repayment details are hidden.

## Historical records and late earnings

Historical payroll totals remain unchanged. Where per-shift payment allocations
were not recorded, the statement identifies that limitation. It does not make
up individual shift payments to match the period total. Imported payments that
conflict with zero recorded shift cash are flagged for cash-record review.

A missed payroll deduction is still outstanding debt. Never mark it repaid
merely because it should have been deducted. Use actual cash evidence before
correcting an earlier payment or wage balance.

Approved payroll is preserved. **Supplemental shifts** collects eligible new,
unprocessed shift earnings for the same approved period, without generating
periodic salary a second time. Existing shifts cannot be included twice. The
normal historical-shift and accounting guards still apply; this action does not
authorize inserting an invented backdated shift. Void an incorrect unpaid run
when a complete replacement is needed.

## Database backup and transfer

The Windows “user-mapped section open” message means a process has the file
mapped. It may be the station source or the development destination. Stop the
relevant NexGen backend and close database viewers before replacing files.

After installing this release, **Settings → Create Backup** produces a
consistent, standalone SQLite snapshot using `VACUUM INTO`, including committed
WAL transactions. Both SQLite integrity and record references are checked. The
snapshot is in the configured data folder's `backups` directory.

Copy that completed snapshot to the development PC. Keep the station backup
unchanged. For development, prefer a new, empty data folder, place a copy there
as `nexgen.db`, and set `NEXGEN_DATA_DIR` to that folder before starting the
development backend. This avoids mixing a new database with old `-wal`/`-shm`
files. Do not copy a running database's main file alone or mix files from
different copy attempts. Never delete a source WAL to get past a copy error.

The command-line equivalents, run from the repository root, are:

```powershell
npm run backup:database --workspace=backend
npm run audit:employee-payroll --workspace=backend -- --database "C:\path\to\verified-snapshot.db"
```

The backup command uses the configured data folder and runs no migrations. The
audit opens the specified file read-only and produces totals and review flags.
Keep audit output private because it contains employee financial information.

## Station release procedure

Use the normal stop, complete data-folder backup, fast-forward pull and install
procedure in [DEPLOYMENT.md](DEPLOYMENT.md). Preserve the current commit ID with
the pre-update backup. Stop before pulling because the development backend
watcher can otherwise restart against the new migration.

After pulling and installing dependencies, while the station is still stopped,
run `npm run backup:database --workspace=backend` and retain its verified snapshot
before running migrations. If verification fails, stop the update and investigate
the copy; do not continue or repair financial history automatically.

Build the backend, run migrations, run `npm run build:mobile`, then start the
normal stack with `npm run station:bg`. Check health, one daily close preview,
one monthly payroll statement and an employee's My Pay. A payroll preview or
statement check does not post a payment.

Rollback is a matched code and database restore only before new financial
activity. Once new shifts or repayments have been posted, preserve the database
and prepare a reconciled corrective update instead of restoring over them.

## Verification

`test:employee-settlement` covers explicit review, prior payments, stale
balances, partial and excess recoveries, all schedules, hybrid components,
prorated capped salary, supplemental shifts, prior daily deductions, separate
receipts and reversals, employee privacy, concurrent requests, transaction
rollback and verified backups. Run it together with the existing payroll,
compensation, shift debt, cancellation and receivable accounting suites.
