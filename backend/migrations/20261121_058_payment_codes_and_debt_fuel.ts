import type { Knex } from 'knex';

// Update #28 (docs/ROADMAP.md, item 6). Debt payments get a transaction code
// (M-Pesa or bank), like the other payment tables already have; a shift's
// credit sale keeps the fuel, litres and pump price it was sold at, so a debt
// can be entered in litres or amount. All new columns are optional: old rows
// stay as recorded.
async function addColumn(knex: Knex, table: string, column: string, sql: string) {
  if (await knex.schema.hasTable(table) && !(await knex.schema.hasColumn(table, column))) {
    await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sql}`);
  }
}

export async function up(knex: Knex): Promise<void> {
  await addColumn(knex, 'credit_payments', 'reference', 'VARCHAR(255) NULL');
  await addColumn(knex, 'shift_credits', 'fuel_type', 'VARCHAR(20) NULL');
  await addColumn(knex, 'shift_credits', 'litres', 'DECIMAL(12,3) NULL');
  await addColumn(knex, 'shift_credits', 'unit_price', 'DECIMAL(10,2) NULL');
}

export async function down(): Promise<void> {
  throw new Error('Payment codes and debt fuel cannot be rolled back. Restore a verified pre-update backup instead.');
}
