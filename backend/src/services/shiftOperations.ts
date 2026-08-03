import type { Knex } from 'knex';

export const DEFAULT_STALE_SHIFT_HOURS = 30;
export const MAX_STALE_SHIFT_HOURS = 720;

export function normalizeStaleShiftHours(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_STALE_SHIFT_HOURS) {
    throw Object.assign(
      new Error(`Stale shift warning must be a whole number from 1 to ${MAX_STALE_SHIFT_HOURS} hours.`),
      { httpStatus: 400, code: 'INVALID_STALE_SHIFT_HOURS' },
    );
  }
  return parsed;
}

export async function getStaleShiftHours(conn: Knex) {
  const row = await conn('operational_settings').where({ key: 'stale_shift_hours' }).first('value');
  const parsed = Number(row?.value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_STALE_SHIFT_HOURS
    ? parsed
    : DEFAULT_STALE_SHIFT_HOURS;
}

export async function updateStaleShiftHours(conn: Knex, value: unknown) {
  const hours = normalizeStaleShiftHours(value);
  const updatedAt = new Date().toISOString();
  const existing = await conn('operational_settings').where({ key: 'stale_shift_hours' }).first();
  if (existing) {
    await conn('operational_settings').where({ key: 'stale_shift_hours' }).update({
      value: String(hours),
      updated_at: updatedAt,
    });
  } else {
    await conn('operational_settings').insert({
      key: 'stale_shift_hours',
      value: String(hours),
      updated_at: updatedAt,
    });
  }
  return { stale_shift_hours: hours, updated_at: updatedAt };
}

export function decorateShiftStaleness<T extends Record<string, any>>(
  shift: T,
  staleShiftHours: number,
  now = new Date(),
): T & { open_duration_hours: number | null; is_stale: boolean } {
  if (shift.status !== 'open' || !shift.start_time) {
    return { ...shift, open_duration_hours: null, is_stale: false };
  }
  const startedAt = new Date(shift.start_time).getTime();
  const duration = Number.isFinite(startedAt)
    ? Math.max(0, (now.getTime() - startedAt) / 3_600_000)
    : 0;
  return {
    ...shift,
    open_duration_hours: Math.round(duration * 10) / 10,
    is_stale: duration >= staleShiftHours,
  };
}

export async function listStaleOpenShifts(conn: Knex, now = new Date()) {
  const staleShiftHours = await getStaleShiftHours(conn);
  const cutoff = new Date(now.getTime() - staleShiftHours * 3_600_000).toISOString();
  const shifts = await conn('shifts')
    .join('employees', 'shifts.employee_id', 'employees.id')
    .where('shifts.status', 'open')
    .where('shifts.start_time', '<=', cutoff)
    .select('shifts.id', 'shifts.shift_date', 'shifts.start_time', 'employees.name as employee_name')
    .orderBy('shifts.start_time', 'asc');
  return {
    stale_shift_hours: staleShiftHours,
    count: shifts.length,
    shifts: shifts.map((shift) => decorateShiftStaleness({ ...shift, status: 'open' }, staleShiftHours, now)),
  };
}
