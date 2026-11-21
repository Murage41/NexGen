# Customers

Two kinds of customer take fuel on account:

- **Money (credit) customers:** each credit sale is a debt; they pay against
  their balance.
- **Invoice customers:** litres are recorded on shifts and later billed on an
  invoice at an agreed price.

Never record the same fuel both ways.

On the desktop, **Customers** lists every customer of both kinds, with what
each owes and any Over limit / Overdue / Draft invoice flag. Click one to open
their account (credit) or their fuel, invoices and payments (invoice).
**Invoices** and **Invoice payments** at the top list all of them.

## Adding a customer

Administrators only: desktop **Customers → New customer**, phone
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
the customer. The customer list shows **Over limit** and **Overdue**. For
invoice customers, Overdue means an invoice past its due date, whether or not a
repayment limit is set, and **Not invoiced** means fuel waiting more than 35
days to be invoiced. Both also show on **Today** (desktop and the
administrator's phone home); a tap opens the customer.

## Money customers

- **Debts** are recorded on the shift (Add debt): fuel in litres or amount at
  the shift's pump price ("Diesel 44.053 L at 227.00"), or Other for an amount.
- **Payments** are recorded on a shift (**Debt Collections**, into that till)
  and pay the oldest debts first. A payment cannot be more than they owe.

**Payment codes.** Every payment by M-Pesa, bank or cheque needs its code (M-Pesa
code, bank reference or cheque number): debt payments, office payments,
refunds, invoice, supplier and payroll payments. An M-Pesa code is 10 letters
and digits; a code already on another payment is refused, the usual sign of a
payment entered twice. A reversed payment frees its code. Older payments with
no code show **Add code** for an administrator: it adds the code once and
changes nothing else.
- **Credit on account:** when a correction or balance move leaves a customer
  having paid more than they owe, the extra is their credit. It pays their next
  credit automatically, or is paid back with **Refund** (amount, cash or
  M-Pesa, approval). A customer holding credit cannot be removed.
- **Removing a customer** needs them to owe nothing and hold no credit,
  counted from their records. It only takes them off the lists: their debts
  and payments stay, so old shifts and reports never change.

## Invoice customers

1. **Record fuel on the shift** (Add debt): customer, fuel, then litres or
   amount at the shift's pump price. No pump is asked for. NexGen checks the
   fuel on account against what that fuel's pumps sold.
2. **Review** the customer's fuel history (filter by date, shift, fuel, status)
   against their issue book.
3. **Create a draft invoice up to a date.** It takes every fill not yet
   invoiced from closed shifts up to that date, however old, so nothing is left
   between invoices; no other draft can take them. Each fill is billed at the
   amount recorded at the pump, one line per fuel and pump price (Diesel at
   227.00, Diesel at 230.80), so the invoice matches the pump receipts. Refresh
   it to add fuel from shifts closed later; deleting it releases the fuel.
4. **Issue** it, with payment terms and due date. The customer owes the
   invoice amount.
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

**Before issue**, a wrong fill on a closed shift is fixed with a Correction. A
correction that puts more fuel on a customer than their credit limit allows
needs the limit approved with it, as a sale on the shift does.

**Removing an invoice customer**, or switching them to money billing, also
needs no fuel waiting to be invoiced (open or closed shifts) and no draft
invoice. The message says how many litres and from which dates: invoice it,
or correct entries recorded by mistake, first.

## Documents

Invoices, debit notes and credit notes are PDFs with the station's logo and
details ([Station PC](STATION-PC.md)). Each is saved when issued and the same
file is shown every time after. Under the amount due, an invoice lists
**Fuel by shift**: date, shift, fuel, litres and the amount recorded at the
pump, one row per shift and line, adding up exactly to the invoice (meters give
litres to 3 decimals; the rows share out the rounding). Invoices issued before
this keep the PDF they were saved with. Desktop: open the invoice → **PDF**. Phone
(administrators): Invoice Customers → customer → Invoices → **PDF**.

The **Statement** (desktop: the customer's page; phone: Invoices tab) is made
when you open it, as at today, and not saved: balance brought forward, every
invoice, payment and note since the first of last month with the running
balance, open invoices with days overdue, ageing, and fuel taken but not yet
invoiced. Send it to the customer each month.

Every document says it is not a tax invoice: tax invoices come from KRA eTIMS
through POSitive.

## Checks

After any change to customer money, run on the station:

```bat
cd /d E:\NexGen\backend
npm run audit:receivables
```

Any reported issue is investigated before going on.
