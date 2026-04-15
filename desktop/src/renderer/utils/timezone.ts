/**
 * Kenya timezone utilities (EAT = UTC+3).
 * Business dates must be in Kenya time, not UTC — otherwise after 9 PM
 * EAT the UI stamps tomorrow's date on today's entries.
 */

/** Returns today's date in Kenya timezone as YYYY-MM-DD */
export function getKenyaDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

/** Returns current month in Kenya timezone as YYYY-MM */
export function getKenyaMonth(): string {
  return getKenyaDate().slice(0, 7);
}
