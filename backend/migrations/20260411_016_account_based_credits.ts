import { Knex } from 'knex';

/**
 * Migration 016 — Account-based credit payments
 *
 * Problem: Credits are currently tracked as individual entries, and payments
 * must be made against specific credit IDs. This migration introduces an
 * account-level balance so payments go against the customer's account total.
 *
 * Changes:
 *   1. credit_accounts.balance — running balance per account (cached, authoritative)
 *   2. credit_payments.payment_type — 'account' (new default) or 'credit' (legacy)
 *
 * Backfill: Compute balance for each customer account from outstanding credit rows.
 *
 * Safety: Additive only. Existing credits, shift_credits, and credit_payments
 * rows are untouched. Individual credit rows remain as line items for shift
 * accountability — the account balance is now the authoritative figure.
 */

export async function up(knex: Knex): Promise<void> {
  // 1. Add balance column to credit_accounts
  if (await knex.schema.hasTable('credit_accounts')) {
    const hasBalance = await knex.schema.hasColumn('credit_accounts', 'balance');
    if (!hasBalance) {
      await knex.schema.alterTable('credit_accounts', (t) => {
        t.decimal('balance', 14, 2).notNullable().defaultTo(0);
      });
    }
  }

  // 2. Add payment_type column to credit_payments AND make credit_id nullable.
  //    SQLite does not support ALTER COLUMN, so we recreate the table.
  if (await knex.schema.hasTable('credit_payments')) {
    const hasType = await knex.schema.hasColumn('credit_payments', 'payment_type');
    if (!hasType) {
      // Recreate credit_payments with credit_id nullable + new payment_type column
      await knex.schema.createTable('credit_payments_new', (t) => {
        t.increments('id').primary();
        t.integer('credit_id').unsigned().nullable().references('id').inTable('credits');
        t.decimal('amount', 14, 2).notNullable();
        t.string('payment_method').notNullable();
        t.date('date').notNullable();
        t.text('notes').nullable();
        t.integer('account_id').unsigned().nullable().references('id').inTable('credit_accounts');
        t.timestamp('deleted_at').nullable();
        t.string('payment_type').notNullable().defaultTo('account');
      });

      // Copy existing data (existing payments are all credit-level, so payment_type = 'credit')
      await knex.raw(`
        INSERT INTO credit_payments_new (id, credit_id, amount, payment_method, date, notes, account_id, deleted_at, payment_type)
        SELECT id, credit_id, amount, payment_method, date, notes, account_id, deleted_at, 'credit'
        FROM credit_payments
      `);

      await knex.schema.dropTable('credit_payments');
      await knex.schema.renameTable('credit_payments_new', 'credit_payments');
    }
  }

  // 3. Backfill credit_accounts.balance from outstanding customer credits
  const customerAccounts: Array<{ id: number }> = await knex('credit_accounts')
    .where({ type: 'customer' })
    .select('id');

  for (const account of customerAccounts) {
    const result = await knex('credits')
      .where({ account_id: account.id })
      .whereNull('deleted_at')
      .whereNot('status', 'paid')
      .sum('balance as total')
      .first();

    const balance = Number((result as any)?.total || 0);
    await knex('credit_accounts').where({ id: account.id }).update({ balance });
  }

  // 4. Backfill employee accounts (balance from staff_debts)
  if (await knex.schema.hasTable('staff_debts')) {
    const employeeAccounts: Array<{ id: number; employee_id: number }> = await knex('credit_accounts')
      .where({ type: 'employee' })
      .select('id', 'employee_id');

    for (const account of employeeAccounts) {
      const result = await knex('staff_debts')
        .where({ employee_id: account.employee_id, status: 'outstanding' })
        .sum('balance as total')
        .first();

      const balance = Number((result as any)?.total || 0);
      await knex('credit_accounts').where({ id: account.id }).update({ balance });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Revert credit_payments: recreate with original schema (credit_id NOT NULL, no payment_type)
  if (await knex.schema.hasTable('credit_payments')) {
    const hasType = await knex.schema.hasColumn('credit_payments', 'payment_type');
    if (hasType) {
      await knex.schema.createTable('credit_payments_old', (t) => {
        t.increments('id').primary();
        t.integer('credit_id').unsigned().notNullable().references('id').inTable('credits');
        t.decimal('amount', 14, 2).notNullable();
        t.string('payment_method').notNullable();
        t.date('date').notNullable();
        t.text('notes').nullable();
        t.integer('account_id').unsigned().nullable().references('id').inTable('credit_accounts');
        t.timestamp('deleted_at').nullable();
      });

      // Only copy rows with non-null credit_id (account-level payments are dropped on rollback)
      await knex.raw(`
        INSERT INTO credit_payments_old (id, credit_id, amount, payment_method, date, notes, account_id, deleted_at)
        SELECT id, credit_id, amount, payment_method, date, notes, account_id, deleted_at
        FROM credit_payments
        WHERE credit_id IS NOT NULL
      `);

      await knex.schema.dropTable('credit_payments');
      await knex.schema.renameTable('credit_payments_old', 'credit_payments');
    }
  }

  if (await knex.schema.hasTable('credit_accounts')) {
    const hasBalance = await knex.schema.hasColumn('credit_accounts', 'balance');
    if (hasBalance) {
      await knex.schema.alterTable('credit_accounts', (t) => {
        t.dropColumn('balance');
      });
    }
  }
}
