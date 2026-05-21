import crypto from 'crypto';

const PIN_PREFIX = 'scrypt';
const KEY_LENGTH = 32;

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, KEY_LENGTH).toString('hex');
  return `${PIN_PREFIX}$${salt}$${hash}`;
}

export function isHashedPin(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${PIN_PREFIX}$`);
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  if (!isHashedPin(stored)) return pin === stored;

  const [, salt, storedHash] = stored.split('$');
  if (!salt || !storedHash) return false;

  const candidate = crypto.scryptSync(pin, salt, KEY_LENGTH);
  const expected = Buffer.from(storedHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function validatePin(pin: string | null | undefined): string | null {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return 'PIN must be exactly 4 digits.';
  }
  return null;
}
