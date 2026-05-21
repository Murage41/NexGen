import { Knex } from 'knex';

/**
 * Migration 024 — Correct shift 42 forgotten closing_litres
 *
 * On 2026-04-28 the closing_litres for the petrol pump on shift 42 was not
 * recorded. closing_amount was correct (KES 203,126.51), but closing_litres
 * was left equal to opening_litres (834,336.84). Shift 43 then auto-seeded
 * its opening from that stale value and absorbed the missing 996.56 L into
 * its own litres_sold (showing 1,347.33 L instead of the true 350.77 L).
 *
 * Correct closing_litres on shift 42 is 835,333.40 (per owner). Aggregate
 * litres across the two shifts is unchanged (1,347.33 L), so book stock,
 * FIFO, and shift variance (which is computed from amount_sold, not litres)
 * are untouched. This migration only redistributes the litres delta between
 * the two shifts to match physical reality.
 *
 * Pre-migration state (verified):
 *   shift 42 reading id=126: opening=834336.84  closing=834336.84  sold=0.00
 *   shift 43 reading id=129: opening=834336.84  closing=835684.17  sold=1347.33
 *
 * Post-migration state:
 *   shift 42 reading id=126: opening=834336.84  closing=835333.40  sold=996.56
 *   shift 43 reading id=129: opening=835333.40  closing=835684.17  sold=350.77
 */

const SHIFT_42_READING_ID = 126;
const SHIFT_43_READING_ID = 129;

const PRE_42_CLOSING = 834336.84;
const PRE_42_SOLD = 0;
const PRE_43_OPENING = 834336.84;
const PRE_43_SOLD_ROUNDED = 1347.33;

const FIXED_CLOSING_LITRES = 835333.40;

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    const r42 = await trx('pump_readings').where({ id: SHIFT_42_READING_ID }).first();
    const r43 = await trx('pump_readings').where({ id: SHIFT_43_READING_ID }).first();

    if (!r42 && !r43) {
      console.log('[mig 024] historical shift 42/43 readings not present. Skipping data repair for fresh database.');
      return;
    }
    if (!r42 || !r43) {
      throw new Error('Migration 024: only one of the expected historical readings was found; aborting to avoid a partial data repair');
    }
    if (r42.shift_id !== 42 || r43.shift_id !== 43) {
      throw new Error('Migration 024: reading ids no longer map to shifts 42/43 — aborting');
    }

    // Idempotency guard: only apply if pre-state matches.
    const c42 = Math.round(Number(r42.closing_litres) * 100) / 100;
    const s42 = Math.round(Number(r42.litres_sold) * 100) / 100;
    if (c42 !== PRE_42_CLOSING || s42 !== PRE_42_SOLD) {
      console.log(`[mig 024] shift 42 already off pre-state (closing=${c42}, sold=${s42}). Skipping.`);
      return;
    }
    const o43 = Math.round(Number(r43.opening_litres) * 100) / 100;
    const s43 = Math.round(Number(r43.litres_sold) * 100) / 100;
    if (o43 !== PRE_43_OPENING || s43 !== PRE_43_SOLD_ROUNDED) {
      console.log(`[mig 024] shift 43 already off pre-state (opening=${o43}, sold=${s43}). Skipping.`);
      return;
    }

    const newSold42 = Math.round((FIXED_CLOSING_LITRES - Number(r42.opening_litres)) * 100) / 100;
    const newSold43 = Math.round((Number(r43.closing_litres) - FIXED_CLOSING_LITRES) * 100) / 100;

    await trx('pump_readings').where({ id: SHIFT_42_READING_ID }).update({
      closing_litres: FIXED_CLOSING_LITRES,
      litres_sold: newSold42,
    });
    await trx('pump_readings').where({ id: SHIFT_43_READING_ID }).update({
      opening_litres: FIXED_CLOSING_LITRES,
      litres_sold: newSold43,
    });

    console.log(`[mig 024] shift 42 reading 126: closing ${PRE_42_CLOSING} → ${FIXED_CLOSING_LITRES}, sold ${PRE_42_SOLD} → ${newSold42}`);
    console.log(`[mig 024] shift 43 reading 129: opening ${PRE_43_OPENING} → ${FIXED_CLOSING_LITRES}, sold ${PRE_43_SOLD_ROUNDED} → ${newSold43}`);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    const r42 = await trx('pump_readings').where({ id: SHIFT_42_READING_ID }).first();
    const r43 = await trx('pump_readings').where({ id: SHIFT_43_READING_ID }).first();
    if (!r42 && !r43) return;

    await trx('pump_readings').where({ id: SHIFT_42_READING_ID }).update({
      closing_litres: PRE_42_CLOSING,
      litres_sold: PRE_42_SOLD,
    });
    await trx('pump_readings').where({ id: SHIFT_43_READING_ID }).update({
      opening_litres: PRE_43_OPENING,
      litres_sold: PRE_43_SOLD_ROUNDED,
    });
  });
}
