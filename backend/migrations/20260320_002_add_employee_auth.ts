import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (t) => {
    t.string('pin', 4).defaultTo('0000');
    t.string('role').defaultTo('attendant'); // 'admin' | 'attendant'
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('pin');
    t.dropColumn('role');
  });
}
