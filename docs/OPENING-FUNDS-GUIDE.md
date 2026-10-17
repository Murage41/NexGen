# Opening funds: office and attendant guide

A3 adds this workflow after A1 and A2. Install and check each release separately.
Older shifts, including one already open during installation, retain their
received-totals fields. Their opening funds are labelled not captured.

## Open a new shift

1. Choose the attendant and their compensation plan.
2. Count the **Opening cash float** and check the **Opening M-Pesa balance**
   for the account this shift will use. Enter both; enter **0** explicitly if
   there are no funds in that method.
3. Add an opening note if helpful, then open the shift.

Every opening starts with blank fields. NexGen never copies the previous
shift's money. Pump opening readings continue their existing meter chain.
Attendants can see their own declared opening funds.

## Record during the shift

Keep recording sales readings, credit sales, invoice fuel, expenses and debt
receipts through their ordinary forms. **Cash remaining** and **M-Pesa balance
at close** mean the actual money now held, including opening funds. Enter
both and sync/save the count; zero is valid. A credit entry that creates a
collections cache is not a saved balance count. An unsaved count cannot close
the shift. An attendant's open shift still hides expected funds and variance.

An admin uses **Money added / removed** for an otherwise unrecorded custody
movement: extra float, cash moved to the safe, M-Pesa transferred to the station
bank, or owner funding/drawing. Choose the method, direction and source or
destination; enter the amount, reference and explanation, then review and approve.
Do not enter an expense, wage or customer payment again as a movement.

For an actual cash/M-Pesa transfer, the admin records a removal from one and
an addition to the other with the same reference. Both are manual entries.
Their combined effect is zero. Opening funds are not added again as a movement.

## Close and review

Record the actual funds held and actual wages paid from this shift. Review
the readings, funds and other entries, then close. Wage earnings and cash paid
remain separate. A transfer to the station bank is not an expense or shortage.

For example, opening funds 5,000 plus sales 10,000, less credit sales 1,000,
invoice fuel 2,000 and business payouts 1,000, plus old-debt receipts 500,
gives expected closing funds **11,500**. Holding 11,500 balances; holding
11,200 gives a **300 shortage**. Opening funds never create sales or profit.

**Collections inferred from counted funds** reconstructs the combined money
collected, allowing for opening funds and payouts/movements. It is not a list
of individual receipts or proof of separate cash/M-Pesa sales. In this example
it is 7,500 when balanced and 7,200 when short. Reports distinguish these
collections from closing holdings and show when a new shift has no saved count.
Owner funding and drawings appear separately from trading cash flow.

## Correct a mistake

- Wrong opening: use **Correct** beside that opening method, enter the correct
  full amount, review the effect and give a reason/approval. The original
  declaration remains in history. If a closed shift becomes worse, choose who
  is responsible through the existing correction review.
- Wrong movement: expand **Money movement history** and use **Reverse** on the
  mistaken entry. Add a replacement movement separately if necessary.
- An opening correction can be corrected again. The desktop Corrections
  register also provides undo where allowed. A pre-close amendment already
  included in the close must be handled by a new correction after close.

**Original close → View original figures** retains the saved opening funds,
movements and close result. Current figures include later corrections. A3
never alters another shift's opening, pump readings or stock. A4 adds the
separate [closing cash/M-Pesa correction form](CLOSING-TOTAL-CORRECTIONS.md),
with both full current totals prefilled and independent changes allowed.
