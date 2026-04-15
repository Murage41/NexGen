import { Knex } from 'knex';

/**
 * Phase 1 — Quick Wins: Financial Accuracy & Regulatory Compliance
 *
 * 1A. M-Pesa settlement fee tracking (0.55% Lipa na M-Pesa Buy Goods)
 *     - New: mpesa_fee_config table (admin-editable fee rate)
 *     - New: shift_collections.mpesa_fee, shift_collections.mpesa_net
 *
 * 1B. EPRA price ceiling enforcement
 *     - New: fuel_prices.epra_max_price, fuel_prices.epra_effective_date, fuel_prices.source
 *
 * 1C. Tank variance categorization (shrinkage accounting)
 *     - New: tank_dips.variance_category, tank_dips.variance_notes
 *
 * Risk: NONE — all changes are additive. New columns default to null/0.
 * Backfill: mpesa_fee and mpesa_net are backfilled for historical collections
 * using the 0.55% default rate so MTD fee totals are accurate immediately.
 */
export async function up(knex: Knex): Promise<void> {
  // ---- 1A. M-Pesa fee config + collection columns ----

  if (!(await knex.schema.hasTable('mpesa_fee_config'))) {
    await knex.schema.createTable('mpesa_fee_config', (t) => {
      t.increments('id').primary();
      t.string('fee_type').notNullable().defaultTo('percentage'); // 'percentage' or 'fixed'
      t.decimal('fee_value', 10, 4).notNullable().defaultTo(0.55); // 0.55% default
      t.string('effective_date').notNullable();
      t.text('notes').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });

    // Seed the default fee rate (0.55% for Lipa na M-Pesa Buy Goods)
    await knex('mpesa_fee_config').insert({
      fee_type: 'percentage',
      fee_value: 0.55,
      effective_date: '2026-01-01',
      notes: 'Default Lipa na M-Pesa Buy Goods fee (0.55%)',
    });
  }

  if (await knex.schema.hasTable('shift_collections')) {
    const hasFee = await knex.schema.hasColumn('shift_collections', 'mpesa_fee');
    if (!hasFee) {
      await knex.schema.alterTable('shift_collections', (t) => {
        t.decimal('mpesa_fee', 14, 2).notNullable().defaultTo(0);
      });
    }
    const hasNet = await knex.schema.hasColumn('shift_collections', 'mpesa_net');
    if (!hasNet) {
      await knex.schema.alterTable('shift_collections', (t) => {
        t.decimal('mpesa_net', 14, 2).notNullable().defaultTo(0);
      });
    }

    // Backfill historical shift collections with 0.55% fee
    await knex.raw(`
      UPDATE shift_collections
      SET mpesa_fee = ROUND(mpesa_amount * 0.0055, 2),
          mpesa_net = ROUND(mpesa_amount - (mpesa_amount * 0.0055), 2)
      WHERE mpesa_amount > 0 AND (mpesa_fee = 0 OR mpesa_fee IS NULL)
    `);
  }

  // ---- 1B. EPRA ceiling columns on fuel_prices ----

  if (await knex.schema.hasTable('fuel_prices')) {
    const hasMax = await knex.schema.hasColumn('fuel_prices', 'epra_max_price');
    if (!hasMax) {
      await knex.schema.alterTable('fuel_prices', (t) => {
        t.decimal('epra_max_price', 10, 2).nullable();
      });
    }
    const hasEffective = await knex.schema.hasColumn('fuel_prices', 'epra_effective_date');
    if (!hasEffective) {
      await knex.schema.alterTable('fuel_prices', (t) => {
        t.string('epra_effective_date').nullable();
      });
    }
    const hasSource = await knex.schema.hasColumn('fuel_prices', 'source');
    if (!hasSource) {
      await knex.schema.alterTable('fuel_prices', (t) => {
        t.string('source').notNullable().defaultTo('manual'); // 'manual' or 'epra'
      });
    }
  }

  // ---- 1C. Tank dip variance categorization ----

  if (await knex.schema.hasTable('tank_dips')) {
    const hasCategory = await knex.schema.hasColumn('tank_dips', 'variance_category');
    if (!hasCategory) {
      await knex.schema.alterTable('tank_dips', (t) => {
        t.string('variance_category').notNullable().defaultTo('unclassified');
        // Values: 'natural_loss', 'operational_loss', 'meter_drift',
        //         'delivery_variance', 'unclassified'
      });
    }
    const hasNotes = await knex.schema.hasColumn('tank_dips', 'variance_notes');
    if (!hasNotes) {
      await knex.schema.alterTable('tank_dips', (t) => {
        t.text('variance_notes').nullable();
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Drop new columns (SQLite supports column drop via Knex alter)
  if (await knex.schema.hasTable('tank_dips')) {
    if (await knex.schema.hasColumn('tank_dips', 'variance_notes')) {
      await knex.schema.alterTable('tank_dips', (t) => t.dropColumn('variance_notes'));
    }
    if (await knex.schema.hasColumn('tank_dips', 'variance_category')) {
      await knex.schema.alterTable('tank_dips', (t) => t.dropColumn('variance_category'));
    }
  }

  if (await knex.schema.hasTable('fuel_prices')) {
    if (await knex.schema.hasColumn('fuel_prices', 'source')) {
      await knex.schema.alterTable('fuel_prices', (t) => t.dropColumn('source'));
    }
    if (await knex.schema.hasColumn('fuel_prices', 'epra_effective_date')) {
      await knex.schema.alterTable('fuel_prices', (t) => t.dropColumn('epra_effective_date'));
    }
    if (await knex.schema.hasColumn('fuel_prices', 'epra_max_price')) {
      await knex.schema.alterTable('fuel_prices', (t) => t.dropColumn('epra_max_price'));
    }
  }

  if (await knex.schema.hasTable('shift_collections')) {
    if (await knex.schema.hasColumn('shift_collections', 'mpesa_net')) {
      await knex.schema.alterTable('shift_collections', (t) => t.dropColumn('mpesa_net'));
    }
    if (await knex.schema.hasColumn('shift_collections', 'mpesa_fee')) {
      await knex.schema.alterTable('shift_collections', (t) => t.dropColumn('mpesa_fee'));
    }
  }

  await knex.schema.dropTableIfExists('mpesa_fee_config');
}
