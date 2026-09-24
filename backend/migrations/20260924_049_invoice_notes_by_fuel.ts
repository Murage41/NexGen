import type { Knex } from 'knex';

// Invoice credit and debit notes carry fuel, litres and a price per litre, like
// the invoice they correct (services/invoiceAdjustments.ts). Invoice customers
// take fuel on account; a correction is always "this much of this fuel at this
// price", never a bare amount.
//
// - A credit note reduces its own invoice by what is still unpaid on it
//   (applied_amount). Anything beyond that is the customer's credit
//   (unapplied_amount): it pays their open invoices, then the next one issued,
//   through invoice_credit_applications. It is never paid out.
// - A debit note is its own bill (customer_invoices.document_kind
//   'debit_note'), with fuel lines, due date and payments like an invoice,
//   referring to the invoice it corrects or the shift the fuel came from.
// Notes posted before this keep working: a credit note was never more than
// the invoice's unpaid balance, so it was applied in full.

export async function up(knex: Knex): Promise<void> {
  const addColumn = async (table: string, column: string, sql: string) => {
    if (!(await knex.schema.hasColumn(table, column))) {
      await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sql}`);
    }
  };
  // litres | price: what was wrong.
  await addColumn('invoice_adjustment_notes', 'correction', 'TEXT NULL');
  await addColumn('invoice_adjustment_notes', 'applied_amount', 'DECIMAL(14,2) NULL');
  await addColumn('invoice_adjustment_notes', 'unapplied_amount', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await addColumn('invoice_adjustment_notes', 'shift_id', 'INTEGER NULL');
  await addColumn('invoice_adjustment_notes', 'approved_by_employee_id', 'INTEGER NULL');
  await addColumn('invoice_adjustment_notes', 'approved_by_name', 'TEXT NULL');
  await knex('invoice_adjustment_notes')
    .where({ note_type: 'credit_note' })
    .whereNull('applied_amount')
    .update({ applied_amount: knex.raw('amount') });

  // invoice | debit_note
  await addColumn('customer_invoices', 'document_kind', "TEXT NOT NULL DEFAULT 'invoice'");
  await addColumn('customer_invoices', 'reason', 'TEXT NULL');
  await addColumn('customer_invoices', 'shift_id', 'INTEGER NULL');
  await addColumn('customer_invoices', 'corrects_invoice_id', 'INTEGER NULL');
  await addColumn('customer_invoices', 'approved_by_employee_id', 'INTEGER NULL');
  await addColumn('customer_invoices', 'approved_by_name', 'TEXT NULL');

  if (!(await knex.schema.hasTable('invoice_credit_applications'))) {
    await knex.schema.createTable('invoice_credit_applications', (table) => {
      table.increments('id').primary();
      table.integer('note_id').unsigned().notNullable()
        .references('id').inTable('invoice_adjustment_notes').onDelete('RESTRICT');
      table.integer('invoice_id').unsigned().notNullable()
        .references('id').inTable('customer_invoices').onDelete('RESTRICT');
      table.decimal('amount', 14, 2).notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('reversed_at').nullable();
      table.index(['invoice_id'], 'idx_invoice_credit_applications_invoice');
      table.index(['note_id'], 'idx_invoice_credit_applications_note');
    });
  }
}

export async function down(): Promise<void> {
  throw new Error(
    'Invoice note history must be preserved. Restore a verified pre-update backup only before new financial activity.',
  );
}
