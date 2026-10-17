# Correct cash and M-Pesa totals

A4 adds this workflow after A1, A2 and A3. Install and check each release
separately. It corrects the two totals on a closed shift; individual receipts
do not need to be entered.

## Enter the correct figures

1. Open the closed shift. Use **Correct closing balances** on a new
   balance-based shift, or **Correct cash and M-Pesa totals** on an older shift.
2. Both current figures are filled in. Enter the full correct cash and M-Pesa
   amounts. To correct just one, leave the other figure as it is. Zero is valid.
   Use at most two decimal places; both fields are required.
3. Review the before/after figures and resulting shortage, surplus or balance.
   When the result gets worse, choose whether the attendant or station carries
   the effect. Check actual responsibility and previous charges/repayments.
4. Select a reason, explain what happened and approve. Desktop uses the named
   admin and PIN; the phone uses the signed-in admin.
5. Check the current result and reports. **Original close → View original
   figures** still shows the saved close. The numbered correction explains
   the later change.

For a balance-based shift, use the actual money remaining at close, including
the opening funds still held. Do not subtract the opening float yourself.
For an older shift, use the full money received total that its original form
used. The shift's basis stays the same.

## Examples and related actions

Suppose expected closing funds are 11,500 and the saved count is cash 6,000
and M-Pesa 5,500. Correcting cash to 5,700 alone produces a 300 shortage.
Starting again from the saved count, correcting only M-Pesa to 5,200 also
produces a 300 shortage. Cash 6,200 and M-Pesa 5,400 produces a 100 surplus.
The combined total can go up, down or stay the same.

This form corrects the recorded count. If money actually entered or left
custody, use **Money added / removed** with its reference. Correct an opening
declaration beside the opening method. Enter debts, payments and expenses
through their own relevant forms; do not invent a payment to fix a count.
See the [opening-funds guide](OPENING-FUNDS-GUIDE.md).

The count correction changes current reconciliation, inferred collections and
the relevant report figures. It does not change metered fuel sales, profit,
stock, fuel cost, customer/supplier debts, earned wages or later openings.
An approved attendant responsibility effect updates the variance ledger;
shortages are never automatically deducted from pay.

## Mistaken corrections

Use another correction for a new discovery. If the correction itself was a
mistake, the desktop **Corrections** register offers **Undo** where allowed.
Undo adds its own history and restores the previous current figures. Undo
later cash/M-Pesa corrections on that shift first if an earlier one depends
on them. The saved source count and original close remain intact throughout.

If someone changes the shift's financial history while approval is pending,
review a fresh preview. Repeated submission of the same request is protected
against duplicate posting. Earlier split-only history remains readable.
