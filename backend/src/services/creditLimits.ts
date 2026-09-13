import type { Knex } from 'knex';
import { getKenyaDate } from '../utils/timezone';
import { resolveApprover, type Approver } from './approval';

// Credit limits for customer accounts (M5).
//
// Both rules are opt-in per customer - a null limit means no rule - and both
// warn rather than wall: a breach needs an administrator to approve, and the
// approval is recorded in credit_limit_overrides. See the M5 section of the
// urgent-matters plan for why a hard block was rejected.
//
// Credit limit: what the customer would owe after this entry, from live source
// rows (never the cached credit_accounts.balance).
//   money   = unpaid credit balances
//   invoice = issued/partial invoice balances + draft invoice totals
//             + unbilled active consumption at retail
// Unbilled consumption must count: the station can go months between invoices
// (Diwafa: 5.3M unbilled against a 186K invoice balance), so a balance-only
// limit would miss nearly everything an invoice customer owes.
//
// Repayment limit: no more credit once anything has been unpaid for more than
// the limit's days past its due date. Money credits fall due the day they are
// given (their payment terms are always 0), so for them this is simply days
// unpaid, counted from the credit's shift date. Invoices use their stored due
// date. Unbilled consumption never ages a customer: slow invoicing is the
// station's delay, not theirs.
//
// Two devices recording credit for the same customer in the same instant could
// both pass the check before either commits. Acceptable for a warning rule at
// one station; do not rely on this as a hard financial control.

type Conn = Knex | Knex.Transaction;

const money = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const kes = (value: number) =>
  `KES ${money(value).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const limitOf = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export type CreditBreach =
  | {
      rule: 'credit_limit';
      message: string;
      credit_limit: number;
      exposure_before: number;
      amount: number;
      exposure_after: number;
    }
  | {
      rule: 'repayment_limit';
      message: string;
      limit_days: number;
      oldest_due_date: string;
      days_past_due: number;
      overdue_amount: number;
    };

export type CreditCheck = {
  credit_limit: number | null;
  credit_age_limit_days: number | null;
  exposure_before: number;
  amount: number;
  exposure_after: number;
  breaches: CreditBreach[];
};

export async function creditExposure(account: any, db: Conn): Promise<number> {
  if (account.billing_mode === 'invoice') {
    const invoiced = await db('customer_invoices')
      .where({ account_id: account.id })
      .whereNull('deleted_at')
      .whereIn('status', ['issued', 'partial'])
      .sum({ total: 'balance' })
      .first();
    const drafts = await db('customer_invoices')
      .where({ account_id: account.id, status: 'draft' })
      .whereNull('deleted_at')
      .sum({ total: 'total_amount' })
      .first();
    // Reversed entries have been replaced by corrections; count only live ones.
    const unbilled = await db('invoice_consumption')
      .where({ account_id: account.id })
      .whereNull('deleted_at')
      .whereNull('invoice_line_id')
      .where((q) => q.whereNull('entry_status').orWhere('entry_status', 'active'))
      .sum({ total: 'retail_amount' })
      .first();
    return money(
      Number((invoiced as any)?.total || 0) + Number((drafts as any)?.total || 0) + Number((unbilled as any)?.total || 0),
    );
  }
  const credits = await db('credits')
    .where({ account_id: account.id })
    .whereNull('deleted_at')
    .where('balance', '>', 0)
    .sum({ total: 'balance' })
    .first();
  return money(Number((credits as any)?.total || 0));
}

// Unpaid items that are more than `limitDays` past due as of `today`.
export async function overdueBeyond(
  account: any,
  limitDays: number,
  today: string,
  db: Conn,
): Promise<{ oldest_due_date: string; days_past_due: number; overdue_amount: number } | null> {
  const cutoff = addDays(today, -limitDays);
  const row: any = account.billing_mode === 'invoice'
    ? await db('customer_invoices')
      .where({ account_id: account.id })
      .whereNull('deleted_at')
      .whereIn('status', ['issued', 'partial'])
      .where('balance', '>', 0)
      .where('due_date', '<', cutoff)
      .min({ oldest: 'due_date' })
      .sum({ total: 'balance' })
      .first()
    : await db('credits as c')
      .join('shifts as s', 's.id', 'c.shift_id')
      .where('c.account_id', account.id)
      .whereNull('c.deleted_at')
      .where('c.balance', '>', 0)
      .where('s.shift_date', '<', cutoff)
      .min({ oldest: 's.shift_date' })
      .sum({ total: 'c.balance' })
      .first();
  if (!row?.oldest) return null;
  const oldest = String(row.oldest).slice(0, 10);
  return {
    oldest_due_date: oldest,
    days_past_due: daysBetween(oldest, today),
    overdue_amount: money(Number(row.total || 0)),
  };
}

export async function evaluateCreditLimits(
  account: any,
  amount: number,
  db: Conn,
  today: string = getKenyaDate(),
): Promise<CreditCheck> {
  const creditLimit = limitOf(account.credit_limit);
  const limitDays = limitOf(account.credit_age_limit_days);
  const exposureBefore = await creditExposure(account, db);
  const exposureAfter = money(exposureBefore + Number(amount || 0));
  const breaches: CreditBreach[] = [];

  if (creditLimit !== null && exposureAfter > creditLimit) {
    breaches.push({
      rule: 'credit_limit',
      message: `${account.name} would owe ${kes(exposureAfter)}; their credit limit is ${kes(creditLimit)}.`,
      credit_limit: money(creditLimit),
      exposure_before: exposureBefore,
      amount: money(amount),
      exposure_after: exposureAfter,
    });
  }

  if (limitDays !== null) {
    const overdue = await overdueBeyond(account, limitDays, today, db);
    if (overdue) {
      breaches.push({
        rule: 'repayment_limit',
        message: account.billing_mode === 'invoice'
          ? `${kes(overdue.overdue_amount)} of invoices is ${overdue.days_past_due} days past due (since ${overdue.oldest_due_date}); the limit is ${limitDays} days.`
          : `${kes(overdue.overdue_amount)} of credit has been unpaid for ${overdue.days_past_due} days (since ${overdue.oldest_due_date}); the limit is ${limitDays} days.`,
        limit_days: limitDays,
        ...overdue,
      });
    }
  }

  return {
    credit_limit: creditLimit === null ? null : money(creditLimit),
    credit_age_limit_days: limitDays,
    exposure_before: exposureBefore,
    amount: money(amount),
    exposure_after: exposureAfter,
    breaches,
  };
}

export function creditBreachError(account: any, check: CreditCheck) {
  return Object.assign(
    new Error(`Admin approval needed. ${check.breaches.map((breach) => breach.message).join(' ')}`),
    {
      httpStatus: 409,
      http: 409,
      code: 'CREDIT_LIMIT_BREACH',
      details: {
        account: { id: account.id, name: account.name, billing_mode: account.billing_mode },
        ...check,
      },
    },
  );
}

// Checks a new credit or fuel-on-account entry against the customer's limits.
// Within limits: returns no approver. Breached without an override: throws the
// 409 the screens turn into an approval prompt. Breached with an override:
// resolves the approving administrator (the signed-in admin, or an admin's PIN
// token bound to `binding`), or throws.
export async function authorizeCreditExtension(
  input: {
    account: any;
    amount: number;
    override: boolean;
    approvalToken: unknown;
    binding: string;
    sessionEmployeeId: number | null;
  },
  db: Knex.Transaction,
): Promise<{ check: CreditCheck; approver: Approver | null }> {
  const check = await evaluateCreditLimits(input.account, input.amount, db);
  if (check.breaches.length === 0) return { check, approver: null };
  if (!input.override) throw creditBreachError(input.account, check);
  const approver = await resolveApprover(input.sessionEmployeeId, input.approvalToken, input.binding, db);
  return { check, approver };
}

export async function recordCreditOverride(
  db: Knex.Transaction,
  input: {
    account: any;
    shiftId: number;
    creditId?: number | null;
    consumptionId?: number | null;
    check: CreditCheck;
    approver: Approver;
    recordedBy: number | null;
  },
) {
  await db('credit_limit_overrides').insert({
    account_id: input.account.id,
    shift_id: input.shiftId,
    credit_id: input.creditId ?? null,
    invoice_consumption_id: input.consumptionId ?? null,
    amount: input.check.amount,
    breaches: JSON.stringify(input.check.breaches),
    approved_by_employee_id: input.approver.id,
    approved_by_name: input.approver.name,
    recorded_by_employee_id: input.recordedBy && input.recordedBy > 0 ? input.recordedBy : null,
  });
}
