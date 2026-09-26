# NexGen Project Status

**Read this at the start of every session. Update it at the end of any session
that changes code, the station, or the plan.** What is left to build, in
order, is in `docs/ROADMAP.md`; how to build it is in
`docs/ENGINEERING-STANDARDS.md`.

Last updated: 2026-09-26.

## Station PC

- **Running `157a9ec`** (confirmed by the owner 2026-09-26: update #11 applied
  in the stop-first order, all phone checks passed). Latest migration there:
  `050`.
- **Pending station updates: none.** The next one will be **#12**.
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

## How the system works now (recent decisions that code must respect)

- **Closed shifts never change.** Mistakes are fixed by **Move balance**
  (money customer / employee / station) or, for invoice customers, **credit and
  debit notes**. See `docs/CLOSED-SHIFT-CORRECTIONS.md`.
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
- **Next: M7** (tank low-stock alert), then M8, M9, phone invoice actions, a
  UI and design review, Tier 4, Tier 5.
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
