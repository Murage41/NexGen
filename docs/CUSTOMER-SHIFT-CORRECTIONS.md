# Correct customer credit and shift debt payments

B1 completes these corrections after A4. Install and check each queued release
separately. Only an administrator makes or approves a correction.

## Start with the record

Open the closed shift on desktop or phone. In **Credits Given** or **Debt
Collections**, choose **Correct** beside the mistaken entry. Use **Add missing**
only when a genuine credit sale or payment was omitted. The desktop
**Corrections** register shows the numbered history and permitted undo.

Choose the mistake: customer, full amount, shift, duplicate or missing. Debt
payments also allow the cash/M-Pesa method to be corrected. For an amount
correction, the full recorded amount is filled in. Enter the full right amount,
with at most two decimal places; it must be positive. To remove a nonexistent
entry, choose the duplicate/never-given or never-received option.

Review what each customer will owe or hold as credit and the resulting shift
variance. If a shift gets worse, choose who carries the effect based on actual
responsibility. Changing the customer's name alone does not establish an
attendant debt. Give a reason and explanation. Desktop takes the named admin's
PIN; phone uses the signed-in admin. Changes to the relevant financial history
while approval is pending require a fresh preview.

## When some money has already been paid

A customer was charged 1,000 and paid 800. Correcting the debt to 900 leaves
100 owed. The real 800 payment remains. If the 1,000 debt belonged to another
customer, the 800 stays with the customer who actually paid: it pays their other
eligible debts and any excess stays as their credit. It never moves with the
wrong name to the replacement customer.

NexGen reverses the allocations of the identified debt/payment and keeps that
history. Settlement then uses the existing order of oldest eligible debt and
payment records. A replacement debt is a new record; its originating shift
still supplies its age. Check the updated customer account, paid amounts and
credit held. An allocation history that cannot account for the money must be
audited before correction.

Credit-limit review uses the resulting net exposure, allowing for the original
debt and real money already paid. A partly paid debt is not charged twice in
the limit check. A genuine increase beyond the amount or age limit needs the
explicit override shown in the preview; that approval is recorded.

## Check the counted money separately

A debt receipt of 500 was actually 400. Correcting the receipt restores its
old allocations and records 400; the customer owes 100 more. Expected money on
the shift falls 100, so its result improves 100. Its counted cash/M-Pesa totals
stay unchanged. Changing only the payment's customer or method leaves the
combined shift result unchanged.

If the saved count was also wrong, use the
[cash/M-Pesa total correction](CLOSING-TOTAL-CORRECTIONS.md) separately after
checking the money. Do not create another payment to repair a count. Neither
debt receipts nor customer repayments create another sale or another profit.
Readings, original closes, stock/FIFO, later openings and earned wages stay as
recorded. Attendant responsibility is never automatically deducted from pay.

## Undo and dependencies

Undo is another recorded correction. If a replacement was corrected again,
undo that later correction first. A payment already partly refunded cannot
be reversed here; first review the real refund through its own workflow.
Undo cannot restore a debt while bypassing a newly breached customer limit.
Use a new correction with a fresh preview and explicit limit approval in that
case. Original payments, source amounts and close evidence remain visible.

Review an archived customer's account or a later switch to invoice billing
before undoing a correction. Undo must not release money into an unavailable
money account. A reversed receipt must have no money still held on it, active
allocations or posted refund; inconsistent history needs an integrity audit.

Issued invoice fuel/notes, office payment/refund changes, employee repayments,
expenses and drawer wages have their own later stages. This guide covers
money customers' credit and debt payments taken in shifts.
