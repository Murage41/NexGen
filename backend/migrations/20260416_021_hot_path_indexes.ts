import { Knex } from 'knex';

/**
 * Migration 021 — Hot-path indexes (Phase 14).
 *
 * Single-station SQLite doesn't need a lot of indexes, but three queries
 * fire on every dashboard/report load and will get slower as the db grows:
 *   • pump_readings.shift_id — joined on every shift detail, daily/monthly
 *     report, stock reconciliation.
 *   • credit_payments.account_id / credit_id — joined on every account
 *     lookup and drift check.
 *   • batch_consumption (shift_id, tank_id) — COGS aggregation per shift.
 *   • tank_stock_ledger.tank_id — stock audit history.
 *
 * All guarded so re-running is safe.
 */

async function ensureIndex(knex: Knex, table: string, columns: string[], name: string) {
  const existing: any[] = await knex.raw(`PRAGMA index_list(${table})`);
  const has = Array.isArray(existing) && existing.some((r: any) => r.name === name);
  if (has) return;
  const cols = columns.map((c) => `"${c}"`).join(', ');
  await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols})`);
}

export async function up(knex: Knex): Promise<void> {
  await ensureIndex(knex, 'pump_readings', ['shift_id'], 'idx_pump_readings_shift');
  await ensureIndex(knex, 'credit_payments', ['account_id'], 'idx_credit_payments_account');
  await ensureIndex(knex, 'credit_payments', ['credit_id'], 'idx_credit_payments_credit');
  await ensureIndex(knex, 'batch_consumption', ['shift_id', 'tank_id'], 'idx_batch_consumption_shift_tank');
  await ensureIndex(knex, 'tank_stock_ledger', ['tank_id'], 'idx_tank_stock_ledger_tank');
  await ensureIndex(knex, 'fuel_deliveries', ['tank_id', 'date'], 'idx_fuel_deliveries_tank_date');
  await ensureIndex(knex, 'shift_expenses', ['shift_id'], 'idx_shift_expenses_shift');
  await ensureIndex(knex, 'shift_credits', ['shift_id'], 'idx_shift_credits_shift');
}

export async function down(knex: Knex): Promise<void> {
  for (const name of [
    'idx_pump_readings_shift',
    'idx_credit_payments_account',
    'idx_credit_payments_credit',
    'idx_batch_consumption_shift_tank',
    'idx_tank_stock_ledger_tank',
    'idx_fuel_deliveries_tank_date',
    'idx_shift_expenses_shift',
    'idx_shift_credits_shift',
  ]) {
    await knex.raw(`DROP INDEX IF EXISTS ${name}`);
  }
}
