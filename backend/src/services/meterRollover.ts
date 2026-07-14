/**
 * Pump meter rollover compensation.
 *
 * A physical pump display shows N digits before the decimal (default 6 → cap
 * 1,000,000). When the display passes its capacity it wraps to 0.00 and
 * keeps counting. Internally we always store cumulative monotonic values
 * (e.g. petrol cumulative > 4,000,000 after 4 wraps), so callers convert
 * the raw display reading they observe into a cumulative value at save time.
 *
 * Rules:
 *   - At most ONE rollover per save per field. A second rollover in the same
 *     shift is implausible (would require >1M L dispensed in one shift) and
 *     is almost always a typo, so we refuse rather than silently double-add.
 *   - Litres and amount counters are independent — either can roll without
 *     the other rolling — so callers compensate each separately.
 *
 * Round to 2dp at the end to match the column precision of pump_readings.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CompensateResult =
  | { ok: true; cumulative: number; rolledOver: boolean }
  | { ok: false; reason: string };

export function compensate(
  opening: number,
  rawClosing: number,
  capacity: number,
): CompensateResult {
  if (!(capacity > 0)) {
    return { ok: false, reason: `meter capacity must be positive (got ${capacity})` };
  }
  if (rawClosing < 0 || rawClosing >= capacity) {
    return { ok: false, reason: `raw reading ${rawClosing} is outside [0, ${capacity})` };
  }
  if (opening < 0) {
    return { ok: false, reason: `opening ${opening} cannot be negative` };
  }

  const rolloversSoFar = Math.floor(opening / capacity);
  const openingDisplay = toDisplay(opening, capacity);

  if (rawClosing >= openingDisplay) {
    // No new rollover. Same number of wraps as opening, raw appended.
    return {
      ok: true,
      cumulative: round2(rolloversSoFar * capacity + rawClosing),
      rolledOver: false,
    };
  }

  // Raw display dropped below opening display — a rollover happened.
  return {
    ok: true,
    cumulative: round2((rolloversSoFar + 1) * capacity + rawClosing),
    rolledOver: true,
  };
}

/** Convenience: derive what the display SHOULD show given a cumulative value. */
export function toDisplay(cumulative: number, capacity: number): number {
  if (!(capacity > 0)) return cumulative;
  return round2(cumulative - Math.floor(cumulative / capacity) * capacity);
}
