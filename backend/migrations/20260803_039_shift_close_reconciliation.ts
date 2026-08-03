import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('shift_close_reconciliations'))) {
    await knex.schema.createTable('shift_close_reconciliations', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').unsigned().notNullable().unique()
        .references('id').inTable('shifts').onDelete('CASCADE');
      table.boolean('readings_reviewed').notNullable();
      table.boolean('collections_reviewed').notNullable();
      table.boolean('entries_reviewed').notNullable();
      table.decimal('expected_sales', 14, 2).notNullable();
      table.decimal('expected_shift_total', 14, 2).notNullable();
      table.decimal('cash_received', 14, 2).notNullable();
      table.decimal('mpesa_received', 14, 2).notNullable();
      table.decimal('credit_receipts', 14, 2).notNullable();
      table.decimal('credits_issued', 14, 2).notNullable();
      table.decimal('invoice_consumption', 14, 2).notNullable();
      table.decimal('expenses', 14, 2).notNullable();
      table.decimal('direct_wage_payment', 14, 2).notNullable();
      table.decimal('payroll_payments', 14, 2).notNullable();
      table.decimal('total_accounted', 14, 2).notNullable();
      table.decimal('variance', 14, 2).notNullable();
      table.string('variance_type').notNullable();
      table.text('variance_reason').nullable();
      table.integer('approved_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.string('approved_by_role').notNullable().defaultTo('admin');
      table.timestamp('approved_at').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_shift_close_reconciliation_approved_at '
    + 'ON shift_close_reconciliations (approved_at)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_shift_close_reconciliation_approved_at');
  await knex.schema.dropTableIfExists('shift_close_reconciliations');
}
