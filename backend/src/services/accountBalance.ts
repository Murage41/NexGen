import db from '../database';
import type { Knex } from 'knex';

/**
 * Recompute the cached `credit_accounts.balance` from source data.
 *
 * **Why**: `credit_accounts.balance` is a Category C cache (see data-immutability
 * policy). Previously it was incremented/decremented on every credit/payment
 * event — that pattern drifts over time when any single update is missed
 * (e.g. soft-delete, shift edit, payment edit). This helper recomputes the
 * truth from source rows so any caller can keep the cache honest by simply
 * calling it after every mutation.
 *
 * Truth formula:
 *   money mode   = SUM(active credits.balance)
 *   invoice mode = SUM(active issued/partial customer_invoices.balance)
 *
 * Posted payments are allocated into those source-row balances. Rebuilding from
 * remaining balances prevents an old unallocated payment from reducing the
 * account cache while leaving individual documents outstanding.
 *
 * Triggers (callers):
 *  - credits.ts POST/PUT/DELETE
 *  - creditAccounts.ts POST payments / DELETE payments
 *  - shifts.ts when shift_credits added/removed (because they create rows in
 *    credits)
 */
export async function recomputeAccountBalance(
  accountId: number,
  conn?: Knex
): Promise<number> {
  const qb = conn || db;

  // Invoice-mode truth is the sum of each open invoice's remaining balance.
  const acct = await qb('credit_accounts').where({ id: accountId }).first('billing_mode');
  if (acct && acct.billing_mode === 'invoice') {
    const outstandingRow = await qb('customer_invoices')
      .where({ account_id: accountId })
      .whereNull('deleted_at')
      .whereIn('status', ['issued', 'partial'])
      .sum('balance as total')
      .first();
    const invBalance = Math.max(0, parseFloat((outstandingRow as any)?.total) || 0);
    await qb('credit_accounts').where({ id: accountId }).update({ balance: invBalance });
    return invBalance;
  }

  // Money-mode truth is the sum of each credit line's remaining balance.
  const creditsSum = await qb('credits')
    .where('account_id', accountId)
    .whereNull('deleted_at')
    .where('balance', '>', 0)
    .sum('balance as total')
    .first();
  const balance = Math.max(0, parseFloat(creditsSum?.total) || 0);

  const before = await qb('credit_accounts').where({ id: accountId }).first('balance');
  await qb('credit_accounts').where({ id: accountId }).update({ balance });

  if (before && Math.abs(parseFloat(before.balance) - balance) > 0.001) {
    console.log(
      `[accountBalance:recompute] acct=${accountId} ${parseFloat(before.balance).toFixed(2)}` +
        `→${balance.toFixed(2)} (Δ${(balance - parseFloat(before.balance)).toFixed(2)})`
    );
  }
  return balance;
}

/**
 * Recompute balances for ALL active accounts. Used during the one-time
 * backfill at the end of Phase 1.
 */
export async function recomputeAllAccountBalances(conn?: Knex): Promise<number> {
  const qb = conn || db;
  const accounts = await qb('credit_accounts').whereNull('deleted_at').pluck('id');
  for (const id of accounts) {
    await recomputeAccountBalance(id, conn);
  }
  return accounts.length;
}
