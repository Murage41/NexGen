import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const employeeColumns = [
    ['job_title', (table: Knex.AlterTableBuilder) => table.string('job_title').nullable()],
    ['employment_type', (table: Knex.AlterTableBuilder) => table.string('employment_type').nullable()],
    ['employment_start_date', (table: Knex.AlterTableBuilder) => table.date('employment_start_date').nullable()],
    ['employment_end_date', (table: Knex.AlterTableBuilder) => table.date('employment_end_date').nullable()],
  ] as const;

  for (const [column, addColumn] of employeeColumns) {
    if (!(await knex.schema.hasColumn('employees', column))) {
      await knex.schema.alterTable('employees', addColumn);
    }
  }

  if (!(await knex.schema.hasTable('employee_compensation_plans'))) {
    await knex.schema.createTable('employee_compensation_plans', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').unsigned().notNullable()
        .references('id').inTable('employees').onDelete('CASCADE');
      table.string('name').notNullable();
      table.string('pay_schedule').notNullable();
      table.date('effective_from').notNullable();
      table.date('effective_to').nullable();
      table.string('status').notNullable().defaultTo('active');
      table.integer('version').notNullable().defaultTo(1);
      table.string('currency', 3).notNullable().defaultTo('KES');
      table.text('notes').nullable();
      table.integer('created_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['employee_id', 'effective_from']);
    });
  }

  if (!(await knex.schema.hasTable('employee_compensation_components'))) {
    await knex.schema.createTable('employee_compensation_components', (table) => {
      table.increments('id').primary();
      table.integer('plan_id').unsigned().notNullable()
        .references('id').inTable('employee_compensation_plans').onDelete('CASCADE');
      table.string('component_type').notNullable();
      table.decimal('amount', 14, 2).nullable();
      table.decimal('rate', 14, 6).nullable();
      table.string('fuel_type').nullable();
      table.decimal('minimum_amount', 14, 2).nullable();
      table.decimal('maximum_amount', 14, 2).nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasColumn('shifts', 'compensation_plan_id'))) {
    await knex.schema.alterTable('shifts', (table) => {
      table.integer('compensation_plan_id').unsigned().nullable()
        .references('id').inTable('employee_compensation_plans').onDelete('SET NULL');
    });
  }

  const employees = await knex('employees').select('id', 'daily_wage');
  for (const employee of employees) {
    let plan = await knex('employee_compensation_plans')
      .where({ employee_id: employee.id })
      .orderBy('effective_from', 'asc')
      .first();

    if (!plan) {
      const [planId] = await knex('employee_compensation_plans').insert({
        employee_id: employee.id,
        name: 'Legacy per-shift wage',
        pay_schedule: 'daily',
        effective_from: '1900-01-01',
        status: 'active',
        version: 1,
        currency: 'KES',
        notes: 'Automatically migrated from employees.daily_wage.',
      });
      await knex('employee_compensation_components').insert({
        plan_id: planId,
        component_type: 'fixed_per_shift',
        amount: Number(employee.daily_wage || 0),
      });
      plan = { id: planId };
    }

    await knex('shifts')
      .where({ employee_id: employee.id })
      .whereNull('compensation_plan_id')
      .update({ compensation_plan_id: plan.id });
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_comp_plans_employee_dates '
    + 'ON employee_compensation_plans (employee_id, effective_from, effective_to)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_comp_components_plan '
    + 'ON employee_compensation_components (plan_id, component_type)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_shifts_compensation_plan '
    + 'ON shifts (compensation_plan_id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_shifts_compensation_plan');
  await knex.raw('DROP INDEX IF EXISTS idx_comp_components_plan');
  await knex.raw('DROP INDEX IF EXISTS idx_comp_plans_employee_dates');

  if (await knex.schema.hasColumn('shifts', 'compensation_plan_id')) {
    await knex.schema.alterTable('shifts', (table) => {
      table.dropColumn('compensation_plan_id');
    });
  }

  await knex.schema.dropTableIfExists('employee_compensation_components');
  await knex.schema.dropTableIfExists('employee_compensation_plans');

  for (const column of ['employment_end_date', 'employment_start_date', 'employment_type', 'job_title']) {
    if (await knex.schema.hasColumn('employees', column)) {
      await knex.schema.alterTable('employees', (table) => {
        table.dropColumn(column);
      });
    }
  }
}
