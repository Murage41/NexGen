import type { Knex } from 'knex';

async function addColumn(knex: Knex, table: string, column: string, sql: string) {
  if (await knex.schema.hasTable(table) && !(await knex.schema.hasColumn(table, column))) {
    await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sql}`);
  }
}

// Opening declarations belong to this shift only. Historical and already-open
// shifts retain their old formula; no previous shift supplies missing money.
export async function up(knex: Knex): Promise<void> {
  for (const table of ['shifts', 'shift_close_reconciliations']) {
    await addColumn(knex, table, 'reconciliation_basis', "VARCHAR(20) NOT NULL DEFAULT 'legacy'");
    await addColumn(knex, table, 'opening_cash_amount', 'DECIMAL(14, 2) NULL');
    await addColumn(knex, table, 'opening_mpesa_amount', 'DECIMAL(14, 2) NULL');
  }
  await addColumn(knex, 'shifts', 'opening_note', 'TEXT NULL');
  await addColumn(knex, 'shifts', 'opening_recorded_by_employee_id', 'INTEGER NULL');
  await addColumn(knex, 'shifts', 'opening_recorded_at', 'TIMESTAMP NULL');
  for (const column of [
    'funds_added_cash', 'funds_added_mpesa', 'funds_added_total',
    'funds_removed_cash', 'funds_removed_mpesa', 'funds_removed_total',
    'drawer_business_payouts', 'expected_closing', 'inferred_collections', 'expected_receipts',
  ]) await addColumn(knex, 'shift_close_reconciliations', column, 'DECIMAL(14, 2) NULL');

  if (!(await knex.schema.hasTable('shift_funds_movements'))) {
    await knex.schema.createTable('shift_funds_movements', t => {
      t.increments('id').primary();
      t.integer('shift_id').notNullable().references('id').inTable('shifts');
      t.string('direction', 10).notNullable();
      t.string('method', 10).notNullable();
      t.decimal('amount', 14, 2).notNullable();
      t.string('source', 30).notNullable();
      t.string('reference').notNullable();
      t.text('reason').notNullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.integer('created_by_record_correction_id').nullable().references('id').inTable('corrections');
      t.integer('reversed_by_record_correction_id').nullable().references('id').inTable('corrections');
      t.timestamp('deleted_at').nullable();
      t.index(['shift_id'], 'idx_shift_funds_movements_shift');
    });
  }
  if (await knex.schema.hasTable('shifts')) {
    const columns = ['reconciliation_basis', 'opening_cash_amount', 'opening_mpesa_amount', 'opening_note', 'opening_recorded_by_employee_id', 'opening_recorded_at'];
    await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_shift_opening_declaration_update
      BEFORE UPDATE OF ${columns.map(c => `"${c}"`).join(', ')} ON shifts
      WHEN ${columns.map(c => `NEW."${c}" IS NOT OLD."${c}"`).join(' OR ')}
      BEGIN SELECT RAISE(ABORT, 'Opening declarations cannot be changed. Correct them instead.'); END`);
  }
  const facts = ['shift_id', 'direction', 'method', 'amount', 'source', 'reference', 'reason', 'created_at', 'created_by_record_correction_id'];
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_shift_funds_movement_update
    BEFORE UPDATE OF ${facts.map(c => `"${c}"`).join(', ')} ON shift_funds_movements
    WHEN ${facts.map(c => `NEW."${c}" IS NOT OLD."${c}"`).join(' OR ')}
    BEGIN SELECT RAISE(ABORT, 'Money movements cannot be changed. Reverse them instead.'); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_shift_funds_movement_delete
    BEFORE DELETE ON shift_funds_movements
    BEGIN SELECT RAISE(ABORT, 'Money movements cannot be deleted. Reverse them instead.'); END`);
}

export async function down(): Promise<void> {
  throw new Error('Shift opening funds are financial history. Restore a verified pre-update backup instead.');
}
