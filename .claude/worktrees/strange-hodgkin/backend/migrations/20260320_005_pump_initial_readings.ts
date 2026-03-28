import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasLitres = await knex.schema.hasColumn('pumps', 'initial_litres');
  if (!hasLitres) {
    await knex.schema.alterTable('pumps', (t) => {
      t.decimal('initial_litres', 14, 2).defaultTo(0);
      t.decimal('initial_amount', 14, 2).defaultTo(0);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasLitres = await knex.schema.hasColumn('pumps', 'initial_litres');
  if (hasLitres) {
    await knex.schema.alterTable('pumps', (t) => {
      t.dropColumn('initial_litres');
      t.dropColumn('initial_amount');
    });
  }
}
