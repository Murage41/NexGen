# Customers

Two kinds of customer take fuel on account:

- **Money (credit) customers:** each credit sale is a debt; they pay against
  their balance.
- **Invoice customers:** litres are recorded on shifts and later billed on an
  invoice at an agreed price.

Never record the same fuel both ways.

## Adding a customer

Administrators only: desktop **Credit Accounts → New Account**, phone
**Credits → Add**. Shift screens cannot create customers.

- Name (unique), phone (required), KRA PIN (optional, e.g. `A012345678Z`).
- Billing: Money or Invoice. Invoice customers are managed from **Customer
  Invoices** (desktop) or **Invoice Customers** (phone).

## Limits

Both optional; blank means no limit.

- **Credit limit (KES):** the most they may owe. For invoice customers this
  includes unpaid invoices and fuel not yet invoiced, at the pump price.
- **Repayment limit (days):** money customers, days since the credit was
  given; invoice customers, days past the invoice due date.

When an entry would break a limit, nothing is recorded until an administrator
approves it on that device (signed in on the phone, or name and PIN). The
approval covers exactly that entry and lasts 10 minutes. Five wrong PINs lock
that administrator on that device for 15 minutes. Every approval is kept on
the customer. The customer list shows **Over limit** and **Overdue**.

## Money customers

- **Credit sales** are recorded on the shift.
- **Payments** are recorded on a shift (**Debt Collections**, into that till)
  and pay the oldest debts first. A payment cannot be more than they owe.
- **Credit on account:** when a correction or balance move leaves a customer
  having paid more than they owe, the extra is their credit. It pays their next
  credit automatically, or is paid back with **Refund** (amount, cash or
  M-Pesa, approval). A customer holding credit cannot be removed.

## Invoice customers

1. **Record fuel on the shift:** customer, fuel, litres (and the pump when
   several can supply that fuel). NexGen checks the litres against what the
   pumps sold. It is valued at the pump price for accountability.
2. **Review** the customer's fuel history (filter by date, shift, fuel, status)
   against their issue book.
3. **Create a draft invoice.** It reserves the selected fuel so no other draft
   can take it. Refresh it to add later fuel; voiding it releases the fuel.
4. **Issue** it at the agreed price, with payment terms and due date. A price
   different from the pump price is posted as an explicit difference. The
   customer owes the invoice amount.
5. **Record payments** against invoices (date, method, reference, amount).
   Overpayments are refused. A wrong payment is reversed with a reason.
   Invoice payments made at the office are not shift money.

**After issue the fuel is fixed.** To change what the customer owes:

- **Credit note** (they owe less): reduces the unpaid amount; any excess is
  held as their credit for other or future bills. Total credits cannot exceed
  the bill. A full credit settles the invoice; its fuel stays invoiced.
- **Debit note** (they owe more): a separate DN- bill with its own due date,
  collected like an invoice. One can also be raised on a customer with no
  invoice to correct.
- Notes are never edited: a wrong credit note is reversed; an unpaid debit
  bill is voided.
- Wrong customer: credit note on the wrong one, debit bill on the right one.

The money-only notes above are update B2, which is on `main` but **not yet on
the station**. Until it is installed, the station keeps its earlier invoice
notes.

## Documents

Invoices, debit notes and credit notes are PDFs with the station's logo and
details ([Station PC](STATION-PC.md)). Each is saved when issued and the same
file is shown every time after. Desktop: open the invoice → **PDF**. Phone
(administrators): Invoice Customers → customer → Invoices → **PDF**. Every
document says it is not a tax invoice: tax invoices come from KRA eTIMS
through POSitive.

## Checks

After any change to customer money, run on the station:

```bat
cd /d E:\NexGen\backend
npm run audit:receivables
```

Any reported issue is investigated before going on.
