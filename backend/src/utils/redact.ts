// Request bodies are logged when a request fails. Anything that authenticates a
// person (PINs, approval and session tokens, keys) must never reach those logs:
// the station stack writes them to a file on disk.
const SENSITIVE_BODY_KEYS = [
  'pin',
  'password',
  'token',
  'authorization',
  'secret',
  'session_secret',
  'desktop_key',
  'x-desktop-key',
];

export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!value || typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    redacted[key] = SENSITIVE_BODY_KEYS.some((sensitiveKey) => lowerKey.includes(sensitiveKey))
      ? '[REDACTED]'
      : redactSensitiveValues(nestedValue);
  }
  return redacted;
}
