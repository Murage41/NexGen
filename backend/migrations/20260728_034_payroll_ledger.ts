import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('employee_compensation_plans', 'proration_method'))) {
    await knex.schema.alterTable('employee_compensation_plans', (table) => {
      table.string('proration_method').notNullable().defaultTo('calendar_days');
    });
  }

  if (!(await knex.schema.hasTable('payroll_periods'))) {
    await knex.schema.createTable('payroll_periods', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('pay_schedule').notNullable();
      table.date('period_start').notNullable();
      table.date('period_end').notNullable();
      table.string('status').notNullable().defaultTo('calculated');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('payroll_runs'))) {
    await knex.schema.createTable('payroll_runs', (table) => {
      table.increments('id').primary();
      table.integer('period_id').unsigned().notNullable().unique()
        .references('id').inTable('payroll_periods').onDelete('RESTRICT');
      table.string('status').notNullable().defaultTo('calculated');
      table.decimal('gross_total', 16, 2).notNullable().defaultTo(0);
      table.decimal('deduction_total', 16, 2).notNullable().defaultTo(0);
      table.decimal('net_total', 16, 2).notNullable().defaultTo(0);
      table.decimal('paid_total', 16, 2).notNullable().defaultTo(0);
      table.integer('created_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.integer('approved_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.timestamp('approved_at').nullable();
      table.timestamp('voided_at').nullable();
      table.text('void_reason').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('payroll_lines'))) {
    await knex.schema.createTable('payroll_lines', (table) => {
      table.increments('id').primary();
      table.integer('run_id').unsigned().notNullable()
        .references('id').inTable('payroll_runs').onDelete('RESTRICT');
      table.integer('employee_id').unsigned().notNullable()
        .references('id').inTable('employees').onDelete('RESTRICT');
      table.decimal('gross_earnings', 16, 2).notNullable().defaultTo(0);
      table.decimal('total_deductions', 16, 2).notNullable().defaultTo(0);
      table.decimal('net_pay', 16, 2).notNullable().defaultTo(0);
      table.decimal('paid_amount', 16, 2).notNullable().defaultTo(0);
      table.decimal('balance_due', 16, 2).notNullable().defaultTo(0);
      table.string('status').notNullable().defaultTo('unpaid');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['run_id', 'employee_id']);
    });
  }

  if (!(await knex.schema.hasTable('payroll_line_earnings'))) {
    await knex.schema.createTable('payroll_line_earnings', (table) => {
      table.increments('id').primary();
      table.integer('payroll_line_id').unsigned().notNullable()
        .references('id').inTable('payroll_lines').onDelete('RESTRICT');
      table.integer('earning_id').unsigned().notNullable()
        .references('id').inTable('employee_earnings').onDelete('RESTRICT');
      table.timestamp('released_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('payroll_deductions'))) {
    await knex.schema.createTable('payroll_deductions', (table) => {
      table.increments('id').primary();
      table.integer('payroll_line_id').unsigned().notNullable()
        .references('id').inTable('payroll_lines').onDelete('RESTRICT');
      table.integer('employee_id').unsigned().notNullable()
        .references('id').inTable('employees').onDelete('RESTRICT');
      table.string('deduction_type').notNullable();
      table.decimal('amount', 16, 2).notNullable();
      table.string('authorization_reference').nullable();
      table.text('notes').nullable();
      table.string('status').notNullable().defaultTo('draft');
      table.integer('created_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.timestamp('approved_at').nullable();
      table.timestamp('reversed_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('payroll_debt_allocations'))) {
    await knex.schema.createTable('payroll_debt_allocations', (table) => {
      table.increments('id').primary();
      table.integer('deduction_id').unsigned().notNullable()
        .references('id').inTable('payroll_deductions').onDelete('RESTRICT');
      table.integer('staff_debt_id').unsigned().notNullable()
        .references('id').inTable('staff_debts').onDelete('RESTRICT');
      table.decimal('amount', 16, 2).notNullable();
      table.timestamp('reversed_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('payroll_payments'))) {
    await knex.schema.createTable('payroll_payments', (table) => {
      table.increments('id').primary();
      table.integer('payroll_line_id').unsigned().notNullable()
        .references('id').inTable('payroll_lines').onDelete('RESTRICT');
      table.integer('employee_id').unsigned().notNullable()
        .references('id').inTable('employees').onDelete('RESTRICT');
      table.integer('shift_id').unsigned().nullable()
        .references('id').inTable('shifts').onDelete('RESTRICT');
      table.decimal('amount', 16, 2).notNullable();
      table.string('payment_method').notNullable();
      table.date('payment_date').notNullable();
      table.string('reference').nullable();
      table.text('notes').nullable();
      table.string('status').notNullable().defaultTo('posted');
      table.integer('created_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.timestamp('reversed_at').nullable();
      table.text('reversal_reason').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_payroll_period_dates '
    + 'ON payroll_periods (period_start, period_end, status)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_payroll_lines_employee '
    + 'ON payroll_lines (employee_id, run_id, status)',
  );
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_active_earning '
    + 'ON payroll_line_earnings (earning_id) WHERE released_at IS NULL',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_payroll_deductions_line '
    + 'ON payroll_deductions (payroll_line_id, status)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_payroll_payments_line '
    + 'ON payroll_payments (payroll_line_id, status, payment_date)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_payroll_payments_shift '
    + 'ON payroll_payments (shift_id, status)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_payroll_payments_shift');
  await knex.raw('DROP INDEX IF EXISTS idx_payroll_payments_line');
  await knex.raw('DROP INDEX IF EXISTS idx_payroll_deductions_line');
  await knex.raw('DROP INDEX IF EXISTS idx_payroll_active_earning');
  await knex.raw('DROP INDEX IF EXISTS idx_payroll_lines_employee');
  await knex.raw('DROP INDEX IF EXISTS idx_payroll_period_dates');
  await knex.schema.dropTableIfExists('payroll_payments');
  await knex.schema.dropTableIfExists('payroll_debt_allocations');
  await knex.schema.dropTableIfExists('payroll_deductions');
  await knex.schema.dropTableIfExists('payroll_line_earnings');
  await knex.schema.dropTableIfExists('payroll_lines');
  await knex.schema.dropTableIfExists('payroll_runs');
  await knex.schema.dropTableIfExists('payroll_periods');
  if (await knex.schema.hasColumn('employee_compensation_plans', 'proration_method')) {
    await knex.schema.alterTable('employee_compensation_plans', (table) => {
      table.dropColumn('proration_method');
    });
  }
}
