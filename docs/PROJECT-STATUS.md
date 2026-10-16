# NexGen Project Status

**Read this at the start of every session. Update it at the end of any session
that changes code, the station, or the plan.** What is left to build, in
order, is in `docs/ROADMAP.md`; how to build it is in
`docs/ENGINEERING-STANDARDS.md`.

Last updated: 2026-10-16.

## Station PC

- **Running `c5c4ee8`** (the owner reported update #15, Corrections phase
  2a, applied on 2026-10-05). Latest migration there: `054`. Before it,
  update #14 (`bcfb424`) was confirmed with all checks passed on 2026-09-30.
- **Pending station update #16: A1 M-Pesa fee removal, published.** Code commit
  `c885a61` is on `origin/main`; the following documentation commit records
  publication. A1 was
  isolated on `codex/remove-mpesa-fees` in this chat's attached worktree,
  starting from station `c5c4ee8`; code, automated checks and scratch desktop/
  phone verification are complete (2026-10-15). Installation and the owner's
  station checkpoint remain. Initial GitHub DNS/service failures on 2026-10-16
  cleared; normal push succeeded and `git ls-remote` verified the published
  code commit. The original development folder's
  mixed fee/phase-2b work is preserved; it is not the A1 release candidate.
  The owner wants independent cash/M-Pesa
  totals, simpler finance and fixed consumption after invoicing; complete
  proposed sequence in `docs/IMPLEMENTATION-STAGES.md`, indexed by
  `docs/ROADMAP.md`. Manual opening floats are in `docs/SHIFT-FLOATS.md`.
  A2's consistent current/original financial views are developed separately
  and queued after A1; floats and the broader edit/note work are not built.
  The whole of old 2b is not authorised to ship. The next station update is
  **#16**, A1 only, based on the station's code (`c5c4ee8`). No new migration
  or dependency installation is required; migration remains `054`.
- **A2 development: current financial views, queued after A1.** The owner
  authorised A2 on 2026-10-16 and changed the delivery workflow: finish and
  test individual development commits, then install/check one at a time on
  the station. `codex/current-shift-financials` starts from A1's installation
  target `7695895`. Closed detail, daily/dashboard and relevant period totals
  share current financial facts; Original close and Original/Current history
  columns retain the saved evidence. No new migration, posting, float, stock
  replay, independent-total correction form or old 2b bundle is included.
  Release card: `docs/releases/A2-CURRENT-FINANCIAL-VIEWS.md`; owner guide:
  `docs/CURRENT-SHIFT-FIGURES.md`. All 37 backend suites, three type checks,
  both client builds, three planted bugs, scratch desktop/phone checks and
  the receivables audit pass. Final real-DB fingerprint is unchanged.
  Station checks gate the next installation,
  not the next development stage. Neither A1 nor A2 installation is confirmed.
- **The development PC's copy of station data** (`backend/data/nexgen.db`) was
  replaced by the owner with the station's live files on 2026-09-30 (last
  written there 09:45; 124 closed shifts, migration 052). It goes out of date
  again as the station runs. Development can use synthetic fixtures and
  isolated copies of this available backup with its age recorded. Before
  installing an update that changes historical reads or migrations, refresh
  the copy when needed for that installation check (the station's
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
| 15 | `c5c4ee8` | Corrections phase 2a: credit sales, debt payments, drawer expenses, cash/M-Pesa | 054 |
| 16 (pending installation) | `c885a61` + publication record | A1: remove M-Pesa fees; staged roadmap and manual-float specification | no new migration |
| A2 (queued after #16) | A2 release commit, directly after `7695895`; see release card | Current financial views and preserved original close | no new migration |

## How the system works now (recent decisions that code must respect)

- **Closed source records and saved closes never change** (database guards
  have been on the station since update #14). Station/A1 detail shows the
  original close by default. Queued A2 shows current figures and active lists,
  retaining Original close separately. Numbered **Corrections** (C-2026-0001) cover fuel on account,
  credit sales, shift debt receipts, drawer expenses and a cash/M-Pesa split
  with an unchanged combined total. Existing office payment reversals, Move
  balance, void and standalone debit-note actions remain in the station/A1
  code. The older unshipped 2b proposal to replace these actions is not part
  of A1. Independent totals and later financial changes follow the separate
  stage plan. Meter readings stay fixed. See `docs/CORRECTIONS.md`.
- **Attendant shortages:** an employee owes the shortages of their short shifts
  and pays them in money (cash, M-Pesa, bank). No write-offs, no paybacks, and
  surpluses never offset shortages (they are the station's). Pay is never
  reduced for shortages. See `docs/ATTENDANT-VARIANCES.md`.
- **Invoice customers:** every note is fuel × litres × price per litre. A credit
  note beyond what the invoice owes becomes credit that pays their next invoice
  (never paid out). A debit note is its own DN- bill, for an invoice or shift.
  Existing litres notes can name the shift's attendant; their shift result
  changes at the shift's retail price. A1 does not impose unshipped 2b's
  price-only notes, cancellation or write-off behavior. The newly agreed
  immutable issued-consumption boundary and suitable monetary notes are
  future B2 work, not implemented by A1. See
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
- **Corrections phase 2a: done, on the station since 2026-10-05 (update #15)**
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
- **Corrections phase 2b: built and tested 2026-10-05, not committed**
  (`docs/ROADMAP.md` §3c, `docs/CORRECTIONS.md`): the shift's cash and M-Pesa
  as the right figures (replaces "mixed up"), office payments of credit
  customers, invoice customers and attendants, Move or write off a balance
  (replaces Move balance; invoice customers can be written off), Cancel
  invoice (replaces void), price-only notes by hand. Drawer wages moved to
  phase 3. All 36 backend suites pass, including the new
  `test:corrections-office`; 21 of 21 planted bugs caught. On a scratch copy
  of the station's data (as copied 2026-09-30): migrations 053 to 055 run, all
  124 closed shifts show the same figures and lists; on the desktop an invoice
  payment (date), Cancel invoice (part paid; what was paid held as credit), a move
  between customers and its undo, an office payment (method), an attendant's
  repayment (amount) and a shift's cash/M-Pesa were corrected; on the phone a
  move and an office payment (date). The receivables audit found nothing, and
  the real database was unchanged. The browser test found and fixed: credit
  notes made by a correction could be reversed by hand (would bill fuel
  twice), a cancelled invoice still offered notes and showed "paid", an
  undo's lines read "owes less" for both sides, the undo of a move paid the
  oldest debt instead of reversing the move, and repayment previews did not
  say what the employee owes.
- **2026-10-06: mistakes are fixed by hand at station level** (decided by
  the owner from listed scenarios; `docs/ROADMAP.md` §3e; not built). A closed
  shift is never changed or corrected through. Desktop only, name and PIN: add
  a debt by hand (reason compulsory), Reverse on payments and hand debts, a
  payment fixes a wrong debt; attendants' payments tied to one shortage;
  litres credit/debit on invoice customers' unbilled fuel. The shift Correct
  buttons, Move balance, the attendant tick on notes and standalone debit
  notes go. To confirm: the Cash Flow report will count payments added to fix
  mistakes as money received (no marker, the owner's choice).
- **2026-10-08: fresh operational review requested**: the owner asked for a
  professional, simple approach to reversals, corrections and returns,
  reasoned from station operations rather than the existing correction
  features. Discussion proposal and primary sources saved in
  `docs/ROADMAP.md` §3f; no implementation requested or design adopted.
- **2026-10-09: manual account corrections reaffirmed**: the owner wants
  closed shifts fully unchanged and separate admin entries following a user
  manual, without the proposed automated Fix entry/replacement workflow.
  Refinement recorded in `docs/ROADMAP.md` §3g; draft manual in
  `docs/MANUAL-ACCOUNT-CORRECTIONS.md`. One Account adjustment option in the
  ordinary payment/debt form is recommended to avoid false cash flow, but not
  yet agreed; station-level expense/stock/cost adjustment scope also remains
  to settle. No implementation requested.
- **2026-10-15: editable closed-shift finances investigated**: the owner
  asked about changing all listed financial entries while keeping readings
  fixed. Source assessment in `docs/ROADMAP.md` §3h: no physical later-shift
  or FIFO replay is needed for that scope, but snapshots, account allocations,
  employee variance and issued documents require consistent amendment handling.
  Direct editing is currently blocked; existing corrections cover much of
  the financial work. This is a hypothetical assessment, not a replacement
  decision or implementation request. No station data accessed.
- **2026-10-15: fees removed; finance requirements clarified**: independent
  shift cash/M-Pesa totals explicitly confirmed; once invoiced, source fuel
  consumption must stay fixed and monetary notes handle changes. Ripple trail
  and implementation proposal in `docs/SIMPLIFIED-FINANCE-AND-SHIFT-CORRECTIONS.md`
  and roadmap §3i. Fee removal is built; all 36 backend suites, all three type
  checks, mobile build, scratch receivables audit and real-DB fingerprint check
  pass. Two planted fee regressions were caught and restored. UI verification
  was blocked because Computer Use could not verify the browser URL. No
  station update, commit or push. Remaining report/note/source-lock work is
  specified, not implemented.
- **2026-10-15: complete staged plan and opening-float specification drafted**:
  `docs/IMPLEMENTATION-STAGES.md` combines the latest finance requirements and
  the unimplemented backlog into individually checked releases, indexed in
  `docs/ROADMAP.md`. `docs/SHIFT-FLOATS.md` specifies two explicit pre-opening
  declarations (cash/M-Pesa), no monetary link to an earlier shift, actual
  closing balances, minimal non-sale funds movements, shared report arithmetic
  and historical compatibility. Opening money is not income; old missing floats
  remain not captured. Advances should reuse employee debts and real money
  records rather than require the old journal proposal. This session changed
  planning documents only; it did not implement, commit, push or deploy features.
- **2026-10-15: A1 implemented and verified separately**: the owner said
  proceed. Attached worktree branch `codex/remove-mpesa-fees` starts from the
  exact station commit `c5c4ee8` and includes only fee removal plus tests and
  agreed planning/owner documentation. No old 2b handlers, independent-total
  edits or migration 055 are included. The nested daily-report fee/net leak
  found during isolation is also fixed. All 36 backend suites, all three
  type checks and desktop/mobile builds pass. Two planted regressions were
  caught (nested legacy fee exposure; fee deducted from gross collections),
  original bytes restored and the clean targeted suite passed. The actual
  bootstrap returns 404 for both retired configuration URLs. Settings and
  desktop/phone closed-shift collections were verified using the in-app
  browser on an isolated copy; this resolves the earlier unverified UI gate
  for the A1 candidate. Scratch receivables audit has zero issues; isolated
  listeners/tabs are closed and the final fingerprint is `REAL-DB-UNCHANGED`. Release
  card: `docs/releases/A1-MPESA-FEE-REMOVAL.md` in the attached worktree;
  owner guide: `docs/M-PESA-COLLECTIONS.md`. No commit, push or station update.
- **2026-10-16: A1 committed and published**: the owner said proceed with
  commit/push and station update preparation. Isolated code/plan commit
  `c885a61` was pushed normally to `origin/main`, with the exact remote SHA
  verified. Initial DNS/connected-service failures cleared before the push.
  The publication record is a documentation-only follow-up in the same
  update #16, not another station update. The original mixed primary checkout
  remains on `c5c4ee8`; do not merge into or reset that dirty checkout.
  No station installation has been reported. Existing verification remains
  valid; no application code changed after the completed A1 checks.
- **2026-10-16: A2 developed and workflow updated.** Closed detail and its
  current lists, daily/dashboard, relevant monthly/cash-flow figures and
  history CSV use a shared reader. Original snapshots and explicit original
  views remain available. Historical wages, paid credits, inactive pumps,
  older corrections and missing snapshots have regression coverage. The
  release card records checks and the separate station checkpoint. Development
  continues in bounded, tested commits before station installation; the older
  mixed checkout and actual development database are preserved.
- **Next development:** implement the complete A3 manual opening-float
  workflow, then A4 independent closing cash/M-Pesa corrections.
  Follow the separate B-J releases in `docs/IMPLEMENTATION-STAGES.md`. Install
  A1 and check it before A2; each later installation waits for the preceding
  station checkpoint, while dependent development waits for development checks.
  Stage IDs
  are not station update numbers; #16 is A1. Do not revive the obsolete
  promise of float as update #17 or ship all
  old phase 2b as a bundle.
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
  pastes in from the station from time to time (latest recorded copy: see
  Station PC above; it is not the live station database). Never run the
  backend on it and never modify it. End-to-end tests run on a scratch copy (`scripts/e2e`,
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
