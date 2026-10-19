# Station update #16: completed A1-A4/B1 together

Owner decision: 2026-10-19. Install the completed financial releases in one
station update and validate genuine operations from 2026-10-20. This replaces
the previous separate-installation checkpoints for these five releases only.
The station is last confirmed at `c5c4ee8`, migration 054; installation of this
update must still be confirmed. Do not mark it installed based on preparation.

## Exact scope

Published application code: `c3b3e14932f8ccbcfaf8b86b3f95e06532109758`.
Its ancestry contains complete A1 fee removal, A2 current/original views,
A3 floats/movements, A4 independent totals and B1 customer/shift receipts.
Keep those development commits. A rollout-documentation commit may be the
supplied installation target; it has identical application/migration code.
No squash, old mixed 2b work or unfinished B2/later work is required.

The only pending migration from station 054 is
`20261016_055_shift_floats.ts`. There are no dependency/lockfile changes, so
no dependency installation is needed. Existing station mode serves desktop
through Vite and backend through tsx; only the mobile production build is
required. Do not build an Electron installer or change station startup tasks.

## One installation

Use Command Prompt in `E:\NexGen`. Stop the running stack first; it watches
files and otherwise could migrate immediately on merge, before a backup.
Refuse local Git changes or a non-fast-forward merge; never reset/force them.
Confirm no backend remains listening before touching code or data.

1. Stop NexGen and fast-forward to the exact published update commit supplied
   in the completion message; do not blindly pull a moving future `main`.
2. `npm run backup:database -w backend` creates an integrity-checked snapshot,
   including committed WAL transactions and uploaded files, without migrating.
   Require successful output with a non-empty backup path/size before continuing.
3. From `backend`, load the same TypeScript/dotenv configuration as runtime:
   `node --import tsx -r dotenv/config -e "const db=require('./src/database').default; db.migrate.latest().then(([batch,files])=>console.log({batch,files})).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.destroy())"`.
   Only migration 055 should be newly applied; an already applied migration
   is not repeated. Run `node --import tsx -r dotenv/config scripts/audit_operational_integrity.ts`
   and require `ok: true`. These steps run no test fixtures or seeds.
4. Return to the repository root, run `npm run build:mobile`, then
   `npm run station:bg`. The backend performs its normal migration check again;
   there should be no pending migration. Use `&&` so a failed step stops the chain.
5. Immediately confirm `/api/health` returns `status: ok` and `database: ok`,
   and reload desktop and phone. Background startup returning successfully is
   not itself proof that the backend is healthy. `dev:status` is informative
   but its exit status alone must not be used as the health gate.

Refresh/reopen every phone page before entering data. An already-open shift
retains the old received-totals workflow. A newly opened shift requires both
manual opening amounts and actual closing balances. Never fabricate a live
shift or a correction just to test the update.

## Live validation from 2026-10-20

- New genuine shift: enter cash and M-Pesa openings independently; confirm
  neither is copied from the preceding shift. Explicit zero is allowed.
- Record genuine credit, debt receipts, expenses, wages paid and movements
  once, using their own forms; close with actual holdings including float.
- Compare shift, daily and dashboard figures; check a saved original close
  stays available. M-Pesa must have no automatic fee deduction.
- Where a real mistake exists, check independent cash/M-Pesa correction and
  customer account correction, preserving real payments/original evidence.
  Correct a count separately if it too was wrong; do not create fake receipts.
- Report discrepancies with the shift, entered values and expected result.
  Record the station commit/migration as installed only after confirmation.

## Evidence and recovery

The unchanged B1 code passed 42 backend suites, three typechecks, both builds,
five planted faults and isolated desktop/phone/undo checks before publication.
On 2026-10-19 a fresh isolated copy of the existing verified 054 restore
fixture was backed up using the actual CLI and migrated directly with the
completed B1 code: one migration 055 applied. All original values in 72
business tables / 4,180 rows matched the pre-migration backup; all old shifts
remained legacy with uncaptured openings. SQLite, foreign keys, operational
and receivable audits passed. The old backup's one September open shift was
reported as stale because of its age. This is development rehearsal on the
available September copy, not a claim of validation against current live data.

If installation fails, stop at the failed step and retain its output and the
verified backup. Do not resume service with a failed migration/build/health
check. Preserve any business recorded afterward: never restore an older
database over newer transactions merely to undo application code.
