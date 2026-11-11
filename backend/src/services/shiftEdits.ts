import type { Knex } from 'knex';

// Edit history for open shifts (migration 057). The server writes one row per
// save that really changed something; the shift's History groups them so a
// sitting of automatic saves reads as one line (docs/SHIFTS.md, History).

type Conn = Knex | Knex.Transaction;

export type ShiftHistoryKind = 'readings' | 'opening_readings' | 'money' | 'removed' | 'changed_entry';

export interface ShiftChange {
  key: string;
  label: string;
  from: number | null;
  to: number | null;
}

// Saves of the same thing by the same person this close together read as one.
export const HISTORY_GROUP_MINUTES = 10;

const round = (value: number | null) => (value === null || value === undefined ? null : Math.round(Number(value) * 1000) / 1000);

// Who made the change: a signed-in employee, or null for the station PC.
export function historyActor(req: any): number | null {
  const id = Number(req?.employee?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function recordShiftHistory(
  conn: Conn,
  entry: { shiftId: number; kind: ShiftHistoryKind; employeeId: number | null; changes: ShiftChange[] },
): Promise<boolean> {
  const changes = entry.changes.filter((c) => round(c.from) !== round(c.to));
  if (changes.length === 0) return false;
  await conn('shift_history').insert({
    shift_id: entry.shiftId,
    kind: entry.kind,
    changes: JSON.stringify(changes.map((c) => ({ ...c, from: round(c.from), to: round(c.to) }))),
    employee_id: entry.employeeId,
    created_at: new Date().toISOString(),
  });
  return true;
}

export async function loadShiftHistory(conn: Conn, shiftId: number) {
  if (!(await conn.schema.hasTable('shift_history'))) return [];
  const rows = await conn('shift_history as h')
    .leftJoin('employees as e', 'h.employee_id', 'e.id')
    .where('h.shift_id', shiftId)
    .select('h.*', 'e.name as employee_name')
    .orderBy('h.created_at')
    .orderBy('h.id');
  return rows.map((row: any) => ({ ...row, changes: JSON.parse(row.changes || '[]') as ShiftChange[] }));
}

// A debt payment by an employee belongs to that employee: like the receipts
// themselves, an attendant sees only their own on a shift.
export const staffReceiptKey = (employeeId: number, paymentId: number) => `staff-receipt:${employeeId}:${paymentId}`;

export function visibleShiftHistory<T extends { changes: ShiftChange[] }>(rows: T[], viewer: { id?: number; role?: string } | undefined): T[] {
  if (viewer?.role === 'admin') return rows;
  return rows.filter((row) => !row.changes.some((c) => c.key.startsWith('staff-receipt:') && c.key.split(':')[1] !== String(viewer?.id)));
}

export interface HistoryGroup {
  id: string;
  kind: ShiftHistoryKind;
  first: boolean;
  actor: string;
  occurred_at: string;
  changes: ShiftChange[];
}

// Pure: consecutive saves of one kind by one person within the window become one
// group, keeping each figure's first old value and last new value. Figures that
// end where they started drop out, and a group left with none is not shown.
// Removals are never merged. `first` marks the first group of its kind, which
// the History calls "recorded" rather than "changed".
export function groupShiftHistory(rows: Array<{ id: number; kind: string; employee_id: number | null; employee_name?: string | null; created_at: string; changes: ShiftChange[] }>): HistoryGroup[] {
  const groups: Array<HistoryGroup & { last: number; employeeId: number | null }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const at = new Date(row.created_at).getTime();
    const prev = groups[groups.length - 1];
    const sameRun = prev
      && row.kind !== 'removed'
      && prev.kind === row.kind
      && prev.employeeId === (row.employee_id ?? null)
      && at - prev.last <= HISTORY_GROUP_MINUTES * 60_000;
    if (sameRun) {
      for (const change of row.changes) {
        const existing = prev.changes.find((c) => c.key === change.key);
        if (existing) existing.to = change.to;
        else prev.changes.push({ ...change });
      }
      prev.last = at;
      prev.occurred_at = row.created_at;
      continue;
    }
    groups.push({
      id: `history-${row.id}`,
      kind: row.kind as ShiftHistoryKind,
      first: !seen.has(row.kind),
      actor: row.employee_name || 'Station PC',
      occurred_at: row.created_at,
      changes: row.changes.map((c) => ({ ...c })),
      last: at,
      employeeId: row.employee_id ?? null,
    });
    seen.add(row.kind);
  }
  return groups
    .map(({ last, employeeId, ...group }) => ({
      ...group,
      changes: group.kind === 'removed' ? group.changes : group.changes.filter((c) => round(c.from) !== round(c.to)),
    }))
    .filter((group) => group.changes.length > 0);
}
