# Payroll and employee debt regression verification

Verified on 7 September 2026. This follow-up corrects calculations and interactions without a new migration or a historical financial rewrite.

## Corrected behavior

- Closed-shift screens use wages saved at close. An empty close form cannot remove a saved wage from accountability. Legacy wages are labelled as recorded wages because the original field could include recovery; new explicit cash payments are labelled as drawer payments.
- Daily reports use the same closed-shift reconciliation basis. Wage recovery is not added to actual cash as if it were a second payment. Legacy zero-cash shifts remain zero-cash.
- Cash-flow reports account for drawer collections being the amounts remaining after payouts. The report adds recorded drawer payouts back before listing them as outflows, avoiding a second subtraction. Payments outside a drawer still reduce net cash flow. Payroll mirrors count once. No cash collection, payment, expense or close snapshot is changed.
- Expanded desktop employee accounts show staff debt history and working links to the employee statement and originating shifts. Employee balances are checked against staff debt, and invoice account balances against open invoices, removing false dashboard drift warnings. Drift detection remains read-only.
- A daily recovery must be reviewed before closing when recovery is available. Editing a confirmed amount, reference or reason invalidates confirmation. Changes to the shift or cash payment request a new preview. Preview errors keep closing disabled and provide a retry. Non-daily plans retain recovery at payroll approval.
- The payroll manual-deduction form defaults to its supported manual category. Staff debt continues through the reviewed recovery workflow.

## Backup comparison

On an isolated copy of the station backup, all 100 closed shifts matched between the shift API, daily reports and the actual desktop/mobile calculation expressions (200 screen comparisons across 69 daily reports). All 30 saved close snapshots matched current accountability. Shift 101 retained its KES 356.86 shortage.

All three employee accounts returned debt entries/statements. Own-account requests succeeded and requests for another employee's account were rejected. No account drift remained in this snapshot. Hashes of the rows in all 63 tables were unchanged by the read-only checks. These results establish consistency for this backup, not the contents of any subsequently updated station database.

## Automated and browser checks

Seventeen suites passed: compensation plans, earnings, wage safety, payroll ledger, payroll schedules, employee settlement, shift debt receipts, shift cancellation, shift review, concurrent shift writes, shift operations, closed-shift variance, receivable payments, receivable reporting, employee debt clearance, payroll/report integration and invoice accounting.

The new `test:payroll-report-integration` suite exercises real API routes using isolated synthetic data: modern cash/recovery, legacy gross wage, legacy zero cash, drawer payroll and expenses, outside-drawer bank payment, payroll mirrors, and read-only employee balance drift checks.

Browser checks covered desktop debt history and navigation, the dashboard, desktop and rebuilt mobile shift 101, and the shared recovery form. Confirmation enabled closing; editing a confirmed amount or changing collections disabled it; failed previews stayed blocked; monthly recovery remained deferred to payroll.

Backend compilation, desktop TypeScript/Vite build, and mobile TypeScript/Vite build passed. Existing bundle-size warnings are performance notices, not failed builds.

## Station data

The station backup and development database were not modified by this verification. Deploy code through Git; do not copy a development database over the station database. Emma's requested balance-only clearance remains a separate, guarded operation described in `HISTORICAL-DEBT-CLEARANCE.md`. This release does not alter her historical payroll payments or reconcile any drawer.
