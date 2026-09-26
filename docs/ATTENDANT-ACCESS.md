# What attendants can see on the phone

An attendant sees what they need to serve customers and run their own shift,
plus their own pay and shortages. The figures you use to check them, the
station's money and other people's money stay with administrators. The server
enforces this: hiding a button is not what protects the figures.

## The attendant's phone

The bottom bar has **Home, My Shift, My Pay, Credits, More**.

| Screen | What the attendant sees |
|---|---|
| Home | Whether a shift is open, who is on it and since when. A warning if a shift has been open too long, and "Fuel is low" when a tank is below its order level (`docs/TANK-LOW-STOCK.md`). "View Shift Details" only on their own shift. |
| My Shift | Their shifts. |
| My Pay | Their pay, payments, and the shortages they owe and have paid. |
| Credits | Money (credit) customers: name, what they owe, their limits, how much more they can take on credit, and an "Over limit" or "Overdue" warning. No phone numbers, no statements, no total owed to the station. |
| More → Pumps | Each pump's fuel, tank, last closing meter reading (as the pump shows it), and where the meters roll over. |
| More → Tanks & Stock | The fuel in each tank now, its capacity, how full it is and its order level. |
| More → Fuel Pricing | Today's pump prices. |

## An open shift is "blind"

While their shift is open, the attendant records readings, cash, M-Pesa,
credits and expenses, and sees what they have recorded. They **do not** see
what the pumps say they should hand in, the running total, the variance or a
"Shortage" warning. The result is worked out when an administrator closes the
shift. Once closed, the attendant sees the result, including any shortage.

Limit: the pump's own money meter still shows its sales, so a careful
attendant can still do the sum. The blind shift removes the easy running
balance, not all arithmetic.

## What attendants never see

- Invoice customers' balances, invoices, notes and fuel history. When they
  record fuel taken on account, they pick the invoice customer by name only.
- Stock value, cost of fuel, dips (measured against book stock), stock
  adjustments and deliveries.
- Today's sales, collections, variance, the weekly chart, reports and profit.
- Station expenses (they record only their own shift's expenses).
- Other employees' pay, debts and shortages.
- Suppliers, payroll, settings, balance moves and corrections.

Administrators see everything, on the desktop and on the phone.
