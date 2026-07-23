import { Knex } from 'knex';

async function ensureIndex(knex: Knex, table: string, columns: string[], name: string) {
  const existing: any[] = await knex.raw(`PRAGMA index_list(${table})`);
  if (Array.isArray(existing) && existing.some((row: any) => row.name === name)) return;

  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  await knex.raw(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" (${quotedColumns})`);
}

export async function up(knex: Knex): Promise<void> {
  await ensureIndex(
    knex,
    'delivery_batches',
    ['tank_id', 'remaining_litres'],
    'idx_delivery_batches_tank_remaining',
  );
  await ensureIndex(
    knex,
    'delivery_batches',
    ['delivery_id'],
    'idx_delivery_batches_delivery',
  );
  await ensureIndex(
    knex,
    'tank_adjustment_batches',
    ['tank_id', 'remaining_litres'],
    'idx_adjustment_batches_tank_remaining',
  );
  await ensureIndex(
    knex,
    'pump_readings',
    ['pump_id', 'shift_id'],
    'idx_pump_readings_pump_shift',
  );
  await ensureIndex(knex, 'pumps', ['tank_id'], 'idx_pumps_tank');
  await ensureIndex(knex, 'shifts', ['status', 'end_time'], 'idx_shifts_status_end');
}

export async function down(knex: Knex): Promise<void> {
  for (const name of [
    'idx_delivery_batches_tank_remaining',
    'idx_delivery_batches_delivery',
    'idx_adjustment_batches_tank_remaining',
    'idx_pump_readings_pump_shift',
    'idx_pumps_tank',
    'idx_shifts_status_end',
  ]) {
    await knex.raw(`DROP INDEX IF EXISTS "${name}"`);
  }
}
