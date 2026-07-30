import type { Knex } from 'knex';

async function addColumnIfMissing(
  knex: Knex,
  table: string,
  column: string,
  sqlType: string,
) {
  if (!(await knex.schema.hasColumn(table, column))) {
    await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sqlType}`);
  }
}

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('invoice_consumption')) {
    // Additive ALTER statements avoid rebuilding the populated shifts table.
    await addColumnIfMissing(knex, 'invoice_consumption', 'pump_id', 'INTEGER NULL');
    await addColumnIfMissing(knex, 'invoice_consumption', 'created_by_employee_id', 'INTEGER NULL');
    await addColumnIfMissing(knex, 'invoice_consumption', 'correction_of_id', 'INTEGER NULL');
    await addColumnIfMissing(knex, 'invoice_consumption', 'entry_status', "TEXT NOT NULL DEFAULT 'active'");
    await addColumnIfMissing(knex, 'invoice_consumption', 'reversed_at', 'TEXT NULL');
    await addColumnIfMissing(knex, 'invoice_consumption', 'reversed_by_employee_id', 'INTEGER NULL');
    await addColumnIfMissing(knex, 'invoice_consumption', 'correction_reason', 'TEXT NULL');
    await addColumnIfMissing(knex, 'invoice_consumption', 'updated_at', 'TEXT NULL');

    await knex.raw(
      "UPDATE invoice_consumption SET entry_status = 'deleted' WHERE deleted_at IS NOT NULL AND entry_status = 'active'",
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_invoice_consumption_shift_fuel ON invoice_consumption (shift_id, fuel_type)',
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_invoice_consumption_shift_pump ON invoice_consumption (shift_id, pump_id)',
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_invoice_consumption_correction ON invoice_consumption (correction_of_id)',
    );
  }

  if (!(await knex.schema.hasTable('shift_accountability_adjustments'))) {
    await knex.schema.createTable('shift_accountability_adjustments', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').unsigned().notNullable()
        .references('id').inTable('shifts').onDelete('RESTRICT');
      table.string('adjustment_type').notNullable();
      table.integer('reference_id').nullable();
      table.decimal('amount_delta', 14, 2).notNullable();
      table.decimal('variance_before', 14, 2).notNullable();
      table.decimal('variance_after', 14, 2).notNullable();
      table.text('reason').notNullable();
      table.integer('created_by_employee_id').nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['shift_id', 'created_at'], 'idx_shift_accountability_adjustments_shift');
    });
  }

  if (!(await knex.schema.hasTable('staff_debt_adjustments'))) {
    await knex.schema.createTable('staff_debt_adjustments', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').unsigned().notNullable()
        .references('id').inTable('shifts').onDelete('RESTRICT');
      table.integer('staff_debt_id').unsigned().nullable()
        .references('id').inTable('staff_debts').onDelete('RESTRICT');
      table.integer('accountability_adjustment_id').unsigned().notNullable()
        .references('id').inTable('shift_accountability_adjustments').onDelete('RESTRICT');
      table.string('adjustment_type').notNullable();
      table.decimal('amount', 14, 2).notNullable();
      table.decimal('balance_before', 14, 2).nullable();
      table.decimal('balance_after', 14, 2).nullable();
      table.string('status').notNullable().defaultTo('posted');
      table.text('reason').notNullable();
      table.integer('created_by_employee_id').nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['shift_id', 'created_at'], 'idx_staff_debt_adjustments_shift');
      table.index('staff_debt_id', 'idx_staff_debt_adjustments_debt');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('staff_debt_adjustments');
  await knex.schema.dropTableIfExists('shift_accountability_adjustments');
  // Additive columns are intentionally retained on rollback. Removing them
  // would rebuild invoice_consumption and risk populated station data.
}
