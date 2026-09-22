# Employee repayments and detailed pay statements

Since update #7 (22 Sep 2026) employees are paid their full compensation on
every plan, and shift close and payroll no longer recover debt. Shortages are
kept as the attendant's variances and repaid separately: see
[Attendant Variances](ATTENDANT-VARIANCES.md) for closing a shift, recording a
repayment (directly or into an open shift's drawer), writing off, and paying an
employee back.

A repayment taken on a closed shift is corrected from the shift with the pencil
next to it, since changing it changes an already reconciled drawer; see
[Correcting a Closed Shift](CLOSED-SHIFT-CORRECTIONS.md).

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
- Their variances: every shift's over or short, what recovered it, repayments,
  write-offs and pay-backs, and the staff-debt records from before variances
  started under Earlier records.
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

`test:employee-settlement` covers full pay on every schedule, hybrid
components, prorated capped salary, supplemental shifts, repayments and
reversals, employee privacy, concurrent requests, transaction rollback and
verified backups; `test:employee-variances` covers netting and the carry-over of
old staff debt. Run them together with the existing payroll, compensation,
shift, cancellation and receivable accounting suites.
