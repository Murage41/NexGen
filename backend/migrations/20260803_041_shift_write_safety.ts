import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('shifts', 'readings_revision'))) {
    await knex.schema.alterTable('shifts', (table) => {
      table.integer('readings_revision').notNullable().defaultTo(0);
    });
  }

  if (!(await knex.schema.hasColumn('shifts', 'collections_revision'))) {
    await knex.schema.alterTable('shifts', (table) => {
      table.integer('collections_revision').notNullable().defaultTo(0);
    });
  }

  if (!(await knex.schema.hasTable('idempotency_records'))) {
    await knex.schema.createTable('idempotency_records', (table) => {
      table.increments('id').primary();
      table.string('scope', 160).notNullable();
      table.string('idempotency_key', 128).notNullable();
      table.string('request_hash', 64).notNullable();
      table.integer('response_status').nullable();
      table.text('response_body').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['scope', 'idempotency_key'], {
        indexName: 'uq_idempotency_records_scope_key',
      });
      table.index(['created_at'], 'idx_idempotency_records_created');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('idempotency_records');

  if (await knex.schema.hasColumn('shifts', 'collections_revision')) {
    await knex.schema.alterTable('shifts', (table) => {
      table.dropColumn('collections_revision');
    });
  }

  if (await knex.schema.hasColumn('shifts', 'readings_revision')) {
    await knex.schema.alterTable('shifts', (table) => {
      table.dropColumn('readings_revision');
    });
  }
}
