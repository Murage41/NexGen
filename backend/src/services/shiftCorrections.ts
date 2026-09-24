import type { Knex } from 'knex';

// Closed-shift corrections posted before 23 Sep 2026, when closed shifts
// became unchangeable (mistakes are fixed with balance moves now,
// services/balanceMoves.ts). Only the history is read.

type Trx = Knex.Transaction;

export async function listShiftCorrections(
  conn: Knex | Trx,
  filter: { shiftId?: number; from?: string; to?: string; postingDate?: string },
) {
  let query = conn('shift_accountability_adjustments as c')
    .join('shifts as s', 'c.shift_id', 's.id')
    .leftJoin('employees as attendant', 's.employee_id', 'attendant.id')
    .leftJoin('employees as recorder', 'c.created_by_employee_id', 'recorder.id')
    .select(
      'c.*',
      's.shift_date',
      'attendant.name as attendant_name',
      'recorder.name as recorded_by_name',
    );
  if (filter.shiftId) query = query.where('c.shift_id', filter.shiftId);
  if (filter.postingDate) {
    query = query.whereRaw("COALESCE(c.posting_date, date(c.created_at, '+3 hours')) = ?", [filter.postingDate]);
  }
  if (filter.from) query = query.whereRaw("COALESCE(c.posting_date, date(c.created_at, '+3 hours')) >= ?", [filter.from]);
  if (filter.to) query = query.whereRaw("COALESCE(c.posting_date, date(c.created_at, '+3 hours')) <= ?", [filter.to]);
  const rows = await query.orderBy('c.created_at', 'desc').orderBy('c.id', 'desc');
  return rows.map((row: any) => {
    let details = null;
    try {
      details = row.details ? JSON.parse(row.details) : null;
    } catch {
      details = null;
    }
    return { ...row, details };
  });
}
