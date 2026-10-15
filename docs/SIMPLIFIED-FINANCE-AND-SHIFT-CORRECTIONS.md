# Simple finance and shift corrections

Owner requirements clarified 2026-10-15. M-Pesa fee removal is built on the
development PC. The financial edit/report changes below are the proposed
implementation plan; they are not yet built or deployed.

The complete remaining sequence is in
[IMPLEMENTATION-STAGES.md](IMPLEMENTATION-STAGES.md). Opening float and the
new balance-based reconciliation are specified in [SHIFT-FLOATS.md](SHIFT-FLOATS.md).
Those documents govern implementation order and the new opening-funds rules.

## What NexGen needs to record

| Area | Source of truth | Effect on profit |
|---|---|---|
| Fuel sold | Fixed pump readings and the agreed customer price | Count the sale once, including credit sales. |
| Fuel cost | Delivery cost allocated to metered litres sold | Deduct fuel cost when sold, not the whole delivery when received. |
| Tank levels | Deliveries + stock adjustments − metered sales | Quantity record; a customer/account correction is not another fuel movement. |
| Dips | Actual measurement compared with book stock | Show variance; do not silently change stock or invent a loss adjustment. |
| Expenses and wages earned | Valid expense and earning records | Deduct once. A later expense correction changes the expense amount. |
| Customer debt and repayments | What the customer owes and real receipts | Classify/settle an already counted sale; no second revenue entry on repayment. |
| Invoice customers before issue | Fuel, litres, supply reference and customer | No second metered sale. Any agreed-price difference is recognised once in billing/accounting. |
| Invoice customers after issue | Fixed invoice/source, money due, notes and payments | Notes can change revenue where they change the billed price/amount; payments only settle debt. |
| Recoverable employee deficits | Approved employee debt and actual repayments | Separate from sales and expenses; repayment is not new sales income. |
| Supplier debts and payments | Goods received, supplier bills and actual payments | Paying a supplier settles debt; fuel purchase cost is not deducted twice. |

This is the operating model, not a proposal for a new general ledger or a new
inventory engine. Real write-offs/unrecoverable losses, if ever approved, are
separate decisions from maintaining a recoverable debt.

## Cash and M-Pesa totals are independent

The owner confirmed **each shift's two totals**, not individual transaction
capture. Cash can increase/decrease while M-Pesa stays unchanged; M-Pesa can
increase/decrease while cash stays unchanged. Both can change together. There
is no requirement that their combined total stays the same.

Example: recorded cash 10,000 and M-Pesa 5,000; correct figures are cash
11,000 and M-Pesa 4,700. The shift accounts for 700 more in total. Pump sales,
tank quantities, FIFO cost and following shift opening readings stay unchanged.

**M-Pesa is the actual amount entered. No estimated fee or net amount.** Fee
configuration, API, calculation, UI and report totals have been removed from
development. Old columns and already-pushed migrations remain only as
historical storage; the active application neither calculates nor uses fees.
Collection/correction responses omit the obsolete fields. No migration or
historical financial rewrite is needed for this removal.

## The exact calculation and its ripple effects

The existing **legacy-shift** reconciliation is:

`accounted = cash + M-Pesa + credit sales + invoice fuel retail value + drawer expenses + drawer wages/payroll payments`

`expected = metered sales amount + old-debt receipts received on the shift`

`over/short = accounted − expected`

New float-enabled shifts use the opening/closing balance calculation in
`SHIFT-FLOATS.md`. Preserve this legacy basis for old and already-open shifts;
do not reinterpret missing historical floats as factual zero declarations.

Debt receipts are already inside entered gross cash/M-Pesa. Classifying a
receipt does not mean adding the same money to collections again. If both a
receipt and its declared gross total were recorded wrongly, the admin supplies
the correct facts for each.

| Change | Recalculate/update | Leave alone |
|---|---|---|
| Cash or M-Pesa total | Current collections, reconciliation, approved employee liability, cash-flow/collection reports | Meter revenue, tanks, FIFO and following physical shifts |
| Credit issued | Debt plus its shift link, exact prior payment allocations, held customer credit, affected account balances/limits, reconciliation | Counted pump sale and physical litres |
| Credit repayment | Exact settlements, real receipt, held credit and affected balances; reconciliation if linked to the drawer | Sale revenue; no new fuel movement |
| Unbilled invoice consumption | Customer/fuel/litres, retail value in reconciliation, fixed meter-limit validation, customer exposure/limit approval, affected drafts | Meter readings, fuel deducted and cost already allocated |
| Issued invoice | Monetary credit/debit note, money due, held credit and valid payments; revenue difference where appropriate | Issued source consumption, original document and physical fuel |
| Expense | Valid expense/category, profit and reconciliation, approved responsibility | Fuel sales/stock and wages already earned |
| Employee deficit | The affected approved debt; existing repayment allocation/credit | Sales revenue and wage entitlement |
| Supplier payment | Actual money out, payable allocations and remaining supplier debt | Stock quantity and fuel cost already counted |

These dependencies are accounting that must remain correct behind ordinary
forms. They do not require a second correction subsystem or an automatic
posting on every other party. Responsibility changes need the admin's approval.

## Preserve the original close; read the current financial position consistently

Keep status closed and pump readings fixed. Retain the signed close snapshot
and existing correction history. Use the existing financial posting helpers
for each approved change, with atomic saves, a reason and conflict checking.
Do not reopen/reclose or call stock/FIFO replay for these financial changes.

One common current-financial reader should combine active credit/receipt/
expense/unbilled-consumption rows with the original cash/M-Pesa and their
cumulative adjustments. Float-enabled shifts also use their declared openings
and actual funds movements. Use each shift's basis in detail, daily report,
dashboard and relevant period/cash-flow totals. Keep **Original at close**
accessible separately. Current code deliberately mixes original close views
and live monthly/account views; that is the main presentation consistency work.

Employee and customer balances can have legitimate later allocation effects.
Reducing an old shortage may free real money already repaid, but must not
silently redistribute historical employee repayments to later debts. Preserve
the old applications and show the released credit for a deliberate allocation
or actual refund. Later shift readings/stock/original totals do not change.
Check original charges, adjustments and real repayments before any extra charge.

## Invoice issue is the boundary

Before issue, fuel is handled as editable unbilled litres. A reserved draft
can be refreshed. When the invoice is issued, its underlying customer, fuel,
litres, shift and supply links become historical facts.

After that, handle what is payable and paid using monetary credit/debit notes
and real payments/refunds. Notes retain the original invoice reference and a
reason. An excess credit remains customer credit/refund due; it is not cash
paid back until an actual refund occurs. A note does not restore tank litres.

Current committed `fuelOnAccount` corrections still soft-reverse and replace
issued consumption and generate notes automatically. Uncommitted 2b also
restricts manual notes toward price changes and directs some actions back to
source corrections. Those paths must be changed together:

1. Refuse source-consumption changes after issue, in the backend as well as UI.
2. Keep suitable monetary note actions available, including both reductions
   and additional amounts payable, instead of directing the admin back to
   editing issued litres.
3. Preserve issued source links even when the bill is fully credited; do not
   silently turn historically invoiced fuel into editable unbilled fuel.
4. Keep source lists, invoice totals, stored PDFs, notes and actual payments
   consistent. Change tests that currently expect issued source replacement.

## Supplier cash flow needs one separate correction

The current cash-flow report uses delivery `total_cost` as fuel-purchase
money out. That can report an unpaid delivery as cash spent. It should use
actual posted supplier payments, with their real dates/methods and reversals,
and verify historical payment coverage. This change must not change supplier
debts, inventory value or FIFO profit calculations.

## Implementation sequence

Use `IMPLEMENTATION-STAGES.md`, rather than a second competing checklist:
A1 fee removal and an approved baseline; A2 common current/original reader;
A3 complete manual opening floats; A4 independent closing totals; B1-B7 one
financial record family at a time; C1-C2 supplier cash flow and drift audit.
Later procurement, phone, access, advances and audit work has its own releases.
Each has numeric acceptance cases and a station checkpoint before dependent
work starts. No float or broader correction feature is implemented by this plan.

## Code evidence and primary practice

- `backend/src/services/shiftAccountability.ts`: one-shift financial formula.
- `backend/src/services/stockCalculator.ts`: stock/FIFO use metered litres.
- `backend/src/services/correctionRules/collection.ts`: development already
  accepts both right totals independently; station HEAD accepts split-only.
- `backend/src/services/correctionRules/creditSale.ts` and `debtReceipt.ts`:
  exact allocation handling and affected customer balances.
- `backend/src/services/correctionRules/fuelOnAccount.ts`: current issued-source
  replacement that conflicts with the new boundary; missing exposure-limit
  check to add for unbilled corrections.
- `backend/src/services/employeeVariances.ts`: recoverable shortages/repayments
  separate from revenue.
- `backend/src/routes/reports.ts`: existing profit is sales/price adjustments
  less FIFO cost, wages earned and expenses; cash-flow delivery-cost query
  needs the supplier-payment correction above.
- [IFRS 15 overview](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/):
  revenue follows the supplied goods/services and amount entitled, not a
  second sale when a receivable is collected.
- [Business Central invoice correction](https://learn.microsoft.com/en-au/dynamics365/business-central/sales-how-correct-cancel-sales-invoice):
  corrective documents retain the issued-invoice trail, including paid invoices.
- [Business Central payment allocation](https://learn.microsoft.com/en-us/dynamics365/business-central/receivables-how-apply-sales-transactions-manually):
  reversing a settlement reopens the exact entries it paid.

Sources checked 2026-10-15. These practices inform the small operating design;
the proposed UI and reporting changes remain to build.
