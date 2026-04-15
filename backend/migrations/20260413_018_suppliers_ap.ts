import { Knex } from 'knex';

/**
 * Migration 018 — Suppliers & Accounts Payable
 *
 * Creates:
 *   1. suppliers — master supplier table
 *   2. supplier_invoices — AP invoices (linked to deliveries)
 *   3. supplier_payments — payments against invoices
 *   4. fuel_deliveries.supplier_id — FK to suppliers
 *
 * Backfill:
 *   - Creates "Mache" supplier from existing delivery data
 *   - Links all existing deliveries to Mache
 *   - Creates paid invoices for historical deliveries
 */

export async function up(knex: Knex): Promise<void> {
  // 1. Suppliers master table
  if (!(await knex.schema.hasTable('suppliers'))) {
    await knex.schema.createTable('suppliers', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
      t.string('phone').nullable();
      t.string('email').nullable();
      t.text('address').nullable();
      t.string('bank_name').nullable();
      t.string('bank_account').nullable();
      t.integer('payment_terms_days').notNullable().defaultTo(0); // 0 = COD
      t.text('notes').nullable();
      t.integer('active').notNullable().defaultTo(1);
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 2. Supplier invoices (AP)
  if (!(await knex.schema.hasTable('supplier_invoices'))) {
    await knex.schema.createTable('supplier_invoices', (t) => {
      t.increments('id').primary();
      t.integer('supplier_id').unsigned().notNullable().references('id').inTable('suppliers');
      t.string('invoice_number').nullable();
      t.integer('delivery_id').unsigned().nullable().references('id').inTable('fuel_deliveries');
      t.decimal('amount', 14, 2).notNullable();
      t.string('due_date').nullable();
      t.string('status').notNullable().defaultTo('unpaid'); // unpaid, partial, paid
      t.decimal('balance', 14, 2).notNullable();
      t.text('notes').nullable();
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Supplier payments
  if (!(await knex.schema.hasTable('supplier_payments'))) {
    await knex.schema.createTable('supplier_payments', (t) => {
      t.increments('id').primary();
      t.integer('supplier_id').unsigned().notNullable().references('id').inTable('suppliers');
      t.integer('invoice_id').unsigned().nullable().references('id').inTable('supplier_invoices');
      t.decimal('amount', 14, 2).notNullable();
      t.string('payment_method').notNullable().defaultTo('bank_transfer');
      t.string('payment_date').notNullable();
      t.string('reference').nullable(); // cheque no, mpesa code, etc.
      t.text('notes').nullable();
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 4. Add supplier_id FK to fuel_deliveries
  if (await knex.schema.hasTable('fuel_deliveries')) {
    const hasCol = await knex.schema.hasColumn('fuel_deliveries', 'supplier_id');
    if (!hasCol) {
      await knex.schema.alterTable('fuel_deliveries', (t) => {
        t.integer('supplier_id').unsigned().nullable().references('id').inTable('suppliers');
      });
    }
  }

  // ── Backfill: create "Mache" supplier and link existing deliveries ──
  const existingDeliveries = await knex('fuel_deliveries').whereNull('deleted_at');
  if (existingDeliveries.length > 0) {
    // Check if Mache already exists (idempotent)
    let mache = await knex('suppliers').where('name', 'Mache').first();
    if (!mache) {
      const [macheId] = await knex('suppliers').insert({
        name: 'Mache',
        payment_terms_days: 0,
        active: 1,
        notes: 'Auto-created from historical delivery data',
      });
      mache = { id: macheId };
    }

    // Link all deliveries with no supplier_id to Mache
    await knex('fuel_deliveries')
      .whereNull('supplier_id')
      .whereNull('deleted_at')
      .update({ supplier_id: mache.id });

    // Create paid invoices for historical deliveries that don't have one yet
    for (const d of existingDeliveries) {
      const existingInvoice = await knex('supplier_invoices')
        .where('delivery_id', d.id)
        .first();
      if (!existingInvoice) {
        await knex('supplier_invoices').insert({
          supplier_id: mache.id,
          delivery_id: d.id,
          amount: Number(d.total_cost) || (Number(d.litres) * Number(d.cost_per_litre)),
          balance: 0,
          status: 'paid',
          due_date: d.date,
          notes: 'Historical delivery — auto-created as paid',
        });
      }
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove supplier_id from fuel_deliveries
  if (await knex.schema.hasTable('fuel_deliveries')) {
    const hasCol = await knex.schema.hasColumn('fuel_deliveries', 'supplier_id');
    if (hasCol) {
      await knex.schema.alterTable('fuel_deliveries', (t) => {
        t.dropColumn('supplier_id');
      });
    }
  }

  await knex.schema.dropTableIfExists('supplier_payments');
  await knex.schema.dropTableIfExists('supplier_invoices');
  await knex.schema.dropTableIfExists('suppliers');
}
