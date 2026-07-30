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
  if (await knex.schema.hasTable('credit_accounts')) {
    await addColumnIfMissing(
      knex,
      'credit_accounts',
      'payment_terms_days',
      'INTEGER NOT NULL DEFAULT 0',
    );
  }

  if (await knex.schema.hasTable('customer_invoices')) {
    await addColumnIfMissing(knex, 'customer_invoices', 'due_date', 'TEXT NULL');
    await addColumnIfMissing(
      knex,
      'customer_invoices',
      'retail_baseline_amount',
      'DECIMAL(14,2) NOT NULL DEFAULT 0',
    );
    await addColumnIfMissing(
      knex,
      'customer_invoices',
      'price_adjustment_amount',
      'DECIMAL(14,2) NOT NULL DEFAULT 0',
    );
    await addColumnIfMissing(
      knex,
      'customer_invoices',
      'adjustment_total',
      'DECIMAL(14,2) NOT NULL DEFAULT 0',
    );
    await addColumnIfMissing(knex, 'customer_invoices', 'issued_at', 'TEXT NULL');
    await addColumnIfMissing(knex, 'customer_invoices', 'issued_by_employee_id', 'INTEGER NULL');
    await addColumnIfMissing(knex, 'customer_invoices', 'voided_at', 'TEXT NULL');
    await addColumnIfMissing(knex, 'customer_invoices', 'voided_by_employee_id', 'INTEGER NULL');
    await addColumnIfMissing(knex, 'customer_invoices', 'void_reason', 'TEXT NULL');

    if (
      await knex.schema.hasTable('invoice_lines')
      && await knex.schema.hasTable('invoice_consumption')
    ) {
      await knex.raw(`
        UPDATE customer_invoices
        SET retail_baseline_amount = COALESCE((
          SELECT ROUND(SUM(ic.retail_amount), 2)
          FROM invoice_lines il
          JOIN invoice_consumption ic ON ic.invoice_line_id = il.id
          WHERE il.invoice_id = customer_invoices.id
            AND ic.deleted_at IS NULL
            AND COALESCE(ic.entry_status, 'active') = 'active'
        ), total_amount),
        issued_at = COALESCE(issued_at, issue_date)
        WHERE status <> 'draft'
      `);
      await knex.raw(`
        UPDATE customer_invoices
        SET price_adjustment_amount = ROUND(total_amount - retail_baseline_amount, 2)
        WHERE status <> 'draft'
      `);
    }
    if (await knex.schema.hasTable('credit_accounts')) {
      await knex.raw(`
        UPDATE customer_invoices
        SET due_date = date(
          issue_date,
          '+' || COALESCE((
            SELECT payment_terms_days
            FROM credit_accounts
            WHERE credit_accounts.id = customer_invoices.account_id
          ), 0) || ' days'
        )
        WHERE issue_date IS NOT NULL AND due_date IS NULL
      `);
    }
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_customer_invoices_due_date ON customer_invoices (status, due_date)',
    );
  }

  if (await knex.schema.hasTable('invoice_payments')) {
    await addColumnIfMissing(
      knex,
      'invoice_payments',
      'status',
      "TEXT NOT NULL DEFAULT 'posted'",
    );
    await addColumnIfMissing(knex, 'invoice_payments', 'received_into', 'TEXT NULL');
    await addColumnIfMissing(knex, 'invoice_payments', 'created_by_employee_id', 'INTEGER NULL');
    await addColumnIfMissing(knex, 'invoice_payments', 'reversed_at', 'TEXT NULL');
    await addColumnIfMissing(knex, 'invoice_payments', 'reversed_by_employee_id', 'INTEGER NULL');
    await addColumnIfMissing(knex, 'invoice_payments', 'reversal_reason', 'TEXT NULL');

    await knex.raw(`
      UPDATE invoice_payments
      SET status = CASE WHEN deleted_at IS NULL THEN 'posted' ELSE 'reversed' END,
          received_into = COALESCE(received_into, CASE LOWER(payment_method)
            WHEN 'cash' THEN 'cash_on_hand'
            WHEN 'mpesa' THEN 'mpesa'
            WHEN 'bank' THEN 'bank'
            WHEN 'cheque' THEN 'cheque_clearing'
            ELSE 'other'
          END),
          reversed_at = CASE WHEN deleted_at IS NOT NULL THEN COALESCE(reversed_at, deleted_at) ELSE reversed_at END,
          reversal_reason = CASE
            WHEN deleted_at IS NOT NULL THEN COALESCE(reversal_reason, 'Legacy deleted payment')
            ELSE reversal_reason
          END
    `);
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_invoice_payments_status_date ON invoice_payments (status, payment_date)',
    );
  }

  if (!(await knex.schema.hasTable('invoice_document_sequences'))) {
    await knex.schema.createTable('invoice_document_sequences', (table) => {
      table.string('document_type').notNullable();
      table.date('business_date').notNullable();
      table.integer('last_number').notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.primary(['document_type', 'business_date']);
    });
  }

  if (!(await knex.schema.hasTable('invoice_adjustment_notes'))) {
    await knex.schema.createTable('invoice_adjustment_notes', (table) => {
      table.increments('id').primary();
      table.integer('account_id').unsigned().notNullable()
        .references('id').inTable('credit_accounts').onDelete('RESTRICT');
      table.integer('invoice_id').unsigned().notNullable()
        .references('id').inTable('customer_invoices').onDelete('RESTRICT');
      table.string('note_number').notNullable().unique();
      table.string('note_type').notNullable();
      table.date('note_date').notNullable();
      table.decimal('amount', 14, 2).notNullable();
      table.decimal('signed_amount', 14, 2).notNullable();
      table.string('fuel_type').nullable();
      table.decimal('litres', 12, 2).nullable();
      table.decimal('unit_price', 10, 2).nullable();
      table.text('reason').notNullable();
      table.string('status').notNullable().defaultTo('posted');
      table.integer('created_by_employee_id').nullable();
      table.timestamp('reversed_at').nullable();
      table.integer('reversed_by_employee_id').nullable();
      table.text('reversal_reason').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['invoice_id', 'status'], 'idx_invoice_adjustment_notes_invoice');
      table.index(['account_id', 'note_date'], 'idx_invoice_adjustment_notes_account');
    });
  }

  if (!(await knex.schema.hasTable('invoice_accounting_events'))) {
    await knex.schema.createTable('invoice_accounting_events', (table) => {
      table.increments('id').primary();
      table.string('source_key').notNullable().unique();
      table.integer('account_id').unsigned().notNullable()
        .references('id').inTable('credit_accounts').onDelete('RESTRICT');
      table.integer('invoice_id').unsigned().nullable()
        .references('id').inTable('customer_invoices').onDelete('RESTRICT');
      table.integer('payment_id').unsigned().nullable()
        .references('id').inTable('invoice_payments').onDelete('RESTRICT');
      table.integer('adjustment_note_id').unsigned().nullable()
        .references('id').inTable('invoice_adjustment_notes').onDelete('RESTRICT');
      table.string('event_type').notNullable();
      table.date('posting_date').notNullable();
      table.decimal('receivable_delta', 14, 2).notNullable().defaultTo(0);
      table.decimal('cash_delta', 14, 2).notNullable().defaultTo(0);
      table.decimal('revenue_adjustment', 14, 2).notNullable().defaultTo(0);
      table.decimal('retail_baseline_amount', 14, 2).notNullable().defaultTo(0);
      table.decimal('document_amount', 14, 2).notNullable().defaultTo(0);
      table.string('payment_method').nullable();
      table.string('receiving_account').nullable();
      table.integer('reversal_of_event_id').unsigned().nullable()
        .references('id').inTable('invoice_accounting_events').onDelete('RESTRICT');
      table.text('reason').nullable();
      table.integer('created_by_employee_id').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['account_id', 'posting_date'], 'idx_invoice_accounting_events_account');
      table.index(['event_type', 'posting_date'], 'idx_invoice_accounting_events_type');
      table.index('invoice_id', 'idx_invoice_accounting_events_invoice');
    });
  }

  if (
    await knex.schema.hasTable('invoice_accounting_events')
    && await knex.schema.hasTable('customer_invoices')
  ) {
    await knex.raw(`
      INSERT OR IGNORE INTO invoice_accounting_events (
        source_key, account_id, invoice_id, event_type, posting_date,
        receivable_delta, cash_delta, revenue_adjustment,
        retail_baseline_amount, document_amount, reason, created_at
      )
      SELECT
        'invoice:' || id || ':issue',
        account_id,
        id,
        'invoice_issue',
        issue_date,
        total_amount,
        0,
        price_adjustment_amount,
        retail_baseline_amount,
        total_amount,
        'Historical invoice issue backfill',
        COALESCE(issued_at, created_at)
      FROM customer_invoices
      WHERE status IN ('issued', 'partial', 'paid', 'void')
        AND issue_date IS NOT NULL
    `);
    await knex.raw(`
      INSERT OR IGNORE INTO invoice_accounting_events (
        source_key, account_id, invoice_id, event_type, posting_date,
        receivable_delta, cash_delta, revenue_adjustment,
        retail_baseline_amount, document_amount, reason, created_at
      )
      SELECT
        'invoice:' || id || ':void',
        account_id,
        id,
        'invoice_void',
        COALESCE(date(voided_at), issue_date),
        -total_amount,
        0,
        -price_adjustment_amount,
        -retail_baseline_amount,
        -total_amount,
        COALESCE(void_reason, 'Historical void backfill'),
        COALESCE(voided_at, created_at)
      FROM customer_invoices
      WHERE status = 'void' AND issue_date IS NOT NULL
    `);
  }

  if (
    await knex.schema.hasTable('invoice_accounting_events')
    && await knex.schema.hasTable('invoice_payments')
  ) {
    await knex.raw(`
      INSERT OR IGNORE INTO invoice_accounting_events (
        source_key, account_id, payment_id, event_type, posting_date,
        receivable_delta, cash_delta, revenue_adjustment,
        retail_baseline_amount, document_amount, payment_method,
        receiving_account, reason, created_at
      )
      SELECT
        'payment:' || id || ':posted',
        account_id,
        id,
        'invoice_payment',
        payment_date,
        -amount,
        amount,
        0,
        0,
        amount,
        payment_method,
        received_into,
        'Historical invoice payment backfill',
        created_at
      FROM invoice_payments
    `);
    await knex.raw(`
      INSERT OR IGNORE INTO invoice_accounting_events (
        source_key, account_id, payment_id, event_type, posting_date,
        receivable_delta, cash_delta, revenue_adjustment,
        retail_baseline_amount, document_amount, payment_method,
        receiving_account, reversal_of_event_id, reason, created_at
      )
      SELECT
        'payment:' || p.id || ':reversal',
        p.account_id,
        p.id,
        'invoice_payment_reversal',
        COALESCE(date(p.reversed_at), p.payment_date),
        p.amount,
        -p.amount,
        0,
        0,
        -p.amount,
        p.payment_method,
        p.received_into,
        e.id,
        COALESCE(p.reversal_reason, 'Historical payment reversal'),
        COALESCE(p.reversed_at, p.created_at)
      FROM invoice_payments p
      JOIN invoice_accounting_events e
        ON e.source_key = 'payment:' || p.id || ':posted'
      WHERE p.status = 'reversed'
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('invoice_accounting_events');
  await knex.schema.dropTableIfExists('invoice_adjustment_notes');
  await knex.schema.dropTableIfExists('invoice_document_sequences');
  // Additive columns are retained to avoid rebuilding populated SQLite tables.
}
