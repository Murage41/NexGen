/**
 * Kenya timezone utilities.
 * All business dates must use Kenya time (EAT = UTC+3), not UTC.
 * Without this, after 9 PM Kenya time the system thinks it's tomorrow.
 */

/** Returns today's date in Kenya timezone as YYYY-MM-DD */
export function getKenyaDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

/** Returns current month in Kenya timezone as YYYY-MM */
export function getKenyaMonth(): string {
  return getKenyaDate().slice(0, 7);
}
