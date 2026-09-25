# NexGen Engineering Standards

Mandatory for every change, in every session. `CLAUDE.md` is the short version
and points here. Read the section that matches the change before writing code.

## 1. Money and records: correct, never edit

NexGen is an accounting system. What was recorded stays recorded; a mistake is
corrected by a new, dated entry that refers to the original.

- **A closed shift never changes.** No edit, no pencil. Mistakes found later are
  fixed on the balances: **Move balance** between a money customer, an employee
  and the station (`services/balanceMoves.ts`), and for invoice customers
  **credit and debit notes** (`services/invoiceAdjustments.ts`). See
  `docs/CLOSED-SHIFT-CORRECTIONS.md`.
- **Financial rows are never deleted.** Payments, receipts, notes and
  repayments are *reversed* (status `reversed`, who, when, reason); an unpaid
  document is *voided*. Soft delete (`deleted_at`) is only for non-financial
  master data.
- **Corrections are dated the day they are made** (`getKenyaDate()`), not
  back-dated into a closed period, and carry a reason.
- **One mechanism over many features** (owner principle): before adding a
  button, entry type or automatic rule, find the existing record type that can
  express it with an option or label. Manager decisions are ordinary entries,
  not automatic rules. When the owner says "do away with X", remove X entirely.
- **Attendant shortages** are derived on read from `employee_variance_entries`
  (`computeVarianceStatement`); nothing stores a running balance. An employee
  owes the shortages of their short shifts and pays them in money; surpluses
  belong to the station. See `docs/ATTENDANT-VARIANCES.md`.
- **Double entry for moves:** every amount taken off one party is put on
  another in the same transaction (customer, employee, station, or revenue).
- **Money arithmetic in cents** (`Math.round(x * 100)`), rounded back with the
  existing helpers (`roundMoney`, `toMoney`). Never accumulate floats.

## 2. Data immutability policy

Every field belongs to exactly one category. Decide which when adding a field.

**A: immutable historical facts.** Once recorded, never changed; corrected only
by a new entry. Pump readings (`opening_/closing_litres`, `_amount`), tank dip
measured litres, fuel delivery litres/cost/date, shift collections, shift
expenses, credit payments, delivery batch originals, `batch_consumption` (FIFO
cost locked at consumption).

**B: live computed, never stored.** Always computed from source rows on read:
P&L, book stock for a date (`computeBookStock`), FIFO costs by range, variance
percentages, margins, attendant shortages, receivable aging.

**C: event-recomputed caches.** Stored for speed but recomputed (never
incremented) whenever a source changes, atomically in the same transaction:

| Field | Recompute trigger |
|---|---|
| `tanks.current_stock_litres` | delivery changes, shift close, dip changes |
| `delivery_batches.remaining_litres` | shift close (FIFO consumption) |
| `credit_accounts.balance` | any credit, payment, reversal, move (`recomputeAccountBalance`) |
| `credits.balance` | payment allocations |
| `customer_invoices.balance`, `status` | payments, credit applications, notes (`recomputeInvoiceTotals`) |
| `supplier_invoices.balance_due` | supplier payment changes |
| `tank_dips.book_stock_at_dip`, `variance_litres` | deliveries or shift closes on/before the dip date |
| `shift_tank_snapshots.*` | deliveries and dips on/before the shift date |

Decision rule for a new field: a physical event we recorded → A. Cheap to
derive → B (default when unsure). Expensive and changes on known events → C,
with its triggers listed and a recompute function called from every trigger.

Rejected patterns: storing a derived value without its triggers; incrementing a
cache instead of recomputing; computing at event time and never updating.

## 3. Approvals, permissions, idempotency

- **Admin approval** uses `services/approval.ts`: the client asks
  `POST /auth/verify-pin` for a short-lived token bound to the exact decision
  (`approvalBindings.<purpose>`: every field that matters, e.g. amount, account,
  shift). The server rebuilds the binding from the request and
  `resolveApprover()` rejects any mismatch. Desktop: admin picker + PIN
  (`shared/ui/ApproverConfirm.tsx`). Mobile: the signed-in admin approves.
  When a decision gains a field, add it to the binding on both sides.
- **Role checks are server-side** (`requireAdmin`, `requireOwnShiftOrAdmin`).
  Hiding a button is not a permission. Attendant-facing payloads are filtered
  on the server (see the dashboard's non-admin branch in `routes/dashboard.ts`).
- **What attendants see** is fixed in `docs/ATTENDANT-ACCESS.md` (M6). A new
  `GET` route that returns money, cost, stock variance or anyone else's data
  is `requireAdmin` unless an attendant screen needs it; then send only the
  fields that screen needs and add the route to `test_attendant_access.ts`.
  Don't assume a router is admin-only: several were open until M6 found them.
  A page served to both roles must not read fields the attendant payload
  leaves out (the phone's home screen would have crashed on them).
- **Double-submit safety:** money mutations that can be retried (shift close,
  payments, moves, payroll) go through `services/idempotency.ts`
  (`runIdempotent`).

## 4. Code conventions

- **Logging.** Every route handler logs its entry, and every catch logs the
  error, tagged `[file:functionOrRoute]`:
  `console.log('[shifts:close]', { shiftId, body })`,
  `console.error('[shifts:close] ERROR', err.message)`. Frontend catches log
  `console.error('[Page:action]', err.response?.data || err.message)`. Never
  log PINs or approval tokens (redact them, as the note routes do).
- **API contract.** Every response is `{ success, data?, error?, code? }`.
  Errors carry an HTTP status and a plain-language `error` the owner can act on.
- **Error display.** Show the server's message:
  `setError(err.response?.data?.error || err.message || 'Operation failed')`.
- **Shared UI.** Components used by both desktop and mobile live in
  `shared/ui/` and take their API calls as props.
- **Match the surrounding code**: naming, comment density, idioms. Comments say
  why, in plain words.
- **Wording shown to the owner** is plain English: short sentences, no jargon,
  says what happens to the money.

## 5. Migrations

- File name `backend/migrations/YYYYMMDD_NNN_short_name.ts`, numbered after the
  last one. Never edit a migration that has been pushed; add a new one.
- Guard every change (`hasTable` / `hasColumn`) so a re-run is harmless.
- Financial history cannot be rolled back: `down()` throws with a message to
  restore a verified pre-update backup instead.
- Some test scripts build their own minimal schema (e.g.
  `test_invoice_accounting_controls.ts`, `test_invoice_draft_reservations.ts`,
  `test_receivable_payment_integrity.ts`). When a service starts reading a new
  table or column, add it there too or those suites fail.
- A migration means the station update backs up the database first.

## 6. Testing

- **Type checks** for every touched package:
  `npx tsc --noEmit -p backend` (and `-p desktop`, `-p mobile`).
- **Backend suites** are `backend/scripts/test_*.ts`, registered in
  `backend/package.json` as `test:<name>`. Each creates a private temporary
  database (`NEXGEN_DATA_DIR` = a fresh temp folder) and exercises the real
  routes. New behaviour gets a new section or suite, registered there.
- **Run all suites** (from `backend/`):
  `for t in $(grep -o '"test:[a-z0-9-]*"' package.json | tr -d '"'); do npm run -s $t >/dev/null 2>&1 && echo "ok $t" || echo "FAIL $t"; done`
- **Mutation check new logic:** plant each important bug (remove a guard,
  change a sign) and confirm a test fails; restore the file afterwards.
- **End-to-end on a scratch copy of real data**, never on
  `backend/data/nexgen.db`:
  1. `node scripts/e2e/copy-db.cjs` (copy + saves the real DB fingerprint)
  2. `NEXGEN_DATA_DIR="$PWD/.e2e-data" node node_modules/tsx/dist/cli.mjs scripts/e2e/add-test-admin.ts`
     ("E2E Test Admin", PIN 9731); for the attendant's phone views also run
     `scripts/e2e/add-test-attendant.ts` the same way ("E2E Test Attendant",
     PIN 9732). The phone app runs at `http://localhost:5174/mobile/`.
  3. Start `e2e-backend`, `e2e-desktop` (or `e2e-mobile`) from
     `.claude/launch.json` (they run `node scripts/e2e/start.cjs <part>`).
     If the file lacks them, add entries with `runtimeExecutable: "node"`,
     `runtimeArgs: ["scripts/e2e/start.cjs", "<part>"]`, ports 3099 / 5183 / 5174.
     **Never** pass `NEXGEN_DATA_DIR` through `cmd /c set ...` in launch.json.
  4. `NEXGEN_DATA_DIR="$PWD/.e2e-data" npm run audit:receivables -w backend`
  5. Stop the servers, then `node scripts/e2e/fingerprint.cjs check` must print
     `REAL-DB-UNCHANGED`. If not, stop and tell the owner.

## 7. Station deployment

The station PC runs its own database; it is updated only by fast-forwarding to
pushed commits.

1. Checks pass → commit (only when the owner asks) → push `origin/main` →
   `git status --short` clean.
2. Give the owner **one command block per pending update, in order**, each
   ending with its own short check. Never one combined jump.
3. Each block: `git fetch origin` (first block), `git merge --ff-only <commit>`,
   `npm run backup:database -w backend` (always when a migration is included),
   `npm run dev:stop`, `npm install` (when dependencies changed),
   `npm run build:mobile` (the phone app is served from `mobile/dist`),
   `npm run station:bg`.
4. If a fast-forward fails, stop and review; never force, rebase or reset the
   station.
5. Record the station's confirmed commit and pending updates in
   `docs/PROJECT-STATUS.md`.

`npm run station:bg` runs backend, desktop and ngrok for normal operation on
the station. `npm run dev:bg` adds the mobile dev server and also starts ngrok,
so it is for testing on the station only; on the development PC never start
ngrok (use `scripts/e2e`).

**Writing the commands:** the owner runs them in **Command Prompt** at
`E:\NexGen` on the station (Windows 10). Every command must work in cmd:
plain `git` / `npm` lines, and anything PowerShell-only wrapped as
`powershell -NoProfile -Command "..."`. Before giving commands, check the
scripts and docs they rely on; don't assume. Say what each check should show,
and to stop and report if something differs.

**Station infrastructure** (start-up task, `scripts/*.ps1`): change only what
the owner asked, with the smallest change, and give the way back. A broad
change to the start-up task on 2026-09-24 had to be undone.
