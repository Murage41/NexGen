import type { Knex } from 'knex';

async function ensureIndex(knex: Knex, name: string, columns: string[]) {
  const existing: any[] = await knex.raw('PRAGMA index_list(shifts)');
  if (Array.isArray(existing) && existing.some((row: any) => row.name === name)) return;

  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  await knex.raw(`CREATE INDEX IF NOT EXISTS "${name}" ON "shifts" (${quotedColumns})`);
}

export async function up(knex: Knex): Promise<void> {
  await knex.raw('UPDATE shifts SET shift_date = DATE(start_time) WHERE shift_date IS NULL');
  await ensureIndex(knex, 'idx_shifts_history_date', ['shift_date', 'start_time', 'id']);
  await ensureIndex(knex, 'idx_shifts_history_status_date', ['status', 'shift_date', 'start_time', 'id']);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS "idx_shifts_history_status_date"');
  await knex.raw('DROP INDEX IF EXISTS "idx_shifts_history_date"');
}
