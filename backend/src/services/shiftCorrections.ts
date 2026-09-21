import crypto from 'crypto';
import type { Knex } from 'knex';
import { computeShiftAccountability, roundMoney } from './shiftAccountability';
import { getKenyaDate } from '../utils/timezone';
import {
  allocateMoneyCredits,
  applyCustomerCredit,
  customerCreditBalance,
  getEligibleMoneyCredits,
  reverseMoneyAccountPaymentInTransaction,
} from './receivablePayments';
import { readAccountBalance } from './accountBalance';
import {
  allocateEmployeeDebt,
  employeeDebtSummary,
  positiveMoney,
  reverseDebtAllocations,
  syncEmployeeDebt,
} from './employeeDebt';
import { resolveConsumptionSource, validateInvoiceConsumptionAgainstReadings } from './invoiceConsumption';
import type { Approver } from './approval';

// Correcting a credit, payment or fuel-on-account entry of a CLOSED shift.
//
// A closed record is never edited or deleted. A correction marks the original
// reversed (keeping its amounts), adds a linked replacement when there is one,
// and is kept as a dated document with its approver - the practice of posted
// invoices corrected by credit notes (Business Central "Correct"/"Cancel") and
// reversal documents (SAP), rather than editing a closed record.
//
// It then settles the shift's accountability: whatever the correction changes
// in what the attendant should have handed over becomes debt (more owed) or
// relief (less owed; money already recovered from them is owed back to them).
//
// The preview runs the same code inside a transaction that is rolled back, so
// what the administrator approves is exactly what is posted. Its confirmation
// token hashes the decision and every figure it changes; posting recomputes it
// and refuses if anything moved in between.

type Trx = Knex.Transaction;

export const CORRECTION_ENTRY_TYPES = ['credit', 'payment', 'invoice_consumption'] as const;
export type CorrectionEntryType = (typeof CORRECTION_ENTRY_TYPES)[number];
export const CORRECTION_KINDS = ['wrong_customer', 'wrong_amount', 'not_valid'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export type CorrectionRequest = {
  shiftId: number;
  entryType: CorrectionEntryType;
  entryId: number;
  kind: CorrectionKind;
  accountId?: number | null;
  amount?: number | null;
  litres?: number | null;
  pumpId?: number | null;
  note?: string | null;
};

type Context = {
  trx: Trx;
  request: CorrectionRequest;
  shift: any;
  headerId: number;
  now: string;
  postingDate: string;
  approverId: number | null;
};

type EntryOutcome = {
  summary: string;
  original: Record<string, unknown>;
  replacement: Record<string, unknown> | null;
  replacementId: number | null;
  originalId: number;
  amountDelta: number;
  accountIds: number[];
  litreValidation?: unknown;
};

function fail(message: string, http = 400, code?: string): never {
  throw Object.assign(new Error(message), { http, httpStatus: http, ...(code ? { code } : {}) });
}

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const litresText = (value: unknown) => `${Number(value || 0).toFixed(2)} L`;
const toCents = (value: unknown) => Math.round(Number(value || 0) * 100);

export function parseCorrectionRequest(shiftId: number, body: any): CorrectionRequest {
  if (!Number.isInteger(shiftId) || shiftId <= 0) fail('Shift not found', 404);
  const entryType = String(body?.entry_type || '') as CorrectionEntryType;
  if (!CORRECTION_ENTRY_TYPES.includes(entryType)) fail('Choose the entry to correct.');
  const entryId = Number(body?.entry_id);
  if (!Number.isInteger(entryId) || entryId <= 0) fail('Choose the entry to correct.');
  const kind = String(body?.kind || '') as CorrectionKind;
  if (!CORRECTION_KINDS.includes(kind)) fail('Choose what was wrong with the entry.');
  const note = body?.note == null ? '' : String(body.note).trim().slice(0, 500);
  const request: CorrectionRequest = { shiftId, entryType, entryId, kind, note: note || null };

  if (kind === 'wrong_customer') {
    const accountId = Number(body?.account_id);
    if (!Number.isInteger(accountId) || accountId <= 0) fail('Choose who it should have been.');
    request.accountId = accountId;
  }
  if (kind === 'wrong_amount') {
    if (entryType === 'invoice_consumption') {
      const litres = Number(body?.litres);
      if (!Number.isFinite(litres) || litres <= 0) fail('Enter the right number of litres.');
      request.litres = Math.round(litres * 1000) / 1000;
      const pump = body?.pump_id;
      const pumpId = pump === undefined || pump === null || pump === '' ? null : Number(pump);
      if (pumpId !== null && (!Number.isInteger(pumpId) || pumpId <= 0)) fail('Choose a valid pump.');
      request.pumpId = pumpId;
    } else {
      request.amount = positiveMoney(body?.amount);
    }
  }
  return request;
}

async function liveVariance(trx: Trx, shift: any): Promise<number> {
  const readings = await trx('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .where('pump_readings.shift_id', shift.id)
    .where('pumps.active', true)
    .select('pump_readings.*', 'pumps.fuel_type');
  const collections = await trx('shift_collections').where({ shift_id: shift.id }).first();
  const expenses = await trx('shift_expenses').where({ shift_id: shift.id }).whereNull('deleted_at');
  const shiftCredits = await trx('shift_credits').where({ shift_id: shift.id }).whereNull('deleted_at');
  const creditReceipts = await trx('credit_payments')
    .where({ shift_id: shift.id, status: 'posted' })
    .whereNull('deleted_at');
  const payrollPayments = await trx('payroll_payments')
    .where({ shift_id: shift.id, status: 'posted' })
    .where((query: any) => {
      query.whereNull('reference').orWhere('reference', 'not like', 'SHIFT-WAGE:%');
    });
  const invoiceConsumption = await trx('invoice_consumption')
    .where({ shift_id: shift.id })
    .whereNull('deleted_at');
  // Same wage basis as the shift page. It is identical before and after, so
  // it never affects what a correction changes.
  const employee_wage = Number(shift.wage_paid ?? shift.employee_wage ?? 0);
  return computeShiftAccountability({
    readings,
    collections,
    shiftCredits,
    invoiceConsumption,
    creditReceipts,
    expenses,
    employee_wage,
    payrollPayments,
  }).variance;
}

// The variance the attendant is currently accountable for: what was approved
// at close plus every later adjustment, so a correction moves it from exactly
// what was charged. Shifts closed before close snapshots existed fall back to
// the live figures.
async function accountableVariance(trx: Trx, shift: any, headerId: number, live: number) {
  const snapshot = await trx('shift_close_reconciliations').where({ shift_id: shift.id }).first('variance');
  if (!snapshot) return live;
  // The 2026-09-10 recovery repair (scripts/fix_mutati_recovery_103_105.ts)
  // rewrote the snapshot itself as well as logging its change, so its delta is
  // already in the snapshot. Every other adjustment left the snapshot alone.
  const prior = await trx('shift_accountability_adjustments')
    .where({ shift_id: shift.id })
    .whereNot({ id: headerId })
    .whereNot({ adjustment_type: 'recovery_mechanism_correction' })
    .select('variance_before', 'variance_after');
  const moved = prior.reduce(
    (sum: number, row: any) => sum + Number(row.variance_after || 0) - Number(row.variance_before || 0),
    0,
  );
  return roundMoney(Number(snapshot.variance || 0) + moved);
}

async function owedNow(trx: Trx, account: any) {
  if (account.type === 'employee') {
    return (await employeeDebtSummary(Number(account.employee_id), trx)).outstanding;
  }
  if (account.billing_mode === 'invoice') {
    const row = await trx('invoice_consumption')
      .where({ account_id: account.id })
      .whereNull('deleted_at')
      .whereNull('invoice_line_id')
      .where((q: any) => q.whereNull('entry_status').orWhere('entry_status', 'active'))
      .sum({ total: 'retail_amount' })
      .first();
    return roundMoney(Number((row as any)?.total || 0));
  }
  return readAccountBalance(Number(account.id), trx);
}

async function refreshAccount(trx: Trx, account: any) {
  if (account.type === 'employee') {
    await syncEmployeeDebt(Number(account.employee_id), trx);
    return;
  }
  const balance = await readAccountBalance(Number(account.id), trx);
  await trx('credit_accounts').where({ id: account.id }).update({ balance });
}

const isMoneyCustomer = (account: any) =>
  account?.type === 'customer' && (account.billing_mode || 'money') === 'money';

async function loadAccount(trx: Trx, id: number) {
  return trx('credit_accounts').where({ id }).whereNull('deleted_at').first();
}

// Pays a customer's closed-shift credits from a payment, oldest first (the
// preferred credit first when given). What the customer doesn't owe stays on
// that payment as credit on account (receivablePayments.ts) instead of being
// refused: the money was received, so it belongs to them.
async function applyToCredits(
  trx: Trx,
  account: any,
  paymentId: number,
  amount: number,
  preferredCreditId: number | null,
) {
  let credits = await getEligibleMoneyCredits(Number(account.id), trx);
  if (preferredCreditId) {
    credits = [
      ...credits.filter((c: any) => Number(c.id) === preferredCreditId),
      ...credits.filter((c: any) => Number(c.id) !== preferredCreditId),
    ];
  }
  const available = credits.reduce((sum: number, c: any) => sum + toCents(c.balance), 0);
  const applyCents = Math.min(toCents(amount), available);
  if (applyCents > 0) {
    const allocations = await allocateMoneyCredits(trx, credits, applyCents / 100);
    await trx('credit_payment_allocations').insert(
      allocations.map((a) => ({ payment_id: paymentId, credit_id: a.credit_id, amount_applied: a.amount_applied })),
    );
  }
  const heldCents = toCents(amount) - applyCents;
  if (heldCents > 0) {
    const payment = await trx('credit_payments').where({ id: paymentId }).first('unapplied_amount');
    await trx('credit_payments').where({ id: paymentId }).update({
      unapplied_amount: (toCents(payment?.unapplied_amount) + heldCents) / 100,
    });
  }
}

// A replacement payment on the same shift, dated the day of the correction.
async function postReplacementPayment(ctx: Context, payer: any, amount: number, original: any) {
  const { trx } = ctx;
  if (payer.type === 'employee') {
    const employeeId = Number(payer.employee_id);
    const summary = await employeeDebtSummary(employeeId, trx);
    if (toCents(amount) > toCents(summary.recoverable)) {
      fail(
        `${payer.name} owes ${kes(summary.recoverable)} that a payment can clear, less than this ${kes(amount)}.`,
        409,
        'EMPLOYEE_OVERPAID',
      );
    }
    await syncEmployeeDebt(employeeId, trx);
    const account = await trx('credit_accounts').where({ employee_id: employeeId, type: 'employee' }).first();
    const [id] = await trx('credit_payments').insert({
      account_id: account.id,
      credit_id: null,
      amount,
      payment_method: original.payment_method,
      payment_type: 'staff_debt',
      date: ctx.postingDate,
      shift_id: original.shift_id,
      notes: original.notes || null,
      status: 'posted',
      created_by_employee_id: ctx.approverId,
      correction_of_id: original.id,
      created_by_correction_id: ctx.headerId,
    });
    await allocateEmployeeDebt(
      employeeId,
      amount,
      { table: 'staff_debt_receipt_allocations', fields: { payment_id: id } },
      trx,
    );
    return Number(id);
  }
  if ((payer.billing_mode || 'money') !== 'money') {
    fail(`${payer.name} is an invoice customer; their payments are recorded against invoices.`);
  }
  const [id] = await trx('credit_payments').insert({
    account_id: payer.id,
    credit_id: null,
    amount,
    payment_method: original.payment_method,
    payment_type: 'account',
    date: ctx.postingDate,
    shift_id: original.shift_id,
    notes: original.notes || null,
    status: 'posted',
    created_by_employee_id: ctx.approverId,
    correction_of_id: original.id,
    created_by_correction_id: ctx.headerId,
  });
  await applyToCredits(trx, payer, Number(id), amount, null);
  return Number(id);
}

async function correctCredit(ctx: Context): Promise<EntryOutcome> {
  const { trx, request, shift } = ctx;
  const shiftCredit = await trx('shift_credits')
    .where({ id: request.entryId, shift_id: shift.id })
    .whereNull('deleted_at')
    .first();
  if (!shiftCredit) fail('That credit is not on this shift, or it has already been corrected.', 404);
  const credit = shiftCredit.credit_id
    ? await trx('credits').where({ id: shiftCredit.credit_id }).whereNull('deleted_at').first()
    : null;
  const account = credit?.account_id ? await loadAccount(trx, Number(credit.account_id)) : null;
  if (!credit || !account) {
    fail('This credit was recorded before customer accounts existed and cannot be corrected here.', 409);
  }

  // What has already been paid on it, and by which payments.
  const allocations = await trx('credit_payment_allocations as a')
    .join('credit_payments as p', 'a.payment_id', 'p.id')
    .where('a.credit_id', credit.id)
    .whereNull('a.reversed_at')
    .where('p.status', 'posted')
    .whereNull('p.deleted_at')
    .select('a.id', 'a.payment_id', 'a.amount_applied')
    .orderBy('a.id');
  const paidCents = allocations.reduce((sum: number, a: any) => sum + toCents(a.amount_applied), 0);
  if (paidCents !== toCents(credit.amount) - toCents(credit.balance)) {
    fail('The payment history of this credit is incomplete. Run the receivables check before correcting it.', 409, 'PAYMENT_ALLOCATION_INCOMPLETE');
  }

  let owner = account;
  let amount = Number(credit.amount);
  let summary: string;
  if (request.kind === 'wrong_customer') {
    const target = await loadAccount(trx, Number(request.accountId));
    if (!target || target.type !== 'customer' || (target.billing_mode || 'money') !== 'money') {
      fail('Choose a customer who buys on normal credit.');
    }
    if (Number(target.id) === Number(account.id)) fail(`The credit is already on ${account.name}.`);
    owner = target;
    summary = `Credit of ${kes(amount)} moved from ${account.name} to ${target.name}`;
  } else if (request.kind === 'wrong_amount') {
    if (toCents(request.amount) === toCents(credit.amount)) fail(`The credit is already ${kes(credit.amount)}.`);
    amount = Number(request.amount);
    summary = `Credit to ${account.name} changed from ${kes(credit.amount)} to ${kes(amount)}`;
  } else {
    summary = `Credit of ${kes(credit.amount)} to ${account.name} voided: it was not given`;
  }

  // Take back what was paid on it, then reverse it. Amounts stay as recorded.
  for (const a of allocations) {
    await trx('credit_payment_allocations').where({ id: a.id }).update({ reversed_at: ctx.now });
  }
  await trx('credits').where({ id: credit.id }).update({
    status: 'reversed',
    balance: 0,
    deleted_at: ctx.now,
    reversed_at: ctx.now,
    reversed_by_employee_id: ctx.approverId,
    reversed_by_correction_id: ctx.headerId,
  });
  await trx('shift_credits').where({ id: shiftCredit.id }).update({ deleted_at: ctx.now });

  let replacementId: number | null = null;
  let replacementShiftCreditId: number | null = null;
  if (request.kind !== 'not_valid') {
    [replacementId] = await trx('credits').insert({
      customer_name: owner.name,
      customer_phone: owner.phone || null,
      amount,
      balance: amount,
      shift_id: shift.id,
      description: credit.description || null,
      status: 'outstanding',
      account_id: owner.id,
      correction_of_id: credit.id,
      created_by_correction_id: ctx.headerId,
    });
    [replacementShiftCreditId] = await trx('shift_credits').insert({
      shift_id: shift.id,
      customer_name: owner.name,
      customer_phone: owner.phone || null,
      amount,
      description: credit.description || null,
      credit_id: replacementId,
    });
  }

  // Payments made on the wrong credit stay with whoever made them: on a
  // changed amount they pay the corrected credit first, otherwise the
  // customer's other credits, oldest first.
  const byPayment = new Map<number, number>();
  for (const a of allocations) {
    byPayment.set(Number(a.payment_id), (byPayment.get(Number(a.payment_id)) || 0) + toCents(a.amount_applied));
  }
  if (paidCents > 0) {
    const preferred = request.kind === 'wrong_amount' ? replacementId : null;
    for (const [paymentId, cents] of byPayment) {
      await applyToCredits(trx, account, paymentId, cents / 100, preferred);
    }
  }

  return {
    summary,
    originalId: Number(credit.id),
    original: {
      credit_id: Number(credit.id),
      shift_credit_id: Number(shiftCredit.id),
      account_id: Number(account.id),
      account_name: account.name,
      amount: Number(credit.amount),
      paid: paidCents / 100,
      description: credit.description || null,
    },
    replacementId,
    replacement: replacementId
      ? {
          credit_id: replacementId,
          shift_credit_id: replacementShiftCreditId,
          account_id: Number(owner.id),
          account_name: owner.name,
          amount,
        }
      : null,
    amountDelta: roundMoney((request.kind === 'not_valid' ? 0 : amount) - Number(credit.amount)),
    accountIds: [...new Set([Number(account.id), Number(owner.id)])],
  };
}

async function correctPayment(ctx: Context): Promise<EntryOutcome> {
  const { trx, request, shift } = ctx;
  const payment = await trx('credit_payments')
    .where({ id: request.entryId, shift_id: shift.id })
    .whereNull('deleted_at')
    .first();
  if (!payment || (payment.status || 'posted') !== 'posted') {
    fail('That payment is not on this shift, or it has already been corrected.', 404);
  }
  if (!['account', 'staff_debt'].includes(payment.payment_type)) {
    fail('This payment was recorded in an older format and cannot be corrected here.', 409);
  }
  const account = await loadAccount(trx, Number(payment.account_id));
  if (!account) fail('The account this payment was recorded against no longer exists.', 409);
  const isEmployee = payment.payment_type === 'staff_debt';

  let payer = account;
  let amount = Number(payment.amount);
  let summary: string;
  if (request.kind === 'wrong_customer') {
    const target = await loadAccount(trx, Number(request.accountId));
    const valid = target && (
      target.type === 'employee'
      || (target.type === 'customer' && (target.billing_mode || 'money') === 'money')
    );
    if (!valid) fail('Choose a customer who buys on normal credit, or an employee.');
    if (Number(target.id) === Number(account.id)) fail(`The payment is already recorded for ${account.name}.`);
    payer = target;
    summary = `Payment of ${kes(amount)} moved from ${account.name} to ${target.name}`;
  } else if (request.kind === 'wrong_amount') {
    if (toCents(request.amount) === toCents(payment.amount)) fail(`The payment is already ${kes(payment.amount)}.`);
    amount = Number(request.amount);
    summary = `Payment from ${account.name} changed from ${kes(payment.amount)} to ${kes(amount)}`;
  } else {
    summary = `Payment of ${kes(payment.amount)} from ${account.name} voided: it was not received`;
  }

  if (isEmployee) {
    await reverseDebtAllocations('staff_debt_receipt_allocations', { payment_id: payment.id }, trx);
    await trx('credit_payments').where({ id: payment.id }).update({
      status: 'reversed',
      reversed_at: ctx.now,
      reversal_reason: summary,
      reversed_by_employee_id: ctx.approverId,
      reversed_by_correction_id: ctx.headerId,
    });
  } else {
    await reverseMoneyAccountPaymentInTransaction(trx, {
      paymentId: Number(payment.id),
      reason: summary,
      actorId: ctx.approverId,
      skipBalanceRefresh: true,
    });
    await trx('credit_payments').where({ id: payment.id }).update({ reversed_by_correction_id: ctx.headerId });
  }

  const replacementId = request.kind === 'not_valid'
    ? null
    : await postReplacementPayment(ctx, payer, amount, payment);

  return {
    summary,
    originalId: Number(payment.id),
    original: {
      payment_id: Number(payment.id),
      account_id: Number(account.id),
      account_name: account.name,
      account_type: account.type,
      amount: Number(payment.amount),
      payment_method: payment.payment_method,
    },
    replacementId,
    replacement: replacementId
      ? {
          payment_id: replacementId,
          account_id: Number(payer.id),
          account_name: payer.name,
          account_type: payer.type,
          amount,
          payment_method: payment.payment_method,
        }
      : null,
    amountDelta: roundMoney((request.kind === 'not_valid' ? 0 : amount) - Number(payment.amount)),
    accountIds: [...new Set([Number(account.id), Number(payer.id)])],
  };
}

async function correctConsumption(ctx: Context): Promise<EntryOutcome> {
  const { trx, request, shift } = ctx;
  const entry = await trx('invoice_consumption')
    .where({ id: request.entryId, shift_id: shift.id })
    .whereNull('deleted_at')
    .first();
  if (!entry || (entry.entry_status && entry.entry_status !== 'active')) {
    fail('That fuel entry is not on this shift, or it has already been corrected.', 404);
  }
  if (entry.invoice_line_id) {
    fail(
      'These litres are already on an invoice. Correct them through the invoice: remove them from the draft, or issue a credit note on the issued invoice.',
      409,
      'CONSUMPTION_INVOICED',
    );
  }
  const account = await loadAccount(trx, Number(entry.account_id));
  if (!account) fail('The customer this fuel was recorded for no longer exists.', 409);

  let owner = account;
  let litres = Number(entry.litres);
  let pumpId: number | null = entry.pump_id ? Number(entry.pump_id) : null;
  let tankId: number | null = entry.tank_id ? Number(entry.tank_id) : null;
  let summary: string;
  if (request.kind === 'wrong_customer') {
    const target = await loadAccount(trx, Number(request.accountId));
    if (!target || target.type !== 'customer' || target.billing_mode !== 'invoice') {
      fail('Choose an invoice customer.');
    }
    if (Number(target.id) === Number(account.id)) fail(`The fuel is already recorded for ${account.name}.`);
    owner = target;
    summary = `${litresText(litres)} ${entry.fuel_type} moved from ${account.name} to ${target.name}`;
  } else if (request.kind === 'wrong_amount') {
    // A chosen pump brings its own tank; otherwise keep the recorded source.
    const source = await resolveConsumptionSource(trx, {
      fuelType: entry.fuel_type,
      pumpId: request.pumpId ?? pumpId,
      tankId: request.pumpId ? null : tankId,
    });
    if (source.source_required) fail('Choose the pump this fuel came from.');
    const pumpChanged = Number(source.pump_id || 0) !== Number(pumpId || 0);
    if (Number(request.litres) === litres && !pumpChanged) fail('Nothing would change. Enter the right litres or pump.');
    summary = Number(request.litres) === litres
      ? `${account.name} ${entry.fuel_type} (${litresText(litres)}) moved to the right pump`
      : `${account.name} ${entry.fuel_type} changed from ${litresText(litres)} to ${litresText(request.litres)}`;
    litres = Number(request.litres);
    pumpId = source.pump_id;
    tankId = source.tank_id;
  } else {
    summary = `${litresText(litres)} ${entry.fuel_type} for ${account.name} voided: it was not supplied`;
  }

  await trx('invoice_consumption').where({ id: entry.id }).update({
    entry_status: 'reversed',
    reversed_at: ctx.now,
    reversed_by_employee_id: ctx.approverId,
    correction_reason: summary,
    updated_at: ctx.now,
    deleted_at: ctx.now,
    reversed_by_correction_id: ctx.headerId,
  });

  let replacementId: number | null = null;
  const price = Number(entry.retail_price_at_time);
  const retail = roundMoney(litres * price);
  if (request.kind !== 'not_valid') {
    [replacementId] = await trx('invoice_consumption').insert({
      account_id: owner.id,
      shift_id: shift.id,
      pump_id: pumpId,
      tank_id: tankId,
      fuel_type: entry.fuel_type,
      litres,
      retail_price_at_time: price,
      retail_amount: retail,
      invoice_line_id: null,
      correction_of_id: entry.id,
      entry_status: 'active',
      correction_reason: summary,
      created_by_employee_id: ctx.approverId,
      created_by_correction_id: ctx.headerId,
    });
  }

  // Litres on account can never exceed what the pumps sold on the shift.
  const readings = await trx('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .where('pump_readings.shift_id', shift.id)
    .select('pump_readings.*', 'pumps.fuel_type');
  const active = await trx('invoice_consumption').where({ shift_id: shift.id }).whereNull('deleted_at');
  const litreValidation = validateInvoiceConsumptionAgainstReadings(readings, active);

  return {
    summary,
    originalId: Number(entry.id),
    original: {
      entry_id: Number(entry.id),
      account_id: Number(account.id),
      account_name: account.name,
      fuel_type: entry.fuel_type,
      litres: Number(entry.litres),
      pump_id: entry.pump_id ? Number(entry.pump_id) : null,
      retail_amount: Number(entry.retail_amount),
    },
    replacementId,
    replacement: replacementId
      ? {
          entry_id: replacementId,
          account_id: Number(owner.id),
          account_name: owner.name,
          fuel_type: entry.fuel_type,
          litres,
          pump_id: pumpId,
          retail_amount: retail,
        }
      : null,
    amountDelta: roundMoney((request.kind === 'not_valid' ? 0 : retail) - Number(entry.retail_amount)),
    accountIds: [...new Set([Number(account.id), Number(owner.id)])],
    litreValidation,
  };
}

// What the attendant is charged for, or relieved of, by the correction.
async function settleAttendant(
  ctx: Context,
  deficitChange: number,
  reason: string,
) {
  const { trx, shift } = ctx;
  const employeeId = Number(shift.employee_id);
  const effect = { debt_added: 0, debt_reduced: 0, refund_owed: 0, not_refunded: 0 };

  if (deficitChange > 0) {
    const [debtId] = await trx('staff_debts').insert({
      employee_id: employeeId,
      shift_id: shift.id,
      original_deficit: deficitChange,
      deducted_from_wage: 0,
      carried_forward: deficitChange,
      balance: deficitChange,
      status: 'outstanding',
      // Approved with the correction itself.
      recovery_status: 'confirmed',
    });
    await trx('staff_debt_adjustments').insert({
      shift_id: shift.id,
      employee_id: employeeId,
      staff_debt_id: debtId,
      accountability_adjustment_id: ctx.headerId,
      adjustment_type: 'increase',
      amount: deficitChange,
      balance_before: 0,
      balance_after: deficitChange,
      status: 'posted',
      reason,
      created_by_employee_id: ctx.approverId,
    });
    effect.debt_added = deficitChange;
    return effect;
  }
  if (deficitChange === 0) return effect;

  // Relief: first whatever of this shift's shortage is still unpaid.
  let relief = Math.abs(deficitChange);
  const debts = await trx('staff_debts')
    .where({ shift_id: shift.id, employee_id: employeeId, status: 'outstanding' })
    .where('balance', '>', 0)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc');
  for (const debt of debts) {
    if (relief <= 0) break;
    const before = roundMoney(Number(debt.balance));
    const applied = roundMoney(Math.min(relief, before));
    const after = roundMoney(before - applied);
    await trx('staff_debts').where({ id: debt.id }).update({
      balance: after,
      status: after === 0 ? 'cleared' : 'outstanding',
    });
    await trx('staff_debt_adjustments').insert({
      shift_id: shift.id,
      employee_id: employeeId,
      staff_debt_id: debt.id,
      accountability_adjustment_id: ctx.headerId,
      adjustment_type: 'decrease',
      amount: applied,
      balance_before: before,
      balance_after: after,
      status: 'posted',
      reason,
      created_by_employee_id: ctx.approverId,
    });
    effect.debt_reduced = roundMoney(effect.debt_reduced + applied);
    relief = roundMoney(relief - applied);
  }
  if (relief <= 0) return effect;

  // The rest was already recovered from the attendant: owed back to them, but
  // only what they actually paid. A shortage that was written off, not paid,
  // is not refunded.
  const debtIds = await trx('staff_debts').where({ shift_id: shift.id, employee_id: employeeId }).pluck('id');
  let recovered = 0;
  if (debtIds.length) {
    for (const table of ['payroll_debt_allocations', 'shift_staff_debt_allocations', 'staff_debt_receipt_allocations']) {
      if (!(await trx.schema.hasTable(table))) continue;
      const row = await trx(table).whereIn('staff_debt_id', debtIds).whereNull('reversed_at').sum({ total: 'amount' }).first();
      recovered += Number((row as any)?.total || 0);
    }
  }
  const owedRow = await trx('staff_debt_adjustments')
    .where({ shift_id: shift.id, adjustment_type: 'employee_credit_review' })
    .sum({ total: 'amount' })
    .first();
  const refundable = Math.max(0, roundMoney(recovered - Number((owedRow as any)?.total || 0)));
  const refund = roundMoney(Math.min(relief, refundable));
  if (refund > 0) {
    await trx('staff_debt_adjustments').insert({
      shift_id: shift.id,
      employee_id: employeeId,
      staff_debt_id: null,
      accountability_adjustment_id: ctx.headerId,
      adjustment_type: 'employee_credit_review',
      amount: refund,
      balance_before: null,
      balance_after: null,
      status: 'review_required',
      reason: `${reason} Already recovered from ${shift.employee_name}: owed back to them.`,
      created_by_employee_id: ctx.approverId,
    });
  }
  effect.refund_owed = refund;
  effect.not_refunded = roundMoney(relief - refund);
  return effect;
}

async function runShiftCorrection(
  trx: Trx,
  request: CorrectionRequest,
  context: { approver: Approver | null; recordedBy: number | null },
) {
  const shift = await trx('shifts')
    .join('employees', 'shifts.employee_id', 'employees.id')
    .where('shifts.id', request.shiftId)
    .select('shifts.*', 'employees.name as employee_name', 'employees.daily_wage as employee_wage')
    .first();
  if (!shift) fail('Shift not found', 404);
  if (shift.status !== 'closed') {
    fail('Only a closed shift is corrected this way. While a shift is open, remove or re-enter the entry on the shift itself.');
  }

  const now = new Date().toISOString();
  const postingDate = getKenyaDate();
  const approverId = context.approver ? Number(context.approver.id) : null;
  const [headerId] = await trx('shift_accountability_adjustments').insert({
    shift_id: shift.id,
    adjustment_type: 'shift_correction',
    entry_type: request.entryType,
    correction_kind: request.kind,
    original_id: request.entryId,
    amount_delta: 0,
    variance_before: 0,
    variance_after: 0,
    reason: 'Correction in progress',
    note: request.note || null,
    posting_date: postingDate,
    created_by_employee_id: context.recordedBy,
    approved_by_employee_id: approverId,
    approved_by_name: context.approver?.name || null,
  });
  const ctx: Context = { trx, request, shift, headerId: Number(headerId), now, postingDate, approverId };

  const liveBefore = await liveVariance(trx, shift);
  const varianceBefore = await accountableVariance(trx, shift, ctx.headerId, liveBefore);

  // Balances before, for everyone the entry touches (read before any change).
  const entryAccounts = await accountsForEntry(trx, request, shift.id);
  const before = new Map<number, number>();
  const creditBefore = new Map<number, number>();
  for (const account of entryAccounts) {
    before.set(Number(account.id), await owedNow(trx, account));
    if (isMoneyCustomer(account)) creditBefore.set(Number(account.id), await customerCreditBalance(Number(account.id), trx));
  }
  const attendantBefore = (await employeeDebtSummary(Number(shift.employee_id), trx)).outstanding;

  const outcome = request.entryType === 'credit'
    ? await correctCredit(ctx)
    : request.entryType === 'payment'
      ? await correctPayment(ctx)
      : await correctConsumption(ctx);

  const liveAfter = await liveVariance(trx, shift);
  const varianceAfter = roundMoney(varianceBefore + (liveAfter - liveBefore));
  const deficitBefore = Math.max(0, roundMoney(-varianceBefore));
  const deficitAfter = Math.max(0, roundMoney(-varianceAfter));
  const deficitChange = roundMoney(deficitAfter - deficitBefore);
  const reason = `Correction #${ctx.headerId} to shift #${shift.id}: ${outcome.summary}.`;
  const attendantEffect = await settleAttendant(ctx, deficitChange, reason);

  const accounts = [];
  for (const id of outcome.accountIds) {
    const account = await trx('credit_accounts').where({ id }).first();
    if (!account) continue;
    // Credit a customer holds pays whatever this correction made payable, and
    // an overpayment it created waits for their next credit.
    if (isMoneyCustomer(account)) await applyCustomerCredit(trx, id);
    await refreshAccount(trx, account);
    if (!before.has(id)) before.set(id, 0);
    accounts.push({
      account_id: id,
      name: account.name,
      type: account.type,
      measure: account.type === 'employee'
        ? 'employee_debt'
        : account.billing_mode === 'invoice' ? 'uninvoiced_fuel' : 'credit',
      owed_before: roundMoney(before.get(id) || 0),
      owed_after: roundMoney(await owedNow(trx, account)),
      credit_before: roundMoney(creditBefore.get(id) || 0),
      credit_after: isMoneyCustomer(account) ? await customerCreditBalance(id, trx) : 0,
    });
  }
  await syncEmployeeDebt(Number(shift.employee_id), trx);
  const attendant = {
    employee_id: Number(shift.employee_id),
    name: shift.employee_name,
    deficit_before: deficitBefore,
    deficit_after: deficitAfter,
    ...attendantEffect,
    owed_before: attendantBefore,
    owed_after: (await employeeDebtSummary(Number(shift.employee_id), trx)).outstanding,
  };

  const result = {
    shift: {
      id: Number(shift.id),
      shift_date: shift.shift_date,
      employee_id: Number(shift.employee_id),
      employee_name: shift.employee_name,
    },
    entry_type: request.entryType,
    kind: request.kind,
    note: request.note || null,
    summary: outcome.summary,
    original: outcome.original,
    replacement: outcome.replacement,
    accounts,
    variance_before: varianceBefore,
    variance_after: varianceAfter,
    attendant,
    posting_date: postingDate,
    ...(outcome.litreValidation ? { litre_validation: outcome.litreValidation } : {}),
  };
  const confirmationToken = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      request: [request.shiftId, request.entryType, request.entryId, request.kind, request.accountId ?? null,
        request.amount ?? null, request.litres ?? null, request.pumpId ?? null],
      original: outcome.original,
      replacement: outcome.replacement ? { ...outcome.replacement, credit_id: undefined, shift_credit_id: undefined, payment_id: undefined, entry_id: undefined } : null,
      accounts: accounts.map((a) => [a.account_id, a.owed_before, a.owed_after, a.credit_before, a.credit_after]),
      attendant: [attendant.deficit_before, attendant.deficit_after, attendant.debt_added,
        attendant.debt_reduced, attendant.refund_owed, attendant.not_refunded, attendant.owed_before],
      variance: [varianceBefore, varianceAfter],
    }))
    .digest('hex');

  await trx('shift_accountability_adjustments').where({ id: ctx.headerId }).update({
    original_id: outcome.originalId,
    replacement_id: outcome.replacementId,
    reference_id: outcome.replacementId,
    amount_delta: outcome.amountDelta,
    variance_before: varianceBefore,
    variance_after: varianceAfter,
    reason: outcome.summary,
    details: JSON.stringify(result),
  });

  return { ...result, correction_id: ctx.headerId, confirmation_token: confirmationToken };
}

// Accounts whose balance the entry itself touches, read before any change.
async function accountsForEntry(trx: Trx, request: CorrectionRequest, shiftId: number) {
  const ids = new Set<number>();
  if (request.accountId) ids.add(Number(request.accountId));
  if (request.entryType === 'credit') {
    const row = await trx('shift_credits as sc')
      .join('credits as c', 'sc.credit_id', 'c.id')
      .where({ 'sc.id': request.entryId, 'sc.shift_id': shiftId })
      .first('c.account_id');
    if (row?.account_id) ids.add(Number(row.account_id));
  } else if (request.entryType === 'payment') {
    const row = await trx('credit_payments').where({ id: request.entryId, shift_id: shiftId }).first('account_id');
    if (row?.account_id) ids.add(Number(row.account_id));
  } else {
    const row = await trx('invoice_consumption').where({ id: request.entryId, shift_id: shiftId }).first('account_id');
    if (row?.account_id) ids.add(Number(row.account_id));
  }
  if (!ids.size) return [];
  return trx('credit_accounts').whereIn('id', [...ids]);
}

const ROLLBACK = Symbol('shift-correction-preview');

export async function previewShiftCorrection(conn: Knex, request: CorrectionRequest, recordedBy: number | null) {
  let preview: any;
  try {
    await conn.transaction(async (trx) => {
      preview = await runShiftCorrection(trx, request, { approver: null, recordedBy });
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  const { correction_id: _unused, ...rest } = preview;
  return rest;
}

export async function postShiftCorrection(
  trx: Trx,
  request: CorrectionRequest,
  input: { approver: Approver; recordedBy: number | null; confirmationToken: string },
) {
  const result = await runShiftCorrection(trx, request, { approver: input.approver, recordedBy: input.recordedBy });
  if (result.confirmation_token !== input.confirmationToken) {
    fail('Something on this shift changed after the preview. Review the correction again.', 409, 'CORRECTION_STALE');
  }
  return result;
}

export async function listShiftCorrections(
  conn: Knex | Trx,
  filter: { shiftId?: number; from?: string; to?: string; postingDate?: string },
) {
  let query = conn('shift_accountability_adjustments as c')
    .join('shifts as s', 'c.shift_id', 's.id')
    .leftJoin('employees as attendant', 's.employee_id', 'attendant.id')
    .leftJoin('employees as recorder', 'c.created_by_employee_id', 'recorder.id')
    .select(
      'c.*',
      's.shift_date',
      'attendant.name as attendant_name',
      'recorder.name as recorded_by_name',
    );
  if (filter.shiftId) query = query.where('c.shift_id', filter.shiftId);
  if (filter.postingDate) {
    query = query.whereRaw("COALESCE(c.posting_date, date(c.created_at, '+3 hours')) = ?", [filter.postingDate]);
  }
  if (filter.from) query = query.whereRaw("COALESCE(c.posting_date, date(c.created_at, '+3 hours')) >= ?", [filter.from]);
  if (filter.to) query = query.whereRaw("COALESCE(c.posting_date, date(c.created_at, '+3 hours')) <= ?", [filter.to]);
  const rows = await query.orderBy('c.created_at', 'desc').orderBy('c.id', 'desc');
  return rows.map((row: any) => {
    let details = null;
    try {
      details = row.details ? JSON.parse(row.details) : null;
    } catch {
      details = null;
    }
    return { ...row, details };
  });
}
