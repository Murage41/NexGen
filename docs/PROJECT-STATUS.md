# NexGen project status

Read at the start of every session; update when code, the station or the plan
changes. What is left to build: `ROADMAP.md`. How to build:
`ENGINEERING-STANDARDS.md`. How each area works: the manuals below.

Last updated: 2026-10-24.

## Station PC

- **Runs update #17**, installed 2026-10-23 (owner's report): commit
  `74ef1f7` on branch `claude/drawer-wage-default` (fix `50f78f9`, built on
  the station's previous code `454640a`). Latest migration
  `20261016_055_shift_floats`. Update #16 (A1–A4 and B1: M-Pesa fees removed,
  current figures, opening cash/M-Pesa, independent cash/M-Pesa corrections,
  customer corrections) is under it.
- **#17 fixed:** A3 (`8997896`) started "Direct wage paid from this shift" at 0,
  so daily-paid attendants showed short by exactly their pay and a typed wage
  was lost on reload. Daily plans now start at the shift's earnings,
  weekly/monthly at 0, and a typed wage stays in the device's shift draft.
  Suite: `test:shift-drawer-wage`.
- **Next station update: #18 = the facelift** (owner yes, 2026-10-26),
  built on branch `ui-facelift` from `main`, not committed yet: new colours
  and grouped menu, navy phone header, 51 helper paragraphs and the
  opening/close notes boxes removed, opening cash/M-Pesa start at 0, and a
  date on the open-shift form (backend `shift_date`, suite
  `test:shift-date`), and optional notes boxes removed from 16 forms
  (payments, receipts, credit sales, shift expenses, dips, invoices, pay
  plans; required reasons stay). Places and clicks unchanged; workflow
  changes follow in the phases of the screen plan. **#18 also ships B2**
  (`4f9b3b4`, migration 056, money-only invoice notes; owner, 2026-10-26).
  The station fast-forwards from `74ef1f7` onto `main`; it never `git pull`s.
  Installation not yet confirmed. Next update after it: #19.

## Development PC

- `main` holds B2, the #17 merge, the docs cut and update #18 (facelift).
  Pushed 2026-10-26 (owner asked). No worktrees; work in
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

- **Screen proposal** awaiting approval (`ROADMAP.md` item 1).
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
