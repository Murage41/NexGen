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

## Correct Consumption

While a shift is open, an unreserved and uninvoiced consumption row can be
edited or soft-deleted through the normal shift workflow.

For a closed shift:

1. Open the consumption record and choose correction.
2. Enter the corrected customer, fuel, source, and litres.
3. Enter a meaningful reason of at least 10 characters.
4. Preview the stock, customer, and accounting effect.
5. Post only after the preview is correct.

The correction reverses the original row and creates a replacement; it does
not rewrite history. Reserved or invoiced consumption cannot be changed from a
shift. Correct an issued invoice through its void, credit-note, or debit-note
document workflow so the receivable and accounting trail remain intact.

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
10. Correct an unbilled closed-shift row and confirm preview, reversal,
    replacement, stock impact, and history.
11. Attempt to edit invoiced consumption from the shift and confirm rejection.
12. Filter the customer history by date, shift, fuel, source, and status on
    both desktop and mobile.

After the test, run the receivable integrity audit:

```cmd
cd /d E:\NexGen\backend
npm run audit:receivables
```

Any reported integrity issue blocks release until investigated.
