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

export interface ShiftHistoryNeighbors {
  previous: any | null;
  next: any | null;
}

export class ShiftHistoryQueryError extends Error {}
export class ShiftHistoryExportError extends Error {}

export const SHIFT_HISTORY_EXPORT_MAX_ROWS = 50_000;

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

function applyNeighborKeyCondition(
  query: Knex.QueryBuilder,
  current: any,
  operator: '>' | '<',
) {
  return query.where(function keyComparison() {
    this.where('shifts.shift_date', operator, current.shift_date)
      .orWhere(function sameDateLaterTime() {
        this.where('shifts.shift_date', current.shift_date)
          .andWhere('shifts.start_time', operator, current.start_time);
      })
      .orWhere(function sameTimestampLaterId() {
        this.where('shifts.shift_date', current.shift_date)
          .andWhere('shifts.start_time', current.start_time)
          .andWhere('shifts.id', operator, current.id);
      });
  });
}

export async function getShiftHistoryNeighbors(
  connection: Knex,
  shiftId: number,
  options: ShiftHistoryOptions,
): Promise<ShiftHistoryNeighbors | null> {
  const current = await connection('shifts')
    .where({ id: shiftId })
    .select('id', 'shift_date', 'start_time')
    .first();
  if (!current) return null;

  const neighborQuery = (
    operator: '>' | '<',
    direction: 'asc' | 'desc',
  ) => {
    const query = connection('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .leftJoin('shift_reviews', 'shifts.id', 'shift_reviews.shift_id')
      .select(
        'shifts.id',
        'shifts.shift_date',
        'shifts.start_time',
        'shifts.end_time',
        'shifts.status',
        'employees.name as employee_name',
        connection.raw(`
          CASE
            WHEN shifts.status = 'closed' THEN COALESCE(shift_reviews.review_status, 'pending_review')
            ELSE NULL
          END AS review_status
        `),
      );
    applyShiftHistoryFilters(query, options);
    applyNeighborKeyCondition(query, current, operator);
    return query
      .orderBy('shifts.shift_date', direction)
      .orderBy('shifts.start_time', direction)
      .orderBy('shifts.id', direction)
      .first();
  };

  const newestFirst = options.sort === 'newest';
  const [previous, next] = await Promise.all([
    neighborQuery(newestFirst ? '>' : '<', newestFirst ? 'asc' : 'desc'),
    neighborQuery(newestFirst ? '<' : '>', newestFirst ? 'desc' : 'asc'),
  ]);

  return { previous: previous || null, next: next || null };
}

export async function exportShiftHistory(
  connection: Knex,
  options: ShiftHistoryOptions,
) {
  const countRow: any = await applyShiftHistoryFilters(
    connection('shifts').count({ count: 'shifts.id' }),
    options,
  ).first();
  const total = Number(countRow?.count || 0);
  if (total > SHIFT_HISTORY_EXPORT_MAX_ROWS) {
    throw new ShiftHistoryExportError(
      `This export contains ${total.toLocaleString()} shifts. Narrow the date range to ${SHIFT_HISTORY_EXPORT_MAX_ROWS.toLocaleString()} or fewer rows.`,
    );
  }

  const direction = options.sort === 'oldest' ? 'asc' : 'desc';
  const rows = await applyShiftHistoryFilters(
    connection('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .leftJoin('shift_reviews', 'shifts.id', 'shift_reviews.shift_id')
      .leftJoin('shift_close_reconciliations as reconciliation', 'shifts.id', 'reconciliation.shift_id')
      .select(
        'shifts.id',
        'shifts.shift_date',
        'employees.name as employee_name',
        'shifts.status',
        'shifts.start_time',
        'shifts.end_time',
        'shifts.compensation_plan_id',
        'shifts.wage_paid',
        'shifts.cancellation_reason',
        connection.raw(`
          CASE
            WHEN shifts.status = 'closed' THEN COALESCE(shift_reviews.review_status, 'pending_review')
            ELSE NULL
          END AS review_status
        `),
        'shift_reviews.notes as review_notes',
        'shift_reviews.reviewed_at',
        'reconciliation.expected_sales',
        'reconciliation.expected_shift_total',
        'reconciliation.cash_received',
        'reconciliation.mpesa_received',
        'reconciliation.credit_receipts',
        'reconciliation.credits_issued',
        'reconciliation.invoice_consumption',
        'reconciliation.expenses',
        'reconciliation.direct_wage_payment',
        'reconciliation.payroll_payments',
        'reconciliation.total_accounted',
        'reconciliation.variance',
        'reconciliation.variance_type',
        'reconciliation.variance_reason',
        'reconciliation.approved_at',
      ),
    options,
  )
    .orderBy('shifts.shift_date', direction)
    .orderBy('shifts.start_time', direction)
    .orderBy('shifts.id', direction);

  return { rows, total };
}
