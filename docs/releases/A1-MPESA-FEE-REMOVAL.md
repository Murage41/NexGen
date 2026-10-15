# A1: remove M-Pesa fees

Scope authorised by the owner's instruction to proceed on 2026-10-15.
Release base: station update #15, `c5c4ee8`, migration `054`.
Implementation branch: `codex/remove-mpesa-fees`, in its attached worktree.
Publication authorised 2026-10-16. Code/plan commit `c885a61` is published on
`origin/main`, verified with `git ls-remote` after a normal fast-forward push.
An initial connectivity failure cleared. A documentation-only follow-up
records publication within the same station update #16. Installation and the
owner's station checkpoint are pending; use the final published release commit
provided in the station command block.

## One workflow

Enter the actual M-Pesa amount for a shift. The application saves, displays
and reports that amount without an estimated fee or a second net figure.
The settings page offers no fee configuration and the retired configuration
API is unavailable. Existing cash/M-Pesa split correction and undo still work.

## Included changes

- Remove the fee route/service, registration and runtime fee-table statistics.
- Stop collection and correction fee calculations/writes.
- Remove fee/net fields from shift, dashboard, daily report and correction
  responses, including historical nested daily collections.
- Remove desktop settings/API helpers and desktop/phone fee displays.
- Add focused fee regression coverage and preserve ordinary split correction.

No new schema, dependency or migration is required. Existing fee columns,
configuration history, stored correction explanations and pushed migrations
remain unchanged historical storage. Original close snapshots stay unchanged.

Excluded: phase 2b office corrections, independent closing totals (A4), current
financial reader (A2), floats (A3), invoice-source/note changes, stock or payroll
changes. The original mixed working tree is preserved separately.

## Acceptance cases

1. Cash 1,000 and M-Pesa 2,000 remain 3,000 combined, regardless of stale fee
   columns or configured rates. No fee/net fields appear in active responses.
2. Saving collections works with no fee configuration table. Legacy fee/net
   fields on existing rows are not rewritten or used.
3. Existing closed-shift split correction moves the same amount between cash
   and M-Pesa, with no variance/profit/stock effect; undo reverses it exactly.
   New correction responses and descriptions have no fee calculation.
4. Original close, readings, tanks, FIFO, customer debt and earned wages remain
   unchanged. Attendants retain existing access restrictions and blind views.
5. The production bootstrap returns 404 for the retired configuration route.
6. Desktop settings and desktop/phone shift detail show ordinary collections
   with no fee/net controls or display, including old records with stored fees.

## Evidence and installation gate

Development verification completed 2026-10-15:

- All 36 registered backend suites and backend/desktop/mobile type checks pass.
- Desktop renderer and mobile production builds pass. Existing bundle-size
  and Browserslist-age warnings remain; no dependency changes are included.
- Removing nested fee filtering and deducting a 0.55% fee both make the focused
  suite fail. Original bytes restored; clean focused suite passes again.
- Actual application bootstrap returns 404 for both retired configuration URLs;
  runtime database statistics do not expose the fee configuration table.
- Settings and desktop/phone closed-shift collection views verified with the
  in-app browser on the isolated copy, retaining gross amounts and ordinary
  split correction controls with no fee/net display.
- Scratch receivables audit reports zero issues. Owned scratch listeners and
  verification tabs are closed; final fingerprint is `REAL-DB-UNCHANGED`.
- Independent source review finds no correctness/scope issues, dangling fee
  dependencies or copied 2b/A4 behavior. No migrations or dependency changes.

The owner checks one shift on the station after installation: M-Pesa remains
the entered amount, the fee settings/display are absent and reconciliation
matches the original gross-money calculation. Do not begin dependent A2 until
that checkpoint passes. Station update #16 is not installed by this work.

## Recovery

Stop the station process before changing its code. This release does not
migrate or rewrite data. If application rollback is required, restore the
previous code/build with the backend stopped, retaining the current database
and all business entered since installation. Do not restore an old database
over newer station transactions. Reintroduced old code would resume fee
behavior; record that limitation and resolve it before normal use.
