# Shifts

How a shift is opened, recorded and closed, and what attendants see. Mistakes
found after close are in [Corrections](CORRECTIONS.md).

## Open a shift

Administrators open shifts (desktop **Shifts & Readings**, phone **Shifts**).

1. Choose the attendant. Their pay plan is shown.
2. Count the cash in the till and check the M-Pesa balance of the account this
   shift will use. Enter **Opening cash** and **Opening M-Pesa**; enter 0 when
   there is none. Nothing is copied from the last shift.
3. Open. Pump opening readings continue from the last closing readings.

A new shift is always dated today. A missed shift cannot yet be entered on its
real date (see the roadmap).

## During the shift

Record, through their own forms:

- **Readings:** the closing figure on each pump's display. NexGen keeps a
  running total past each meter rollover; screens show the pump's own figure.
- **Credit sales** to money customers, and **fuel on account** (litres) for
  invoice customers. Breaking a customer's limit needs an administrator's
  approval ([Customers](CUSTOMERS.md)).
- **Expenses** paid from the till (never wages).
- **Debt payments**: a customer paying old credit into this till.
- **Cash remaining** and **M-Pesa balance**: the money actually held now,
  including the opening funds. Do not subtract the opening float.
- **Direct wage paid from this shift** (close form): for a daily-paid
  attendant it starts at what the plan earned this shift; change it only if a
  different amount was taken from the till. Weekly and monthly pay starts at 0.
  A typed amount stays on that device until close.

While a shift is open an administrator removes a wrong entry with the bin icon;
it is kept, marked reversed. Readings and counts are overwritten when saved
(no history yet; see the roadmap). Two devices saving an older copy get a
conflict message instead of overwriting each other.

**Money added / removed** (administrators): cash or M-Pesa put into or taken
out of the till that is not a sale, expense, wage or customer payment, such as
extra float, cash taken to the safe or bank mid-shift, or the owner taking
money. Enter method, direction, amount, reference and reason. A wrong one is
reversed, never deleted.

## Close

Review readings, money and entries, then close. NexGen works out:

```text
expected = opening cash + opening M-Pesa + sales from the pumps
           - credit sales - fuel on account - expenses - wage paid
           + debt payments + money added - money removed
short / over = cash remaining + M-Pesa balance - expected
```

Example: opening 5,000, sales 10,000, credit sales 1,000, fuel on account
2,000, expenses 1,000, debt payments 500 gives expected 11,500. Holding 11,500
balances; holding 11,200 is 300 short.

- A shortage goes on the attendant's Shortages list
  ([Staff and pay](STAFF-AND-PAY.md)). Pay is never reduced for it.
- A surplus belongs to the station.
- Shift earnings are worked out from the pay plan at close.
- Tank stock is reduced by what the pumps sold, oldest fuel first (FIFO cost).

NexGen does not estimate or subtract M-Pesa fees.

## After close

The shift and reports show **current figures**, including later corrections.
**Original close → View original figures** shows what was saved at close.
Reports use the same current figures, and history exports have both.

Shifts opened before update #16 keep their old method: they record money
received instead of opening and closing balances.

## What attendants see on the phone

Bottom bar: **Home, My Shift, My Pay, Credits, More**.

- Home: whether a shift is open, and "Fuel is low" warnings.
- My Shift: their own shifts. An open shift is **blind**: they record readings,
  money, credits and expenses but see no expected total or shortage until an
  administrator closes it. The pump's own money meter still shows its sales.
- My Pay: their pay, payments and shortages.
- Credits: money customers' names, balances and limits (no phone numbers or
  statements). Invoice customers appear by name only, to record fuel.
- More: pumps, tanks, today's prices.

They never see stock value or cost, dips and deliveries, the day's sales or
reports, other employees' pay, suppliers, payroll, settings or corrections.
The server enforces this, not just the screens.
