import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('credits', (t) => {
    t.timestamp('deleted_at').nullable();
  });
  await knex.schema.alterTable('shift_credits', (t) => {
    t.timestamp('deleted_at').nullable();
  });
  await knex.schema.alterTable('credit_accounts', (t) => {
    t.timestamp('deleted_at').nullable();
  });
  await knex.schema.alterTable('credit_payments', (t) => {
    t.timestamp('deleted_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('credits', (t) => { t.dropColumn('deleted_at'); });
  await knex.schema.alterTable('shift_credits', (t) => { t.dropColumn('deleted_at'); });
  await knex.schema.alterTable('credit_accounts', (t) => { t.dropColumn('deleted_at'); });
  await knex.schema.alterTable('credit_payments', (t) => { t.dropColumn('deleted_at'); });
}
