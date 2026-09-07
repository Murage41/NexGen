import { syncEmployeeDebt } from './employeeDebt';
import db from '../database';
import type { Knex } from 'knex';

/** Read the same source balances used by repairs, without changing any rows. */
export async function readAccountBalance(accountId: number, qb: Knex = db): Promise<number> {
  const account = await qb('credit_accounts').where({id: accountId}).first();
  if (account?.type === 'employee') {
    const row = await qb('staff_debts').where({employee_id: account.employee_id}).sum('balance as total').first();
    return Math.round(Number(row?.total || 0) * 100) / 100;
  }
  if (account?.billing_mode === 'invoice') {
    const row = await qb('customer_invoices').where({account_id: accountId}).whereNull('deleted_at').whereIn('status', ['issued', 'partial']).sum('balance as total').first();
    return Math.max(0, Number(row?.total || 0));
  }
  const row = await qb('credits').where({account_id: accountId}).whereNull('deleted_at').where('balance', '>', 0).sum('balance as total').first();
  return Math.max(0, Number(row?.total || 0));
}

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
  const acct = await qb('credit_accounts').where({ id: accountId }).first();
  if (acct?.type === 'employee') return syncEmployeeDebt(Number(acct.employee_id), qb);
  const balance = await readAccountBalance(accountId, qb);

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
