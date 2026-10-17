# M-Pesa collections

For older shifts, enter the actual M-Pesa collection amount. For new A3
shifts, enter the opening M-Pesa balance before opening and the actual balance
remaining at close, using the same till/account. NexGen does not estimate an
M-Pesa fee or subtract one from either figure. The shared calculation removes
opening funds once when reconstructing collections. See the
[opening-funds guide](OPENING-FUNDS-GUIDE.md).

The fee settings and fee/net display have been removed. Old saved fee fields
remain historical storage and are not used in current calculations or reports.
Original close snapshots and previously recorded correction history remain.

A4 adds independently corrected cash and M-Pesa totals, including zero and
changes to their combined total. Both full current figures are prefilled;
leave one unchanged when correcting only the other. See the
[correction guide](CLOSING-TOTAL-CORRECTIONS.md). It follows A3's opening funds
and closing balances, with each release installed and checked separately.
Earlier split-only corrections remain readable; no M-Pesa fee is introduced.
