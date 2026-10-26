# Staff and pay

Employees, pay plans, payroll, and attendants' shortages.

## Employees

Desktop **Employees**, phone **More → Employees** (administrators). Each
employee has employment details, a role (admin or attendant) with a 4-digit
PIN, and a pay plan.

Click an employee to open their page: what they owe on shortages, earned
this month and are due on top, then **Pay** (statement and payments),
**Shortages** (with Record payment) and **Pay plan & details** (Change pay
plan, Edit details, Deactivate). On the desktop the list stays on the left.
Payroll's employee links open the same page.

## Pay plans

A plan has one or more parts (up to eight):

| Part | Meaning |
|---|---|
| Fixed per shift | An amount for each closed shift |
| Fixed salary | An amount per pay period |
| % of sales | A share of the shift's sales (all fuel, petrol or diesel) |
| KES per litre | A rate on litres sold in the shift |

Parts can be combined and can have a minimum or maximum, e.g. 750 per shift
plus 0.5% of sales. The pay schedule (daily, weekly, every two weeks, monthly)
decides when earnings are paid, so a per-shift plan can still be paid monthly.

Plans are never edited: a change is a new version from a start date. It
cannot start before an already closed shift, or while the employee has an
open shift. Closed shifts keep the plan they were earned under.

## Earnings and payment

- Shift parts are worked out when the shift closes, once, rounded to cents.
- A salary is worked out when its payroll period is calculated.
- **Daily pay from the till:** at close, "Direct wage paid from this shift"
  starts at what the shift earned (see [Shifts](SHIFTS.md)). It counts as paid
  in payroll, so it is never paid twice.

## Payroll

Desktop **Payroll**, phone **More → Payroll**.

1. **Calculate** a schedule and period (daily = one day, weekly = 7 days,
   every two weeks = 14 days, monthly = a calendar month). Every shift in the
   period must be closed; periods of one schedule cannot overlap.
2. Review each employee: earnings, what was already paid from the till, and
   deductions (statutory, advance, or other approved; each needs an
   administrator's approval).
3. **Approve.** This is when pay becomes an expense.
4. **Pay** (cash, M-Pesa, bank, cheque), in one or more payments, directly or
   from an open shift's till. A wrong payment is reversed with a reason.
5. A wrong run is voided (after reversing its payments) and calculated again.
   **Supplemental shifts** adds late shift earnings to an approved period.

Wages are never entered as an expense; NexGen refuses expenses named wage or
salary.

## Shortages

- A shift that closes **short** is owed by its attendant, dated the shift's
  date. A shift that closes **over** is the station's; it never pays a
  shortage.
- **Pay is never reduced for a shortage**, on any plan. Kenya's Employment Act
  s.19 allows a wage deduction for a cash shortage only in narrow cases and
  caps all deductions; paying in full and collecting separately avoids that.
- No write-offs and no paying back (owner decision, 24 Sep 2026). Older ones
  stay on record, labelled.

**Shortages list:** desktop **Employees → Shortages** column, phone the
employee's card. Columns: date, shift, shortage, paid, still owed.

**Record payment** (administrators): amount, cash / M-Pesa / bank, date,
reference. If the money goes into an open shift's till, choose that shift and
count it there. It pays the oldest shortage first; a wrong one is reversed.

If a shortage gets smaller after it was paid (a correction), what was paid is
the attendant's credit and pays their next shortage. It is never paid out.

## What employees see

**My Pay** on the phone: their own shifts, earnings by part, payments,
shortages and payments towards them, and **Print statement**. Never anyone
else's.
