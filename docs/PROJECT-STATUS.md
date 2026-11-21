# NexGen project status

Read at the start of every session; update when code, the station or the plan
changes. What is left to build: `ROADMAP.md`. How to build:
`ENGINEERING-STANDARDS.md`. How each area works: the manuals below.

Last updated: 2026-11-21.

## Station PC

- **Runs update #27** (`9453542`, installed 2026-11-20 per the owner's
  report; see below), on top of #26 `1a428d9`, #25 `16b9642`, #24 `dab2acb`, #23 `123eb2a`, #22 `cdca8fa` and #21 `c97a87f` (one page per employee: owed, earned, pay due; tabs Pay,
  Shortages, Pay plan & details). Before it #20 `90e3022` (phone shift page
  in tabs, cash count first in Money) and #19 `c35dc4e` (desktop shift page
  in tabs, one-press close, "Record my shift"). Latest migration
  `20261020_056_issued_invoice_money_notes` (#18).
- **Update #18**, installed 2026-10-26 (owner's report): `main` at
  `cea43f3`, latest migration `20261020_056_issued_invoice_money_notes`.
  It brought: the facelift (new colours, grouped menu, navy phone header,
  helper paragraphs and optional notes boxes removed from about 16 forms;
  places and clicks unchanged), opening cash/M-Pesa starting at 0, a date on
  the open-shift form (`ceca62d`, suite `test:shift-date`), and B2
  (`4f9b3b4`, money-only invoice credit/debit notes). Under it: #17 (daily
  drawer wage, `74ef1f7`) and #16 (A1–A4, B1).
- The station is now on branch `main` and fast-forwards to pinned commits;
  it never `git pull`s.
- **Update #22 installed 2026-10-28** (owner's report; station now at
  `cdca8fa`, no migration; next update number #23): one desktop **Customers** list (credit and invoice customers,
  owes, flags) opening each customer's own records; on-screen messages
  (`shared/ui/Notify.tsx`: short "done" after saves that matter, errors for
  lost connection/server failures and three silent phone saves); about 20
  more explanation lines cut; description boxes back on credit sales and
  shift expenses; My Pay redone (figures, short tables, colour); phone home
  shows tank levels for everyone; attendants' Credits sorted by who owes
  most, like the admin's (backend sort, `test:attendant-access`) (owner,
  2026-10-28). No migration, no new packages. Phone Credits
  and Invoice Customers stay separate for now.
- **Update #23 installed 2026-10-29** (owner's report; station now at
  `123eb2a`, no migration; next update number #24): screen
  phase 4. Desktop **Stock** (tank list, tank page with
  Stock ledger / Dips / Deliveries / Adjustments), supplier page with Bills
  (delivery, still owed, days late) / Payments / Details, menu Stock ·
  Suppliers · Prices with Pumps under Settings; phone tank and supplier pages
  the same way, phone Add supplier fixed, last-dip figure now against the
  book at that dip. Frontend only; no migration, no new packages.
- **Update #24 installed by 2026-11-04** (owner's `git log` on the station
  shows `dab2acb`; no migration; phone build not confirmed; next update
  number #25): screen phase 5. **Today** (was Dashboard: open shift with its
  date, rows Today / This month / Money owed incl. what we owe suppliers,
  every box opens its page), Expenses with Expenses / Wages chips and month
  arrows, Reports tabs Day / Month / Stock / Who owes us / Cash flow loading
  at once with plain cash-flow words, one Corrections list (corrections,
  balance moves, older shift corrections; Mistakes Fixed left Reports),
  Settings tabs Station profile / Pumps / System; phone home, Expenses and
  Reports the same way. Frontend only; no migration, no new packages.
- **Update #25 installed 2026-11-11** (`16b9642`, owner's report in project
  memory; was pending since the owner asked for the commands that day): edit history on open shifts. Migration
  `20261104_057_shift_history` (table `shift_history`, never changed or
  deleted; `shift_expenses` gains `created_at` and
  `created_by_employee_id`). Readings, opening readings and cash/M-Pesa
  saves that change a figure, and expenses, credit sales, invoice fuel and
  debt payments removed, keep who/when/old → new; the shift's History shows
  them grouped (one line per sitting) with each expense and who did it.
  Suite `test:shift-history`. Needs a backup at install. History is latest
  first. The owner wants this and the next item on the station together, as
  one update (2026-11-05).
- **Update #26 installed by 2026-11-17** (owner's report; station now at
  `1a428d9`; no migration, no new packages, no phone rebuild): undo and delete recounts (`ROADMAP.md` item 4).
  Archiving a customer keeps their debts and payments (old shifts and reports
  no longer change); a supplier bill with any payment cannot be deleted;
  reversing a customer or supplier payment, or a shift's FIFO use, counts the
  debt, bill or fuel batch again (`services/cacheRecounts.ts`); the Today
  drift check runs in one pass and also checks debts, bills and batches, and
  the System check includes it; a late delivery or stock adjustment recounts
  closed shifts' tank litres; an open-shift credit with a payment cannot be
  removed. Suite `test:reversal-recounts`. Station data copy (to shift #157)
  had no archived customers and no drift: no repair needed. Next update
  number #27.
- **Update #27 installed 2026-11-20** (owner's report; station now at `9453542`; no pending station update; next update
  number #28): an invoice customer with fuel not yet invoiced or a draft invoice
  cannot be removed or switched to money billing (one check in
  `routes/creditAccounts.ts`, `invoiceWorkLeft`; suite
  `test:reversal-recounts`). No screen offered Remove for invoice customers,
  so it was reachable only through the server. Then the invoice review
  (`ROADMAP.md` item 5, owner's go-ahead 2026-11-18): drafts take all
  unbilled fuel up to a date, billed at the pump amounts with one line per fuel
  and price (no From date, no typed prices); invoice PDFs list **Fuel by
  shift**; Overdue / Over limit / Not invoiced flags and Today reminders for
  invoice customers, desktop and phone; a Statement PDF; fuel corrections check
  the credit limit. New suite `test:invoice-followup`; 50 suites. No database
  change, no new packages; **the phone app needs a rebuild** (`npm run
  build:mobile`).
- **Pending station update #28** (owner asked for the station commands
  2026-11-21; pushed to `main` in the commit after `9453542`; next update
  number #29; `ROADMAP.md` item 6): payment codes required
  for M-Pesa/bank/cheque on every payment, never reused, Add code on older
  payments; debts in litres or amount at the pump price for every customer, no
  pump choice, litres checked per fuel; light customer picker; phone step bar
  Readings · Count · Close; notes back on Close. Migration
  `20261121_058_payment_codes_and_debt_fuel` (needs a backup at install);
  phone rebuild. Suite `test:shift-debts-codes`; 51 suites.
- **Also in #25:** one dated shortages list (latest first, red
  adds, green takes off, owed after each line; server `ledger` on the
  statement, no database change), **My Pay renamed My Account** with tabs Pay
  (paid this month, in payroll not paid, not in any payroll yet, full plan,
  lists, `paid_history`) and Shortages; the admin's Pay tab uses the same
  layout. Suite `test:employee-account`.
- **Offered, not chosen (2026-10-26):** closing reading boxes starting empty
  so every pump must be typed; the owner shipped #20 without it.

## Development PC

- `main` holds B2, the #17 merge, the docs cut and updates #18 to #28.
  Pushed 2026-11-11 (owner asked). No worktrees; work in
  `D:\NexGen` on a branch.
- Local-only archive branches (never push): `archive/old-phase-2b` (the
  abandoned office-corrections design; its migration 055 clashes with the
  real 055), `archive/shift-pay-calculation` (alternative wage fix with
  migration 057; never ship), `archive/focused-feistel`,
  `archive/mystifying-johnson`. `codex/production-readiness` has 13 commits
  not in `main` (also on GitHub); don't build on it.
- `backend/data/nexgen.db` is the owner's copy of station data, refreshed
  by the owner after 2026-10-29 (shifts to #157, none open). Never run the backend on
  it; E2E uses `scripts/e2e` on a scratch copy.
- **Incident, 2026-10-23:** removing an old Codex worktree deleted through its
  `node_modules` junction and emptied `backend`, `desktop`, `mobile`, `shared`
  and `node_modules` here, including the station data copy and the dev
  `backend/data/backups` folder (the station's own backups were not touched).
  Code was restored from git, packages reinstalled, the phone app rebuilt and
  all 45 suites pass. The old untracked `mobile/android` scaffold went too.
  Rule added: `ENGINEERING-STANDARDS.md` §6 and CLAUDE.md.
- Private evidence, never committed: `.e2e-data/reading-recovery-20261023-102120/`,
  `ui-proposal-20261023/`, `wage-fix-audit-20261023/`.
- Never start ngrok here (`station:bg`, `dev:bg`, `*:tunnel` all do).

## Manuals

| File | Covers |
|---|---|
| `SHIFTS.md` | Opening, recording, closing, current figures, what attendants see |
| `CORRECTIONS.md` | Fixing closed records, undo, Move balance |
| `CUSTOMERS.md` | Money and invoice customers, limits, invoices, notes, documents |
| `STAFF-AND-PAY.md` | Pay plans, payroll, shortages, My Account |
| `STOCK.md` | Deliveries, FIFO, dips, low-fuel warning, prices |
| `STATION-PC.md` | Running, backups, updates, audits, station profile |

## Open items for the owner

- **Screen phase 5** (dashboard, expenses, reports, corrections, settings):
  proposal next (`ROADMAP.md` item 1).
- **Public repository:** the tracked spreadsheets `NEXGENLTRS (Autosaved).xlsx`
  and `NexGen_Litres_Tracker.xlsx` may hold station figures; staff names remain
  in pushed migrations 018/023 and one-off `backend/scripts/repair_*`, `fix_*`
  and `clear_*` scripts. Old commits keep removed docs that named staff.
  Owner to decide; nothing removed yet.
- Accepted for now: desktop has no login (shared key), ngrok for phones,
  unsigned installer, eTIMS stays with POSitive.

## Station facts code must respect

- Pumps: petrol, diesel main, diesel 2. Meters have 6 digits and roll over at
  999,999.99 (litres and KES), except diesel main litres at 99,999.999.
  Readings are stored as running totals past each rollover.
- Prices are EPRA's published price plus the owner's transport cost.
- One or two attendants per shift, mostly paid daily; payroll also has
  non-attendant staff. Pay is never reduced for shortages.
- Customers: money (credit) customers and invoice customers.
- POSitive (Asprime) is the fiscal/eTIMS system; NexGen documents are not tax
  invoices.
