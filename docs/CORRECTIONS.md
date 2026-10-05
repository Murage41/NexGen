# Corrections

How to fix a mistake found after a shift has closed. For the owner and for
training whoever handles the office.

## The rule

**Before a shift closes, fix it on the shift. After it closes, correct it.**

A closed shift never changes. Its figures (sales, cash, M-Pesa, credits, fuel
on account, debt payments, expenses, shortage or surplus) stay exactly as they
were when it closed, on every screen. The database itself refuses to change
them.

A mistake found later is fixed by a **correction**: a numbered record
(C-2026-0001, C-2026-0002, …) that says what was wrong, what the right record
is, why, and who approved it. It is kept next to the shift, never inside it.
This is how accounting systems keep closed records closed: SAP and Dynamics 365
post a reversal instead of editing, Odoo corrects a delivery before it is
invoiced and with a credit note after, and KRA (eTIMS) corrects an issued
invoice only with a credit or debit note that refers to it.

## What can be corrected today

On a closed shift:
- **Fuel on account** (an invoice customer's fuel entry).
- **Credit sales** (credit given to a credit customer).
- **Debt payments** (a credit customer paying what they owe, into the drawer).
- **Drawer expenses.**
- **Cash and M-Pesa** recorded the wrong way round.

Still done the old way until later phases: office payments and attendants'
repayments (payment reversal), moving or writing off a balance (**Move
balance**, see `CLOSED-SHIFT-CORRECTIONS.md`), cancelling an invoice (void),
price notes, wages paid from the drawer, meter readings, deliveries and stock.

## Where

- **On a closed shift** (desktop and phone): each list (fuel on account,
  credits given, debt collections, shift expenses) has **Correct** on every
  entry and an **Add missing** button; the sales collections have **Cash and
  M-Pesa mixed up**. An entry already corrected shows the correction's number
  instead.
- **A fuel entry** can also be corrected from the customer's fuel history:
  Customer Invoices (desktop) or Invoice Customers (phone) → the customer →
  **Correct**.
- **The register (desktop):** **Corrections** in the menu lists every
  correction, newest first. Open one to see exactly what it did, and to undo it.
- **The daily report** lists the corrections posted that day.

Only administrators correct. On the desktop, choose the approving
administrator and enter their PIN; on the phone the signed-in administrator
approves.

## The steps

1. **What was wrong?** The choices depend on the record (below).
2. **The right value.** Only the wrong part can be changed.
3. **Check what it does.** NexGen lists every effect in plain words: what is
   reversed and what is added, what each customer owes before and after, the
   shift's result at close and after, and the attendant.
4. **Who carries it?** Asked only when a shift's result gets worse:
   - **The attendant (normal rules):** it adds to their shortage on that shift.
   - **The station (not their doing):** their shortage stays as it is.

   A correction that makes a shift better always goes to the attendant: it
   lowers what they owe on that shift (a surplus is the station's).
5. **Reason and approval.** Choose a reason and say what happened (at least 10
   characters). The approval is for exactly what was shown: if anything changed
   in between, NexGen stops and shows the new effects to check again.

## Record by record

### Fuel on account

Mistakes: the litres, the other fuel, another customer, another shift, never
taken (or recorded twice), or taken but not recorded. The price is always the
shift's pump price for that fuel and day.

| Where the entry is | What the correction does |
|---|---|
| Not yet invoiced | The wrong entry is reversed (kept, marked), the right one added. The customer's next invoice bills the right fuel. |
| In a draft invoice | The same, and the draft is refreshed at once. Check the draft's prices before issuing it. |
| On an issued invoice, paid or not | NexGen makes the notes itself, at the invoice's agreed price: a **credit note** for what was billed and should not have been, a **debit note** (a new bill) for what should have been billed. Credit beyond what the invoice still owes is held for the customer's next bill, and pays a debit note first. Fuel that was another customer's goes to that customer's next invoice. |

The fuel on account for a fuel can never be more than that fuel's pumps sold
on the shift. A credit note can never credit more litres than the invoice
billed. If the invoice already has a note made by hand, NexGen warns you, so
the same mistake is not corrected twice.

### Credit sales

Mistakes: another customer, the wrong amount, another shift, never given (or
recorded twice), or given but not recorded.

- The customer's debt moves with the sale. If the wrong sale had already been
  paid (fully or partly), that money goes on to pay the same customer's other
  debts, oldest first; anything left is held as their credit (it pays their
  next credit, or can be refunded).
- When a customer takes on more credit, their credit limits are checked. If
  the correction would take them past a limit, NexGen says so and the
  administrator ticks **Approve going past the customer's credit limit**; the
  approval is recorded like any other limit override.
- The shift: a credit counts towards what the drawer accounted for, so
  removing one makes the shift worse and adding one makes it better.

### Debt payments taken in a shift

Mistakes: another customer paid, the wrong amount, cash and M-Pesa the wrong
way round, another shift, never received (or recorded twice), or received but
not recorded.

- A payment reversed puts back the debts it paid: the customer owes them
  again. A payment added pays the customer's oldest debts; anything beyond
  what they owe is held as their credit (the money was received).
- The shift: a debt payment adds to what the drawer should hold. So a payment
  that was never received makes the shift better (the drawer was never short
  of it), and one not recorded makes it worse. Cash and M-Pesa the wrong way
  round changes neither.
- A payment part of which has already been refunded to the customer cannot be
  corrected.

### Drawer expenses

Mistakes: the wrong amount, the wrong category, never paid (or recorded
twice), or paid but not recorded (for example a receipt found later).

- The shift: an expense counts towards what the drawer accounted for, so an
  expense found later makes the shift better (the attendant owes less), and
  one that was never paid makes it worse. A wrong category does not change the
  shift.
- Wages are never a drawer expense; they are paid through Payroll.

### Cash and M-Pesa the wrong way round

Say what the money really was and how much was recorded the wrong way round.
The amount moves from one to the other; the M-Pesa fee is worked out again at
that shift's rate. The drawer's total and the shift's result do not change.
It can never move more than the shift shows.

## What happens elsewhere

**The shift.** Its own figures and lists do not move. It shows a note: "2
corrections since close: result at close short KES 300; corrected result short
KES 800", with each correction listed. Attendants see the corrections on their
own shifts (without customers' balances).

**The attendant.** Their shortage on that shift changes as described in step 4,
through their Variances, like any other correction of their shortage.

**Reports.** The daily report shows each shift as it closed and lists the
corrections posted that day. Monthly expense totals and categories include
corrected expenses on the shift's date.

**Tank stock, fuel sales and fuel cost never change.** These records are how
metered sales were paid or accounted for; the pumps measured the fuel either
way.

## Undo

A correction made in error is undone from the register: **Undo this
correction**, with a reason and approval. The undo is itself a new correction
(it cancels the first exactly): the reversed record comes back, the added one
is reversed, and anything it did to the attendant is cancelled. Customers'
balances follow: a restored credit sale is owed again (credit they hold pays
it first), a restored payment pays their debts again.

An undo is refused when something has been built on the correction since: it
made a credit or debit note (correct the entry again instead: that makes the
opposite note), its fuel is now on an issued invoice, a later correction
changed what it added (undo that one first), or a later cash/M-Pesa correction
on the same shift was worked out from it.

## What corrections don't do

- Decide which record is wrong: check the issue book, the customer's statement,
  the M-Pesa statement and the dips first.
- Replace KRA eTIMS documents: those come from the POS.
- Correct the records listed above as "still done the old way" (later phases).
- Show the station's own losses as a separate figure: a loss the station
  carries shows in the shift's corrected result.
