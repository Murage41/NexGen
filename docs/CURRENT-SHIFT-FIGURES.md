# Current shift figures

A2 is developed for installation after A1. It changes how existing corrections
are displayed; the station keeps its earlier screens until A2 is installed.

## Reading a closed shift

The main figures and lists show the current position, including corrections
recorded since close. Cash, M-Pesa, credits, debt receipts, invoice fuel and
expenses use the same calculation in the shift, daily report and dashboard.
Relevant monthly and cash-flow totals use those current amounts too.

Open **Original close → View original figures** to see what was saved when the
shift closed. The correction note explains the result at close and the current
result. The original records, pump readings, tank movements and fuel cost are
preserved. A financial correction does not change the next shift's readings.

For example, a shift closed with cash 10,000, M-Pesa 9,700 and expenses 300,
accounting for sales of 20,000. If an expense was recorded twice and 700 was
cash recorded instead of M-Pesa, its current figures become cash 9,300,
M-Pesa 10,400 and expenses zero: accounted 19,700, short 300. Original close
still shows the original balanced result and original amounts.

## Understanding the amounts

- A credit sale still accounts for that sale after the customer pays it.
  Its remaining debt is a separate figure on the customer's account.
- Invoice fuel still accounts for the sale after it is invoiced. Issuing an
  invoice does not create a second fuel sale.
- Debt receipts are already included in the money received. They increase
  expected money on the shift and are never added to received money twice.
- The wage used to reconcile an old close can differ from cash actually paid.
  **Paid from shift drawer** and cash flow use the actual payment. Payroll
  copies of a direct shift wage are not counted a second time.
- Correcting cash or expenses does not change the fuel measured by the pumps.
  Expenses affect profit; collecting an existing debt is not another sale.

If an old shift has no saved close, its original figures are marked unavailable.
Opening the screen does not create a historical close. History CSV exports
label both Original and Current financial columns so the two can be compared.

Only administrators make corrections. Attendants can read their own closed
shifts; the open shift remains blind. Existing correction and undo steps are
in [Corrections](CORRECTIONS.md).

Opening floats and independent corrections to cash/M-Pesa totals follow as
separate A3 and A4 releases. A2 retains the existing correction forms.
