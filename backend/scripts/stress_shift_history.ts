import knexFactory from 'knex';
import {
  getShiftHistoryNeighbors,
  exportShiftHistory,
  listShiftHistory,
  normalizeShiftHistoryQuery,
  ShiftHistoryExportError,
  ShiftHistoryQueryError,
  SHIFT_HISTORY_MAX_LIMIT,
} from '../src/services/shiftHistory';

const SHIFT_COUNT = 100_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertQueryError(query: Record<string, unknown>, label: string) {
  try {
    normalizeShiftHistoryQuery(query);
    throw new Error(`${label}: expected validation error`);
  } catch (error) {
    if (!(error instanceof ShiftHistoryQueryError)) throw error;
  }
}

function percentile(values: number[], percentage: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentage))];
}

async function main() {
  const db = knexFactory({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  try {
    await db.schema.createTable('employees', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
    });
    await db.schema.createTable('shifts', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').notNullable();
      table.timestamp('start_time').notNullable();
      table.timestamp('end_time');
      table.string('status').notNullable();
      table.date('shift_date');
      table.text('notes');
      table.timestamp('created_at');
      table.integer('compensation_plan_id');
      table.decimal('wage_paid').defaultTo(0);
      table.text('cancellation_reason');
    });
    await db.schema.createTable('shift_reviews', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').notNullable().unique();
      table.string('review_status').notNullable();
      table.text('notes');
      table.timestamp('reviewed_at');
    });
    await db.schema.createTable('shift_close_reconciliations', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').notNullable().unique();
      for (const column of [
        'expected_sales', 'expected_shift_total', 'cash_received', 'mpesa_received',
        'credit_receipts', 'credits_issued', 'invoice_consumption', 'expenses',
        'direct_wage_payment', 'payroll_payments', 'total_accounted', 'variance',
      ]) table.decimal(column).nullable();
      table.string('variance_type');
      table.text('variance_reason');
      table.timestamp('approved_at');
    });
    await db('employees').insert(
      Array.from({ length: 12 }, (_, index) => ({ name: `Employee ${index + 1}` })),
    );

    const baseTime = Date.UTC(2000, 0, 1, 5, 0, 0);
    const rows = Array.from({ length: SHIFT_COUNT }, (_, index) => {
      const start = new Date(baseTime + index * 8 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
      return {
        employee_id: (index % 12) + 1,
        start_time: start.toISOString(),
        end_time: index === SHIFT_COUNT - 1 ? null : end.toISOString(),
        status: index === SHIFT_COUNT - 1 ? 'open' : 'closed',
        shift_date: start.toISOString().slice(0, 10),
      };
    });

    const insertStarted = performance.now();
    await db.batchInsert('shifts', rows, 100);
    await db('shift_reviews').insert({ shift_id: 1, review_status: 'reviewed' });
    await db.raw(
      'CREATE INDEX idx_shifts_history_date ON shifts (shift_date, start_time, id)',
    );
    await db.raw(
      'CREATE INDEX idx_shifts_history_status_date ON shifts (status, shift_date, start_time, id)',
    );
    const insertMs = performance.now() - insertStarted;

    const newest = await listShiftHistory(db, normalizeShiftHistoryQuery({ limit: '25' }));
    assert(newest.total === SHIFT_COUNT, 'all-shift count is incorrect');
    assert(newest.shifts.length === 25, 'default page size is incorrect');
    assert(Number(newest.shifts[0].id) === SHIFT_COUNT, 'newest ordering is incorrect');
    assert(newest.shifts[0].review_status === null, 'open shift received a review status');

    const oldest = await listShiftHistory(db, normalizeShiftHistoryQuery({ sort: 'oldest' }));
    assert(Number(oldest.shifts[0].id) === 1, 'oldest ordering is incorrect');
    assert(oldest.shifts[0].review_status === 'reviewed', 'stored review status was not returned');
    assert(oldest.shifts[1].review_status === 'pending_review', 'legacy closed shift did not default to pending review');

    const middleId = 50_000;
    const newestNeighbors = await getShiftHistoryNeighbors(
      db,
      middleId,
      normalizeShiftHistoryQuery({ sort: 'newest' }),
    );
    assert(Number(newestNeighbors?.previous?.id) === middleId + 1, 'newest previous neighbor is incorrect');
    assert(Number(newestNeighbors?.next?.id) === middleId - 1, 'newest next neighbor is incorrect');

    const oldestNeighbors = await getShiftHistoryNeighbors(
      db,
      middleId,
      normalizeShiftHistoryQuery({ sort: 'oldest' }),
    );
    assert(Number(oldestNeighbors?.previous?.id) === middleId - 1, 'oldest previous neighbor is incorrect');
    assert(Number(oldestNeighbors?.next?.id) === middleId + 1, 'oldest next neighbor is incorrect');

    const firstNeighbors = await getShiftHistoryNeighbors(
      db,
      1,
      normalizeShiftHistoryQuery({ sort: 'oldest', status: 'closed' }),
    );
    assert(firstNeighbors?.previous === null && Number(firstNeighbors?.next?.id) === 2, 'first-row boundary navigation is incorrect');

    const finalPage = await listShiftHistory(
      db,
      normalizeShiftHistoryQuery({ page: '999999', limit: '25' }),
    );
    assert(finalPage.page === 4000, 'out-of-range page was not clamped');
    assert(Number(finalPage.shifts.at(-1)?.id) === 1, 'last page did not reach first shift');

    const openOnly = await listShiftHistory(
      db,
      normalizeShiftHistoryQuery({ status: 'open' }),
    );
    assert(openOnly.total === 1, 'open filter count is incorrect');
    assert(Number(openOnly.shifts[0].id) === SHIFT_COUNT, 'open filter row is incorrect');

    const targetDate = rows[50_000].shift_date;
    const onDate = await listShiftHistory(
      db,
      normalizeShiftHistoryQuery({ from: targetDate, to: targetDate, limit: '1000' }),
    );
    assert(onDate.total >= 2 && onDate.total <= 4, 'date filtering returned an unexpected count');
    assert(onDate.limit === SHIFT_HISTORY_MAX_LIMIT, 'page-size cap was not enforced');
    assert(onDate.shifts.every((shift) => shift.shift_date === targetDate), 'date filter leaked rows');

    assertQueryError({ from: '2026-02-30' }, 'invalid calendar date');
    assertQueryError({ from: '2026-07-02', to: '2026-07-01' }, 'reversed date range');
    assertQueryError({ status: 'pending' }, 'invalid status');
    assertQueryError({ sort: 'sideways' }, 'invalid sort');
    assertQueryError({ page: '0' }, 'invalid page');

    let oversizedExportRejected = false;
    const exportGuardStarted = performance.now();
    try {
      await exportShiftHistory(db, normalizeShiftHistoryQuery({ sort: 'oldest' }));
    } catch (error) {
      oversizedExportRejected = error instanceof ShiftHistoryExportError;
    }
    const exportGuardMs = performance.now() - exportGuardStarted;
    assert(oversizedExportRejected, 'oversized shift export was not rejected');

    const exportFrom = rows[20_000].shift_date;
    const exportTo = rows[29_999].shift_date;
    const exportStarted = performance.now();
    const boundedExport = await exportShiftHistory(db, normalizeShiftHistoryQuery({
      from: exportFrom,
      to: exportTo,
      sort: 'oldest',
    }));
    const exportMs = performance.now() - exportStarted;
    assert(boundedExport.total >= 10_000 && boundedExport.total < 10_010, 'bounded export row count is incorrect');
    assert(Number(boundedExport.rows[0].id) <= Number(boundedExport.rows.at(-1)?.id), 'bounded export ordering is incorrect');

    const queryTimes: number[] = [];
    for (let index = 0; index < 250; index += 1) {
      const page = 1 + ((index * 7919) % 4000);
      const query = normalizeShiftHistoryQuery({
        page: String(page),
        limit: '25',
        status: index % 3 === 0 ? 'closed' : '',
        sort: index % 2 === 0 ? 'newest' : 'oldest',
      });
      const started = performance.now();
      const result = await listShiftHistory(db, query);
      queryTimes.push(performance.now() - started);
      assert(result.shifts.length > 0, `stress query ${index} returned no rows`);
    }

    const datePlan: any[] = await db.raw(
      'EXPLAIN QUERY PLAN SELECT id FROM shifts WHERE shift_date >= ? AND shift_date <= ? ORDER BY shift_date DESC, start_time DESC, id DESC LIMIT 25',
      [targetDate, targetDate],
    );
    const statusPlan: any[] = await db.raw(
      'EXPLAIN QUERY PLAN SELECT id FROM shifts WHERE status = ? AND shift_date >= ? ORDER BY shift_date DESC, start_time DESC, id DESC LIMIT 25',
      ['closed', targetDate],
    );
    assert(
      datePlan.some((row) => String(row.detail).includes('idx_shifts_history_date')),
      'date query did not use the history date index',
    );
    assert(
      statusPlan.some((row) => String(row.detail).includes('idx_shifts_history_status_date')),
      'status/date query did not use the composite history index',
    );

    console.log(`PASS shift history correctness across ${SHIFT_COUNT.toLocaleString()} rows`);
    console.log('PASS validation, filters, sort order, page cap, final-page access, and cross-page neighbors');
    console.log(`PASS export cap in ${exportGuardMs.toFixed(2)}ms and ${boundedExport.total.toLocaleString()}-row export in ${exportMs.toFixed(2)}ms`);
    console.log(
      `PASS 250 stress queries: p50 ${percentile(queryTimes, 0.5).toFixed(2)}ms, `
      + `p95 ${percentile(queryTimes, 0.95).toFixed(2)}ms, max ${Math.max(...queryTimes).toFixed(2)}ms`,
    );
    console.log(`INFO generated and indexed test data in ${insertMs.toFixed(0)}ms`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL shift history stress test');
  console.error(error);
  process.exit(1);
});
