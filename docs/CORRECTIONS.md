# Corrections

How to fix a mistake found after a shift has closed. For the owner and for
training whoever handles the office.

## The rule

**Before a shift closes, fix it on the shift. After it closes, correct it.**

A closed shift never changes. Its figures (sales, cash, M-Pesa, credits, fuel
on account, shortage or surplus) stay exactly as they were when it closed, on
every screen. The database itself refuses to change them.

A mistake found later is fixed by a **correction**: a numbered record
(C-2026-0001, C-2026-0002, …) that says what was wrong, what the right record
is, why, and who approved it. It is kept next to the shift, never inside it.
This is how accounting systems keep closed records closed: SAP and Dynamics 365
post a reversal instead of editing, Odoo corrects a delivery before it is
invoiced and with a credit note after, and KRA (eTIMS) corrects an issued
invoice only with a credit or debit note that refers to it.

## What can be corrected today

**Fuel on account** (an invoice customer's fuel entry on a closed shift). Other
records (credit sales, payments, expenses, meter readings, deliveries) follow
in later phases; until then use **Move balance** (see
`CLOSED-SHIFT-CORRECTIONS.md`), credit and debit notes, or payment reversal as
before.

## Where

- **A fuel entry:** Customer Invoices (desktop) or Invoice Customers (phone) →
  the customer → the fuel history → **Correct** on the entry.
- **A closed shift:** the shift's fuel on account list → **Correct** on the
  entry, or **Add missing fuel on account** (phone: **Add missing**).
- **The register (desktop):** **Corrections** in the menu lists every
  correction, newest first. Open one to see exactly what it did, and to undo it.

Only administrators correct. On the desktop, choose the approving
administrator and enter their PIN; on the phone the signed-in administrator
approves.

## The steps

1. **What was wrong?**
   - The litres were wrong
   - It was the other fuel
   - It was another customer
   - It was on another shift
   - It was never taken, or was recorded twice
   - Fuel was taken but not recorded (from the shift: Add missing)
2. **The right value.** Only the wrong part can be changed. The price is always
   the shift's pump price for that fuel and day; it cannot be typed.
3. **Check what it does.** NexGen lists every effect in plain words: the
   entry reversed and the one added, the customer's invoice, the shift's result
   at close and after the correction, and the attendant.
4. **Who carries it?** Asked only when a shift's result gets worse:
   - **The attendant (normal rules):** it adds to their shortage on that shift.
   - **The station (not their doing):** their shortage stays as it is.

   A correction that makes a shift better always goes to the attendant: it
   lowers what they owe on that shift (a surplus is the station's).
5. **Reason and approval.** Choose a reason and say what happened (at least 10
   characters). The approval is for exactly what was shown: if anything changed
   in between (for example the invoice was issued), NexGen stops and shows the
   new effects to check again.

## What happens to the money

| Where the entry is | What the correction does |
|---|---|
| Not yet invoiced | The wrong entry is reversed (kept, marked), the right one added. The customer's next invoice bills the right fuel. |
| In a draft invoice | The same, and the draft is refreshed at once. Check the draft's prices before issuing it. |
| On an issued invoice, paid or not | NexGen makes the notes itself, at the invoice's agreed price: a **credit note** for what was billed and should not have been, a **debit note** (a new bill) for what should have been billed. Credit beyond what the invoice still owes is held for the customer's next bill, and pays a debit note first. Fuel that was another customer's goes to that customer's next invoice. |

**The shift.** Its own figures do not move. It shows a note: "1 correction
since close: result at close short KES 300; corrected result short KES 800",
with each correction listed. Attendants see the corrections on their own shifts.

**The attendant.** Their shortage on that shift changes as described in step 4,
through their Variances, like any other correction of their shortage.

**Tank stock and fuel cost never change.** Fuel on account is how a metered
sale was paid, like cash or M-Pesa. The pumps measured the fuel either way.

**Limits.** The fuel on account for a fuel can never be more than that fuel's
pumps sold on the shift. A credit note can never credit more litres than the
invoice billed. If the invoice already has a credit or debit note made by
hand, NexGen warns you, so the same mistake is not corrected twice.

## Undo

A correction made in error is undone from the register: **Undo this
correction**, with a reason and approval. The undo is itself a new correction
(it cancels the first exactly): the reversed entry comes back, the added one
is reversed, and anything it did to the attendant is cancelled.

An undo is refused when something has been built on the correction since: it
made a credit or debit note (correct the entry again instead: that makes the
opposite note), its fuel is now on an issued invoice, or a later correction
changed its entry (undo that one first).

## What corrections don't do

- Decide which record is wrong: check the issue book, the customer's statement
  and the dips first.
- Replace KRA eTIMS documents: those come from the POS.
- Correct other kinds of records yet (later phases).
- Show the station's own losses as a separate figure: a loss the station
  carries shows in the shift's corrected result.
