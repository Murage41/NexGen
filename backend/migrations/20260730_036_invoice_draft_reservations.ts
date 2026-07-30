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
  if (!(await knex.schema.hasTable('customer_invoices'))) return;

  // Additive ALTER statements keep this migration safe for populated station
  // databases and avoid SQLite's table-copy implementation of alterTable.
  await addColumnIfMissing(
    knex,
    'customer_invoices',
    'reservation_status',
    "TEXT NOT NULL DEFAULT 'legacy_unreserved'",
  );
  await addColumnIfMissing(knex, 'customer_invoices', 'reserved_at', 'TEXT NULL');
  await addColumnIfMissing(knex, 'customer_invoices', 'reservation_updated_at', 'TEXT NULL');

  if (await knex.schema.hasTable('invoice_consumption')) {
    await knex.raw(`
      UPDATE customer_invoices
      SET reservation_status = CASE
        WHEN status = 'draft' AND EXISTS (
          SELECT 1
          FROM invoice_lines il
          JOIN invoice_consumption ic ON ic.invoice_line_id = il.id
          WHERE il.invoice_id = customer_invoices.id
        ) THEN 'reserved'
        WHEN status = 'draft' THEN 'legacy_unreserved'
        WHEN status = 'void' THEN 'released'
        ELSE 'issued'
      END
    `);
    await knex.raw(`
      UPDATE customer_invoices
      SET reserved_at = COALESCE(reserved_at, created_at),
          reservation_updated_at = COALESCE(reservation_updated_at, created_at)
      WHERE reservation_status IN ('reserved', 'issued')
    `);
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_customer_invoices_reservation ON customer_invoices (status, reservation_status)',
  );
}

export async function down(_knex: Knex): Promise<void> {
  // Columns are intentionally retained on rollback. Removing columns would
  // rebuild customer_invoices and risk populated station data.
}
