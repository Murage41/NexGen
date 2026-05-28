import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('fuel_deliveries')) {
    if (!(await knex.schema.hasColumn('fuel_deliveries', 'invoice_number'))) {
      await knex.schema.alterTable('fuel_deliveries', (t) => {
        t.string('invoice_number').nullable();
      });
    }
    if (!(await knex.schema.hasColumn('fuel_deliveries', 'invoice_file_name'))) {
      await knex.schema.alterTable('fuel_deliveries', (t) => {
        t.string('invoice_file_name').nullable();
      });
    }
    if (!(await knex.schema.hasColumn('fuel_deliveries', 'invoice_file_path'))) {
      await knex.schema.alterTable('fuel_deliveries', (t) => {
        t.text('invoice_file_path').nullable();
      });
    }
    if (!(await knex.schema.hasColumn('fuel_deliveries', 'invoice_uploaded_at'))) {
      await knex.schema.alterTable('fuel_deliveries', (t) => {
        t.timestamp('invoice_uploaded_at').nullable();
      });
    }
  }

  if (await knex.schema.hasTable('supplier_invoices')) {
    if (!(await knex.schema.hasColumn('supplier_invoices', 'invoice_file_name'))) {
      await knex.schema.alterTable('supplier_invoices', (t) => {
        t.string('invoice_file_name').nullable();
      });
    }
    if (!(await knex.schema.hasColumn('supplier_invoices', 'invoice_file_path'))) {
      await knex.schema.alterTable('supplier_invoices', (t) => {
        t.text('invoice_file_path').nullable();
      });
    }
    if (!(await knex.schema.hasColumn('supplier_invoices', 'invoice_uploaded_at'))) {
      await knex.schema.alterTable('supplier_invoices', (t) => {
        t.timestamp('invoice_uploaded_at').nullable();
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('supplier_invoices')) {
    if (await knex.schema.hasColumn('supplier_invoices', 'invoice_uploaded_at')) {
      await knex.schema.alterTable('supplier_invoices', (t) => t.dropColumn('invoice_uploaded_at'));
    }
    if (await knex.schema.hasColumn('supplier_invoices', 'invoice_file_path')) {
      await knex.schema.alterTable('supplier_invoices', (t) => t.dropColumn('invoice_file_path'));
    }
    if (await knex.schema.hasColumn('supplier_invoices', 'invoice_file_name')) {
      await knex.schema.alterTable('supplier_invoices', (t) => t.dropColumn('invoice_file_name'));
    }
  }

  if (await knex.schema.hasTable('fuel_deliveries')) {
    if (await knex.schema.hasColumn('fuel_deliveries', 'invoice_uploaded_at')) {
      await knex.schema.alterTable('fuel_deliveries', (t) => t.dropColumn('invoice_uploaded_at'));
    }
    if (await knex.schema.hasColumn('fuel_deliveries', 'invoice_file_path')) {
      await knex.schema.alterTable('fuel_deliveries', (t) => t.dropColumn('invoice_file_path'));
    }
    if (await knex.schema.hasColumn('fuel_deliveries', 'invoice_file_name')) {
      await knex.schema.alterTable('fuel_deliveries', (t) => t.dropColumn('invoice_file_name'));
    }
    if (await knex.schema.hasColumn('fuel_deliveries', 'invoice_number')) {
      await knex.schema.alterTable('fuel_deliveries', (t) => t.dropColumn('invoice_number'));
    }
  }
}
