# Correcting a Closed Shift

How to fix a credit, payment or fuel-on-account entry that was wrong on a shift
that is already closed. Use it for staff training and as the owner's reference.

## The Rule

A closed shift is never edited, and nothing on it is deleted. A correction:

- marks the wrong entry **corrected** and keeps it on record with its original
  amounts;
- adds the right entry, linked to the original, when there is one;
- is dated the day it is made and records who approved it and why;
- recalculates the attendant's shortage for that shift.

This is how professional accounting systems work. Microsoft Dynamics 365
Business Central corrects a posted invoice with a linked credit note instead of
editing it. SAP reverses a document from a closed period in the current period.
Odoo's point of sale issues a refund that refers to the original receipt. Never
fix a mistake by entering a second made-up transaction: a payment entered on the
Credits page to cancel a wrong credit is reported as money received, and a
credit added on today's shift to cancel a wrong payment distorts today's drawer.

While a shift is still **open**, remove the entry with the bin icon instead.

## What Can Be Corrected

| Entry | Wrong customer | Wrong amount | Did not happen |
|---|---|---|---|
| Credit given | Move it to the right customer | Change the amount | Void it |
| Payment received (customer or employee repayment) | Move it to the right customer or employee | Change the amount | Void it |
| Fuel on account (invoice customer) | Move it to the right invoice customer | Change the litres or pump | Void it |

Fuel already on an invoice (draft or issued) is corrected through the invoice:
remove it from the draft, or issue a credit note on the issued invoice.

## How

**Desktop:** open the closed shift, press the pencil next to the entry, choose
what was wrong, press **Preview**, then choose the approving administrator,
enter their PIN and press **Post correction**.

**Phone (administrators):** the same pencils appear on a closed shift. The
signed-in administrator approves as themselves.

The preview changes nothing. It shows each customer's balance before and after,
the shift's shortage or surplus before and after, and what happens to the
attendant. Changing anything after the preview withdraws it. If anything on the
shift changes between the preview and posting, posting is refused and you
preview again. A note is optional.

## What It Does to the Attendant

All the fuel money from a shift is in one of three places: the drawer, a
customer's balance, or the attendant's shortage. A correction only moves money
between them. It never changes sales or profit.

- **Wrong customer:** the attendant is unaffected; the money was real.
- **A payment that never came in:** the attendant was charged for money that
  did not exist, so their shortage goes **down**.
- **A credit that never happened:** that fuel's money should have been in the
  drawer, so their shortage goes **up**. A made-up credit used to hide a
  shortage is charged back to the attendant on that shift.
- **Wrong amount:** the shortage is recalculated by the difference.

If a correction reduces a shortage the attendant has **already repaid**, the
repaid part is owed back to them. A shortage that was written off, not repaid,
is not refunded.

## Money Owed Back to an Employee

It appears on the employee's pay statement under **Owed back after
corrections**. An administrator settles it in full, with approval:

- **Paid to them in cash or M-Pesa**: shown under **Refunds to Employees** in the
  cash-flow report.
- **Set off against what they owe now**, when that covers it.

It is not paid through payroll. Payroll carries wages the employee earned, and
money returned after a wrong recovery is not a wage. Kenya's Employment Act,
section 19, allows deducting a cash shortage from pay only when the employee
caused it through negligence or dishonesty and their job has them handling
money, so a "shortage" that was a typing error must be returned.

## Where the Record Is Kept

- **The shift:** a **Corrections after close** list. The close reconciliation
  keeps the figures as closed, with the shortage or surplus after corrections.
- **Reports → Corrections:** every correction by the day it was posted: what
  changed, the effect on the attendant, who approved and who recorded it.
- **Reports → Daily:** a day's shifts appear as they were closed, and the
  corrections made that day are listed underneath. Earlier days never change.
- **Reports → Monthly:** receivables show credits and payments reversed by
  corrections as their own lines, in the month of the correction.
- **Customer statement:** the original entry stays and the reversal appears on
  the day of the correction.
- **Employee pay statement:** shortage added or reduced by each correction, and
  money owed back.

## When a Correction Is Refused

- **The customer would end up paid ahead.** For example, a wrong credit the
  customer already paid while owing nothing else. NexGen cannot hold a
  customer's credit balance yet, so leave the entry as it is for now.
- **The litres would exceed what the pumps sold on the shift.**
- **The fuel is already on an invoice.**
- **The shift is open, or the entry has already been corrected.**

## Release Acceptance Test

Run on a test copy, never on the station's records.

1. On a closed shift, move a credit to another customer. Confirm both balances,
   that the attendant is unaffected, and that the original is listed as
   corrected.
2. Void a credit that never happened. Confirm the attendant is charged.
3. Void a payment that never came in, after the attendant repaid part of the
   shortage. Confirm the unpaid part is cancelled and the repaid part is owed
   back; settle it in cash and find it in the cash-flow report.
4. Change a fuel-on-account entry's litres and confirm pump sales cap it.
5. Try a correction that leaves a customer paid ahead and confirm the refusal.
6. Preview, change something on the shift, then post: confirm the refusal.
7. Confirm the daily report for the shift's date is unchanged and today's lists
   the corrections.
