# Invoice Customer Workflow

This guide explains how invoice-customer fuel consumption, invoices, payments,
corrections, and accounting records work in NexGen. Use it for station training
and release acceptance.

## Choose the Correct Customer Type

Use **normal credit** when the customer takes fuel on account and each credit
entry itself represents the debt to collect.

Use **invoice customer** when the station records litres during shifts, reviews
the consumption with the customer, and later combines selected consumption
into a formal invoice at an agreed price.

Money received for an invoice is an invoice payment. It is deliberately
separate from normal credit/debt payments and is not counted as a shift debt
receipt when an admin records it outside the shift.

Both kinds of customer are added from Credits, and either can have a credit
limit and repayment limit. See [CREDIT-CUSTOMERS-AND-LIMITS.md](CREDIT-CUSTOMERS-AND-LIMITS.md).

## Record Consumption During a Shift

1. Open the active shift and choose **Credits**.
2. Select the invoice customer.
3. Select the fuel type and enter the litres supplied.
4. If only one pump/source supplied that fuel, NexGen selects it automatically.
5. If several pumps/sources can supply it, select the exact source used.
6. Review and save the entry.

The backend checks the customer mode, shift, fuel type, pump/source, tank, and
available shift litres. It records the shift retail value for operational
accountability. The later invoice may use a different agreed price.

If the entry would break the customer's credit or repayment limit, nothing is
recorded until an administrator approves it on that screen.

Do not enter the same issue under both normal credit and invoice consumption.

## Review Customer Records

On desktop, open **Customer Invoices**, then open the customer's records. On
mobile, open **Invoice Customers** and select the customer.

The customer record shows:

- Consumption date, shift, attendant, fuel, pump/source, litres, and retail
  reference amount.
- Consumption status and the linked invoice where applicable.
- Issued, part-paid, paid, overdue, void, and draft invoices.
- Posted and reversed payments.
- Date, shift, fuel, source, and status filters with pagination through the
  full history.

Use these records to compare NexGen with the customer's issue book before
creating the invoice.

## Consumption Statuses

- **Unbilled**: active consumption that is available for a new draft.
- **In draft**: reserved by one draft and unavailable to other drafts.
- **Invoiced**: captured by an issued invoice.
- **Released**: previously reserved by a draft that was voided; available for
  a new draft.
- **Reversed**: original row retained after an audited correction.
- **Deleted**: original row retained after an allowed soft deletion.

Reversed and deleted rows remain visible for audit but do not count as active
customer consumption.

## Create and Issue an Invoice

1. Review the customer's unbilled consumption and date range.
2. Create the draft. NexGen reserves the selected rows immediately.
3. Review litres, agreed price, terms, due date, and totals.
4. Refresh the draft when later eligible consumption should be added.
5. Resolve any disputed consumption before issue.
6. Issue the invoice.

Two drafts cannot issue the same consumption. Deleting or voiding a draft
releases its reserved rows. A legacy draft must be refreshed before it can be
issued.

If the agreed invoice price differs from the shift retail reference price,
NexGen posts the difference explicitly in the invoice accounting trail. The
receivable always uses the issued invoice amount.

## Record a Payment

1. Open the customer or invoice.
2. Enter the payment date, method, reference, and amount.
3. Confirm the amount does not exceed the customer's outstanding invoice
   balance.
4. Post the payment.

NexGen rejects zero, negative, and overpayments. A customer payment is
allocated to outstanding invoices using the controlled allocation order.
Incorrect payments are reversed with a reason; they are not deleted.

Do not record an invoice payment as a normal credit payment. Do not add an
admin-recorded invoice payment to a shift's cash or M-Pesa expectation unless a
future approved workflow explicitly links that payment to the shift.

## Correct Consumption: Credit and Debit Notes

While a shift is open, an unreserved and uninvoiced consumption row can be
edited or soft-deleted through the normal shift workflow. A closed shift never
changes, and an issued invoice is final: it is corrected only by a note that
refers to it (KRA eTIMS works the same way).

Invoice customers take fuel on account, so every note is **fuel, litres and a
price per litre**, never a bare amount. On the invoice, choose **Credit note**
or **Debit note**, then what was wrong:

- **The litres:** fewer (credit) or more (debit) litres than the invoice says,
  priced at the invoice's own agreed price for that fuel.
- **The price per litre:** the same litres at the difference per litre (for
  example agreed 185, invoiced 190: 5 a litre).

Give the reason and the approving administrator with their PIN (on the phone
the signed-in administrator approves). Notes are dated the day they are
posted. Tank stock never changes: the fuel left the pumps either way; a note
only changes who owes it.

**Credit note (they owe less).** It reduces what the invoice still owes. If the
invoice is already paid, or the credit is more than what is unpaid, the rest is
the customer's **credit**: it pays their other open invoices and then their
next invoice when it is issued. It is never paid out. A credit note can never
credit more of a fuel than the invoice billed.

**Debit note (they owe more).** It is a **bill of its own** (numbered DN-), due
and payable like an invoice, and it appears in their invoices, statements and
aging. From an invoice it refers to that invoice. For a customer with no
invoice to correct (fuel taken on a shift but recorded on someone else, or
missed), use **Debit note** on the customer's page and give the shift and the
price per litre.

**Fuel recorded on the wrong invoice customer:** a credit note on the customer
charged wrongly and a debit note on the one who took it, each at their own
agreed price.

**Mistakes on notes.** A note is never edited. Reverse a wrong credit note (any
credit it gave other invoices comes back off them). Void a wrong debit note
while it is unpaid; once paid (in money or with the customer's credit), correct
it with a credit note.

## Release Acceptance Test

Run these checks in a test database, not with fabricated transactions in the
live station records:

1. Record petrol consumption where only one source exists and confirm automatic
   source selection.
2. Record diesel consumption where several sources exist and confirm a source
   is required.
3. Attempt litres above the selected shift/source allowance and confirm
   rejection.
4. Create two drafts for the same customer and confirm the second cannot
   capture rows already reserved by the first.
5. Void one draft and confirm its rows become available again.
6. Issue an invoice at a price different from retail and confirm the invoice,
   customer balance, and accounting difference agree.
7. Post a partial payment and confirm invoice and customer balances.
8. Attempt an overpayment and confirm no payment or allocation is created.
9. Reverse the partial payment and confirm the balances return while both audit
   records remain visible.
10. Post a litres credit note on a paid invoice: the customer shows In credit,
    and the credit pays their next invoice when it is issued.
11. Post a debit note for a shift on a customer with no invoice: it appears as
    a DN- bill, due and payable.
12. Attempt to edit invoiced consumption from the shift and confirm rejection.
13. Filter the customer history by date, shift, fuel, source, and status on
    both desktop and mobile.

After the test, run the receivable integrity audit:

```cmd
cd /d E:\NexGen\backend
npm run audit:receivables
```

Any reported integrity issue blocks release until investigated.
