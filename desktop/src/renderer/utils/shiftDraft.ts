export type ShiftDraft = {
  readings?: Record<string, { raw_l_input: string; raw_a_input: string }>;
  collections?: { cash_amount: number; mpesa_amount: number };
  updated_at: string;
};

const keyFor = (shiftId: number | string) => `nexgen:shift-draft:${shiftId}`;

export function readShiftDraft(shiftId: number | string): ShiftDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(shiftId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeShiftDraft(
  shiftId: number | string,
  section: Partial<Omit<ShiftDraft, 'updated_at'>>,
) {
  try {
    const current = readShiftDraft(shiftId) || { updated_at: new Date().toISOString() };
    localStorage.setItem(keyFor(shiftId), JSON.stringify({
      ...current,
      ...section,
      updated_at: new Date().toISOString(),
    }));
  } catch {
    // Server persistence remains available if browser storage is unavailable.
  }
}

export function clearShiftDraftSection(
  shiftId: number | string,
  section: 'readings' | 'collections',
) {
  try {
    const current = readShiftDraft(shiftId);
    if (!current) return;
    delete current[section];
    if (!current.readings && !current.collections) localStorage.removeItem(keyFor(shiftId));
    else localStorage.setItem(keyFor(shiftId), JSON.stringify(current));
  } catch {
    // A failed cleanup is harmless; the server copy remains authoritative.
  }
}

export function clearShiftDraft(shiftId: number | string) {
  try { localStorage.removeItem(keyFor(shiftId)); } catch { /* no-op */ }
}

export function hasPendingShiftDraft(shiftId: number | string) {
  const draft = readShiftDraft(shiftId);
  return Boolean(draft?.readings || draft?.collections);
}
