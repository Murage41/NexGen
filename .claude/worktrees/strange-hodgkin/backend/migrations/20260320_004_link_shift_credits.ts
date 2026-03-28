import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add credit_id to shift_credits to link to main credits ledger
  const hasColumn = await knex.schema.hasColumn('shift_credits', 'credit_id');
  if (!hasColumn) {
    await knex.schema.alterTable('shift_credits', (t) => {
      t.integer('credit_id').nullable().references('id').inTable('credits');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('shift_credits', 'credit_id');
  if (hasColumn) {
    await knex.schema.alterTable('shift_credits', (t) => {
      t.dropColumn('credit_id');
    });
  }
}
