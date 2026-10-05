# NexGen Project Status

**Read this at the start of every session. Update it at the end of any session
that changes code, the station, or the plan.** What is left to build, in
order, is in `docs/ROADMAP.md`; how to build it is in
`docs/ENGINEERING-STANDARDS.md`.

Last updated: 2026-09-30.

## Station PC

- **Running `bcfb424`** (confirmed by the owner 2026-09-30: update #14,
  Corrections phase 1, applied in the stop-first order with a backup before
  the migration; all checks passed: Corrections menu opens empty, the closed
  shifts the owner noted show the same shortage or surplus as before, and
  closed shifts show Correct on desktop and phone). Latest migration there:
  `053`.
- **Pending station updates: none yet.** Corrections phase 2a is built and
  tested on the development PC, **not committed**; once the owner asks to
  commit and push, it becomes update **#15** (migration `054`, so a backup
  before it; no new dependencies).
- **The development PC's copy of station data** (`backend/data/nexgen.db`) was
  replaced by the owner with the station's live files on 2026-09-30 (last
  written there 09:45; 124 closed shifts, migration 052). It goes out of date
  again as the station runs: before an update that changes how existing
  records are read or migrated, ask the owner for a fresh copy (the station's
  `backend\data\nexgen.db` with its `-wal` and `-shm` files, or the newest
  file in `backend\data\backups\`) and check on a scratch copy of it.
- `npm install` on the station reports 12 known vulnerabilities (1 low, 6
  moderate, 5 high) in dependencies; review them with the Tier 5 audit.
- The station has its own database. It is changed only by fast-forwarding to
  pushed commits, one command block per update, as in
  `docs/ENGINEERING-STANDARDS.md` §7.
- Station PC: Windows 10, repository at `E:\NexGen`. The owner types commands
  in **Command Prompt** there. Logs: `E:\NexGen\logs\nexgen-station-stack.log`.
- Start-up: a scheduled task starts NexGen when the owner's Windows account
  logs in, in a visible PowerShell window (closing it stops NexGen). An
  attempt to hide that window was undone on 2026-09-24 at the owner's request;
  the installer (`scripts/Install-NexGenStartupTask.ps1`) is the original.
  The same day the stack stopped unexpectedly once; that was being diagnosed
  in a separate session from the log above.

| # | Commit | What | Migration |
|---|---|---|---|
| 1 | `a033eda` | Admin picker + PIN approvals; fewer reason fields (M3/M4) | none |
| 2 | `584dda5` | Credit customers created properly, with limits (M5) | 044 |
| 3 | `4266872` | Login PIN guessing fix (device tokens) | none |
| 4 | `a81ad7b` | Remove a mistaken open-shift payment by reversal; edit invoice customers on the phone | none |
| 5 | `4c862dc` | Closed-shift corrections (later retired by #8) | 045 |
| 6 | `40e8137` | Customer credit on account, refunds (M5c) | 046 |
| 7 | `b07947e` | Attendant variances ledger; no recovery at close or payroll (M5d) | 047 |
| 8 | `05f0482` | Closed shifts never edited: Move balance; employees simply pay shortages | 048 |
| 9 | `ab6adda` | Invoice credit/debit notes by fuel, litres and price; DN- bills; credit held for the next invoice | 049 |
| 10 | `7e9fd54` | Invoice notes can name the shift's attendant | 050 |
| 11 | `157a9ec` | Attendants see only what they need; blind open shift (M6) | none |
| 12 | `3131f77` | Low fuel warning per tank; open-shift tank card fixed (M7) | 051 |
| 13 | `9bd40d5` | Station profile, logo, PDF invoices and notes; backups copy uploads (M8) | 052 |
| 14 | `bcfb424` | Corrections phase 1: closed shifts read their snapshot, database guards, correcting fuel on account | 053 |

## How the system works now (recent decisions that code must respect)

- **Closed shifts never change** (on the station since update #14: the
  database refuses it, and a closed shift shows its close snapshot, never a
  recalculation). A mistake on fuel on account is fixed by a numbered
  **Correction** (C-2026-0001) that reverses and/or adds entries and makes any
  credit or debit note itself; phase 2a (uncommitted) adds credit sales, debt
  receipts, drawer expenses and the cash/M-Pesa split; see
  `docs/CORRECTIONS.md`. Office payments, balance moves, invoice void and
  price notes still work the old way (`docs/CLOSED-SHIFT-CORRECTIONS.md`)
  until phase 2b.
- **Attendant shortages:** an employee owes the shortages of their short shifts
  and pays them in money (cash, M-Pesa, bank). No write-offs, no paybacks, and
  surpluses never offset shortages (they are the station's). Pay is never
  reduced for shortages. See `docs/ATTENDANT-VARIANCES.md`.
- **Invoice customers:** every note is fuel × litres × price per litre. A credit
  note beyond what the invoice owes becomes credit that pays their next invoice
  (never paid out). A debit note is its own DN- bill, for an invoice or a
  shift. A litres note on a shift can name that shift's attendant: their
  shortage changes by the litres at **the shift's** pump price. See
  `docs/INVOICE-CUSTOMER-WORKFLOW.md`.
- **Money customers:** overpayments are held as credit on account; credit
  limits warn and allow an admin-PIN override. See
  `docs/CREDIT-CUSTOMERS-AND-LIMITS.md`.
- **Approvals:** desktop picks an admin and takes their PIN; the phone uses the
  signed-in admin. Tokens are bound to the exact decision.
- **Documents (M8):** one station profile (desktop Settings) feeds every
  document; invoices, DN- bills and credit notes get a PDF saved inside the
  database when issued and served unchanged ever after; every document says
  it is not a tax invoice (eTIMS stays with POSitive). The NexGen logo ships
  with the app (`backend/assets/`). Backups also copy uploaded supplier PDFs.
  See `docs/STATION-PROFILE-AND-DOCUMENTS.md`.
- **Tanks (M7):** each tank has an optional "order more at" level; everyone
  sees a "Fuel is low" warning when the fuel in the tank now (book stock less
  the open shift's sales so far, `services/tankStock.ts`) is below it. The open
  shift's tank card uses the same calculation as the close. See
  `docs/TANK-LOW-STOCK.md`.
- **Attendants (M6):** read-only Credits (money customers' credit only),
  Pumps and Tanks (levels only); invoice customers by name only; a blind open
  shift (no expected total, variance or "Shortage" until an admin closes it);
  home screen shows the shift status only. Enforced on the server. See
  `docs/ATTENDANT-ACCESS.md`.

## Milestones

- Roadmap Tiers 1-3: done (2026-09-10 to 09-12).
- Owner's urgent matters: **M1-M5 done; M5b-M5e done** (closed-shift
  corrections evolved into Move balance and the shortages ledger); **M2 closed
  2026-09-24** (diesel main pump set to roll over at 100,000 L and confirmed on
  the station; old-log PIN check returned 0).
- **M6, what attendants can see: done, on the station since 2026-09-26
  (update #11)** (`docs/ROADMAP.md` §1, `docs/ATTENDANT-ACCESS.md`).
  All 31 backend suites pass, including the new `test:attendant-access`
  (14 planted bugs all caught); checked in the browser on a scratch copy of
  station data as an attendant on and off shift, and as an admin.
- **M7, low fuel warning: done, on the station since 2026-09-26 (update #12)** (`docs/ROADMAP.md` §2, `docs/TANK-LOW-STOCK.md`). It also
  fixes the open shift's Tank Stock card, which counted that day's deliveries
  twice. Checked on a scratch copy on desktop and phone, as admin and
  attendant.
- **M8, station profile, logo and PDF documents: done, on the station since
  2026-09-26 (update #13)** (`docs/ROADMAP.md` §3,
  `docs/STATION-PROFILE-AND-DOCUMENTS.md`). The logo was rebuilt from canopy
  photos and chosen by the owner. Building it also found that backups held
  only the database (uploaded supplier invoice PDFs were in none) and that
  those uploads were written to `backend/data` even in test runs; both fixed.
- **M10, correct a fuel entry before invoicing (owner, 2026-09-30): built and
  tested but superseded the same day, never committed** (`docs/ROADMAP.md` §3b).
  Raised by two wrong entries (diesel recorded instead of petrol; an entry
  never taken) on an invoice customer that could not be fixed before
  invoicing. 34 backend suites pass; `test:entry-corrections` caught 11 of 11
  planted bugs; checked on a scratch copy (desktop correct and undo with PIN,
  phone form; shift 116 unchanged).
- **2026-09-30: Corrections adopted as one mechanism.** The owner found M10
  too specific, had three outside designs written from a neutral brief, and
  adopted one Correction record for every mistake on a closed record, built
  in four phases (`docs/ROADMAP.md` §3c). M10's uncommitted code on the
  development PC is reused as phase 1's fuel-on-account handler; its own
  button, routes and migration 053 will not ship as they are.
- **Corrections phase 1: done, on the station since 2026-09-30 (update #14)**
  (`docs/ROADMAP.md` §3c, `docs/CORRECTIONS.md`). Closed shifts read their
  snapshot (migration 053 backfills the 70 closed shifts without one, marked
  backfilled); database guards; the Correction record (C-YYYY-NNNN, reason
  codes, approval bound to the plan hash, register); fuel on account for all
  six error kinds at every stage (notes made automatically on issued
  invoices); undo; desktop register and entry points on desktop and phone.
  35 backend suites pass; `test:corrections` caught 19 of 19 planted bugs. On
  a scratch copy of the station's latest data (copied to the development PC
  2026-09-30, migration 052, 124 closed shifts): all 124 show exactly the
  figures they showed before, 70 got a backfilled snapshot, a correction and
  its undo on shift #123 worked, and the open shift closed normally with the
  guards in place. Earlier, on the older copy: desktop correct, register and
  undo with PIN; phone correct with the station carrying it; an issued-invoice preview made
  the credit note at the invoice price. Credit notes made by a correction book
  only the price difference as revenue (the shift's corrected result carries
  the rest).
- **Corrections phase 2a: built and tested 2026-10-02, not yet committed**
  (`docs/ROADMAP.md` §3c, `docs/CORRECTIONS.md`): a closed shift's credit
  sales, debt receipts, drawer expenses and cash/M-Pesa split are corrected
  with the same wizard, register and undo, on desktop and phone. 36 backend
  suites pass; `test:corrections-money` (shifts recorded and closed through
  the real routes) caught 21 of 21 planted bugs. On a scratch copy of the
  station's data as copied 2026-09-30: all 124 closed shifts show the same
  figures and the same credit, payment and expense lists after migration 054;
  on the desktop a credit sale (wrong amount) and a cash/M-Pesa mix-up were
  corrected and the mix-up undone from the register with a PIN; on the phone
  a debt payment (cash/M-Pesa) was corrected and a missing expense added; the
  daily report listed all five. The owner confirmed (2026-10-05) that the
  station's data since that copy holds nothing different, so no fresh copy is
  needed for this update.
- **Next:** Corrections phase 2b, then phases 3–4 and M9 (order to confirm), phone invoice actions, a UI and design review, Tier 4,
  Tier 5.
- 2026-09-24: the project's rules and status moved into committed files
  (`CLAUDE.md`, this file, `docs/ROADMAP.md`, `docs/ENGINEERING-STANDARDS.md`,
  `scripts/e2e/`), and the roadmap was re-checked against the code.

## Open items for the owner

- **The GitHub repository `Murage41/NexGen` stays public** (owner decision
  2026-09-24: the station PC pulls updates from it). So committed files must
  never contain real names, balances, PINs or other station data. Some older
  docs (`RECOVERY-MECHANISM-CORRECTION.md`, `EMPLOYEE-ADMIN-ACCESS-PLAN.md`,
  `HISTORICAL-DEBT-CLEARANCE.md`, `PAYROLL-REGRESSION-VERIFICATION.md`) name
  staff or customers; removing those names is open, awaiting the owner's
  go-ahead (earlier versions stay in git history).
- **Real names in committed code:** removed 2026-09-26 from the test suites,
  two code comments and a desktop placeholder (checked against every customer,
  employee and supplier name in the station copy). Still left, each needing
  its own decision: comments in two pushed migrations (`018`, `023`; pushed
  migrations are never edited), the one-off station scripts named after people
  (`backend/scripts/repair_*`, `clear_emma_debt.ts` with its test, which
  checks the employee's real name as a safety guard, `fix_*`,
  `verify_phase3b.js`), and `docs/phases/`.
- Accepted-for-now gaps (desktop has no login, unsigned installer, eTIMS stays
  with POSitive, dev-mode station processes): `docs/PRODUCTION-SECURITY-AND-COMPLIANCE.md`.

## Station facts that code must respect

- Pumps: petrol, diesel main, diesel 2. Every meter has 6 digits and rolls
  over after 999,999.99 (litres and KES), except the diesel main pump's litres,
  which roll over after 99,999.999 (confirmed by the owner 2026-09-25;
  configured per pump as 1,000,000 and 100,000). NexGen stores readings as
  running totals past each rollover; screens show the pump's own display
  (the total less every full turn).
- Pump prices are the owner's: EPRA's published (Nairobi) prices plus the
  owner's transport cost, not EPRA prices as published.
- One or two attendants per shift; attendants are mostly paid daily; payroll
  also has non-attendant staff (a watchman with a salary advance being repaid
  weekly: the case behind Tier 4 #17). Pay is never reduced for shortages.
- Customers: money (credit) customers who pay against their balance, and
  invoice customers billed per period at agreed prices.
- POSitive (Asprime) remains the fiscal/eTIMS system at the station; NexGen
  documents are not tax invoices.

## Development PC facts

- `backend/data/nexgen.db` is a **copy of station data** that the owner
  pastes in from the station from time to time (now: to shift 118,
  2026-09-22, migrated only to `044`). Never run the backend on it and never
  modify it. End-to-end tests run on a scratch copy (`scripts/e2e`,
  `docs/ENGINEERING-STANDARDS.md` §6), which migrates itself to the latest.
- **Never start the ngrok tunnel on the development PC**: the phone link would
  reach two different databases (the owner had it stopped, 2026-09-09). That
  rules out `npm run station:bg`, `dev:bg`, `station:tunnel` and `dev:tunnel`
  here; all of them start ngrok. Use the `e2e-*` launchers instead.
- Local-only planning history (contains station data, never committed):
  `D:\NexGen\.claude\plans\`. Local launch configs, including the `e2e-*`
  entries: `.claude/launch.json`.
- `main` is the only live branch; the station pulls it. `codex/production-readiness`,
  `debug-sweep` and the `claude/*` branches are old; don't build on them.
  Old git worktrees exist under `.claude/worktrees/`.
- Several sessions can run at once in this folder (e.g. one on the station
  start-up while another built features). Stage only your own files.
