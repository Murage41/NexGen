# Fixing a Mistake on a Closed Shift

How to fix a credit, payment or repayment that turns out to be wrong after its
shift has closed. Use it for staff training and as the owner's reference.

## The Rule

**A closed shift never changes.** Its readings, collections, credits, payments
and shortage or surplus stay exactly as they were at close, on every screen and
report. Nobody can edit, reverse or delete anything on it.

While a shift is still **open**, remove a wrong entry with the bin icon instead.

## Why One Tool Is Enough

All the money a shift took is in one of three places: the drawer, a customer's
balance, or the attendant's shortage. The drawer was counted at close and is
final. So a mistake found later always means **money sitting on the wrong
account**, and the fix is always to move it:

> **Move balance**: move KES ___ **from** one account (it owes less) **to**
> another (it owes more), with a reason, the shift number and an
> administrator's approval.

An account is any customer, any employee, or, for customers only, **the
Station** (it writes a customer's debt off, or raises one). Both sides always match, as in a journal entry, so
nothing can go missing. This is how accounting systems keep closed periods
closed: NetSuite posts a correction in the current period, Business Central
fixes a payment on the wrong customer on the customer ledger, and Odoo cannot
change a closed till session at all.

## Where

- **Credit Accounts**: open a customer, **Move balance** (starts from that
  customer). Phone: **Credits**, open the customer.
- **Employees → Shortages**: **Move balance** (starts from that employee).

Choose From and To (the ⇄ button swaps them), the amount, the shift number,
the reason, and the approving administrator with their PIN. On the phone the
signed-in administrator approves.

## Which Move

| Mistake on a closed shift | From (owes less) | To (owes more) |
|---|---|---|
| Credit recorded on the wrong customer | the wrong customer | the right customer |
| Credit recorded for too much | the customer | the attendant |
| Credit given but not recorded (the till was short) | the attendant | the customer |
| Made-up credit that hid a shortage | the customer | the attendant |
| Payment recorded on the wrong customer | the customer who really paid | the one it was recorded on |
| Payment recorded that never came in | the attendant | the customer |
| Repayment recorded on the wrong employee | the employee who paid | the one it was recorded on |
| A customer's debt nobody will pay | the customer | the Station |

A move between a customer and an employee always needs the **shift number**,
and it must be that employee's shift: the money was in their drawer on that
shift.

## What Happens to Each Side

- **A customer who owes less** has the named shift's credit settled first, then
  their oldest. Anything beyond what they owe is **credit on their account**
  (they paid it): it pays their next credit automatically, or can be refunded.
- **A customer who owes more** gets a credit dated today that ages from the
  shift's date, so credit age limits and aging see how old the debt really is.
- **An employee, on their own shift**: the move changes that shift's shortage
  on their Shortages list (the shift page itself never changes). If they had
  already paid it, what they paid for it is their credit and pays their next
  shortage.
- **An employee, otherwise** (for example a payment recorded on the wrong
  employee): onto them it is owed; off them it pays what they owe, and anything
  left is their credit.
- **The Station** is only ever on a customer's move: it writes off a customer's
  debt (never more than they owe) or raises one. An employee's shortage is never
  written off or raised by the station.

No money moves. A move never appears as cash received or paid. It shows on the
customer's statement and the employee's Shortages list on the day it was made, on the
shift page under **Mistakes fixed later** (the shift itself unchanged), in
**Reports → Mistakes Fixed**, and in the monthly report (balance moves, customer
balances the station wrote off, and attendants' variances changed after close).

A move is never edited or deleted. A wrong move is fixed by moving it back.

## Invoice Customers

Their fuel is billed on invoices, so it is corrected with a **credit note**
(they owe less) or **debit note** (they owe more), always in fuel, litres and
price per litre. A debit note is a bill of its own and also works for a shift
when there is no invoice yet. When the shift's attendant is the one who owes
it (fuel recorded on the customer to cover their drawer, or the customer's fuel
never recorded), the note names them and their shortage on that shift changes,
as a customer-to-attendant move does. See
[Invoice Customer Workflow](INVOICE-CUSTOMER-WORKFLOW.md).

## Corrections Made Before This Rule

Corrections posted with the old pencil (September 2026) stay on record: the
shift page lists them under **Corrections after close**, and Reports → Mistakes
Fixed lists them. No new ones can be made.

## Release Acceptance Test

Run on a test copy, never on the station's records.

1. Open a closed shift: no pencil or edit control on any entry.
2. Move a credit from customer A to customer B. Confirm both balances and
   statements, and that the shift page shows the move under Mistakes fixed later
   with its figures unchanged.
3. Move a payment from a customer who owes nothing: they show **In credit**.
4. Move from an attendant who already paid their shortage to a customer: the
   attendant has credit for their next shortage.
5. Move more than a customer owes to the Station: refused.
6. Confirm the day's cash-flow report did not change and the monthly report
   shows the moves.
