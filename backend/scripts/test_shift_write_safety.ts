import knexFactory from 'knex';
import { pruneCompletedIdempotencyRecords, runIdempotent } from '../src/services/idempotency';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const db = knexFactory({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    pool: { min: 1, max: 1 },
    useNullAsDefault: true,
  });

  try {
    await db.schema.createTable('idempotency_records', (table) => {
      table.increments('id').primary();
      table.string('scope').notNullable();
      table.string('idempotency_key').notNullable();
      table.string('request_hash').notNullable();
      table.integer('response_status').nullable();
      table.text('response_body').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.unique(['scope', 'idempotency_key']);
    });
    await db.schema.createTable('operations', (table) => {
      table.increments('id').primary();
      table.string('description').notNullable();
    });
    await db.schema.createTable('shifts', (table) => {
      table.increments('id').primary();
      table.string('value').notNullable();
      table.integer('readings_revision').notNullable().defaultTo(0);
    });

    const createOperation = (key: string, description: string) => runIdempotent(
      db,
      {
        scope: 'shift:1:expense',
        key,
        payload: { description, amount: 100 },
      },
      async (trx) => {
        const [id] = await trx('operations').insert({ description });
        const operation = await trx('operations').where({ id }).first();
        return { status: 201, body: { success: true, data: operation } };
      },
    );

    const first = await createOperation('expense-action-0001', 'Generator service');
    const replay = await createOperation('expense-action-0001', 'Generator service');
    assert(!first.replayed, 'The first operation was incorrectly marked as replayed');
    assert(replay.replayed, 'The repeated operation was not replayed');
    assert(first.body.data.id === replay.body.data.id, 'Replay returned a different business row');
    assert(Number((await db('operations').count({ count: '*' }).first())?.count) === 1, 'Replay created a duplicate row');

    let changedPayloadRejected = false;
    try {
      await createOperation('expense-action-0001', 'Different expense');
    } catch (error: any) {
      changedPayloadRejected = error.code === 'IDEMPOTENCY_KEY_REUSED';
    }
    assert(changedPayloadRejected, 'A reused key accepted different request data');

    const [shiftId] = await db('shifts').insert({ value: 'opening' });
    const saveRevision = (expectedRevision: number, value: string) => db.transaction(async (trx) => {
      const changed = await trx('shifts')
        .where({ id: shiftId, readings_revision: expectedRevision })
        .update({ value, readings_revision: expectedRevision + 1 });
      if (changed !== 1) throw Object.assign(new Error('stale revision'), { code: 'STALE_SHIFT_READINGS' });
    });

    const concurrent = await Promise.allSettled([
      saveRevision(0, 'device-a'),
      saveRevision(0, 'device-b'),
    ]);
    const fulfilled = concurrent.filter((result) => result.status === 'fulfilled');
    const rejected = concurrent.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    assert(fulfilled.length === 1, 'Both concurrent saves were accepted');
    assert(rejected.length === 1, 'A stale concurrent save was not rejected');
    assert(rejected[0].reason.code === 'STALE_SHIFT_READINGS', 'Concurrent save returned the wrong conflict');

    const storedShift = await db('shifts').where({ id: shiftId }).first();
    assert(Number(storedShift.readings_revision) === 1, 'Revision was incremented incorrectly');
    assert(['device-a', 'device-b'].includes(storedShift.value), 'Winning save was not persisted');

    await db('idempotency_records').insert([
      {
        scope: 'old:complete',
        idempotency_key: 'old-complete-key',
        request_hash: 'old-complete',
        response_status: 201,
        response_body: '{}',
        created_at: '2020-01-01 00:00:00',
      },
      {
        scope: 'old:incomplete',
        idempotency_key: 'old-incomplete-key',
        request_hash: 'old-incomplete',
        created_at: '2020-01-01 00:00:00',
      },
    ]);
    const pruned = await pruneCompletedIdempotencyRecords(db, 90);
    assert(pruned === 1, 'Retention did not prune exactly the expired completed record');
    assert(await db('idempotency_records').where({ scope: 'old:incomplete' }).first(), 'Retention removed an incomplete operation');

    console.log('PASS idempotent replay creates one business row and returns the original response');
    console.log('PASS changed payload cannot reuse an operation key');
    console.log('PASS concurrent stale shift save is rejected without overwriting the winner');
    console.log('PASS retention prunes only expired completed operation keys');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL shift write safety checks');
  console.error(error);
  process.exit(1);
});
