import { Knex } from 'knex';

/**
 * Migration 022 — Delivery timestamp for sub-day ordering
 *
 * Problem: computeBookStock previously used date-level granularity to decide
 * whether a delivery had been received. When a pre-delivery dip, the delivery
 * itself, and a post-delivery dip all shared the same calendar date, the
 * pre-delivery dip's book_stock was polluted by the subsequent delivery —
 * producing phantom variances equal to the delivery volume.
 *
 * Fix: add `delivery_timestamp` (nullable TEXT) storing the effective
 * real-world delivery time. If null, queries fall back to `created_at`.
 * The delivery POST accepts an optional HH:MM field; if not provided,
 * delivery_timestamp defaults to the current moment.
 */

export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('fuel_deliveries', 'delivery_timestamp');
  if (!hasCol) {
    await knex.schema.alterTable('fuel_deliveries', (t) => {
      t.text('delivery_timestamp').nullable();
    });
  }

  // Backfill: for existing rows, set delivery_timestamp = created_at so
  // the new timestamp-aware logic has something better than null to compare.
  await knex.raw(`
    UPDATE fuel_deliveries
    SET delivery_timestamp = created_at
    WHERE delivery_timestamp IS NULL
      AND deleted_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('fuel_deliveries', 'delivery_timestamp');
  if (hasCol) {
    await knex.schema.alterTable('fuel_deliveries', (t) => {
      t.dropColumn('delivery_timestamp');
    });
  }
}
