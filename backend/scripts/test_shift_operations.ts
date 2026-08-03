import knexFactory from 'knex';
import { exportShiftHistory, normalizeShiftHistoryQuery } from '../src/services/shiftHistory';
import {
  getStaleShiftHours,
  listStaleOpenShifts,
  updateStaleShiftHours,
} from '../src/services/shiftOperations';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const db = knexFactory({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  try {
    await db.schema.createTable('operational_settings', (table) => {
      table.string('key').primary();
      table.string('value').notNullable();
      table.timestamp('updated_at').notNullable();
    });
    await db.schema.createTable('employees', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
    });
    await db.schema.createTable('shifts', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').notNullable();
      table.string('shift_date').notNullable();
      table.string('status').notNullable();
      table.timestamp('start_time').notNullable();
      table.timestamp('end_time').nullable();
      table.integer('compensation_plan_id').nullable();
      table.decimal('wage_paid').defaultTo(0);
      table.text('cancellation_reason').nullable();
    });
    await db.schema.createTable('shift_reviews', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').notNullable();
      table.string('review_status').notNullable();
      table.text('notes').nullable();
      table.timestamp('reviewed_at').nullable();
    });
    await db.schema.createTable('shift_close_reconciliations', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').notNullable();
      for (const column of [
        'expected_sales', 'expected_shift_total', 'cash_received', 'mpesa_received',
        'credit_receipts', 'credits_issued', 'invoice_consumption', 'expenses',
        'direct_wage_payment', 'payroll_payments', 'total_accounted', 'variance',
      ]) table.decimal(column).nullable();
      table.string('variance_type').nullable();
      table.text('variance_reason').nullable();
      table.timestamp('approved_at').nullable();
    });
    await db.raw('CREATE INDEX idx_shifts_status_start_time ON shifts (status, start_time, id)');

    const [employeeId] = await db('employees').insert({ name: 'Operations Test' });
    await db('operational_settings').insert({
      key: 'stale_shift_hours',
      value: '30',
      updated_at: '2026-08-03T00:00:00.000Z',
    });
    await db('shifts').insert([
      {
        employee_id: employeeId,
        shift_date: '2026-08-01',
        status: 'closed',
        start_time: '2026-08-01T08:00:00.000Z',
        end_time: '2026-08-02T08:00:00.000Z',
        wage_paid: 800,
      },
      {
        employee_id: employeeId,
        shift_date: '2026-08-02',
        status: 'open',
        start_time: '2026-08-02T09:00:00.000Z',
      },
      {
        employee_id: employeeId,
        shift_date: '2026-08-03',
        status: 'open',
        start_time: '2026-08-03T10:00:00.000Z',
      },
    ]);
    await db('shift_reviews').insert({ shift_id: 1, review_status: 'reviewed' });
    await db('shift_close_reconciliations').insert({
      shift_id: 1,
      expected_sales: 10000,
      expected_shift_total: 10000,
      cash_received: 6000,
      mpesa_received: 4000,
      total_accounted: 10000,
      variance: 0,
      variance_type: 'balanced',
      approved_at: '2026-08-02T08:00:00.000Z',
    });

    const now = new Date('2026-08-03T18:00:00.000Z');
    const stale = await listStaleOpenShifts(db, now);
    assert(stale.count === 1 && stale.shifts[0].id === 2, 'Stale open shift was not identified');
    assert(stale.shifts[0].open_duration_hours === 33, 'Open duration is incorrect');

    await updateStaleShiftHours(db, 40);
    assert(await getStaleShiftHours(db) === 40, 'Updated threshold was not persisted');
    assert((await listStaleOpenShifts(db, now)).count === 0, 'Updated threshold was not applied');

    let invalidRejected = false;
    try {
      await updateStaleShiftHours(db, 0);
    } catch (error: any) {
      invalidRejected = error.code === 'INVALID_STALE_SHIFT_HOURS';
    }
    assert(invalidRejected, 'Invalid stale threshold was accepted');

    const stalePlan: any[] = await db.raw(
      'EXPLAIN QUERY PLAN SELECT id FROM shifts WHERE status = ? AND start_time <= ? ORDER BY start_time ASC',
      ['open', now.toISOString()],
    );
    assert(
      stalePlan.some((row) => String(row.detail).includes('idx_shifts_status_start_time')),
      'Stale-shift query did not use its supporting index',
    );

    const exportResult = await exportShiftHistory(db, normalizeShiftHistoryQuery({
      status: 'closed',
      from: '2026-08-01',
      to: '2026-08-01',
      sort: 'oldest',
    }));
    assert(exportResult.total === 1, 'Filtered export returned the wrong row count');
    assert(exportResult.rows[0].review_status === 'reviewed', 'Review state was omitted from export');
    assert(Number(exportResult.rows[0].expected_sales) === 10000, 'Close snapshot was omitted from export');

    console.log('PASS configurable stale-shift threshold and duration calculation');
    console.log('PASS stale-shift query uses the status/start-time index');
    console.log('PASS filtered shift export includes review and immutable close snapshot data');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL shift operations checks');
  console.error(error);
  process.exit(1);
});
