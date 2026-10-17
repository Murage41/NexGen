# B1: customer credit and shift debt-receipt corrections

Authorised 2026-10-17 after published A4 `03d0653`. Branch
`codex/customer-shift-corrections`. Station remains last confirmed at
`c5c4ee8`/054; install/check the preceding A1–A4 releases individually first.

## Boundary and workflow

Complete the existing credit-sale and shift debt-payment correction families:
wrong customer, full amount, wrong shift, duplicate and missing, plus payment
method for receipts. Keep the ordinary Correct / Add missing → preview →
reason → responsibility / limit approval → post → history / permitted undo.
Reuse the existing allocation and account-balance services; add no second
correction subsystem or per-receipt collection capture.

Removing a credit releases only the allocations paying that identified debt.
The real payments remain on their original customer's account, paying their
other eligible debts and leaving excess credit held. A replacement debt belongs
to the chosen customer. Reversing a receipt reopens exactly the debts its live
allocations paid. A replacement receipt uses normal oldest-first settlement;
refund and incomplete-history dependencies must be respected.

The counted cash/M-Pesa totals are independent recorded facts. Correcting a
debt receipt's method does not move those totals. If the count was also wrong,
correct it separately using A4, after checking the money. No automatic invented
receipt, employee charge or wage deduction accompanies a customer reassignment.
Any worsening of a shift requires an explicit responsibility choice.

Credit classification changes reconciliation, not fixed pump sales/profit.
Debt receipts settle debt and are already included in counted money. They
increase expected money once, never income or received money a second time.
Preserve original closes, readings, stock/FIFO, later openings, earned wages,
invoice source/documents and supplier facts. Issued invoice changes, unbilled
invoice limits, expenses, employee debt/targeted repayments and office
payment/refund workflows stay in B2–B7.

## Acceptance examples and gates

- A balanced legacy or balance-based shift has a credit sale of 1,000.
  Correct it to 1,200: accounted credit increases 200 and the result improves
  200; counted money and metered revenue do not change.
- Of that original 1,000 debt, 800 was paid. Correcting the debt to 900 leaves
  100 owed, retaining the 800 real payment. Moving it to another customer
  leaves that money with the original customer, never with the replacement.
  Exposure warnings must use the resulting net debt, without counting freed
  payments twice or requiring an override for an unchanged paid debt.
- A saved debt receipt of 500 was actually 400. Correcting it restores the
  exact prior allocations then posts 400; expected money falls 100 and the
  shift result improves 100 while the saved count stays unchanged. Changing
  only method or customer leaves the combined shift result unchanged.
- Wrong-shift changes affect only the two financial reconciliations and
  involved accounts. Both original closes and later physical/opening facts
  remain unchanged. Missing/duplicate cases and allowed undo retain history.
- Preview values must equal the shared current financial/account figures.
  Changed balances, allocations, limits, refunds or shift correction history,
  including intervening changes followed by undo, invalidate approval.
- Test strict amounts, admin identity and exact-plan binding, explicit
  responsibility, exposure overrides, retries, dependent undo, held/part-paid/
  fully-paid cases, refunds and incomplete allocations. Fixed-value detail,
  daily/dashboard/monthly, cash flow and Original/Current CSV must agree.

Before publication: run all registered suites, touched typechecks, both client
builds, meaningful planted bugs and isolated desktop/phone checks. Compare
protected source facts, run integrity audits, close test servers/tabs and
finish with `REAL-DB-UNCHANGED`. Record actual results below when complete.
No station installation is part of this development turn.

## Development evidence — 2026-10-17; final undo checks 2026-10-18

- All **42 registered backend suites** pass, including the new
  `test:customer-shift-corrections` and existing money-correction compatibility
  suite. All three TypeScript checks and both production builds pass. Existing
  Browserslist data-age and bundle-size warnings remain.
- Fixed-value legacy and balance-based route fixtures cover all credit-sale
  and receipt mistakes, paid/partly-paid/held money, exact reversals, refunds,
  missing/duplicate entries, wrong shifts, dependency undo and explicit staff
  responsibility. Counted funds, inferred actual collections, cash flow,
  metered profit, original close and physical/payroll facts stay unchanged.
  Daily/month/dashboard headers and Original/Current CSV agree after a known
  credit/receipt change and undo; debt receipts do not become a second inflow.
- A 1,000 debt with 800 paid corrected to 1,200 leaves 400 owed. Limit 600
  needs no false override; limit 300 requires a recorded before 200 / increase
  200 / after 400 approval. A fully paid old debt increased later checks its
  newly outstanding overdue amount. Undo cannot bypass current credit rules.
- Strict amounts include the minimum cent and reject zero, negatives, missing,
  strings, nonfinite values, extra decimal places and amounts above 100 million.
  Tests cover admin/attendant access, named desktop PIN binding, signed-in phone
  approval, idempotency, stale previews after history/allocations change and
  undo, and approval unaffected by an unrelated customer's activity.
- Corrupt sale/debt links, duplicate links, mismatched paid balances, incomplete
  payment partitions and allocations to another/deleted/reversed debt are
  refused with an audit instruction. Receipt undo rechecks both restored and
  replacement customer accounts' mode/availability. Refunded receipts remain
  blocked; valid later allocations reverse exactly through existing helpers.
  The final undo check also refuses an original reversed receipt with held
  money (including a sub-cent inconsistency), active allocations or a posted
  refund, leaving all financial rows unchanged when it refuses.
- Five planted faults were caught by assertions: receipt variance sign,
  omitted customer-state approval binding, omission of released paid money
  from exposure, skipped allocation proof, and skipped reversed-receipt undo
  proof. Exact original source bytes /
  SHA-256 hashes were restored after each; the clean expanded suite passed.
  Screen-expression tests cover full source amounts on paid debts, strict
  currency and renewed review when displayed server results change.
- Isolated desktop/phone checks used the available 2026-09-30 station copy plus
  fictional fixtures. On a balanced shift, phone correction of paid credit
  1,000 → 1,200 showed owed 200 → 400 and a 200 surplus, without a false limit
  warning. Desktop account history displayed amount 1,200 / paid 800 / remaining
  400. Invalid precision disabled preview/post on the narrow phone form.
- Desktop receipt correction 500 → 600 showed customer debt 1,500 → 1,400 and
  surplus 200 → 100, explicitly approved for the station. Cash 8,000/M-Pesa
  5,500 remained fixed. Original close stayed balanced with credit 1,000 and
  receipt 500. Desktop undo restored receipt 500, customer debt and the 200
  surplus; the separate credit correction remained. Both browser error logs
  were empty; the narrow phone form was visually checked.
- Scratch before/after hashes match for **30 protected selections / 3,249 rows**
  covering shifts/counts/snapshots, readings, stock/FIFO, invoice documents,
  expenses, wages/payroll, custody movements, supplier facts and uninvolved
  customers. Original debt, shift-credit and payment source fields also match;
  permitted status/balance/allocation changes remain recorded. SQLite is OK;
  foreign-key, receivable, negative-revision, incomplete-operation, missing-close
  and stale-open audit counts are all zero. Test tabs/servers are closed.
  Final fingerprint: **REAL-DB-UNCHANGED**.

This is a separate development release directly after `03d0653`; the completion
report supplies its exact published commit. It needs no migration, dependency
installation or history rewrite. Queue installation/checks A1 → A2 → A3 → A4 →
B1; the station is still last confirmed at `c5c4ee8`/054. Rehearse a known case
on a current backup, then check genuine corrections, their account allocation,
Original close, counted money and reports at the station. Preserve all newer
business/correction history during recovery; use a forward fix rather than
restoring an old database over transactions recorded since a backup.
Next development: **B2**, fixed issued consumption and monetary notes.
