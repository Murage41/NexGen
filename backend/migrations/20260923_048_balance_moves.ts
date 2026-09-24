import type { Knex } from 'knex';

// Balance moves (services/balanceMoves.ts). A closed shift is never changed. A
// mistake found on one means money sits on the wrong account, so it is fixed by
// moving an amount from one account to another: a customer, an employee, or the
// station itself (which takes the loss or keeps the gain). Both sides always
// match, like a journal entry. Each side is posted as that ledger's own row
// (a credit, a non-cash payment, or a variance entry) so balances, credit on
// account and repayments work unchanged. No money moves: cash reports leave
// moves out. A move is never edited; a wrong one is moved back.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('balance_moves'))) {
    await knex.schema.createTable('balance_moves', (table) => {
      table.increments('id').primary();
      table.decimal('amount', 14, 2).notNullable();
      table.date('posting_date').notNullable();
      table.text('reason').notNullable();
      // The closed shift the mistake was on, for reference only.
      table.integer('shift_id').unsigned().nullable()
        .references('id').inTable('shifts').onDelete('RESTRICT');
      // customer | employee | station. The "from" side ends up owing less,
      // the "to" side owing more.
      table.string('from_kind').notNullable();
      table.integer('from_id').unsigned().nullable();
      table.string('from_name').notNullable();
      table.string('to_kind').notNullable();
      table.integer('to_id').unsigned().nullable();
      table.string('to_name').notNullable();
      table.integer('approved_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.string('approved_by_name').nullable();
      table.integer('created_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['posting_date'], 'idx_balance_moves_date');
      table.index(['shift_id'], 'idx_balance_moves_shift');
    });
  }
  // Each side's own row points back at its move.
  if (!(await knex.schema.hasColumn('credits', 'move_id'))) {
    await knex.raw('ALTER TABLE "credits" ADD COLUMN "move_id" INTEGER NULL');
  }
  // A moved credit is posted today (created_at) but the debt dates from the
  // shift the mistake was on: credit age limits and aging read this date, the
  // way an ERP separates a document's posting date from its document date.
  if (!(await knex.schema.hasColumn('credits', 'origin_date'))) {
    await knex.raw('ALTER TABLE "credits" ADD COLUMN "origin_date" DATE NULL');
  }
  if (!(await knex.schema.hasColumn('credit_payments', 'move_id'))) {
    await knex.raw('ALTER TABLE "credit_payments" ADD COLUMN "move_id" INTEGER NULL');
  }
  if (!(await knex.schema.hasColumn('employee_variance_entries', 'move_id'))) {
    await knex.raw('ALTER TABLE "employee_variance_entries" ADD COLUMN "move_id" INTEGER NULL');
  }
}

export async function down(): Promise<void> {
  throw new Error(
    'Balance moves must be preserved. Restore a verified pre-update backup only before new financial activity.',
  );
}
