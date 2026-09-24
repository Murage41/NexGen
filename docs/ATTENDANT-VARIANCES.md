# Attendant Shortages

An attendant owes the shortages of the shifts they ran, and pays them. That is
the whole rule.

- A shift that closes **short** is owed by its attendant.
- A shift that closes **over** (a surplus) is recorded on the shift and in the
  reports, and belongs to the station. It never pays a shortage and never
  appears on the attendant's list.
- The attendant **pays** in money: cash, M-Pesa or bank transfer.
- There are **no write-offs and no paying back** (owner decision 24 Sep 2026).
- Pay is never reduced for a shortage on any plan (daily, weekly, fortnightly or
  monthly): the attendant is paid in full and pays shortages separately.

## Why It Works This Way

- Point-of-sale systems (Dynamics 365 Commerce, Odoo) record each shift's over
  or short when it closes. They never take it from the cashier's pay at close.
- Retail cash practice keeps overages and shortages apart: shortages are
  recovered from the cashier; overages are banked with the day's sales and are
  the business's (or a customer's who overpaid), not the cashier's.
- Money an employee owes is a different kind of receivable from customer credit
  (IAS 1 lists them separately), so it is kept under Employees, not Credits.
- Kenya's Employment Act, section 19, allows deducting a cash shortage from
  wages only when the employee caused it through negligence or dishonesty and
  their contract makes them responsible for cash, and caps all deductions at
  two-thirds of wages. Paying in full and collecting separately keeps payroll
  out of that. Keep the cash-handling duty in attendants' contracts.

## Closing a Shift

There is no recovery step. For daily plans the wage field starts at the full
amount earned. When the shift closes, a shortage is posted to the attendant's
list, dated the shift date. A surplus is recorded for the station.

## The Shortages List

Open **Employees** and select the amount in the **Shortages** column (desktop),
or tap it on the employee's card (phone). Attendants see their own list,
read-only, under **My Pay**.

| Column | Meaning |
|---|---|
| Date, Shift | A shift they ran that was short |
| Shortage | How short it was |
| Paid | What has been paid towards it |
| Still owed | What is left |

The total at the bottom is what is still owed. Tap a row for the details.

## Recording a Payment

On the Shortages page (administrators only), **Record payment**: the amount,
cash, M-Pesa or bank transfer, the date, and the M-Pesa or bank reference
(optional for cash). If the money goes into an open shift's drawer, enter that
shift and count it in the drawer. A payment pays the oldest shortage first and
can't be more than what is owed. **Reverse** undoes a mistaken one; it stays on
record, marked reversed, and the amount is owed again.

## Credit

If a shortage turns out smaller after it was paid (see Mistakes Found After
Close), what was paid for it is the attendant's **credit**. It pays their next
shortage automatically. It is never paid out.

## Mistakes Found After Close

A closed shift never changes. A mistake found later is fixed with **Move
balance** (see [Fixing a Mistake on a Closed Shift](CLOSED-SHIFT-CORRECTIONS.md)):

- between a customer and the attendant, naming the attendant's shift: the
  shift's shortage on their list goes up or down by the amount, dated the day of
  the move;
- between two employees, for example a payment recorded on the wrong one.

The station is never one side of an attendant's move: it neither writes a
shortage off nor adds one.

For an **invoice customer** the same is done with a credit or debit note that
names the shift's attendant: fuel recorded on the customer to cover the drawer
(their shortage goes up), or the customer's fuel never recorded (it goes down),
at the shift's pump price. See
[Invoice Customer Workflow](INVOICE-CUSTOMER-WORKFLOW.md).

## History Kept As It Was

- Write-offs and paybacks recorded before 24 Sep 2026 stay on the list and
  still count, labelled with that date.
- Corrections posted with the old pencil (before 23 Sep 2026) stay on record.
- The staff-debt records from before this list started show under **Earlier
  records**; what was still owed from them is included.

## Reports

- **Dashboard:** Owed by attendants.
- **Monthly report:** shortages, what attendants paid, changes after close,
  what they owe at month end, and shift surpluses (the station's).
- **Cash flow:** payments received directly are cash in. Payments taken into a
  drawer are part of that shift's collections.
- **Daily report:** shortages on the day's shifts that attendants still owe.

## What Was Carried Over (update #7, migration 047)

Nothing was deleted or edited. Every shift since 17 Aug 2026 (when close figures
began to be stored), and any shift that still had debt, is listed with what the
old system recovered (wage deductions, repayments, payroll) or cleared, and what
is left. Each employee's total equals what the old records said, to the cent, or
the update stops and changes nothing. A debt recovery drafted on an unapproved
payroll run is cancelled. The old debt-clearance commands refuse to run.

## When Updating the Station (24 Sep 2026 change)

Between the update on about 22 Sep and this one, a surplus automatically paid
off earlier shortages. That rule is gone: shortages are owed in full. **Before
updating, note each employee's figure on the Employees page; after updating,
compare.** An employee whose figure went up had a surplus since 22 Sep that was
set against their shortages; the new figure is what they owe under the rule.

## Acceptance Test

1. Close a shift with a shortage: no recovery step, the wage is paid in full,
   and the shortage is on the attendant's list with the right date.
2. Close another of their shifts over: it is not on their list and what they
   owe does not change.
3. Record a cash payment: it pays the oldest shortage and appears in cash flow;
   reverse it and they owe it again.
4. Record Payment offers only cash, M-Pesa and bank transfer; there is no Write
   off or Pay back.
5. Move part of a paid shortage off them on their shift: it shows as credit and
   pays their next shortage.
6. Sign in as the attendant on a phone: My Pay shows their shortages and no one
   else's.
