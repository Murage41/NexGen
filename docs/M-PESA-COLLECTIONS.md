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

This release keeps the station's existing cash/M-Pesa split correction. The
separate planned release for independently changing the two totals is not
included in A1 or A3; it follows separately in A4. Opening shift floats are
developed in A3, queued for installation after A1 and A2.
