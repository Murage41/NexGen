import { Knex } from 'knex';

/**
 * Migration 019 — Link credit payments to shifts
 *
 * Adds shift_id (nullable FK) to credit_payments so that debt collected
 * during an open shift is traceable back to that shift.
 *
 * When a customer pays their credit during a shift:
 *   - credit_payments.shift_id = that shift's id
 *   - shift_collections.cash_amount (or mpesa_amount) is incremented
 *   - The shift accountability report can then separate "today's sales" from
 *     "old debt collected today" — preventing confusion over positive variance.
 *
 * Additive only — all existing rows get shift_id = NULL (no change to behaviour).
 */

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('credit_payments')) {
    const hasCol = await knex.schema.hasColumn('credit_payments', 'shift_id');
    if (!hasCol) {
      await knex.schema.alterTable('credit_payments', (t) => {
        t.integer('shift_id').unsigned().nullable().references('id').inTable('shifts');
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('credit_payments')) {
    const hasCol = await knex.schema.hasColumn('credit_payments', 'shift_id');
    if (hasCol) {
      await knex.schema.alterTable('credit_payments', (t) => {
        t.dropColumn('shift_id');
      });
    }
  }
}
