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

## Correct Consumption

Before issue, review the litres, customer, fuel and supply source. An open
shift uses its existing entry controls; a closed shift uses **Correct** for
unbilled or draft consumption. Drafts refresh after a valid correction.

**After invoice issue, consumption is fixed.** The original customer, fuel,
litres, shift, pump/source, invoice lines and original PDF stay recorded.
Correct the money payable using a credit or debit note. A full credit does
not return that fuel to Unbilled and does not put litres back in a tank.
Issued invoices cannot be voided to release their fuel for another bill.

### Credit and debit notes after issue

On desktop, open **Customer Invoices**, open the invoice, then choose
**Credit note** or **Debit note**. Enter the amount in KES and explain what
happened. Choose the approving administrator and enter their PIN. Notes are
dated today. The approval covers the customer, invoice, type, full amount and
reason. Do not enter a new fuel quantity or change a shift through this form.

**Credit note: the customer owes less.** It reduces the invoice's unpaid
money first. Any excess is held as customer credit, settling other eligible
open bills and then a future bill. It does not create a payment or pay out
a refund. The form shows the remaining amount available to credit; total
posted credits cannot exceed that document's billed amount. Historical debit
notes recorded inside the same bill add to that amount; a newer separate DN-
bill has its own credit limit and is corrected against that bill itself.

For example: original invoice 1,000, actual payment 800, credit note 300.
The invoice has nothing left to collect and the customer holds credit 100.
The original invoice remains 1,000 and the real payment remains 800.

**Debit note: the customer owes more.** It creates a separate DN- bill,
linked to the invoice, with its own amount due, due date and saved PDF. Open
that bill to collect it using the existing invoice-payment workflow. A 250
debit bill on the account above uses held credit 100 and leaves 150 payable.
The linked original invoice's fuel and face amount remain fixed.

For a charge on a customer with no invoice to correct, use **Debit note** on
the customer's desktop page. Enter the money owed and a clear explanation.
It creates a monetary DN- bill; no shift or invented litres are required.

**Wrong invoice customer.** Make a credit note on the wrongly charged
customer's invoice. Make a separate debit bill on the right customer, with
the original invoice reference in the explanation. Real payments stay with
the customer who paid. There is no automatic transfer or attendant charge.

**Full credit.** Enter the remaining available credit amount on that document.
An unpaid invoice becomes settled; money already paid remains recorded and
any excess becomes customer credit. The fuel stays linked to its issued bill.

**Mistaken note.** Notes are never edited. Reverse a wrong credit note with
a reason and approval; any credit it applied to other bills is taken back off
them. An unpaid debit bill can be voided. Once paid, correct it with a credit
note against that debit bill. Its original invoice has a separate credit cap.

**Historical notes.** Existing fuel/litres/price notes and earlier attendant
effects remain visible, with their stored PDFs and permitted reversals.
New notes are money only and do not change an employee's debt, wages, shift
money, pump readings, tank stock or FIFO. Customer notes are not an employee
responsibility decision. Genuine refunds remain a separate financial action;
B6's payment/refund changes and E2's new phone note actions are later stages.

Keep the invoice billing mode while the customer holds invoice credit. A note
cannot be reversed on an archived customer or an account switched to normal
money credit; restore a valid invoice account and review it before proceeding.

The phone continues to show invoice/customer history and saved documents.
Issued source entries display that they are fixed, with guidance to use a
monetary note. Historical records are not rewritten when B2 is installed.

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
10. Post a monetary credit note on a part-paid/paid invoice; verify retained
    actual payments, correct credit held and application to a new bill.
11. Post a linked or standalone monetary debit bill; collect its true balance
    through the existing invoice-payment form without adding shift money.
12. Fully credit an issued invoice; verify its source remains Invoiced,
    unavailable to another draft, with unchanged original PDF and stock.
13. Attempt issued source changes, correction/undo and issued fuel void;
    confirm refusal with guidance to monetary notes. Draft release still works.
14. Filter the customer history by date, shift, fuel, source, and status on
    both desktop and mobile.

After the test, run the receivable integrity audit:

```cmd
cd /d E:\NexGen\backend
npm run audit:receivables
```

Any reported integrity issue blocks release until investigated.
