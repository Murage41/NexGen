import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('fuel_deliveries', (t) => {
    t.timestamp('deleted_at').nullable();
  });
  await knex.schema.alterTable('shift_expenses', (t) => {
    t.timestamp('deleted_at').nullable();
  });
  await knex.schema.alterTable('expenses', (t) => {
    t.timestamp('deleted_at').nullable();
  });
  await knex.schema.alterTable('tank_dips', (t) => {
    t.timestamp('deleted_at').nullable();
  });
  await knex.schema.alterTable('wage_deductions', (t) => {
    t.timestamp('deleted_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('fuel_deliveries', (t) => { t.dropColumn('deleted_at'); });
  await knex.schema.alterTable('shift_expenses', (t) => { t.dropColumn('deleted_at'); });
  await knex.schema.alterTable('expenses', (t) => { t.dropColumn('deleted_at'); });
  await knex.schema.alterTable('tank_dips', (t) => { t.dropColumn('deleted_at'); });
  await knex.schema.alterTable('wage_deductions', (t) => { t.dropColumn('deleted_at'); });
}
