/**
 * Kenya timezone utilities (EAT = UTC+3).
 * All business dates must be in Kenya time, not UTC — otherwise after
 * 9 PM EAT the UI thinks it's tomorrow.
 */

/** Returns today's date in Kenya timezone as YYYY-MM-DD */
export function getKenyaDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

/** Returns current month in Kenya timezone as YYYY-MM */
export function getKenyaMonth(): string {
  return getKenyaDate().slice(0, 7);
}
