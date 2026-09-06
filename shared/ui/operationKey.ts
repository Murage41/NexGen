// Mobile clients may connect over station LAN HTTP, where randomUUID is unavailable.
export function newOperationKey() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `settlement-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  );
}
