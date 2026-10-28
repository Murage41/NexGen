# NexGen project status

Read at the start of every session; update when code, the station or the plan
changes. What is left to build: `ROADMAP.md`. How to build:
`ENGINEERING-STANDARDS.md`. How each area works: the manuals below.

Last updated: 2026-10-28.

## Station PC

- **Runs update #22** (`cdca8fa`, see below), on top of #21 `c97a87f` (one page per employee: owed, earned, pay due; tabs Pay,
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
- **Pending station update #23** (owner yes 2026-10-28; pushed to `main`
  2026-10-28 in the commit after `cdca8fa`; next update number #24): screen
  phase 4. Desktop **Stock** (tank list, tank page with
  Stock ledger / Dips / Deliveries / Adjustments), supplier page with Bills
  (delivery, still owed, days late) / Payments / Details, menu Stock ·
  Suppliers · Prices with Pumps under Settings; phone tank and supplier pages
  the same way, phone Add supplier fixed, last-dip figure now against the
  book at that dip. Frontend only; no migration, no new packages.
- **Offered, not chosen (2026-10-26):** closing reading boxes starting empty
  so every pump must be typed; the owner shipped #20 without it.

## Development PC

- `main` holds B2, the #17 merge, the docs cut and updates #18 to #23.
  Pushed 2026-10-28 (owner asked). No worktrees; work in
  `D:\NexGen` on a branch.
- Local-only archive branches (never push): `archive/old-phase-2b` (the
  abandoned office-corrections design; its migration 055 clashes with the
  real 055), `archive/shift-pay-calculation` (alternative wage fix with
  migration 057; never ship), `archive/focused-feistel`,
  `archive/mystifying-johnson`. `codex/production-readiness` has 13 commits
  not in `main` (also on GitHub); don't build on it.
- `backend/data/nexgen.db` is the owner's copy of station data from
  2026-10-23 (shifts to #151, one open), re-pasted 2026-10-24 after the
  incident below. Fingerprint re-saved 2026-10-24. Never run the backend on
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
| `STAFF-AND-PAY.md` | Pay plans, payroll, shortages, My Pay |
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
