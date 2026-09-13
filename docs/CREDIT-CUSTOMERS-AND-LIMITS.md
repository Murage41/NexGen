# Credit Customers and Limits

How customers are added, what their limits mean, and what happens when a sale
would break one. Applies to money (normal credit) and invoice customers.

## Adding a Customer

Customers are added only from **Credits**: on the desktop, **Credit Accounts →
New Account**; on mobile, **Credits → Add** (administrators only). Shift credit
entry lists existing customers and cannot create one. An attendant who cannot
find a customer asks an administrator to add them.

- **Name** must be unique, ignoring capitals and spaces.
- **Phone** is required for new customers. Customers added before this release
  can still be edited without one, but a phone on file cannot be removed.
- **KRA PIN** is optional: a letter, nine digits and a letter, for example
  `A012345678Z`. It is saved in capitals.
- **Billing** is Money or Invoice. Invoice customers are managed from
  **Customer Invoices**; use **Edit customer** in their workspace.

## Limits

Both limits are optional. Blank means no limit, and every customer that existed
before this release starts with none.

**Credit limit (KES)** is the most the customer may owe.

- Money customers: their unpaid credit.
- Invoice customers: unpaid and draft invoices **plus fuel on account not yet
  invoiced**, at retail price. Uninvoiced fuel must count: it is usually most of
  what an invoice customer owes.

**Repayment limit (days)** is how long a balance may stay unpaid.

- Money customers: days since the credit was given (its shift date).
- Invoice customers: days past the invoice's due date. The due date is the issue
  date plus the payment terms. Fuel not yet invoiced never counts here, because
  a delay in invoicing is the station's, not the customer's.

A limit is broken only when it is exceeded: a new entry that takes the customer
over the credit limit, or anything unpaid for **more** than the repayment limit.
Entering a repayment limit shows the date approval would start to be needed.

## When a Limit Is Broken

Nothing is recorded. The screen shows which limit is broken and by how much,
and asks for an administrator's approval:

- **Signed in on mobile as an administrator:** tap **Approve and add credit**
  (or **Approve and record litres**). You are recorded as the approver.
- **Desktop, or an attendant's phone:** an administrator selects their name and
  enters their PIN on that device.

An approval covers exactly that entry: the same customer, shift and amount (or
fuel type and litres). Changing the entry withdraws it, and it expires after 10
minutes. Five wrong PINs lock that administrator's approvals for 15 minutes.

If no administrator is present, the attendant cannot record the entry. An
administrator can add it to the shift later from their own device.

## Where Approvals Are Recorded

Every approval is kept: when, which shift, the amount, which limits were broken
and by how much, who approved, and who was signed in when it was recorded.

- Desktop money customers: **Credit Accounts**, expand the customer.
- Desktop invoice customers: **Customer Invoices → Open → Edit customer**.
- Mobile: **Credits**, open the customer.

The customer list also shows each customer's limits, flagged **Over limit** or
**Overdue** when a limit is broken right now.

## Release Acceptance Test

1. Add a money customer with a phone, KRA PIN, credit limit of 1,000 and
   repayment limit of 30 days. Confirm an eight-digit KRA PIN is refused.
2. On an open shift, add a credit of 1,500 for them. Confirm nothing is recorded
   until approval, a wrong PIN is refused, and the correct PIN records the
   credit and lists the approval on the customer.
3. Add a credit for a customer with no limits. Confirm it records directly.
4. Signed in on mobile as an attendant, break a limit and have an administrator
   approve on that phone. Confirm the approval lists the administrator, "for"
   the attendant.
5. Give an invoice customer a credit limit below what they owe now. Confirm
   recording litres asks for approval, and the figure includes uninvoiced fuel.
6. Confirm shift credit entry offers no way to type in a new customer.
