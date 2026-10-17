# A4: independently correct cash and M-Pesa totals

Authorised 2026-10-17 after A3 (`8997896`). Branch
`codex/closing-total-corrections`. Station remains last confirmed at `c5c4ee8`,
migration 054; A1, A2 and A3 are queued for separate installation/checks.

## Workflow and boundary

On a closed shift, an admin opens **Correct cash and M-Pesa totals** (legacy)
or **Correct closing balances** (A3). Both current totals are prefilled. The
admin enters the right full amounts, changing one or both; zero is valid.
The combined total may increase, decrease or stay unchanged. This corrects
the recorded figures; it does not record an actual transfer between methods.

Reuse the existing correction preview, reason, exact-plan approval, employee
responsibility decision, history, duplicate-request protection and undo.
Post signed lines for the affected totals without changing the source row
or original close. Older split-only records and cached requests remain valid.
Use A2/A3's shared current figures as the before values, including original
snapshot evidence and earlier corrections. Preserve the financial basis.

For balance-based shifts these are actual remaining cash/M-Pesa holdings,
including opening funds. For legacy shifts they retain their original received
totals meaning. Opening declarations, custody movements, pump readings, tank
stock/FIFO, metered sales, customer debts and earned wages are not changed by
correcting the totals. Later shifts keep their own opening declarations.
Only an approved responsibility effect can change the attendant's variance
ledger. Never deduct the shortage from pay or make it another profit expense.

No new migration, correction engine, receipt-per-transaction capture, opening
edit, invoice rule, debt/payment edit family or general ledger is included.

## Acceptance cases

Use fixed legacy and balance-based closed fixtures. For a balanced A3 shift
whose expected closing funds are 11,500 and recorded cash/M-Pesa are 6,000/
5,500: change cash to 5,700 alone → short 300; restore cash to 6,000 and reduce
M-Pesa to 5,200 → short 300; cash 6,200/M-Pesa 5,400 → over 100. A same-total
method correction leaves combined variance unchanged. Correcting one total
to explicit zero is allowed; an unchanged pair is refused.

Detail, daily/dashboard, monthly, cash flow and history/CSV must agree with
the same current amounts; original snapshots remain reproducible. Inferred
collections change by the combined closing difference; metered sales, profit,
stock, customer/supplier debt and earned wages do not change. Undo restores
the earlier current figures exactly and retains its own history. Refuse undo
that depends on a later collection correction until that one is undone first.

Test missing/null/blank/string/nonfinite/negative/overlimit/overprecision
amounts, permissions and approval binding, independent methods, duplicate
requests, stale preview after intervening corrections and undo, legacy source/
snapshot differences, missing source with saved snapshot, and unsupported
missing evidence. Compare all unaffected source/account/stock/payroll rows.

## Checks and delivery

Use private synthetic databases plus the isolated available station copy;
never run the backend against the real development database. Run all registered
suites, touched typechecks, both client builds, meaningful planted bugs and
desktop/phone verification. Finish with relevant integrity audits, scratch
cleanup and `REAL-DB-UNCHANGED`.

Install A1, check it; A2, check it; A3 with verified backup/migration, check it;
then this separate release. At the station correct a known cash-only/M-Pesa-only
mistake, compare reports and Original close, and confirm later openings/stock
remain unchanged. Refresh available data for installation checks as needed.
This release adds no migration or data rewrite. Recovery must preserve newer
business and correction history; never restore an old database over it merely
to roll back application code.

## Development evidence — 2026-10-17

- All **41 registered backend suites** pass, including the new
  `test:closing-total-corrections`. All three TypeScript checks and both Vite
  production builds pass. Existing bundle-size/Browserslist warnings remain.
- The focused suite closes legacy and balance-based shifts through real
  routes. It checks cash-only, M-Pesa-only, both-method, same-sum, zero, cents,
  reset and undo; exact expected values agree across detail, daily, monthly,
  dashboard, cash flow and Original/Current CSV. Count changes do not become
  profit or a second customer receipt. Actual payout/funding facts are included.
- Strict invalid-input cases, attendant denial, desktop PIN binding, phone
  admin identity, responsibility, idempotency and stale approval after
  collection/opening/movement/expense/debt-receipt changes and undo pass.
  Original/source divergence, missing snapshot, saved snapshot without source,
  and missing both are covered. A historical expense mismatch proves the
  preview starts from the same current variance that reports show.
- Three planted bugs were caught: wrong closing-effect sign, coercing missing/
  string amounts, and dropping history/state approval binding. Original source
  bytes/hashes were restored after each; the clean suite passed. The screen
  suite executes actual form expressions for currency validity and fresh
  review when the displayed server result changes despite the same count sum.
- Independent review found one report edge: a saved closed balance count was
  excluded when its old collection row was absent. The shared reader now
  treats the saved snapshot as count evidence, without inserting a source row.
  The new suite verifies its correction, report inclusion and undo. Open
  cache-only counts remain excluded; the existing float suites pass.
- Desktop/phone verification used the isolated available 2026-09-30 station
  copy plus fictional fixtures. A balance-based cash-only decrease of 300
  changed short 300 to short 600; a phone M-Pesa-only decrease of 300 changed
  it to short 900, with inferred collections 9,100. Original close remained
  balanced with cash 7,000/M-Pesa 5,500 and its own saved opening funds.
  Explicit zero previews correctly; clearing it removes the approvable preview.
- On a legacy shift, a phone cash-only increase of 300 made short 300 balanced.
  Desktop undo restored cash 9,300/M-Pesa 10,400 and short 300, retaining both
  correction and undo history. The narrow phone form was visually checked;
  both browser error logs were empty.
- Before/after hashes match for **28 protected table selections / 3,232 rows**
  on the scratch copy: source counts, shifts/later openings, original closes,
  readings, stock/FIFO, customer debts/accounts, invoice facts, expenses,
  earned wages/payroll, supplier bills/payments and custody source rows.
  SQLite integrity is OK; foreign-key, receivable, negative-revision,
  incomplete-operation, missing-close and stale-open audit counts are all zero.
  Isolated servers/tabs are closed. Final fingerprint: **REAL-DB-UNCHANGED**.

This is a separate development release directly after `8997896`; its exact
publication commit is supplied with the completion report. The station remains
last confirmed at `c5c4ee8`/054. Install/check A1 → A2 → A3 → A4 one at a time.
Next development stage: **B1**, customer credit and shift debt receipts.
