import type { Knex } from 'knex';

// M8. The station profile: one record every document's header and footer
// reads (Settings on the desktop). A logo uploaded here replaces the one that
// ships with NexGen; empty means the default.
//
// Stored documents: the PDF of an issued invoice, debit-note bill or credit
// note, saved once and served unchanged ever after, so a reprint years later
// matches the original. Kept in the database, so every backup holds them.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('station_profile'))) {
    await knex.schema.createTable('station_profile', (t) => {
      t.integer('id').primary();
      t.text('trading_name').nullable();
      t.text('registered_name').nullable();
      t.text('physical_address').nullable();
      t.text('postal_address').nullable();
      t.text('phone').nullable();
      t.text('email').nullable();
      t.text('kra_pin').nullable();
      t.text('vat_number').nullable();
      t.text('mpesa_details').nullable();
      t.text('bank_details').nullable();
      t.text('document_footer').nullable();
      t.binary('logo').nullable();
      t.text('logo_mime').nullable();
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.integer('updated_by_employee_id').nullable();
    });
  }
  if (!(await knex('station_profile').where({ id: 1 }).first())) {
    await knex('station_profile').insert({ id: 1 });
  }

  if (!(await knex.schema.hasTable('stored_documents'))) {
    await knex.schema.createTable('stored_documents', (t) => {
      t.increments('id').primary();
      // 'customer_invoice' (invoices and DN- debit-note bills) or 'credit_note'.
      t.string('kind').notNullable();
      t.integer('record_id').notNullable();
      t.string('document_number').notNullable();
      t.binary('content').notNullable();
      t.string('sha256').notNullable();
      t.integer('byte_size').notNullable();
      t.integer('created_by_employee_id').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.unique(['kind', 'record_id']);
    });
  }
}

export async function down(): Promise<void> {
  throw new Error('Issued documents must be preserved. Restore a verified pre-update backup instead.');
}
