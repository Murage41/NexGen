# NexGen Project Status

**Read this at the start of every session. Update it at the end of any session
that changes code, the station, or the plan.** What is left to build, in
order, is in `docs/ROADMAP.md`; how to build it is in
`docs/ENGINEERING-STANDARDS.md`.

Last updated: 2026-09-24.

## Station PC

- **Running `7e9fd54`** (confirmed by the owner 2026-09-24: updates #8, #9 and
  #10 applied, all checks passed). Latest migration there: `050`.
- **Pending station updates: none.** The next one will be **#11**.
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

## Milestones

- Roadmap Tiers 1-3: done (2026-09-10 to 09-12).
- Owner's urgent matters: **M1-M5 done; M5b-M5e done** (closed-shift
  corrections evolved into Move balance and the shortages ledger); **M2 closed
  2026-09-24** (diesel main pump set to roll over at 100,000 L and confirmed on
  the station; old-log PIN check returned 0).
- **Next: M6, what attendants can see.** The owner decided on 2026-09-24:
  tank fuel levels, money customers' credit, no invoice customers (names only,
  to record fuel on account), only their own debts, and no variance or
  expected totals on an open shift (a blind close); also pumps shown,
  customers' phone numbers and statements hidden, and only the shift status
  on the attendant's home screen. The spec is `docs/ROADMAP.md` §1. Then M7, M8,
  M9, phone invoice actions, a UI and design review, Tier 4, Tier 5.
- 2026-09-24: the project's rules and status moved into committed files
  (`CLAUDE.md`, this file, `docs/ROADMAP.md`, `docs/ENGINEERING-STANDARDS.md`,
  `scripts/e2e/`), and the roadmap was re-checked against the code.

## Open items for the owner

- **The GitHub repository `Murage41/NexGen` is public.** Committed files must
  never contain real names, balances, PINs or other station data. Some older
  docs (`RECOVERY-MECHANISM-CORRECTION.md`, `EMPLOYEE-ADMIN-ACCESS-PLAN.md`,
  `HISTORICAL-DEBT-CLEARANCE.md`, `PAYROLL-REGRESSION-VERIFICATION.md`) already
  name staff or customers; the owner should decide whether to make the repo
  private or have those scrubbed.
- Accepted-for-now gaps (desktop has no login, unsigned installer, eTIMS stays
  with POSitive, dev-mode station processes): `docs/PRODUCTION-SECURITY-AND-COMPLIANCE.md`.

## Station facts that code must respect

- Pumps: petrol, diesel main, diesel 2. Meters roll over at 1,000,000, except
  the diesel main pump's litres at 100,000 (configured per pump).
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
