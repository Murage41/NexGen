# Opening shift floats and reconciliation

Specification prepared 2026-10-15. The owner requested manual opening cash and
M-Pesa fields before a shift opens, with no link to the previous shift.
This document specifies stage A3 in `IMPLEMENTATION-STAGES.md`. A3 is developed
and tested on `codex/shift-floats`, queued after A1 and A2; no station installation
is confirmed. See [the release card](releases/A3-SHIFT-FLOATS.md) for evidence and
[the operating guide](OPENING-FUNDS-GUIDE.md) for day-to-day steps.
Existing pump-opening readings continue their existing chain.

## 1. Operating decision

The Open Shift form contains, before the Open button:

- **Opening cash float**: physical cash handed to this shift.
- **Opening M-Pesa balance**: the starting balance in the till/account this
  shift is accountable for; this is the owner's M-Pesa float field.
- Optional opening note, alongside the existing employee/compensation choice.

Only an admin opens the shift. Both amounts must be explicitly supplied;
zero is valid and must not be confused with a missing field. Clear both
fields for every new shift. Do not copy, suggest, link, validate against, or
recalculate them from an earlier shift's closing funds. An earlier shift's
correction never changes a later shift's declared opening funds.

Record the declaration and available actor/time through the existing access
and audit conventions. There is no extra cashier-to-cashier approval chain,
automatic bank integration, safe register, denomination counter or wallet
subsystem. Attendants can see the opening funds declared for their own shift;
the blind-open-shift policy still hides expected totals and variance.

## 2. What the closing fields mean

For float-enabled shifts use **Cash remaining** and **M-Pesa balance at close**.
They are actual holdings at handover: remaining opening funds plus the shift's
receipts, less amounts actually paid or removed. During recording, the same
fields represent the amounts currently held, not another transaction receipt.

Do not ask an admin to subtract opening float before entering these amounts.
The calculation does that once. The closing M-Pesa amount must refer to the
same till/account as its opening declaration. A closing amount below its
opening amount is valid when supported by payouts/removals.

Separate opening/closing figures do not by themselves establish how much
sales should have been cash versus M-Pesa: pump sales are not captured as
transaction-by-transaction tenders. Keep one combined over/short calculation.
Show method balances separately, but do not invent separate cash and M-Pesa
shortages or exact per-method gross receipts from incomplete payout data.

## 3. Complete combined calculation

All terms below use cents and the shared money helpers. Invoice fuel means
the retail value used for this shift's reconciliation, not a second sale.

`opening = opening cash + opening M-Pesa`

`actual closing = cash remaining + closing M-Pesa balance`

`expected closing = opening + metered sales + shift debt receipts + other money added − credit sales − invoice fuel value − drawer business payouts − other money removed`

`variance = actual closing − expected closing`

Equivalent to the existing accountability convention:

`accounted = actual closing + credit sales + invoice fuel value + drawer business payouts + other money removed`

`expected = opening + metered sales + shift debt receipts + other money added`

`variance = accounted − expected`

Drawer business payouts include expenses actually funded by this shift,
actual drawer wages and other payroll payments. As later stages add
shift-funded refunds or supplier payments, their genuine outflows must also
enter once, through their ordinary business record or a linked funds movement.
Wages earned but not paid from this shift never count as a drawer outflow.

Debt receipts are already in the actual closing money. They increase the
money the shift should explain; do not add the same receipt to closing money
again. Opening float, top-ups, removals and debt settlements create no extra
sale. Fuel cost and profit still use the existing metered-sale/FIFO basis.

## 4. Money added or removed during the shift

Opening balances alone are incomplete if money moves during the shift. A
bank settlement or owner collection must not look like an employee shortage.
Include one small admin **Money added/removed** form in A3:

| Field | Requirement |
|---|---|
| Direction | Added or removed |
| Method | Cash or M-Pesa |
| Amount | Positive, finite money within existing limits |
| Source/destination | Station bank/safe, owner funding/drawing, or explained other custody movement |
| Reference and reason | Identify the actual event; compulsory explanation |
| Time, shift, approver | Recorded through existing audit/approval patterns |

Use this only for otherwise unrecorded custody movements: float top-ups,
cash sent to a safe/bank/owner, or M-Pesa transferred to bank, for example.
An expense, wage or other payment already counted as a drawer payout is not
also entered as a removal. If its normal record lacks a shift-funding link,
one linked movement can supply that link; the reader must count it once.

Moving money between this shift's cash and M-Pesa can be recorded as a removal
and addition with the same reference. The admin completes both entries; the
combined amount and profit do not change. This is an actual movement, distinct
from correcting an incorrectly recorded closing figure.

Keep a posted movement's history. Reverse a mistaken movement rather than
delete it. Opening declarations are not movements repeated as money added.
No source/destination balancing account or automatic previous-shift handover
is created for the admin.

## 5. Worked examples and acceptance amounts

| Item | KES |
|---|---:|
| Opening cash | 2,000 |
| Opening M-Pesa | 3,000 |
| Metered sales | 10,000 |
| Credit sales | 1,000 |
| Invoice fuel retail value | 2,000 |
| Old-debt receipts during shift | 500 |
| Expense paid from drawer | 400 |
| Wages actually paid from drawer | 600 |
| Other money added/removed | 0 |
| Expected closing money | **11,500** |

Cash 6,000 and M-Pesa 5,500 gives zero variance. Cash 5,700 and M-Pesa 5,500
gives a 300 shortage. These cases do not add the opening 5,000 to revenue.

Additional fixed checks:

- A 2,500 M-Pesa transfer to the station bank changes expected closing to
  9,000. Cash 6,000 and M-Pesa 3,000 balances; it is no expense or shortage.
- A 1,000 additional cash float changes expected closing to 12,500; it is
  no sale or profit.
- Opening funds 5,000, no sales and a genuine 1,000 drawer expense gives
  expected closing 4,000. The lower closing balance must be allowed.
- M-Pesa opening 20,000 + receipts 30,000 − bank transfer 25,000 = closing
  25,000. The 5,000 balance increase is not 5,000 of sales.
- The next shift can independently open with cash 1,200 and M-Pesa 800.
  Its declaration remains 2,000 even if this shift is later amended.

## 6. Reports, profit and cash flow

Opening money is a balance, not another period receipt. Never sum openings or
closing balances as sales/turnover. Use the common current-financial reader
and the version-appropriate basis on detail, close preview, dashboard, daily,
period, cash-flow, history/CSV and phone screens.

For any combined collection figure reconstructed from custody, use:

`inferred collections = actual closing + drawer business payouts + other money removed − opening − other money added`

`expected receipts = metered sales − credit sales − invoice fuel value + shift debt receipts`

`inferred collections = expected receipts + variance`

Show **Collections inferred from counted funds**, **Expected receipts** and
the over/short separately. In the worked example these are 7,500, 7,500 and
zero. With the 300 shortage they are 7,200, 7,500 and −300. Do not deduct the
300 again or present expected receipts as verified money received. A bank
transfer changes closing custody, not this reconstructed collections figure.

An unexplained shortage does not prove whether a customer failed to pay or
received cash disappeared. Do not manufacture channel-specific receipt evidence
or silently convert shortage into a profit expense. New payout records can
capture method where the later business stage needs that breakdown. Reports
must make this evidence limit clear until actual receipt records exist.

Internal transfers to the station's own bank/safe change where money sits,
not total station cash flow or profit. Owner funding/drawings are shown
separately from trading income/expenses. Office receipts/payments outside
shifts remain their own records; opening declaration is not a substitute for
those events. Source and destination movements must not be counted twice.

## 7. Historical compatibility and correction rules

Use a small shift reconciliation version/basis: **legacy** versus
**opening/closing balances**. Preserve every historical snapshot and its
existing calculation. Legacy opening money is **not captured**, not evidence
that the attendant physically started with zero. Its old formula still has
no opening term; never estimate past openings from the preceding shift.

An already-open shift at rollout stays on the legacy basis through close.
Only a newly created float-enabled shift requires the two new declarations.
New clients display the proper field meanings for the shift's basis. Reject
an old client attempting to submit receipt-only figures to a balance-based
shift with a plain reload/update message. The server determines the basis;
the client cannot choose legacy mode to bypass opening requirements.

A wrong opening entry needs a visible admin correction with a reason and
before/after history. Do not falsify the closing count to compensate for it.
Reuse existing financial amendment history rather than a new revision engine.
Its variance effect is the negative of the opening change; a closing-balance
correction has the same sign as the closing change. Both affect this shift
only, with approved employee responsibility handled normally. No direct
mutation of the signed original snapshot is permitted.

## 8. Data and code touchpoints

Proposed minimal source fields: `opening_cash_amount`, `opening_mpesa_amount`
and a reconciliation basis/version on the shift, plus existing actor/time
conventions. Capture these in new close snapshots. Legacy nullable values
mean not captured; do not run snapshot backfills or rewrite original variance.
A small shift funds-movement table/history holds the few actual non-sale
movements; it is not a general ledger. Choose the next migration number only
after A1 isolates approved changes from the uncommitted old 2b migration.

Touchpoints confirmed in the current code:

- `backend/src/schemas/index.ts` `openShiftSchema`: currently only employee
  and compensation plan; add the two explicit amounts and relevant contract.
- `backend/src/routes/shifts.ts`: admin-only atomic creation, live detail,
  closing, opening snapshots and history export; keep previous pump-opening
  logic but add no previous monetary lookup.
- `backend/src/services/shiftAccountability.ts` and `shiftSnapshot.ts`:
  shared versioned arithmetic, original snapshots and current-financial view.
- `backend/src/services/correctionRules/collection.ts`: preserve existing
  correction compatibility with the new basis. A4 owns the new independent
  closing-total workflow and its sum-of-differences effect. A3 owns opening
  corrections and their separately identified opposite-sign effect.
- `backend/src/services/employeeVariances.ts`: approved result flows to the
  existing debt records, never payroll wage deduction or profit.
- `backend/src/routes/reports.ts`, `dashboard.ts`, `services/shiftHistory.ts`:
  remove opening balances from turnover/receipt assumptions; preserve legacy
  figures and update labels/exports with their basis.
- Desktop and phone `pages/Shifts.tsx` and API clients: pre-open fields;
  desktop/phone `ShiftDetail.tsx` and phone `ShiftRecord.tsx`: actual balances,
  opening display, recording/close previews and audit visibility.

Use one transaction, one-open-shift protection, duplicate-submit/conflict
checks, server role checks, existing money helpers and reasoned approval for
corrections/movements. Do not require a new desktop login/session project to
deliver floats; use existing approvals until the later identity stage.

## 9. A3 delivery gate

Build/test internally in this order: source/legacy compatibility; pure
calculation; opening/closing forms and shared readers; small funds movements;
opening/movement correction and audit paths; full scratch-data and station
checks. Ship the complete float system only after all pass. No partial release
that captures opening money while leaving reports or close calculations on
the old basis. A3 does not absorb A4's independent closing-total edit workflow.

Required cases: explicit zero, missing/negative/infinite inputs refused,
cash-only/M-Pesa-only opening, duplicate open submission, no sale/no movement,
all worked examples, repeated independent openings, no float income,
non-sale top-up/removal, internal transfer, no duplicated expense, actual
shortage and its 7,200 inferred collections, original snapshot retained,
opening/movement corrections, compatibility with existing closing corrections,
historical and already-open legacy shifts unchanged, old-client rejection
and permissions.
Compare all relevant screens/exports. Pumps, tanks, FIFO, supplier/customer
debts and wages earned must remain unchanged except approved independent
business transactions. Use a fresh station backup on a scratch copy; finish
with the normal integrity audits and `REAL-DB-UNCHANGED` check.

## 10. Primary practice checked 2026-10-15

- [Microsoft shift/drawer management](https://learn.microsoft.com/en-us/dynamics365/commerce/shift-drawer-management):
  starting amounts enter over/short; closing declarations count current
  holdings; float entries and tender removals are non-sale events.
- [Microsoft cash management](https://learn.microsoft.com/en-us/dynamics365/commerce/cash-mgmt):
  supports simpler one-sided movements alongside fuller traceability. Its
  safe example declares a fresh start rather than automatically carrying it.
- [Safaricom Business channels](https://www.safaricom.co.ke/media-center-landing/frequently-asked-questions/m-pesa-business-channels-and-portals):
  the indexed official guidance describes balances/statements and payments/
  withdrawals. M-Pesa balance changes therefore need movement context.

Applying opening/closing balance control to M-Pesa and the equations above is
the proposed NexGen design inference. It does not claim Microsoft supplies
NexGen's M-Pesa integration. No automatic bank/till connection is proposed.
