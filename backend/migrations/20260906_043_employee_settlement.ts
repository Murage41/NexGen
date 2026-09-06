import type { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  for (const [table, column, definition] of [
    ['payroll_lines', 'recovery_review', 'TEXT NULL'],
    ['payroll_lines', 'settlement_version', 'INTEGER NOT NULL DEFAULT 0'],
    ['shifts', 'direct_wage_cash_amount', 'DECIMAL(14,2) NULL'],
    ['shifts', 'recovery_review', 'TEXT NULL'],
    ['staff_debts', 'recovery_status', "TEXT NOT NULL DEFAULT 'confirmed'"],
    [
      'employees',
      'recovery_limit_percent',
      'DECIMAL(5,2) NOT NULL DEFAULT 100',
    ],
    ['credit_payments', 'created_by_employee_id', 'INTEGER NULL'],
  ]) {
    if (!(await db.schema.hasTable(table))) continue;
    if (!(await db.schema.hasColumn(table, column))) {
      await db.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  if (!(await db.schema.hasTable('staff_debt_reviews'))) {
    await db.schema.createTable('staff_debt_reviews', (t) => {
      t.increments('id');
      t.integer('staff_debt_id')
        .notNullable()
        .references('id')
        .inTable('staff_debts');
      t.string('status').notNullable();
      t.text('reason').notNullable();
      t.integer('actor_id').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }
  if (!(await db.schema.hasTable('staff_debt_receipt_allocations'))) {
    await db.schema.createTable('staff_debt_receipt_allocations', (t) => {
      t.increments('id');
      t.integer('payment_id')
        .notNullable()
        .references('id')
        .inTable('credit_payments');
      t.integer('staff_debt_id')
        .notNullable()
        .references('id')
        .inTable('staff_debts');
      t.decimal('amount', 14, 2).notNullable();
      t.timestamp('reversed_at').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.unique(['payment_id', 'staff_debt_id']);
    });
  }
  if (!(await db.schema.hasTable('payroll_settlement_allocations'))) {
    await db.schema.createTable('payroll_settlement_allocations', (t) => {
      t.increments('id');
      t.integer('payroll_line_id')
        .notNullable()
        .references('id')
        .inTable('payroll_lines');
      t.integer('earning_id')
        .notNullable()
        .references('id')
        .inTable('employee_earnings');
      t.string('source_type').notNullable();
      t.integer('source_id').notNullable();
      t.decimal('amount', 14, 2).notNullable();
      t.timestamp('reversed_at').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.unique(['earning_id', 'source_type', 'source_id']);
    });
  }
}

export async function down(): Promise<void> {
  throw new Error(
    'Employee settlement history must be preserved. Restore a verified pre-update backup only before new financial activity.',
  );
}
