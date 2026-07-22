# Fuel Delivery Workflow

This is the production rule for fuel deliveries on the station PC.

## Core Rule

When an admin enters a delivery date, NexGen treats that delivery as effective
from the start of that date:

```text
selected date 2026-07-21 -> effective timestamp 2026-07-21 00:00:00
```

The actual save time remains the audit time (`created_at`). The save time is
not used to decide whether later shift sales are deducted before or after the
delivery.

## Normal Same-Day Delivery

1. Open the ERP as admin.
2. Go to Tank Stock Management.
3. Open the Deliveries tab.
4. Click Record Fuel Delivery.
5. Select the delivery date.
6. Select the tank.
7. Enter litres delivered.
8. Select the supplier account.
9. Enter cost per litre and invoice number if the supplier invoice is ready.
10. Attach the supplier invoice PDF if available.
11. Save.

If the tank book stock goes above tank capacity, NexGen saves the delivery but
shows a warning so the admin can check the litres/date and take a dip.

## Supplier Invoice Not Ready Yet

When fuel has arrived but the supplier has not provided price or invoice:

1. Record the delivery with date, tank, litres, and supplier.
2. Leave Cost per Litre blank.
3. Leave invoice number/PDF blank unless you already have a delivery note PDF.
4. Save.

NexGen immediately adds the litres to stock. It marks the delivery as pending
price and does not create supplier debt yet.

When the supplier invoice arrives:

1. Open the same delivery.
2. Enter cost per litre.
3. Enter invoice number.
4. Attach the PDF if available.
5. Save.

NexGen then creates the linked supplier invoice/payable.

## Backdated Delivery

Use the real delivery date. For example, if fuel arrived on Tuesday but the
price arrives on Thursday, enter Tuesday as the delivery date.

NexGen will:

- make the delivery effective from Tuesday 00:00:00,
- recompute tank stock from that date forward,
- recompute affected dip book-stock values from that date forward,
- replay FIFO batch consumption and COGS for affected closed shifts,
- keep older station history untouched unless the delivery itself is edited.

If a pending-price delivery already supplied litres to a closed shift before
the price was entered, NexGen allows the price update and replays FIFO costing
for the affected closed shifts automatically.

If many closed shifts are affected, saving the delivery can take a little
longer because the replay is done immediately and transactionally.

## Existing Station Data

This change does not rewrite historical delivery timestamps already stored on
the station PC. That protects the station database from silent historical
changes.

To preview old deliveries that do not match the new midnight rule, run this on
the station PC:

```cmd
cd D:\NexGen\backend
npm run maintenance:delivery-timestamps:dry-run
```

The command prints a table only. It does not change the database.

## Professional Follow-Ups

Useful delivery controls to add later:

- a visible COGS recalculation screen for admin users,
- delivery correction documents instead of editing finalized deliveries,
- supplier delivery note number separate from invoice number,
- landed-cost allocation for transport/levies/fees when needed,
- delivery approval workflow if attendants are allowed to record receipts.
