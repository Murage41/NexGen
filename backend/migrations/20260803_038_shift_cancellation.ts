import type { Knex } from 'knex';

async function addColumnIfMissing(
  knex: Knex,
  table: string,
  column: string,
  definition: string,
) {
  if (!(await knex.schema.hasColumn(table, column))) {
    await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  }
}

type CreditRow = {
  id: number;
  account_id: number | null;
  amount: number;
  balance: number;
  created_at: string | null;
};

type PaymentRow = {
  id: number;
  credit_id: number | null;
  account_id: number | null;
  amount: number;
};

function cents(value: unknown): number {
  return Math.round(Number(value || 0) * 100);
}

async function backfillCreditPaymentAllocations(knex: Knex) {
  const existing = await knex('credit_payment_allocations').count('* as count').first();
  if (Number(existing?.count || 0) > 0) return;

  const credits = await knex<CreditRow>('credits')
    .whereNull('deleted_at')
    .select('id', 'account_id', 'amount', 'balance', 'created_at')
    .orderBy('created_at')
    .orderBy('id');
  const payments = await knex<PaymentRow>('credit_payments')
    .whereNull('deleted_at')
    .where({ status: 'posted' })
    .select('id', 'credit_id', 'account_id', 'amount')
    .orderBy('id');

  const remaining = new Map(credits.map((credit) => [Number(credit.id), cents(credit.amount)]));
  const creditById = new Map(credits.map((credit) => [Number(credit.id), credit]));
  const creditsByAccount = new Map<number, CreditRow[]>();
  for (const credit of credits) {
    if (!credit.account_id) continue;
    const rows = creditsByAccount.get(Number(credit.account_id)) || [];
    rows.push(credit);
    creditsByAccount.set(Number(credit.account_id), rows);
  }

  for (const payment of payments) {
    let amountLeft = cents(payment.amount);
    const candidates = payment.credit_id
      ? [creditById.get(Number(payment.credit_id))].filter(Boolean) as CreditRow[]
      : creditsByAccount.get(Number(payment.account_id)) || [];

    for (const credit of candidates) {
      if (amountLeft <= 0) break;
      const available = remaining.get(Number(credit.id)) || 0;
      if (available <= 0) continue;
      const applied = Math.min(amountLeft, available);
      await knex('credit_payment_allocations').insert({
        payment_id: payment.id,
        credit_id: credit.id,
        amount_applied: applied / 100,
      });
      remaining.set(Number(credit.id), available - applied);
      amountLeft -= applied;
    }

    if (amountLeft > 0) {
      throw new Error(
        `Cannot backfill payment ${payment.id}: KES ${(amountLeft / 100).toFixed(2)} has no matching credit balance. Run the receivables audit before migrating.`,
      );
    }
  }

  for (const credit of credits) {
    const calculated = remaining.get(Number(credit.id)) || 0;
    const stored = cents(credit.balance);
    if (calculated !== stored) {
      throw new Error(
        `Cannot backfill credit ${credit.id}: stored balance KES ${(stored / 100).toFixed(2)} differs from payment history KES ${(calculated / 100).toFixed(2)}. Run the receivables audit before migrating.`,
      );
    }
  }
}

export async function up(knex: Knex): Promise<void> {
  await addColumnIfMissing(knex, 'shifts', 'cancelled_at', 'TEXT NULL');
  await addColumnIfMissing(knex, 'shifts', 'cancelled_by_employee_id', 'INTEGER NULL');
  await addColumnIfMissing(knex, 'shifts', 'cancellation_reason', 'TEXT NULL');

  await addColumnIfMissing(knex, 'credit_payments', 'status', "TEXT NOT NULL DEFAULT 'posted'");
  await addColumnIfMissing(knex, 'credit_payments', 'reversed_at', 'TEXT NULL');
  await addColumnIfMissing(knex, 'credit_payments', 'reversed_by_employee_id', 'INTEGER NULL');
  await addColumnIfMissing(knex, 'credit_payments', 'reversal_reason', 'TEXT NULL');

  if (!(await knex.schema.hasTable('credit_payment_allocations'))) {
    await knex.schema.createTable('credit_payment_allocations', (table) => {
      table.increments('id').primary();
      table.integer('payment_id').unsigned().notNullable()
        .references('id').inTable('credit_payments').onDelete('RESTRICT');
      table.integer('credit_id').unsigned().notNullable()
        .references('id').inTable('credits').onDelete('RESTRICT');
      table.decimal('amount_applied', 14, 2).notNullable();
      table.timestamp('reversed_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['payment_id', 'reversed_at'], 'idx_credit_payment_allocations_payment');
      table.index(['credit_id', 'reversed_at'], 'idx_credit_payment_allocations_credit');
    });
  }

  if (!(await knex.schema.hasTable('shift_staff_debt_allocations'))) {
    await knex.schema.createTable('shift_staff_debt_allocations', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').unsigned().notNullable()
        .references('id').inTable('shifts').onDelete('RESTRICT');
      table.integer('wage_deduction_id').unsigned().nullable()
        .references('id').inTable('wage_deductions').onDelete('RESTRICT');
      table.integer('staff_debt_id').unsigned().notNullable()
        .references('id').inTable('staff_debts').onDelete('RESTRICT');
      table.decimal('amount', 14, 2).notNullable();
      table.timestamp('reversed_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['shift_id', 'reversed_at'], 'idx_shift_staff_debt_allocations_shift');
    });
  }

  await backfillCreditPaymentAllocations(knex);
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_shifts_status_cancelled ON shifts (status, cancelled_at, id)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_credit_payments_shift_status ON credit_payments (shift_id, status, id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_credit_payments_shift_status');
  await knex.raw('DROP INDEX IF EXISTS idx_shifts_status_cancelled');
  await knex.schema.dropTableIfExists('shift_staff_debt_allocations');
  await knex.schema.dropTableIfExists('credit_payment_allocations');
  // Additive columns are retained to avoid rebuilding populated SQLite tables.
}
