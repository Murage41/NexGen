# Attendant Variances

Every closed shift's over or short belongs to the attendant who ran it. It is
kept under **Employees**, one list per employee, like a cashier variance
listing. Pay is never reduced for it on any plan (daily, weekly, fortnightly or
monthly): the employee is paid in full and repays shortages separately.

## Why It Works This Way

- Point-of-sale systems (Dynamics 365 Commerce, Odoo) record each shift's
  over/short when it closes and post it to a difference account. They never
  take it from the cashier's pay at close.
- Money an employee owes is a different kind of receivable from customer credit
  (IAS 1 lists them separately), so it no longer appears on Credits.
- Kenya's Employment Act, section 19, allows deducting a cash shortage from
  wages only when the employee caused it through negligence or dishonesty and
  their contract makes them responsible for cash, and caps all deductions at
  two-thirds of wages. Paying in full and collecting repayments separately keeps
  payroll out of that. Write off shortages that were not the attendant's fault,
  and keep the cash-handling duty in attendants' contracts.

## Closing a Shift

There is no recovery step. For daily plans the wage field starts at the full
amount earned; enter less only if part of the wage is paid later through
payroll. When the shift closes, its over or short is posted to the attendant's
variances, dated the shift date.

## The Variances List

Open **Employees** and select the amount in the **Variance** column (desktop),
or tap the variance figure on the employee's card (phone).

| Column | Meaning |
|---|---|
| Date, Shift | The shift and its date |
| Shift variance | Short or over, after any corrections |
| Recovered | What has covered the shortage: surplus, repayments, write-offs, or the old system |
| Real variance | What is left: still owed (short), or surplus still usable this month (over) |

The total at the bottom is the real variance of the rows shown. The top of the
page says what the employee owes now, or has in their favour. Tap a row for the
details. Attendants see their own list on their phone under **My Pay**,
read-only.

## Surpluses (decided 2026-09-22)

A surplus pays whatever the attendant owes at that point, oldest first. What is
left can pay their later shortages **in the same month**. At month end, any
surplus still unused stays with the station. A surplus is never paid out in
cash.

For example, within one month: short 52.42, over 57.84, short 1.88, short 90.28,
over 0.38. The attendant owes 86.36.

## Repayments, Write-offs and Paying Back

On the Variances page (administrators only):

- **Record repayment:** cash, M-Pesa or bank transfer, the date, and the M-Pesa
  or bank reference (optional for cash). If the money goes into an open shift's
  drawer, enter that shift and count it in the drawer. A repayment can't be more
  than what is owed. It pays the oldest shortage first. **Reverse** undoes a
  mistaken one; it stays on record, marked reversed.
- **Write off:** for a shortage that was not the attendant's fault. Choose the
  shift (or oldest first), the amount and why. It needs an administrator's PIN
  on the desktop. The station takes the loss; a write-off never creates money
  owed to the employee.
- **Pay back:** only money the employee repaid that no longer covers anything,
  usually after a correction reduced a shortage. Cash or M-Pesa, with an
  administrator's PIN on the desktop.

## Closed-shift Corrections

A correction changes the shift's variance by exactly what it changes in the
drawer, as an entry dated the day of the correction. What covered that shift is
then worked out again: if repaid money no longer covers anything, it can be
paid back; freed surplus stays with the station; a write-off only ever covers
what is owed. The correction preview shows the effect before you approve it.
See [Correcting a Closed Shift](CLOSED-SHIFT-CORRECTIONS.md).

## Reports

- **Dashboard:** Owed by attendants.
- **Monthly report:** shortages, surpluses, changes by corrections, repaid,
  written off (station loss), surplus kept by the station, paid back, and what
  attendants owe at month end.
- **Cash flow:** repayments received directly are cash in; money paid back to
  employees is cash out. Repayments taken into a drawer are part of that
  shift's collections.
- **Daily report:** shortages on the day's shifts that attendants still owe.

## What Was Carried Over (update #7, migration 047)

Nothing was deleted or edited. The old staff-debt records stay as they were and
show under **Earlier records** on each Variances page.

- Every shift since 17 Aug 2026 (when close figures began to be stored), and any
  shift that still had debt, is listed with its variance, what the old system
  recovered (wage deductions, repayments, payroll) or cleared, and what is left.
- Surpluses before the update were kept by the station, the rule then; they show
  as kept.
- Money owed back to an employee after a correction carries over as money that
  can be paid back.
- Each employee's total equals what the old records said they owe, to the cent.
  If it would not, the update stops and changes nothing.
- A debt recovery drafted on a payroll run that was not yet approved is
  cancelled; the run then pays in full.
- The old debt-clearance commands (`clear:employee-debt`, `clear:emma-debt`) and
  repair scripts refuse to run after this update. Use **Write off** instead.

## Acceptance Test

1. Close a shift with a shortage. Confirm the close form has no recovery step,
   the wage is paid in full, and the shortage appears on the attendant's
   Variances with the right date.
2. Close another shift for them with a surplus in the same month. Confirm it
   covers the shortage and the total drops by the surplus.
3. Record a cash repayment. Confirm it pays the oldest shortage and appears in
   cash flow; reverse it and confirm they owe it again.
4. Write off part of a shortage with a PIN. Confirm the reason and approver show.
5. Correct a repaid shortage on a closed shift so it shrinks. Confirm the
   preview shows the amount that can be paid back, then pay it back with a PIN.
6. Confirm Credits lists customers only and payroll shows no recovery.
7. Sign in as the attendant on a phone. Confirm My Pay shows their variances and
   no one else's.
