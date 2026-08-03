import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('operational_settings'))) {
    await knex.schema.createTable('operational_settings', (table) => {
      table.string('key', 100).primary();
      table.string('value', 500).notNullable();
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex.raw(`
    INSERT INTO operational_settings (key, value, updated_at)
    SELECT 'stale_shift_hours', '30', CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1 FROM operational_settings WHERE key = 'stale_shift_hours'
    )
  `);

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_shifts_status_start_time '
    + 'ON shifts (status, start_time, id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_shifts_status_start_time');
  await knex.schema.dropTableIfExists('operational_settings');
}
