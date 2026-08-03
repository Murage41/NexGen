import knexFactory from 'knex';
import { updateShiftReview } from '../src/services/shiftReview';
import { buildShiftTimeline } from '../src/services/shiftTimeline';

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
    await db.schema.createTable('employees', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
    });
    await db.schema.createTable('shifts', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').notNullable();
      table.string('status').notNullable();
      table.timestamp('start_time').notNullable();
      table.timestamp('end_time').nullable();
    });
    await db.schema.createTable('shift_reviews', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').notNullable().unique();
      table.string('review_status').notNullable();
      table.text('notes').nullable();
      table.integer('reviewed_by_employee_id').nullable();
      table.string('reviewed_by_role').nullable();
      table.timestamp('reviewed_at').nullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('updated_at').notNullable();
    });
    await db.schema.createTable('shift_review_events', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').notNullable();
      table.string('from_status').nullable();
      table.string('to_status').notNullable();
      table.text('notes').nullable();
      table.integer('actor_employee_id').nullable();
      table.string('actor_role').notNullable();
      table.timestamp('created_at').notNullable();
    });

    const [adminId] = await db('employees').insert({ name: 'Review Admin' });
    const [closedShiftId] = await db('shifts').insert({
      employee_id: adminId,
      status: 'closed',
      start_time: '2026-08-01T08:00:00.000Z',
      end_time: '2026-08-02T08:00:00.000Z',
    });
    const [openShiftId] = await db('shifts').insert({
      employee_id: adminId,
      status: 'open',
      start_time: '2026-08-02T08:00:00.000Z',
    });
    await db('shift_reviews').insert({
      shift_id: closedShiftId,
      review_status: 'pending_review',
      created_at: '2026-08-02T08:00:00.000Z',
      updated_at: '2026-08-02T08:00:00.000Z',
    });

    let missingFlagReasonRejected = false;
    try {
      await updateShiftReview(db, closedShiftId, { status: 'flagged' });
    } catch (error: any) {
      missingFlagReasonRejected = error.code === 'FLAG_REASON_REQUIRED';
    }
    assert(missingFlagReasonRejected, 'Flagging without a reason was accepted');

    const flagged = await updateShiftReview(db, closedShiftId, {
      status: 'flagged',
      notes: 'Cash handover requires source-document comparison',
      actor: { employeeId: adminId, role: 'admin' },
    });
    assert(flagged.review_status === 'flagged', 'Closed shift was not flagged');
    assert(flagged.reviewed_by_name === 'Review Admin', 'Reviewer attribution was not returned');

    let missingResolutionRejected = false;
    try {
      await updateShiftReview(db, closedShiftId, { status: 'reviewed' });
    } catch (error: any) {
      missingResolutionRejected = error.code === 'RESOLUTION_REQUIRED';
    }
    assert(missingResolutionRejected, 'Flagged shift was resolved without a note');

    const reviewed = await updateShiftReview(db, closedShiftId, {
      status: 'reviewed',
      notes: 'Cash count verified against the signed handover sheet',
      actor: { employeeId: adminId, role: 'admin' },
    });
    assert(reviewed.review_status === 'reviewed', 'Flagged shift was not resolved');
    const events = await db('shift_review_events').where({ shift_id: closedShiftId }).orderBy('id');
    assert(events.length === 2, 'Review transition history is incomplete');
    assert(events[0].from_status === 'pending_review' && events[0].to_status === 'flagged', 'Flag event is incorrect');
    assert(events[1].from_status === 'flagged' && events[1].to_status === 'reviewed', 'Resolution event is incorrect');

    let openShiftRejected = false;
    try {
      await updateShiftReview(db, openShiftId, {
        status: 'flagged',
        notes: 'Open shifts cannot be reviewed',
      });
    } catch (error: any) {
      openShiftRejected = error.code === 'SHIFT_NOT_CLOSED';
    }
    assert(openShiftRejected, 'Open shift review was accepted');

    const timeline = buildShiftTimeline({
      shift: {
        id: closedShiftId,
        employee_name: 'Review Admin',
        status: 'closed',
        start_time: '2026-08-01T08:00:00.000Z',
        end_time: '2026-08-02T08:00:00.000Z',
      },
      shiftCredits: [{
        id: 4,
        customer_name: 'Test Customer',
        amount: 500,
        created_at: '2026-08-01T12:00:00.000Z',
      }],
      creditReceipts: [{
        id: 8,
        account_name: 'Old Debt Customer',
        amount: 300,
        payment_method: 'cash',
        date: '2026-08-01',
      }],
      closeReconciliation: {
        approved_at: '2026-08-02T08:00:00.000Z',
        variance: 0,
      },
      reviewEvents: events.map((event) => ({ ...event, actor_name: 'Review Admin' })),
    });
    assert(timeline[0].type === 'shift_opened', 'Timeline does not begin with shift opening');
    assert(timeline.some((event) => event.type === 'debt_receipt' && event.precision === 'date'), 'Date-only receipt precision was lost');
    assert(timeline.at(-1)?.type === 'shift_reviewed', 'Timeline is not chronologically ordered');

    console.log('PASS closed-shift review transitions, notes, attribution, and append-only events');
    console.log('PASS timeline ordering and date-level precision disclosure');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL shift review checks');
  console.error(error);
  process.exit(1);
});
