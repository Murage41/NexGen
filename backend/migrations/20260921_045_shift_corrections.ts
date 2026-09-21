import type { Knex } from 'knex';

// Closed-shift corrections (services/shiftCorrections.ts). A closed record is
// never edited: a correction marks the original reversed, adds a linked
// replacement when one is needed, and is itself kept as a dated, approved
// document in shift_accountability_adjustments. Additive columns only, so the
// populated tables are not rebuilt.

async function addColumn(knex: Knex, table: string, column: string, sqlType: string) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) {
    await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sqlType}`);
  }
}

export async function up(knex: Knex): Promise<void> {
  const columns: Array<[string, string, string]> = [
    // The correction document.
    ['shift_accountability_adjustments', 'entry_type', 'TEXT NULL'],
    ['shift_accountability_adjustments', 'correction_kind', 'TEXT NULL'],
    ['shift_accountability_adjustments', 'original_id', 'INTEGER NULL'],
    ['shift_accountability_adjustments', 'replacement_id', 'INTEGER NULL'],
    ['shift_accountability_adjustments', 'posting_date', 'TEXT NULL'],
    ['shift_accountability_adjustments', 'approved_by_employee_id', 'INTEGER NULL'],
    ['shift_accountability_adjustments', 'approved_by_name', 'TEXT NULL'],
    ['shift_accountability_adjustments', 'note', 'TEXT NULL'],
    ['shift_accountability_adjustments', 'details', 'TEXT NULL'],
    // Links on the corrected records.
    ['credits', 'reversed_at', 'TEXT NULL'],
    ['credits', 'reversed_by_employee_id', 'INTEGER NULL'],
    ['credits', 'reversed_by_correction_id', 'INTEGER NULL'],
    ['credits', 'correction_of_id', 'INTEGER NULL'],
    ['credits', 'created_by_correction_id', 'INTEGER NULL'],
    ['credit_payments', 'reversed_by_correction_id', 'INTEGER NULL'],
    ['credit_payments', 'correction_of_id', 'INTEGER NULL'],
    ['credit_payments', 'created_by_correction_id', 'INTEGER NULL'],
    ['invoice_consumption', 'reversed_by_correction_id', 'INTEGER NULL'],
    ['invoice_consumption', 'created_by_correction_id', 'INTEGER NULL'],
    // Money owed back to an employee after a correction, and how it was settled.
    ['staff_debt_adjustments', 'employee_id', 'INTEGER NULL'],
    ['staff_debt_adjustments', 'settled_at', 'TEXT NULL'],
    ['staff_debt_adjustments', 'settlement_date', 'TEXT NULL'],
    ['staff_debt_adjustments', 'settlement_method', 'TEXT NULL'],
    ['staff_debt_adjustments', 'settlement_reference', 'TEXT NULL'],
    ['staff_debt_adjustments', 'settled_by_employee_id', 'INTEGER NULL'],
    ['staff_debt_adjustments', 'settled_by_name', 'TEXT NULL'],
  ];
  for (const [table, column, sqlType] of columns) await addColumn(knex, table, column, sqlType);

  if (await knex.schema.hasTable('shift_accountability_adjustments')) {
    // Invoice litre corrections made before this release become ordinary
    // corrections: same log, dated the day they were made.
    await knex.raw(`
      UPDATE shift_accountability_adjustments
      SET entry_type = 'invoice_consumption',
          correction_kind = 'wrong_amount',
          replacement_id = reference_id,
          original_id = (
            SELECT correction_of_id FROM invoice_consumption
            WHERE invoice_consumption.id = shift_accountability_adjustments.reference_id
          ),
          posting_date = date(created_at, '+3 hours'),
          approved_by_employee_id = created_by_employee_id,
          approved_by_name = (
            SELECT name FROM employees
            WHERE employees.id = shift_accountability_adjustments.created_by_employee_id
          )
      WHERE adjustment_type = 'invoice_consumption_correction' AND entry_type IS NULL
    `);
    await knex.raw(`
      UPDATE invoice_consumption
      SET created_by_correction_id = (
        SELECT a.id FROM shift_accountability_adjustments a
        WHERE a.entry_type = 'invoice_consumption' AND a.replacement_id = invoice_consumption.id
      )
      WHERE created_by_correction_id IS NULL AND EXISTS (
        SELECT 1 FROM shift_accountability_adjustments a
        WHERE a.entry_type = 'invoice_consumption' AND a.replacement_id = invoice_consumption.id
      )
    `);
    await knex.raw(`
      UPDATE invoice_consumption
      SET reversed_by_correction_id = (
        SELECT a.id FROM shift_accountability_adjustments a
        WHERE a.entry_type = 'invoice_consumption' AND a.original_id = invoice_consumption.id
      )
      WHERE reversed_by_correction_id IS NULL AND EXISTS (
        SELECT 1 FROM shift_accountability_adjustments a
        WHERE a.entry_type = 'invoice_consumption' AND a.original_id = invoice_consumption.id
      )
    `);
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_shift_accountability_adjustments_posting '
      + 'ON shift_accountability_adjustments (posting_date, id)',
    );
  }

  if (await knex.schema.hasTable('staff_debt_adjustments')) {
    await knex.raw(`
      UPDATE staff_debt_adjustments
      SET employee_id = (SELECT employee_id FROM shifts WHERE shifts.id = staff_debt_adjustments.shift_id)
      WHERE employee_id IS NULL
    `);
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_staff_debt_adjustments_owed '
      + 'ON staff_debt_adjustments (employee_id, adjustment_type, status)',
    );
  }
  for (const table of ['credits', 'credit_payments', 'invoice_consumption']) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_${table}_reversed_by_correction ON ${table} (reversed_by_correction_id)`,
    );
  }
}

export async function down(): Promise<void> {
  throw new Error(
    'Correction history must be preserved. Restore a verified pre-update backup only before new financial activity.',
  );
}
