import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('employee_earnings'))) {
    await knex.schema.createTable('employee_earnings', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').unsigned().notNullable()
        .references('id').inTable('employees');
      table.integer('shift_id').unsigned().nullable()
        .references('id').inTable('shifts').onDelete('RESTRICT');
      table.integer('plan_id').unsigned().nullable()
        .references('id').inTable('employee_compensation_plans').onDelete('RESTRICT');
      table.integer('component_id').unsigned().nullable()
        .references('id').inTable('employee_compensation_components').onDelete('RESTRICT');
      table.string('source_type').notNullable();
      table.string('source_key').notNullable().unique();
      table.date('earning_date').notNullable();
      table.decimal('basis_amount', 16, 2).nullable();
      table.decimal('basis_quantity', 16, 3).nullable();
      table.decimal('rate', 16, 6).nullable();
      table.decimal('gross_amount', 16, 2).notNullable();
      table.string('status').notNullable().defaultTo('approved');
      table.text('description').nullable();
      table.timestamp('approved_at').nullable();
      table.timestamp('reversed_at').nullable();
      table.integer('reversal_of_id').unsigned().nullable()
        .references('id').inTable('employee_earnings').onDelete('RESTRICT');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasColumn('shifts', 'earnings_generated_at'))) {
    await knex.schema.alterTable('shifts', (table) => {
      table.timestamp('earnings_generated_at').nullable();
    });
  }

  const closedShifts = await knex('shifts')
    .where({ status: 'closed' })
    .whereNull('earnings_generated_at')
    .select(
      'id',
      'employee_id',
      'compensation_plan_id',
      'shift_date',
      'start_time',
      'wage_paid',
      'end_time',
    );

  for (const shift of closedShifts) {
    const deduction = await knex('wage_deductions')
      .where({ shift_id: shift.id })
      .whereNull('deleted_at')
      .first();
    const recordedGross = deduction?.original_wage != null
      ? Number(deduction.original_wage)
      : Number(shift.wage_paid || 0);
    const component = shift.compensation_plan_id
      ? await knex('employee_compensation_components')
        .where({ plan_id: shift.compensation_plan_id, component_type: 'fixed_per_shift' })
        .first()
      : null;

    await knex('employee_earnings').insert({
      employee_id: shift.employee_id,
      shift_id: shift.id,
      plan_id: shift.compensation_plan_id || null,
      component_id: component?.id || null,
      source_type: 'legacy_shift',
      source_key: `legacy-shift:${shift.id}`,
      earning_date: shift.shift_date || String(shift.start_time).slice(0, 10),
      gross_amount: recordedGross,
      status: 'approved',
      description: 'Migrated from the recorded closed-shift wage without recalculation.',
      approved_at: shift.end_time || knex.fn.now(),
    });

    await knex('shifts').where({ id: shift.id }).update({
      earnings_generated_at: shift.end_time || knex.fn.now(),
    });
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_employee_earnings_employee_date '
    + 'ON employee_earnings (employee_id, earning_date, id)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_employee_earnings_shift '
    + 'ON employee_earnings (shift_id, status)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_employee_earnings_status_date '
    + 'ON employee_earnings (status, earning_date)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_employee_earnings_status_date');
  await knex.raw('DROP INDEX IF EXISTS idx_employee_earnings_shift');
  await knex.raw('DROP INDEX IF EXISTS idx_employee_earnings_employee_date');
  if (await knex.schema.hasColumn('shifts', 'earnings_generated_at')) {
    await knex.schema.alterTable('shifts', (table) => {
      table.dropColumn('earnings_generated_at');
    });
  }
  await knex.schema.dropTableIfExists('employee_earnings');
}
