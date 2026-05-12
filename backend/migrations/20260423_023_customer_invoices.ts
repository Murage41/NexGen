import { Knex } from 'knex';

/**
 * Migration 023 — Customer Invoicing (AR Phase 3)
 *
 * Introduces invoice-mode customers (e.g. Diwafa, Mugendi Stores) who take
 * fuel on a running tab and are billed periodically at a negotiated price.
 *
 * Changes:
 *   1. credit_accounts.billing_mode — 'money' (existing behavior) or 'invoice'
 *   2. invoice_consumption — per-shift-per-fuel-type litre ledger (retail-priced for shift balance)
 *   3. customer_invoices — invoice header with draft→issued→paid lifecycle
 *   4. invoice_lines — per-fuel-type rollup with editable agreed_price
 *   5. invoice_payments + invoice_payment_allocations — payments with FIFO trail
 *
 * No data backfill. Existing `credits`/`credit_payments` remain untouched —
 * `billing_mode` defaults to 'money', which is the current behavior.
 */

export async function up(knex: Knex): Promise<void> {
  // 1. billing_mode on credit_accounts
  if (await knex.schema.hasTable('credit_accounts')) {
    const hasCol = await knex.schema.hasColumn('credit_accounts', 'billing_mode');
    if (!hasCol) {
      await knex.schema.alterTable('credit_accounts', (t) => {
        t.string('billing_mode').notNullable().defaultTo('money'); // 'money' | 'invoice'
      });
    }
  }

  // 2. invoice_consumption — the litre ledger
  if (!(await knex.schema.hasTable('invoice_consumption'))) {
    await knex.schema.createTable('invoice_consumption', (t) => {
      t.increments('id').primary();
      t.integer('account_id').unsigned().notNullable().references('id').inTable('credit_accounts');
      t.integer('shift_id').unsigned().notNullable().references('id').inTable('shifts');
      t.integer('tank_id').unsigned().nullable().references('id').inTable('tanks');
      t.string('fuel_type').notNullable(); // 'petrol' | 'diesel'
      t.decimal('litres', 12, 2).notNullable();
      t.decimal('retail_price_at_time', 10, 2).notNullable();
      t.decimal('retail_amount', 14, 2).notNullable(); // litres × retail_price (shift balance only)
      t.integer('invoice_line_id').unsigned().nullable().references('id').inTable('invoice_lines');
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['account_id', 'shift_id']);
      t.index('invoice_line_id');
    });
  }

  // 3. customer_invoices — header
  if (!(await knex.schema.hasTable('customer_invoices'))) {
    await knex.schema.createTable('customer_invoices', (t) => {
      t.increments('id').primary();
      t.integer('account_id').unsigned().notNullable().references('id').inTable('credit_accounts');
      t.string('invoice_number').notNullable().unique(); // CINV-YYYYMMDD-NNN
      t.date('from_date').notNullable();
      t.date('to_date').notNullable();
      t.date('issue_date').nullable(); // NULL while draft
      t.string('status').notNullable().defaultTo('draft'); // draft|issued|partial|paid|void
      t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('balance', 14, 2).notNullable().defaultTo(0);
      t.text('notes').nullable();
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['account_id', 'status']);
      t.index('issue_date');
    });
  }

  // 4. invoice_lines — per-fuel-type rollup
  if (!(await knex.schema.hasTable('invoice_lines'))) {
    await knex.schema.createTable('invoice_lines', (t) => {
      t.increments('id').primary();
      t.integer('invoice_id').unsigned().notNullable().references('id').inTable('customer_invoices').onDelete('CASCADE');
      t.string('fuel_type').notNullable();
      t.decimal('total_litres', 12, 2).notNullable();
      t.decimal('agreed_price', 10, 2).notNullable();
      t.decimal('line_total', 14, 2).notNullable();
      t.index('invoice_id');
    });
  }

  // 5. invoice_payments
  if (!(await knex.schema.hasTable('invoice_payments'))) {
    await knex.schema.createTable('invoice_payments', (t) => {
      t.increments('id').primary();
      t.integer('account_id').unsigned().notNullable().references('id').inTable('credit_accounts');
      t.decimal('amount', 14, 2).notNullable();
      t.string('payment_method').notNullable(); // cash | mpesa | bank
      t.date('payment_date').notNullable();
      t.string('reference').nullable();
      t.text('notes').nullable();
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['account_id', 'payment_date']);
    });
  }

  // 6. invoice_payment_allocations — FIFO trail
  if (!(await knex.schema.hasTable('invoice_payment_allocations'))) {
    await knex.schema.createTable('invoice_payment_allocations', (t) => {
      t.increments('id').primary();
      t.integer('payment_id').unsigned().notNullable().references('id').inTable('invoice_payments').onDelete('CASCADE');
      t.integer('invoice_id').unsigned().notNullable().references('id').inTable('customer_invoices');
      t.decimal('amount_applied', 14, 2).notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index('payment_id');
      t.index('invoice_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('invoice_payment_allocations');
  await knex.schema.dropTableIfExists('invoice_payments');
  await knex.schema.dropTableIfExists('invoice_lines');
  await knex.schema.dropTableIfExists('customer_invoices');
  await knex.schema.dropTableIfExists('invoice_consumption');

  if (await knex.schema.hasTable('credit_accounts')) {
    const hasCol = await knex.schema.hasColumn('credit_accounts', 'billing_mode');
    if (hasCol) {
      await knex.schema.alterTable('credit_accounts', (t) => {
        t.dropColumn('billing_mode');
      });
    }
  }
}
