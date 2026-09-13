import type { Knex } from 'knex';

// Credit customer limits (M5). Every new column is nullable and null means
// "no rule": existing customers must keep trading exactly as before until the
// owner sets a limit, never be blocked by a default of zero.
export async function up(db: Knex): Promise<void> {
  for (const [column, definition] of [
    ['credit_limit', 'DECIMAL(14,2) NULL'],
    ['credit_age_limit_days', 'INTEGER NULL'],
    ['kra_pin', 'TEXT NULL'],
  ]) {
    if (!(await db.schema.hasColumn('credit_accounts', column))) {
      await db.raw(`ALTER TABLE credit_accounts ADD COLUMN ${column} ${definition}`);
    }
  }

  // One row per credit or fuel-on-account entry an administrator allowed past a
  // limit: which rules were breached and by how much, and who approved it.
  if (!(await db.schema.hasTable('credit_limit_overrides'))) {
    await db.schema.createTable('credit_limit_overrides', (t) => {
      t.increments('id');
      t.integer('account_id').notNullable().references('id').inTable('credit_accounts');
      t.integer('shift_id').notNullable().references('id').inTable('shifts');
      t.integer('credit_id').nullable().references('id').inTable('credits');
      t.integer('invoice_consumption_id').nullable().references('id').inTable('invoice_consumption');
      t.decimal('amount', 14, 2).notNullable();
      t.text('breaches').notNullable();
      t.integer('approved_by_employee_id').notNullable().references('id').inTable('employees');
      t.string('approved_by_name').notNullable();
      t.integer('recorded_by_employee_id').nullable().references('id').inTable('employees');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.index(['account_id', 'created_at'], 'idx_credit_limit_overrides_account');
    });
  }
}

export async function down(): Promise<void> {
  throw new Error(
    'Credit limit overrides are an audit record and must be preserved. Restore a verified pre-update backup only before new credit activity.',
  );
}
