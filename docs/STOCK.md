# Stock

Tanks, deliveries, dips and the low-fuel warning. Desktop **Tank & Stock**,
phone **More → Tanks & Stock**.

## How stock moves

- **Closing a shift** takes the pumps' sales out of their tanks, oldest fuel
  first (FIFO), which gives the cost of the fuel sold.
- **A delivery** adds litres from the start of its delivery date.
- **A dip** measures the tank; the difference from book stock is shown.

## Record a delivery

**Tank & Stock → Deliveries → Record Fuel Delivery:** date, tank, litres,
supplier, cost per litre, invoice number, and the supplier's PDF if you have
it. If the tank would go over its size, NexGen saves it and warns you to check
the litres and take a dip.

**Price not known yet:** leave cost per litre blank. The litres go into stock
at once; no supplier debt is created. When the supplier's invoice comes, open
the same delivery and add the cost and invoice number; the supplier invoice is
created then.

**Backdated delivery:** enter the real date. NexGen recalculates stock, dip
book figures and fuel cost for the affected shifts from that date.

## Low fuel warning

Each tank has an **Order more at** level (pencil on the tank; empty = no
warning). It can be changed during a shift. The form suggests a level from the
last 14 days' sales, e.g. 200 L a day, two days to arrive plus one day's
margin: 600 L.

When **In the tank now** (stock less what the open shift has sold so far) is
below the level, everyone's home screen shows "Fuel is low: order more" and
the menu shows a red count. It clears when a delivery lifts the tank above the
level.

It is a calculation, not a measurement: losses not yet found by a dip make it
late. It sends no messages and places no orders.

## Pumps and prices

- Pumps are set per tank, with the meter rollover point of each display.
- **Fuel Pricing** holds the pump prices. They are the owner's: EPRA's
  published price plus the station's transport cost.
