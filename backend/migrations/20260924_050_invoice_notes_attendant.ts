import type { Knex } from 'knex';

// An invoice note can name the attendant of its shift (services/
// invoiceAdjustments.ts): fuel recorded on an invoice customer to cover a
// drawer shortage, or a customer's fuel that was never recorded and left the
// drawer short. The attendant's shortage on that shift changes by the litres
// at the shift's pump price, as a 'correction' entry linked to the note, so
// reversing the note (or voiding the debit note) reverses it too.

export async function up(knex: Knex): Promise<void> {
  const addColumn = async (table: string, column: string, sql: string) => {
    if (!(await knex.schema.hasColumn(table, column))) {
      await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sql}`);
    }
  };
  // A credit note (invoice_adjustment_notes), or a debit note's own bill
  // (customer_invoices, document_kind 'debit_note').
  await addColumn('employee_variance_entries', 'invoice_note_id', 'INTEGER NULL REFERENCES invoice_adjustment_notes(id)');
  await addColumn('employee_variance_entries', 'invoice_id', 'INTEGER NULL REFERENCES customer_invoices(id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_variance_entries_invoice_note ON employee_variance_entries (invoice_note_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_variance_entries_invoice ON employee_variance_entries (invoice_id)');
}

export async function down(): Promise<void> {
  throw new Error(
    'Attendant corrections must be preserved. Restore a verified pre-update backup only before new financial activity.',
  );
}
