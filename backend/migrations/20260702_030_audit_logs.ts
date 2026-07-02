import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('audit_logs');
  if (exists) return;

  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id').primary();
    t.string('action').notNullable();
    t.string('target_type').nullable();
    t.string('target_id').nullable();
    t.integer('user_id').nullable();
    t.integer('employee_id').nullable();
    t.string('role').nullable();
    t.string('ip_address').nullable();
    t.string('user_agent').nullable();
    t.text('details_json').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['action']);
    t.index(['target_type', 'target_id']);
    t.index(['user_id']);
    t.index(['employee_id']);
    t.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
}
