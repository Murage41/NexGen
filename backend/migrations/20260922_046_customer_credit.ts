import type { Knex } from 'knex';

// Customer credit on account (services/receivablePayments.ts). When a
// closed-shift correction leaves a customer having paid more than they owe, the
// excess stays on the payment that overpaid (unapplied_amount). It is applied
// to their next credits as they become payable, or refunded. Refunds are their
// own documents, linked to the payments whose credit they paid out.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('credit_payments', 'unapplied_amount'))) {
    await knex.raw('ALTER TABLE "credit_payments" ADD COLUMN "unapplied_amount" DECIMAL(14,2) NOT NULL DEFAULT 0');
  }

  if (!(await knex.schema.hasTable('customer_refunds'))) {
    await knex.schema.createTable('customer_refunds', (table) => {
      table.increments('id').primary();
      table.integer('account_id').unsigned().notNullable()
        .references('id').inTable('credit_accounts').onDelete('RESTRICT');
      table.decimal('amount', 14, 2).notNullable();
      table.string('method').notNullable();
      table.date('refund_date').notNullable();
      table.string('reference').nullable();
      table.string('status').notNullable().defaultTo('posted');
      table.integer('approved_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.string('approved_by_name').nullable();
      table.integer('created_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['account_id', 'refund_date'], 'idx_customer_refunds_account_date');
      table.index(['refund_date'], 'idx_customer_refunds_date');
    });
  }

  if (!(await knex.schema.hasTable('customer_refund_allocations'))) {
    await knex.schema.createTable('customer_refund_allocations', (table) => {
      table.increments('id').primary();
      table.integer('refund_id').unsigned().notNullable()
        .references('id').inTable('customer_refunds').onDelete('RESTRICT');
      table.integer('payment_id').unsigned().notNullable()
        .references('id').inTable('credit_payments').onDelete('RESTRICT');
      table.decimal('amount', 14, 2).notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['refund_id', 'payment_id']);
      table.index('payment_id', 'idx_customer_refund_allocations_payment');
    });
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_credit_payments_unapplied ON credit_payments (account_id, unapplied_amount)',
  );
}

export async function down(): Promise<void> {
  throw new Error(
    'Customer credit and refund history must be preserved. Restore a verified pre-update backup only before new financial activity.',
  );
}
