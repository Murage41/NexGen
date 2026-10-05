import type { Knex } from 'knex';

// Corrections, phase 2a (docs/ROADMAP.md §3c): a closed shift's credit sales,
// debt receipts, drawer expenses and cash/M-Pesa split are corrected, never
// changed (services/correctionRules/).
// 1. Links from those records to the correction that reversed or created them.
// 2. Correction lines carry a payment method, an expense category and an
//    M-Pesa fee change.
// 3. Guards: the database refuses changes to the recorded facts of a closed
//    shift's credit sales and debt receipts (drawer expenses and collections
//    were guarded by migration 053). Balances, statuses and links stay
//    writable: payments still settle sales, and corrections reverse them.

async function addColumn(knex: Knex, table: string, column: string, sql: string) {
  if (!(await knex.schema.hasColumn(table, column))) {
    await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sql}`);
  }
}

async function guardClosedShiftRows(knex: Knex, table: string, columns: string[]) {
  const closed = `(SELECT status FROM shifts WHERE id = OLD.shift_id) = 'closed'`;
  const changed = columns.map((c) => `NEW."${c}" IS NOT OLD."${c}"`).join(' OR ');
  const message = "A closed shift's records cannot be changed. Correct them instead.";
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_${table}_closed_update
    BEFORE UPDATE OF ${columns.map((c) => `"${c}"`).join(', ')} ON "${table}"
    WHEN ${closed} AND (${changed})
    BEGIN SELECT RAISE(ABORT, "${message}"); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_${table}_closed_delete
    BEFORE DELETE ON "${table}"
    WHEN ${closed}
    BEGIN SELECT RAISE(ABORT, "${message}"); END`);
}

export async function up(knex: Knex): Promise<void> {
  for (const table of ['shift_credits', 'credits', 'credit_payments', 'shift_expenses']) {
    await addColumn(knex, table, 'reversed_by_record_correction_id', 'INTEGER NULL');
    await addColumn(knex, table, 'created_by_record_correction_id', 'INTEGER NULL');
  }
  await addColumn(knex, 'correction_lines', 'method', 'VARCHAR(10) NULL');
  await addColumn(knex, 'correction_lines', 'category', 'VARCHAR(255) NULL');
  await addColumn(knex, 'correction_lines', 'fee_delta', 'DECIMAL(14, 2) NULL');

  await guardClosedShiftRows(knex, 'shift_credits', ['shift_id', 'amount', 'credit_id']);
  await guardClosedShiftRows(knex, 'credits', ['shift_id', 'account_id', 'amount']);
  await guardClosedShiftRows(knex, 'credit_payments', ['shift_id', 'account_id', 'amount', 'payment_method', 'date']);
}

export async function down(): Promise<void> {
  throw new Error('Corrections are part of the financial record. Restore a verified pre-update backup instead.');
}
