import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Add current_stock_litres to tanks (running ledger balance)
  if (await knex.schema.hasTable('tanks')) {
    const hasStockCol = await knex.schema.hasColumn('tanks', 'current_stock_litres');
    if (!hasStockCol) {
      await knex.schema.alterTable('tanks', (t) => {
        t.decimal('current_stock_litres', 12, 2).notNullable().defaultTo(0);
      });
    }
  }

  // 2. Add dip_date to tank_dips (the date of the physical measurement, vs. timestamp = when entered)
  if (await knex.schema.hasTable('tank_dips')) {
    const hasDipDateCol = await knex.schema.hasColumn('tank_dips', 'dip_date');
    if (!hasDipDateCol) {
      await knex.schema.alterTable('tank_dips', (t) => {
        t.string('dip_date', 10).nullable(); // 'YYYY-MM-DD'
      });
      // Backfill existing rows: extract date portion from timestamp
      await knex.raw(`UPDATE tank_dips SET dip_date = DATE(timestamp) WHERE dip_date IS NULL`);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // SQLite does not support DROP COLUMN via ALTER TABLE in older versions.
  // These columns are additive and safe to leave during rollback.
  // If using a DB that supports it, uncomment the following:
  //
  // await knex.schema.alterTable('tanks', t => t.dropColumn('current_stock_litres'));
  // await knex.schema.alterTable('tank_dips', t => t.dropColumn('dip_date'));
}
