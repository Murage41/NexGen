# A3: manual opening funds and shift reconciliation

Authorised 2026-10-16 after A2 (`ab50f1b`). Development branch:
`codex/shift-floats`. Station remains last confirmed at `c5c4ee8`, migration
054. A1 and A2 remain queued for separate installation/checks.

## Delivered workflow and boundary

An administrator explicitly enters opening cash and opening M-Pesa before
opening each new shift. Both values are required, zero is valid, neither comes
from a previous shift. Closing fields count actual cash remaining and M-Pesa
balance. Opening funds are balances, never sales or a fresh receipt.

Use one small admin form for otherwise unrecorded custody money added or
removed, with method, source/destination, reference and reason. Reuse existing
preview, approval, correction history and reversal mechanisms. Correct wrong
opening declarations with visible before/after history. No new ledger, bank
integration, automatic handover or independent closing-total edit (A4).

The shared current/original calculation, close preview, daily/dashboard,
monthly/cash flow, history/export and desktop/phone must agree. Meter readings,
fuel stock/FIFO, sales revenue and earned wages do not change because of a
float or custody movement. Internal transfers do not become expenses or new
station cash flow. Owner funding/drawings are separate from trading figures.

## Data and compatibility

New guarded migration 055 adds nullable original opening declarations,
`reconciliation_basis` (`legacy` or `balances_v1`), audit information, frozen
close evidence and a small funds-movement history. Do not reuse the older
unshipped primary checkout's office-corrections migration 055. No historical
opening estimate or snapshot backfill: existing closed and already-open shifts
stay legacy. Only newly opened shifts use balances. Old clients cannot submit
receipt-only fields to those shifts; return a plain reload message.

Original declarations and close snapshots remain unchanged. Effective opening
values include posted opening corrections exactly once. Corrections made while
open are captured in the close; later amendments do not count them again.
Posted movements are reversed with retained history. New movements, approvals,
duplicate requests and conflicting writes use existing transaction controls.

## Fixed acceptance amounts

Opening cash 2,000 and M-Pesa 3,000; metered sales 10,000; credit sales 1,000;
invoice fuel 2,000; debt receipts 500; drawer expense 400; actual wage cash 600.
Expected closing is **11,500**. Closing cash 6,000 and M-Pesa 5,500 balances;
cash 5,700 makes a **300 shortage**. Combined inferred collections are **7,500**
or **7,200** respectively, never opening plus sales and never channel-specific
receipts invented from custody counts.

A 2,500 internal M-Pesa transfer out reduces expected closing to 9,000 without
expense, shortage or station cash outflow. A 1,000 float top-up raises expected
closing to 12,500 without income. Opening 5,000 with no sales and a genuine
1,000 drawer expense permits a closing balance of 4,000. A later shift can
independently open with 1,200 cash and 800 M-Pesa and remains unaffected by
earlier financial corrections.

Test explicit zero/missing/negative/nonfinite/overlimit inputs, duplicate open
and movement requests, stale edits, old-client rejection, own-shift visibility
and blind open fields, opening/movement correction and undo, original evidence,
legacy compatibility, full cross-report figures and unchanged underlying stock,
customer/supplier debts and earnings. Run registered suites, touched type
checks, both builds, planted regressions, desktop/phone scratch verification,
integrity audits and the final real database fingerprint.

## Installation and recovery

Develop against private synthetic databases and isolated available station
copies, recording age. Refresh the station copy for migration/installation
checks as needed; verify backup restore before the station migration. Install
and check A1, then A2, then this release separately. Check an existing open
shift stays legacy and the next shift requires both opening declarations.
Confirm the worked reconciliation and a real custody movement with the owner.

Stop the station before merging/migrating. Migration down refuses deletion of
financial history. Preserve business entered after installation: application
rollback must retain and understand new balance-based shifts, or use a verified
pre-update backup only with an explicit plan for later business. Never replace
the live database casually to undo an application update.

## Development evidence (2026-10-16 to 2026-10-17)

- **40 registered backend suites pass** on the final financial source, plus
  backend typecheck. New suites cover fixed arithmetic/reader edge cases,
  opening and movement corrections, and the real route lifecycle with
  daily/month/dashboard/cash-flow comparisons, permission/old-client/stale/
  idempotent/count guards and unchanged physical/account/earnings records.
- The screen-expression suite checks both clients' 11,500 balanced example,
  300 shortage, 9,000 after bank removal, 12,500 after top-up and a 4,000
  no-sale closing after a genuine expense. Desktop/phone typechecks and both
  production builds pass, including the final original-close label change.
  Existing bundle-size/Browserslist warnings remain.
- **Five planted bugs were caught**: wrong opening correction sign, counting
  pre-close effects twice, undoing a pre-close change after close, omitting
  opening money from expected accountability, and the wrong removal sign in
  inferred collections. Exact source bytes/hashes were restored after each;
  clean targeted tests and the full run passed afterward.
- Migration 054→055 on the isolated available copy, repeat up, verified backup
  and independent restoration all passed. All **72 existing business tables
  and 4,180 old rows**, projected onto their original columns, retain their
  hashes, including issued documents, snapshots, stock/FIFO, accounts and
  payroll. Its one already-open shift remained legacy with uncaptured openings.
- Scratch UI: desktop explicitly opened 2,000 cash/3,000 M-Pesa. A desktop
  PIN-approved 1,000 cash top-up, phone bank removal 2,500, phone expense 400,
  actual closing 7,000/5,500 and explicit wage paid 600 closed balanced at
  **12,500**; inferred collections were **10,000** on 10,000 metered sales.
  The phone attendant saw opening funds, blank count inputs and no expected
  totals/variance, then saved both actual balances. Phone admin corrected the
  closed opening cash to 2,300 with station responsibility: current shortage
  300/inferred collections 9,700, while Original close kept 2,000, balanced
  result and inferred collections 10,000. The narrow phone layout was checked.
- The next phone opening started blank and independently accepted 1,200 cash
  and 800 M-Pesa. Cancelling that unused synthetic shift preserved its opening
  history and displayed no assessed shortage. No browser console errors on
  the final phone check. Temporary viewport and scratch tabs/listeners cleaned.
- Final scratch operational/receivables audit: SQLite OK, zero foreign-key,
  receivable, negative revision or incomplete-operation issues. Real database
  fingerprint: `REAL-DB-UNCHANGED`.

Scratch source is the station copy supplied on 2026-09-30, plus fictional A2/A3
fixtures. No fresh live station connection or station installation was used.
The separate station migration/checkpoint and current-data refresh remain
installation work; development does not claim those checks have occurred.
