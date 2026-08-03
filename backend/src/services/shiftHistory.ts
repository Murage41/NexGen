import type { Knex } from 'knex';

export const SHIFT_HISTORY_DEFAULT_LIMIT = 25;
export const SHIFT_HISTORY_MAX_LIMIT = 100;

export type ShiftHistoryStatus = 'open' | 'closed' | 'cancelled';
export type ShiftHistorySort = 'newest' | 'oldest';

export interface ShiftHistoryOptions {
  requestedPage: number;
  limit: number;
  status?: ShiftHistoryStatus;
  from?: string;
  to?: string;
  sort: ShiftHistorySort;
}

export interface ShiftHistoryResult {
  shifts: any[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  has_previous: boolean;
  has_next: boolean;
  range_start: number;
  range_end: number;
  filters: {
    status: ShiftHistoryStatus | null;
    from: string | null;
    to: string | null;
    sort: ShiftHistorySort;
  };
}

export class ShiftHistoryQueryError extends Error {}

function singleQueryValue(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new ShiftHistoryQueryError(`${name} must be provided once.`);
    return singleQueryValue(value[0], name);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ShiftHistoryQueryError(`${name} has an invalid value.`);
  }
  return String(value).trim();
}

function positiveInteger(value: unknown, name: string, fallback: number): number {
  const raw = singleQueryValue(value, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ShiftHistoryQueryError(`${name} must be a positive whole number.`);
  }
  return parsed;
}

function dateOnly(value: unknown, name: string): string | undefined {
  const raw = singleQueryValue(value, name);
  if (raw === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ShiftHistoryQueryError(`${name} must use YYYY-MM-DD.`);
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new ShiftHistoryQueryError(`${name} is not a valid date.`);
  }
  return raw;
}

export function normalizeShiftHistoryQuery(query: Record<string, unknown>): ShiftHistoryOptions {
  const requestedPage = positiveInteger(query.page, 'page', 1);
  const requestedLimit = positiveInteger(query.limit, 'limit', SHIFT_HISTORY_DEFAULT_LIMIT);
  const limit = Math.min(requestedLimit, SHIFT_HISTORY_MAX_LIMIT);
  const from = dateOnly(query.from, 'from');
  const to = dateOnly(query.to, 'to');
  const rawStatus = singleQueryValue(query.status, 'status');
  const rawSort = singleQueryValue(query.sort, 'sort') || 'newest';

  if (rawStatus && rawStatus !== 'open' && rawStatus !== 'closed' && rawStatus !== 'cancelled') {
    throw new ShiftHistoryQueryError('status must be open, closed, or cancelled.');
  }
  if (rawSort !== 'newest' && rawSort !== 'oldest') {
    throw new ShiftHistoryQueryError('sort must be newest or oldest.');
  }
  if (from && to && from > to) {
    throw new ShiftHistoryQueryError('from date cannot be after to date.');
  }

  return {
    requestedPage,
    limit,
    status: rawStatus as ShiftHistoryStatus | undefined,
    from,
    to,
    sort: rawSort as ShiftHistorySort,
  };
}

function applyShiftHistoryFilters(query: Knex.QueryBuilder, options: ShiftHistoryOptions) {
  if (options.status) query.where('shifts.status', options.status);
  if (options.from) query.where('shifts.shift_date', '>=', options.from);
  if (options.to) query.where('shifts.shift_date', '<=', options.to);
  return query;
}

export async function listShiftHistory(
  connection: Knex,
  options: ShiftHistoryOptions,
): Promise<ShiftHistoryResult> {
  const countQuery = applyShiftHistoryFilters(
    connection('shifts').count({ count: 'shifts.id' }),
    options,
  );
  const countRow: any = await countQuery.first();
  const total = Number(countRow?.count || 0);
  const totalPages = Math.ceil(total / options.limit);
  const page = Math.min(options.requestedPage, Math.max(totalPages, 1));
  const offset = (page - 1) * options.limit;
  const direction = options.sort === 'oldest' ? 'asc' : 'desc';

  const shifts = await applyShiftHistoryFilters(
    connection('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .leftJoin('shift_reviews', 'shifts.id', 'shift_reviews.shift_id')
      .select(
        'shifts.*',
        'employees.name as employee_name',
        connection.raw(`
          CASE
            WHEN shifts.status = 'closed' THEN COALESCE(shift_reviews.review_status, 'pending_review')
            ELSE NULL
          END AS review_status
        `),
      ),
    options,
  )
    .orderBy('shifts.shift_date', direction)
    .orderBy('shifts.start_time', direction)
    .orderBy('shifts.id', direction)
    .limit(options.limit)
    .offset(offset);

  return {
    shifts,
    total,
    page,
    limit: options.limit,
    total_pages: totalPages,
    has_previous: page > 1,
    has_next: page < totalPages,
    range_start: total === 0 ? 0 : offset + 1,
    range_end: total === 0 ? 0 : Math.min(offset + shifts.length, total),
    filters: {
      status: options.status || null,
      from: options.from || null,
      to: options.to || null,
      sort: options.sort,
    },
  };
}
