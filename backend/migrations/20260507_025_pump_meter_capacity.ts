import { Knex } from 'knex';

/**
 * Migration 025 — Pump meter capacity (rollover support)
 *
 * Physical fuel pumps display 6 digits before the decimal — they wrap from
 * 999,999.99 to 0.00 and start counting again. The owner has been mentally
 * adding 1,000,000 to the closing reading whenever a rollover occurred, so
 * existing cumulative values (petrol > 4M, diesel > 2M) are correct as
 * stored. This migration just records the capacity per pump so the backend
 * can do the rollover compensation automatically going forward.
 *
 * Litres and amount counters are independent — either can roll without the
 * other rolling on the same shift — so each gets its own capacity.
 *
 * Defaults to 1,000,000 (the owner's current pumps). Per-pump tuning is
 * supported in case a future pump has a 7- or 8-digit display.
 */
export async function up(knex: Knex): Promise<void> {
  const hasL = await knex.schema.hasColumn('pumps', 'meter_capacity_litres');
  if (!hasL) {
    await knex.schema.alterTable('pumps', (t) => {
      t.decimal('meter_capacity_litres', 14, 2).notNullable().defaultTo(1000000);
    });
  }
  const hasA = await knex.schema.hasColumn('pumps', 'meter_capacity_amount');
  if (!hasA) {
    await knex.schema.alterTable('pumps', (t) => {
      t.decimal('meter_capacity_amount', 14, 2).notNullable().defaultTo(1000000);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('pumps', 'meter_capacity_litres')) {
    await knex.schema.alterTable('pumps', (t) => t.dropColumn('meter_capacity_litres'));
  }
  if (await knex.schema.hasColumn('pumps', 'meter_capacity_amount')) {
    await knex.schema.alterTable('pumps', (t) => t.dropColumn('meter_capacity_amount'));
  }
}
