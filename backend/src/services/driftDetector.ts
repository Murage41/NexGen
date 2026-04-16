import db from '../database';
import { computeBookStock } from './stockCalculator';

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
  timestamp: string;
}

export async function detectDrift(): Promise<DriftReport> {
  const dipDrift: DipDrift[] = [];
  const dips = await db('tank_dips')
    .whereNull('deleted_at')
    .select('id', 'tank_id', 'dip_date', 'measured_litres', 'book_stock_at_dip', 'variance_litres');
  for (const d of dips) {
    const truthBook = await computeBookStock(d.tank_id, d.dip_date);
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
  }

  const accountDrift: AccountDrift[] = [];
  const accounts = await db('credit_accounts').whereNull('deleted_at').select('id', 'name', 'balance');
  for (const a of accounts) {
    const creditsSum = await db('credits')
      .where('account_id', a.id).whereNull('deleted_at').sum('amount as t').first();
    const ids = await db('credits').where('account_id', a.id).whereNull('deleted_at').pluck('id');
    const paySum = await db('credit_payments')
      .whereNull('deleted_at')
      .where((q: any) => {
        q.where('account_id', a.id);
        if (ids.length) q.orWhereIn('credit_id', ids);
      })
      .sum('amount as t').first();
    const truth = (parseFloat(creditsSum?.t) || 0) - (parseFloat(paySum?.t) || 0);
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

  const ok = dipDrift.length === 0 && accountDrift.length === 0;
  return {
    ok,
    dips: { drift_count: dipDrift.length, total_checked: dips.length, drifted: dipDrift },
    accounts: { drift_count: accountDrift.length, total_checked: accounts.length, drifted: accountDrift },
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
  checked_at: string;
}> {
  const report = await detectDrift();
  return {
    ok: report.ok,
    dip_drift_count: report.dips.drift_count,
    account_drift_count: report.accounts.drift_count,
    checked_at: report.timestamp,
  };
}
