import { Knex } from 'knex';

/**
 * Migration 020 — COGS correction audit log
 *
 * Adds an immutable record of every shift-level COGS recalculation (delivery
 * cost correction, FIFO drift fix, etc.) so the owner can always trace a
 * change in historical profit numbers back to who/when/why.
 *
 * Phase 10 of the production-readiness plan.
 *
 * Write path: POST /api/reports/recalculate-cogs inserts one row per
 * (shift_id, tank_id) it touches.
 *
 * Rows are append-only — this table is never updated or deleted from.
 */

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('cogs_corrections');
  if (exists) return;

  await knex.schema.createTable('cogs_corrections', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').unsigned().notNullable()
      .references('id').inTable('shifts');
    t.integer('tank_id').unsigned().notNullable()
      .references('id').inTable('tanks');
    t.decimal('litres_sold', 12, 2).notNullable();
    t.decimal('old_cogs', 14, 2).notNullable();
    t.decimal('new_cogs', 14, 2).notNullable();
    t.decimal('delta_kes', 14, 2).notNullable();
    // employee_id = 0 means the desktop app (which is admin-only by design);
    // any positive value is a mobile-authenticated admin.
    t.integer('corrected_by').notNullable().defaultTo(0);
    t.text('reason').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['shift_id']);
    t.index(['tank_id']);
    t.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cogs_corrections');
}
