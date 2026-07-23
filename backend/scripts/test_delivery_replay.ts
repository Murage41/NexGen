import knex, { Knex } from 'knex';
import appDb from '../src/database';
import { replayTankCogsFrom } from '../src/services/stockCalculator';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function createSchema(db: Knex) {
  await db.schema.createTable('tanks', (t) => {
    t.increments('id').primary();
    t.string('label');
    t.decimal('current_stock_litres', 12, 2).defaultTo(0);
  });
  await db.schema.createTable('fuel_deliveries', (t) => {
    t.increments('id').primary();
    t.integer('tank_id').notNullable();
    t.decimal('litres', 12, 2).notNullable();
    t.text('delivery_timestamp').nullable();
    t.text('created_at').nullable();
    t.text('deleted_at').nullable();
  });
  await db.schema.createTable('pumps', (t) => {
    t.increments('id').primary();
    t.integer('tank_id').notNullable();
  });
  await db.schema.createTable('shifts', (t) => {
    t.increments('id').primary();
    t.string('status').notNullable();
    t.text('shift_date').notNullable();
    t.text('end_time').nullable();
  });
  await db.schema.createTable('pump_readings', (t) => {
    t.increments('id').primary();
    t.integer('pump_id').notNullable();
    t.integer('shift_id').notNullable();
    t.decimal('litres_sold', 12, 2).notNullable();
  });
  await db.schema.createTable('delivery_batches', (t) => {
    t.increments('id').primary();
    t.integer('delivery_id').nullable();
    t.integer('tank_id').notNullable();
    t.decimal('original_litres', 12, 2).notNullable();
    t.decimal('remaining_litres', 12, 2).notNullable();
    t.decimal('cost_per_litre', 12, 2).notNullable();
    t.text('date').notNullable();
  });
  await db.schema.createTable('tank_stock_adjustments', (t) => {
    t.increments('id').primary();
    t.integer('tank_id').notNullable();
    t.decimal('litres_change', 12, 2).notNullable();
    t.text('adjustment_timestamp').notNullable();
  });
  await db.schema.createTable('tank_adjustment_batches', (t) => {
    t.increments('id').primary();
    t.integer('adjustment_id').notNullable();
    t.integer('tank_id').notNullable();
    t.decimal('original_litres', 12, 2).notNullable();
    t.decimal('remaining_litres', 12, 2).notNullable();
    t.decimal('cost_per_litre', 12, 2).notNullable();
    t.text('date').notNullable();
  });
  await db.schema.createTable('batch_consumption', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').nullable();
    t.integer('adjustment_batch_id').nullable();
    t.integer('shift_id').notNullable();
    t.integer('tank_id').notNullable();
    t.decimal('litres_consumed', 12, 2).notNullable();
    t.decimal('cost_per_litre', 12, 2).notNullable();
    t.decimal('total_cost', 14, 2).notNullable();
  });
  await db.schema.createTable('shift_tank_snapshots', (t) => {
    t.integer('shift_id').notNullable();
    t.integer('tank_id').notNullable();
    t.decimal('cogs', 14, 2).notNullable();
  });
  await db.schema.createTable('cogs_corrections', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable();
    t.integer('tank_id').notNullable();
    t.decimal('litres_sold', 12, 2).notNullable();
    t.decimal('old_cogs', 14, 2).notNullable();
    t.decimal('new_cogs', 14, 2).notNullable();
    t.decimal('delta_kes', 14, 2).notNullable();
    t.integer('corrected_by').notNullable().defaultTo(0);
    t.text('reason').nullable();
  });
}

async function makeDb() {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await createSchema(db);
  await db('tanks').insert({ id: 1, label: 'Test Tank', current_stock_litres: 0 });
  await db('pumps').insert({ id: 1, tank_id: 1 });
  return db;
}

async function testBackdatedDeliveryReplacesMissingConsumption() {
  const db = await makeDb();
  try {
    await db('fuel_deliveries').insert({
      id: 1,
      tank_id: 1,
      litres: 300,
      delivery_timestamp: '2026-07-20 00:00:00',
      created_at: '2026-07-22 10:00:00',
    });
    await db('delivery_batches').insert({
      id: 1,
      delivery_id: 1,
      tank_id: 1,
      original_litres: 300,
      remaining_litres: 300,
      cost_per_litre: 180,
      date: '2026-07-20',
    });
    await db('shifts').insert({ id: 10, status: 'closed', shift_date: '2026-07-21', end_time: '2026-07-21 08:00:00' });
    await db('pump_readings').insert({ pump_id: 1, shift_id: 10, litres_sold: 300 });
    await db('batch_consumption').insert({ batch_id: null, shift_id: 10, tank_id: 1, litres_consumed: 300, cost_per_litre: 0, total_cost: 0 });
    await db('shift_tank_snapshots').insert({ shift_id: 10, tank_id: 1, cogs: 0 });

    const results = await replayTankCogsFrom(1, '2026-07-20 00:00:00', 'test backdated delivery', 0, db);
    const batch = await db('delivery_batches').where({ id: 1 }).first();
    const snapshot = await db('shift_tank_snapshots').where({ shift_id: 10, tank_id: 1 }).first();
    const correctionCount = Number((await db('cogs_corrections').count('* as c').first() as any).c);

    assertEqual(results.length, 1, 'backdated replay result count');
    assertEqual(results[0].new_cogs, 54000, 'backdated replay cogs');
    assertEqual(results[0].missing_litres, 0, 'backdated replay missing litres');
    assertEqual(Number(batch.remaining_litres), 0, 'backdated replay remaining litres');
    assertEqual(Number(snapshot.cogs), 54000, 'backdated replay snapshot cogs');
    assertEqual(correctionCount, 1, 'backdated replay correction count');
  } finally {
    await db.destroy();
  }
}

async function testPendingPriceReplay() {
  const db = await makeDb();
  try {
    await db('fuel_deliveries').insert({
      id: 2,
      tank_id: 1,
      litres: 500,
      delivery_timestamp: '2026-07-20 00:00:00',
      created_at: '2026-07-20 06:00:00',
    });
    await db('delivery_batches').insert({
      id: 2,
      delivery_id: 2,
      tank_id: 1,
      original_litres: 500,
      remaining_litres: 300,
      cost_per_litre: 0,
      date: '2026-07-20',
    });
    await db('shifts').insert({ id: 20, status: 'closed', shift_date: '2026-07-21', end_time: '2026-07-21 08:00:00' });
    await db('pump_readings').insert({ pump_id: 1, shift_id: 20, litres_sold: 200 });
    await db('batch_consumption').insert({ batch_id: 2, shift_id: 20, tank_id: 1, litres_consumed: 200, cost_per_litre: 0, total_cost: 0 });
    await db('shift_tank_snapshots').insert({ shift_id: 20, tank_id: 1, cogs: 0 });

    await db('delivery_batches').where({ id: 2 }).update({ cost_per_litre: 190 });
    const results = await replayTankCogsFrom(1, '2026-07-20 00:00:00', 'test pending price', 0, db);
    const batch = await db('delivery_batches').where({ id: 2 }).first();
    const snapshot = await db('shift_tank_snapshots').where({ shift_id: 20, tank_id: 1 }).first();

    assertEqual(results.length, 1, 'pending-price replay result count');
    assertEqual(results[0].new_cogs, 38000, 'pending-price replay cogs');
    assertEqual(Number(batch.remaining_litres), 300, 'pending-price replay remaining litres');
    assertEqual(Number(snapshot.cogs), 38000, 'pending-price replay snapshot cogs');
  } finally {
    await db.destroy();
  }
}

async function testFutureDeliveryBatchStaysUnavailable() {
  const db = await makeDb();
  try {
    await db('fuel_deliveries').insert([
      {
        id: 30,
        tank_id: 1,
        litres: 100,
        delivery_timestamp: '2026-07-01 00:00:00',
        created_at: '2026-07-01 10:00:00',
      },
      {
        id: 31,
        tank_id: 1,
        litres: 100,
        delivery_timestamp: '2026-07-03 00:00:00',
        created_at: '2026-07-01 10:00:00',
      },
    ]);
    await db('delivery_batches').insert([
      {
        id: 30,
        delivery_id: 30,
        tank_id: 1,
        original_litres: 100,
        remaining_litres: 100,
        cost_per_litre: 100,
        date: '2026-07-01',
      },
      {
        id: 31,
        delivery_id: 31,
        tank_id: 1,
        original_litres: 100,
        remaining_litres: 100,
        cost_per_litre: 200,
        date: '2026-07-01',
      },
    ]);
    await db('shifts').insert([
      { id: 30, status: 'closed', shift_date: '2026-07-02', end_time: '2026-07-02 08:00:00' },
      { id: 31, status: 'closed', shift_date: '2026-07-04', end_time: '2026-07-04 08:00:00' },
    ]);
    await db('pump_readings').insert([
      { pump_id: 1, shift_id: 30, litres_sold: 150 },
      { pump_id: 1, shift_id: 31, litres_sold: 100 },
    ]);
    await db('batch_consumption').insert([
      { batch_id: null, shift_id: 30, tank_id: 1, litres_consumed: 150, cost_per_litre: 0, total_cost: 0 },
      { batch_id: null, shift_id: 31, tank_id: 1, litres_consumed: 100, cost_per_litre: 0, total_cost: 0 },
    ]);
    await db('shift_tank_snapshots').insert([
      { shift_id: 30, tank_id: 1, cogs: 0 },
      { shift_id: 31, tank_id: 1, cogs: 0 },
    ]);

    const results = await replayTankCogsFrom(1, '2026-07-01 00:00:00', 'test future delivery', 0, db);
    const earlyRows = await db('batch_consumption').where({ shift_id: 30 }).orderBy('id');
    const laterRows = await db('batch_consumption').where({ shift_id: 31 }).orderBy('id');

    assertEqual(results[0].new_cogs, 10000, 'early shift only uses first delivery');
    assertEqual(results[0].missing_litres, 50, 'early shift keeps future litres missing');
    assertEqual(results[1].new_cogs, 20000, 'later shift uses future delivery');
    assertEqual(results[1].missing_litres, 0, 'later shift has eligible delivery');
    assertEqual(earlyRows.some((row: any) => Number(row.batch_id) === 31), false, 'future delivery excluded from early shift');
    assertEqual(laterRows.some((row: any) => Number(row.batch_id) === 31), true, 'future delivery available to later shift');
  } finally {
    await db.destroy();
  }
}

async function testFutureAdjustmentBatchStaysUnavailable() {
  const db = await makeDb();
  try {
    await db('tank_stock_adjustments').insert({
      id: 40,
      tank_id: 1,
      litres_change: 50,
      adjustment_timestamp: '2026-07-03 09:00:00',
    });
    await db('tank_adjustment_batches').insert({
      id: 40,
      adjustment_id: 40,
      tank_id: 1,
      original_litres: 50,
      remaining_litres: 50,
      cost_per_litre: 150,
      date: '2026-07-01',
    });
    await db('shifts').insert([
      { id: 40, status: 'closed', shift_date: '2026-07-02', end_time: '2026-07-02 08:00:00' },
      { id: 41, status: 'closed', shift_date: '2026-07-04', end_time: '2026-07-04 08:00:00' },
    ]);
    await db('pump_readings').insert([
      { pump_id: 1, shift_id: 40, litres_sold: 50 },
      { pump_id: 1, shift_id: 41, litres_sold: 50 },
    ]);
    await db('batch_consumption').insert([
      { batch_id: null, shift_id: 40, tank_id: 1, litres_consumed: 50, cost_per_litre: 0, total_cost: 0 },
      { batch_id: null, shift_id: 41, tank_id: 1, litres_consumed: 50, cost_per_litre: 0, total_cost: 0 },
    ]);
    await db('shift_tank_snapshots').insert([
      { shift_id: 40, tank_id: 1, cogs: 0 },
      { shift_id: 41, tank_id: 1, cogs: 0 },
    ]);

    const results = await replayTankCogsFrom(1, '2026-07-02 00:00:00', 'test future adjustment', 0, db);
    const earlyRows = await db('batch_consumption').where({ shift_id: 40 });
    const laterRows = await db('batch_consumption').where({ shift_id: 41 });

    assertEqual(results[0].new_cogs, 0, 'early shift excludes future adjustment');
    assertEqual(results[0].missing_litres, 50, 'early adjustment litres remain missing');
    assertEqual(results[1].new_cogs, 7500, 'later shift uses eligible adjustment');
    assertEqual(earlyRows.some((row: any) => Number(row.adjustment_batch_id) === 40), false, 'future adjustment excluded');
    assertEqual(laterRows.some((row: any) => Number(row.adjustment_batch_id) === 40), true, 'later adjustment included');
  } finally {
    await db.destroy();
  }
}

async function testReplayStress() {
  const db = await makeDb();
  try {
    await db('fuel_deliveries').insert({
      id: 3,
      tank_id: 1,
      litres: 2500,
      delivery_timestamp: '2026-07-01 00:00:00',
      created_at: '2026-07-22 10:00:00',
    });
    await db('delivery_batches').insert({
      id: 3,
      delivery_id: 3,
      tank_id: 1,
      original_litres: 2500,
      remaining_litres: 2500,
      cost_per_litre: 180,
      date: '2026-07-01',
    });

    for (let i = 0; i < 250; i += 1) {
      const shiftId = 1000 + i;
      const day = String(1 + Math.floor(i / 10)).padStart(2, '0');
      await db('shifts').insert({ id: shiftId, status: 'closed', shift_date: `2026-07-${day}`, end_time: `2026-07-${day} 08:00:00` });
      await db('pump_readings').insert({ pump_id: 1, shift_id: shiftId, litres_sold: 10 });
      await db('batch_consumption').insert({ batch_id: null, shift_id: shiftId, tank_id: 1, litres_consumed: 10, cost_per_litre: 0, total_cost: 0 });
      await db('shift_tank_snapshots').insert({ shift_id: shiftId, tank_id: 1, cogs: 0 });
    }

    const results = await replayTankCogsFrom(1, '2026-07-01 00:00:00', 'stress replay', 0, db);
    const batch = await db('delivery_batches').where({ id: 3 }).first();
    const totalCogs = Number((await db('shift_tank_snapshots').sum('cogs as total').first() as any).total);
    const correctionCount = Number((await db('cogs_corrections').count('* as c').first() as any).c);

    assertEqual(results.length, 250, 'stress replay result count');
    assertEqual(Number(batch.remaining_litres), 0, 'stress replay remaining litres');
    assertEqual(totalCogs, 450000, 'stress replay total cogs');
    assertEqual(correctionCount, 250, 'stress replay correction count');
  } finally {
    await db.destroy();
  }
}

async function main() {
  await testBackdatedDeliveryReplacesMissingConsumption();
  await testPendingPriceReplay();
  await testFutureDeliveryBatchStaysUnavailable();
  await testFutureAdjustmentBatchStaysUnavailable();
  await testReplayStress();
}

main()
  .then(() => {
    console.log('PASS delivery FIFO replay for backdated and pending-price deliveries');
    console.log('PASS future delivery and adjustment batches stay unavailable to earlier shifts');
    console.log('PASS 250-shift delivery replay stress check');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await appDb.destroy();
  });
