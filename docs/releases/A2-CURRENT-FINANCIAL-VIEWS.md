# A2: consistent current shift financial views

Authorised 2026-10-16. Base: `7695895` (A1 plus its publication record).
Branch: `codex/current-shift-financials`. This release changes reads and labels,
not posting, correction permissions, readings, stock or close snapshots.

## Workflow and boundaries

The default closed-shift view, daily/dashboard and relevant period totals use
the same current financial facts: recorded cash/M-Pesa with their posted
collection adjustments, active full credit sales, active invoice consumption,
posted debt receipts and active drawer expenses. Paid credits and already
invoiced fuel still count as how the original metered sale was accounted for.
Do not add debt receipts to cash a second time. Keep the original close
available as saved evidence, explicitly labelled; history export retains its
original columns and adds clearly named current columns.

Closed expected meter sales and the recorded wage basis use the saved close
where present. Current pump activation or today's employee wage cannot change
an unamended historic shift. Legacy actual wage cash remains distinct from
the reconciliation wage; exclude wage mirrors from additional payroll payouts.
Missing snapshots are marked unavailable; no read creates or backfills data.
Detail lists, figures and correction history are read in one transaction, so
a correction from another device cannot mix two versions in one response.

Manual balance moves and invoice-attendant liability notes are not new cash
or source-shift fuel. Their account history remains separate. Invoice revenue
adjustments retain their posting date. Supplier cash-flow correction is C1.

No floats (A3), independent-total correction entry (A4), new invoice-source
locks (B2), new ledger, migrations or extra automatic postings are included.

## Acceptance cases

- Corrected three-shift fixture: cash 31,100, M-Pesa 10,100, credits 3,900,
  expenses 350, drawer wages 2,400, debt receipts 2,250, fixed pump sales
  45,000. Accounted 47,850 less expected 47,250 gives variance +600.
  Detail, daily, dashboard, monthly and relevant cash flow must agree.
- Correction and undo retain every original close and restore the known
  current figures exactly. Original-view lists remain reproducible.
- Historical/backfilled snapshots do not double-count older corrections.
  Liability-only changes do not change tender totals or metered sales.
- Fully paid credit, reserved/issued fuel, explicit zero wage, legacy wage
  deduction, payroll mirror and inactive historical pump cases remain correct.
- Admin/own-shift restrictions and blind-open responses hold in both clients.
- Before/after reads leave source rows, accounts, employee debt entries,
  earnings, pump readings, tank/FIFO records and original snapshots unchanged.

## Checks and delivery

Use synthetic temporary databases and isolated copies of available station
data; never run the backend on the real development copy. Type-check touched
packages, run the registered suites, build affected clients, plant meaningful
regressions, review source and verify desktop/phone. Finish with the real
database fingerprint unchanged. Record any coverage or station-data-age limit.

The owner changed the workflow on 2026-10-16: development and tested commits
may continue before station installation. Keep each stage independently
reviewable and queued. Install A1, check it, then A2 and check it; never combine
the pending stages into one unverified station jump. Station checks block the
next installation, not further isolated development.

At the station, compare a corrected closed shift across detail/daily reports,
open Original close, compare its saved figures, and verify unchanged pump
sales/stock and normal attendant visibility. Use a current station backup
before installation checks where historical-data coverage needs refreshing.
Recovery keeps newer business data: stop the process, restore the previous
application code/build if required, retain the current database. This read-only
release adds no migration or financial-data rewrite.

## Development evidence (2026-10-16)

- All **37 registered backend suites pass** on the final source, including
  current/original detail, daily/dashboard/monthly/cash-flow comparisons,
  correction/undo and unchanged underlying money/stock records.
- The new historical-view suite covers legacy/backfilled closes, deleted and
  fully paid credits, issued consumption, inactive pumps, actual versus
  reconciliation wages, explicit zero/NULL payments, mirrors, permissions and
  original/current history export. A separate WAL connection commits a
  correction midway through a detail GET: the first response remains one
  complete snapshot, the next sees the full correction, original close stays
  unchanged.
- Backend, desktop and mobile type checks and both client builds pass.
  Existing bundle-size/Browserslist warnings remain.
- Three planted bugs were caught: reversed collection sign, revival of a
  deleted legacy credit and treating an old recorded wage as cash actually
  paid. Exact source bytes were restored after each; clean targeted suites
  passed, followed by the final full run.
- Scratch desktop and phone checks: synthetic cash 9,300/M-Pesa 10,400,
  expense zero and variance -300 agree with the daily report/dashboard.
  Original close retains cash 10,000/M-Pesa 9,700, expense 300 and balanced
  variance. The phone's narrow layout, admin view and own-shift attendant view
  were checked; attendant correction controls remain absent. The final detail
  response was rechecked after the transaction fix; no browser errors there.
- Scratch receivables audit: zero issues. Scratch servers stopped; the actual
  development database fingerprint reports `REAL-DB-UNCHANGED`.

Historical scratch coverage uses the station copy supplied on 2026-09-30,
migrated through 054, plus synthetic records. This is development evidence;
newer station business still needs the separate installation checkpoint.
No station installation has been performed or confirmed.
