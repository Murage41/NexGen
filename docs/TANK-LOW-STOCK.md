# Low fuel warning

NexGen warns everyone when a tank is running low, so fuel is ordered in time.

## Setting it up

Each tank has an **"Order more at"** level in litres. Set it under
**Tank & Stock** (desktop) or **More → Tanks & Stock** (phone, administrators):
press the pencil on the tank. Leave it empty and that tank never warns.

The level can be changed any time, even during a shift. A tank's name, fuel
and size still wait until no shift is open.

**How to choose the level:** enough fuel to last from the day you order to the
day it arrives, plus a margin. The form helps: it shows the level as a share of
the tank and, from the last 14 days, about how much the tank sells a day and
how many days of fuel the level covers. For example, a tank that sells 200 L a
day, with deliveries two days after ordering and one day's margin: 3 × 200 =
600 L.

## What you see

- **Home screen** (desktop and phone, administrators and attendants):
  "Fuel is low: order more", with each low tank, the litres left and its order
  level. It stays until a delivery brings the tank back above its level.
- **Menu:** a red number on **Tank & Stock** (desktop) or **More** (phone) with
  how many tanks are low.
- **Tank pages:** each tank shows **In the tank now** and its order level, in
  red when it is below.

## "In the tank now"

NexGen takes a shift's sales out of the tank when the shift closes. So while a
shift is open, "in the tank now" is the tank's stock less what the open shift
has sold so far, from the readings entered. The warning uses this figure.

The open shift's **Tank Stock** box uses the same calculation as the shift
close. (It used to add that day's deliveries a second time.)

## What it won't do

- The figure is calculated, not measured. Losses a dip has not yet recorded
  make the warning late. Record dips regularly.
- An open shift's sales count only once its readings are entered.
- Nobody is sent a message: the warning shows when NexGen is open.
- It does not place orders.
