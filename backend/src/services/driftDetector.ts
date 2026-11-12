import type { Knex } from 'knex';
import db from '../database';
import { readAccountBalance } from './accountBalance';
import { findStoredBalanceDrift, type StoredBalanceDrift } from './cacheRecounts';
import { computeBookStockAtTimes } from './stockCalculator';

/**
 * Phase 11 — Reconciliation loop.
 *
 * Central drift detector. Walks every Category C cache (values that are
 * stored for performance but can be recomputed from source rows) and
 * reports any row whose cached value disagrees with truth.
 *
 * Two consumers:
 *   • GET /api/health/drift-check — on-demand detailed report.
 *   • GET /api/dashboard — embeds summary counts so the owner sees drift
 *     the moment it appears.
 *
 * Keep this file fast. It is called on every dashboard load.
 */

export interface DipDrift {
  dip_id: number;
  tank_id: number;
  dip_date: string;
  cached_book: number;
  truth_book: number;
  drift: number;
  cached_variance: number;
  truth_variance: number;
}

export interface AccountDrift {
  account_id: number;
  name: string;
  cached_balance: number;
  truth_balance: number;
  drift: number;
}

export interface DriftReport {
  ok: boolean;
  dips: { drift_count: number; total_checked: number; drifted: DipDrift[] };
  accounts: { drift_count: number; total_checked: number; drifted: AccountDrift[] };
  // Debts, supplier bills and fuel batches (services/cacheRecounts.ts).
  stored_balances: { drift_count: number; drifted: StoredBalanceDrift[] };
  timestamp: string;
}

export async function detectDrift(conn: Knex = db): Promise<DriftReport> {
  const dipDrift: DipDrift[] = [];
  // Each dip's book stock at its own timestamp, the same moment
  // recomputeDipsForTankFromDate uses (a bare date means end of that day, so a
  // delivery between the dip and midnight is not counted). One pass per tank:
  // re-adding the whole history once per dip slowed the Today page as dips grew.
  const dips = await conn('tank_dips')
    .whereNull('deleted_at')
    .select(
      'id', 'tank_id', 'dip_date', 'timestamp', 'measured_litres', 'book_stock_at_dip', 'variance_litres',
      conn.raw(`datetime(CASE WHEN COALESCE(NULLIF(timestamp, ''), dip_date) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        THEN COALESCE(NULLIF(timestamp, ''), dip_date) || ' 23:59:59'
        ELSE COALESCE(NULLIF(timestamp, ''), dip_date) END) as as_of`),
    );
  const byTank = new Map<number, any[]>();
  for (const d of dips) {
    const list = byTank.get(Number(d.tank_id)) || [];
    list.push(d);
    byTank.set(Number(d.tank_id), list);
  }
  for (const [tankId, tankDips] of byTank) {
    const books = await computeBookStockAtTimes(tankId, tankDips.map((d) => d.as_of || null), conn as Knex);
    tankDips.forEach((d, index) => {
      const truthBook = books[index];
      const truthVar = parseFloat(d.measured_litres) - truthBook;
      const cachedBook = parseFloat(d.book_stock_at_dip) || 0;
      if (Math.abs(cachedBook - truthBook) > 0.01) {
        dipDrift.push({
          dip_id: d.id,
          tank_id: d.tank_id,
          dip_date: d.dip_date,
          cached_book: cachedBook,
          truth_book: Number(truthBook.toFixed(2)),
          drift: Number((cachedBook - truthBook).toFixed(2)),
          cached_variance: parseFloat(d.variance_litres) || 0,
          truth_variance: Number(truthVar.toFixed(2)),
        });
      }
    });
  }
  dipDrift.sort((a, b) => a.dip_id - b.dip_id);

  const accountDrift: AccountDrift[] = [];
  const accounts = await conn('credit_accounts').whereNull('deleted_at').select('id', 'name', 'balance');
  for (const a of accounts) {
    const truth = await readAccountBalance(a.id, conn);
    const cached = parseFloat(a.balance) || 0;
    if (Math.abs(cached - truth) > 0.01) {
      accountDrift.push({
        account_id: a.id,
        name: a.name,
        cached_balance: cached,
        truth_balance: Number(truth.toFixed(2)),
        drift: Number((cached - truth).toFixed(2)),
      });
    }
  }

  const storedDrift = await findStoredBalanceDrift(conn);

  const ok = dipDrift.length === 0 && accountDrift.length === 0 && storedDrift.length === 0;
  return {
    ok,
    dips: { drift_count: dipDrift.length, total_checked: dips.length, drifted: dipDrift },
    accounts: { drift_count: accountDrift.length, total_checked: accounts.length, drifted: accountDrift },
    stored_balances: { drift_count: storedDrift.length, drifted: storedDrift },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Lightweight summary for the dashboard — counts only, no per-row detail.
 * Intended to be rendered as a status badge. If drift_count > 0, the UI
 * shows a red banner with "Run /api/health/drift-check for details".
 */
export async function detectDriftSummary(): Promise<{
  ok: boolean;
  dip_drift_count: number;
  account_drift_count: number;
  stored_balance_drift_count: number;
  checked_at: string;
}> {
  const report = await detectDrift();
  return {
    ok: report.ok,
    dip_drift_count: report.dips.drift_count,
    account_drift_count: report.accounts.drift_count,
    stored_balance_drift_count: report.stored_balances.drift_count,
    checked_at: report.timestamp,
  };
}
