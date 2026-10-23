# Corrections

How to fix a mistake after a shift has closed. Only administrators correct.

**Before a shift closes, fix it on the shift. After it closes, correct it.**
A closed shift's records and its saved close never change. A correction is a
new numbered record (C-2026-0001, …) kept beside the shift: what was wrong,
the right record, why, and who approved it. This is how SAP, Dynamics 365 and
NetSuite keep closed records closed: they post a reversal, never an edit.

## What a correction can fix

On a closed shift, beside each entry (**Correct**) or list (**Add missing**),
desktop and phone:

| Record | Mistakes it fixes |
|---|---|
| Fuel on account (invoice customer) | Litres, fuel, customer, shift, never taken, not recorded. Only before the fuel is on an issued invoice. |
| Credit sale | Customer, amount, shift, never given, not recorded |
| Debt payment taken in the shift | Customer, amount, cash/M-Pesa swapped, shift, never received, not recorded |
| Drawer expense | Amount, category, never paid, not recorded |
| Cash and M-Pesa totals | The counted money, each figure independently (zero allowed) |
| Opening cash / M-Pesa | A wrong opening figure (also while the shift is open) |
| Money added / removed | A missing movement, or reverse a wrong one |

Other mistakes:

- **Balance on the wrong account** (a customer's or employee's): **Move
  balance**, below.
- **An issued invoice:** a credit or debit note ([Customers](CUSTOMERS.md)).
- **Meter readings, deliveries and stock, office payments, wages:** no
  correction yet; see the roadmap.

## The steps

1. Choose what was wrong. Only the wrong part can change.
2. Enter the right value (for amounts, the full correct amount).
3. Check the effects NexGen lists: what is reversed and added, what each
   customer owes before and after, and the shift's result at close and now.
4. **Who carries it?** Asked only when the shift's result gets worse: the
   attendant (it adds to their shortage on that shift) or the station (their
   shortage stays). A correction that improves the shift lowers what the
   attendant owes on it.
5. Give a reason (at least 10 characters) and approve: on desktop choose the
   administrator and enter their PIN; on the phone the signed-in administrator
   approves. If the records change before approval, NexGen asks you to check
   the new effects again.

## What happens to the money

- **Customers.** A reversed credit sale that was already paid: the money stays
  with the customer who paid and pays their other debts, oldest first; anything
  left is their credit. A reversed payment puts back the debts it paid. Going
  past a credit limit needs the limit approval, recorded like any other.
- **The shift.** Credit sales and expenses count as money accounted for;
  debt payments add to what the till should hold. So an expense found later
  improves the shift, and a payment never received improves it too. Swapping
  cash and M-Pesa changes neither.
- **Counted money stays as counted** unless you correct the totals. Never
  invent a payment to fix a count.
- **Never changed:** pump readings, fuel sold, tank stock, fuel cost, earned
  wages, later shifts' openings.

The shift page and reports show current figures; **Original close → View
original figures** shows the saved close. The desktop **Corrections** page
lists every correction; the daily report lists the day's.

## Undo

From the desktop **Corrections** page: **Undo this correction**, with a reason
and approval. The undo is itself a new correction that cancels the first
exactly. It is refused when something was built on it since (its fuel is now
on an issued invoice, a later correction changed what it added, or a later
cash/M-Pesa correction on the same shift depends on it): undo the later one
first, or make a new correction.

## Move balance

For money sitting on the wrong account after close. From a customer
(**Credit Accounts**, phone **Credits**) or an employee (**Employees →
Shortages**): **Move balance** of KES ___ **from** one account (owes less)
**to** another (owes more), with the shift number, reason and approval.

| Mistake | From | To |
|---|---|---|
| Repayment recorded on the wrong employee | employee who paid | employee it was recorded on |
| A customer's debt nobody will pay | the customer | the Station |
| Credit hid a till shortage | the customer | the attendant |

A move between a customer and an employee must name that employee's shift.
The Station is only ever on a customer's side: an employee's shortage is never
written off. No money moves; a wrong move is fixed by moving it back. Moves
show on statements, the shift's **Mistakes fixed later** and **Reports →
Mistakes Fixed**.

## What corrections don't do

They don't decide which record is wrong: check the issue book, the customer,
the M-Pesa statement and the dips first. They don't replace KRA eTIMS
documents, which come from the POS.
