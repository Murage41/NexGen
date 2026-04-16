import db from '../database';
import { Knex } from 'knex';

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
 *   balance = SUM(credits.amount  WHERE account_id = X AND deleted_at IS NULL)
 *           - SUM(credit_payments.amount
 *                 WHERE deleted_at IS NULL
 *                 AND (account_id = X OR credit_id IN
 *                      (SELECT id FROM credits WHERE account_id = X AND deleted_at IS NULL)))
 *
 * **Important**: This function does NOT fix overpayment / per-credit balance
 * issues — those are a separate Phase 6 concern (see
 * production-readiness-debug-plan.md). It only ensures the account-level
 * cache reflects the sum of valid amounts/payments.
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

  const creditsSum = await qb('credits')
    .where('account_id', accountId)
    .whereNull('deleted_at')
    .sum('amount as total')
    .first();
  const totalCredits = parseFloat(creditsSum?.total) || 0;

  // Active credit IDs for this account
  const activeCreditIds: number[] = (
    await qb('credits')
      .where('account_id', accountId)
      .whereNull('deleted_at')
      .pluck('id')
  );

  let totalPayments = 0;
  if (activeCreditIds.length || true) {
    const paySum = await qb('credit_payments')
      .whereNull('deleted_at')
      .where((q: any) => {
        q.where('account_id', accountId);
        if (activeCreditIds.length) q.orWhereIn('credit_id', activeCreditIds);
      })
      .sum('amount as total')
      .first();
    totalPayments = parseFloat(paySum?.total) || 0;
  }

  const balance = totalCredits - totalPayments;

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
