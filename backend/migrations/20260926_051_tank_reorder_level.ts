import type { Knex } from 'knex';

// M7: each tank's "order more at" level in litres (a reorder point). Empty
// means the tank never warns. The home screens warn while the fuel in the tank
// now (services/tankStock.ts) is below it.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('tanks', 'reorder_level_litres'))) {
    await knex.raw('ALTER TABLE "tanks" ADD COLUMN "reorder_level_litres" DECIMAL(12, 2) NULL');
  }
}

export async function down(): Promise<void> {
  throw new Error('Tank order levels are station settings. Restore a verified pre-update backup instead.');
}
