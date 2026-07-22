import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('fuel_deliveries')) {
    if (!(await knex.schema.hasColumn('fuel_deliveries', 'pricing_status'))) {
      await knex.schema.alterTable('fuel_deliveries', (t) => {
        t.string('pricing_status').notNullable().defaultTo('priced');
      });
    }

    if (!(await knex.schema.hasColumn('fuel_deliveries', 'priced_at'))) {
      await knex.schema.alterTable('fuel_deliveries', (t) => {
        t.timestamp('priced_at').nullable();
      });
    }

    // Do not rewrite historical delivery_timestamp values here. Station data
    // may need a dry-run and backup before any optional historical repair.
    await knex.raw(`
      UPDATE fuel_deliveries
      SET pricing_status = CASE
        WHEN COALESCE(CAST(cost_per_litre AS REAL), 0) > 0 THEN 'priced'
        ELSE 'pending_price'
      END
      WHERE deleted_at IS NULL
    `);

    await knex.raw(`
      UPDATE fuel_deliveries
      SET priced_at = COALESCE(created_at, datetime('now'))
      WHERE deleted_at IS NULL
        AND pricing_status = 'priced'
        AND priced_at IS NULL
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('fuel_deliveries')) {
    if (await knex.schema.hasColumn('fuel_deliveries', 'priced_at')) {
      await knex.schema.alterTable('fuel_deliveries', (t) => t.dropColumn('priced_at'));
    }
    if (await knex.schema.hasColumn('fuel_deliveries', 'pricing_status')) {
      await knex.schema.alterTable('fuel_deliveries', (t) => t.dropColumn('pricing_status'));
    }
  }
}
