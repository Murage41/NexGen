import type { Knex } from 'knex';
import type { ApplyContext, CorrectionRequest, CorrectionRule, Plan, PlanLine, RulePlan } from '../corrections';
import { evaluateCreditLimits, recordCreditOverride } from '../creditLimits';
import { recomputeAccountBalance } from '../accountBalance';
import { applyCustomerCredit, roundMoney } from '../receivablePayments';
import {
  cents, closedShift, customerOutlook, earliest, httpError, kes, laterCorrection, moneyCustomer,
  outlookText, positiveAmount, releaseCreditAllocations, type Conn, type ShiftRef,
} from './common';

// Corrections of a credit sale (a money customer's credit on a closed shift).
// A credit sale is two rows: the customer's debt (`credits`) and the shift's
// tender (`shift_credits`), which counts towards what the drawer accounted for.
// The wrong sale is reversed and the right one added, on the right shift and
// customer. Money that had paid a reversed sale goes back to paying that
// customer's other debts, oldest first; what is left is held as their credit.
// A customer taking more credit is checked against their limits; going past
// them is approved with the correction.

const ERROR_KINDS = ['wrong_customer', 'wrong_amount', 'wrong_shift', 'duplicate', 'missing'];

async function liveSale(conn: Conn, shiftCreditId: number) {
  const sale = await conn('shift_credits as sc')
    .leftJoin('credits as c', 'sc.credit_id', 'c.id')
    .where('sc.id', shiftCreditId)
    .first('sc.*', 'c.id as credit_row_id', 'c.account_id', 'c.amount as credit_amount', 'c.balance as credit_balance',
      'c.status as credit_status', 'c.deleted_at as credit_deleted_at');
  if (!sale) throw httpError('Credit sale not found.', 404, 'SALE_NOT_FOUND');
  if (sale.deleted_at || sale.reversed_by_record_correction_id) {
    throw httpError('This credit sale was already removed or corrected.', 409, 'SALE_NOT_ACTIVE');
  }
  if (!sale.credit_row_id || sale.credit_deleted_at || !sale.account_id) {
    throw httpError('This credit sale is not on a customer account, so it cannot be corrected here.', 409, 'SALE_NO_ACCOUNT');
  }
  return sale;
}

async function plan(conn: Conn, req: CorrectionRequest): Promise<RulePlan> {
  const lines: PlanLine[] = [];
  const effects: string[] = [];
  let target: any = null;
  let from: ShiftRef | null = null;
  let owner: any = null;
  if (req.error_kind !== 'missing') {
    if (!req.target_id) throw httpError('Choose the credit sale to correct.', 400, 'TARGET_REQUIRED');
    target = await liveSale(conn, req.target_id);
    from = await closedShift(conn, target.shift_id, 'remove or change the credit');
    owner = await moneyCustomer(conn, target.account_id);
  }

  let add: null | { account: any; shift: ShiftRef; amount: number; description: string | null } = null;
  switch (req.error_kind) {
    case 'wrong_customer': {
      const account = await moneyCustomer(conn, req.account_id);
      if (Number(account.id) === Number(owner.id)) throw httpError('Choose the customer who took the credit.', 400, 'NO_CHANGE');
      add = { account, shift: from!, amount: roundMoney(Number(target.amount)), description: target.description };
      break;
    }
    case 'wrong_amount': {
      const amount = positiveAmount(req.amount, 'Enter the right amount.');
      if (cents(amount) === cents(target.amount)) throw httpError('Nothing would change: enter the right amount.', 400, 'NO_CHANGE');
      add = { account: owner, shift: from!, amount, description: target.description };
      break;
    }
    case 'wrong_shift': {
      const shift = await closedShift(conn, req.shift_id, 'record the credit');
      if (shift.id === from!.id) throw httpError('Choose the shift the credit was given on.', 400, 'NO_CHANGE');
      add = { account: owner, shift, amount: roundMoney(Number(target.amount)), description: target.description };
      break;
    }
    case 'missing': {
      const shift = await closedShift(conn, req.shift_id, 'record the credit');
      const account = await moneyCustomer(conn, req.account_id);
      add = { account, shift, amount: positiveAmount(req.amount, 'Enter the amount of the credit.'), description: req.description || null };
      break;
    }
    default:
      break;
  }

  if (target) {
    lines.push({
      seq: 1, action: 'reverse', record_type: 'credit_sale', target_id: Number(target.id), shift_id: from!.id, shift_open: false,
      party_type: 'customer', party_id: Number(owner.id), party_name: owner.name, fuel_type: null, litres: null, unit_price: null,
      amount: roundMoney(Number(target.amount)), stage: target.credit_status || null, invoice_id: null, invoice_number: null,
      shift_effect: -roundMoney(Number(target.amount)),
    });
    effects.push(`Reversed: credit sale of ${kes(target.amount)} to ${owner.name} in shift #${from!.id}.`);
    const paid = roundMoney(Number(target.credit_amount) - Number(target.credit_balance));
    if (paid > 0) effects.push(`${kes(paid)} already paid on it goes to ${owner.name}'s other debts first; anything left is held as their credit.`);
  }
  let needsOverride = false;
  if (add) {
    lines.push({
      seq: 2, action: 'add', record_type: 'credit_sale', target_id: target ? Number(target.id) : null, shift_id: add.shift.id,
      shift_open: false, party_type: 'customer', party_id: Number(add.account.id), party_name: add.account.name, fuel_type: null,
      litres: null, unit_price: null, amount: add.amount, stage: null, invoice_id: null, invoice_number: null, shift_effect: add.amount,
    });
    effects.push(`Added: credit sale of ${kes(add.amount)} to ${add.account.name} in shift #${add.shift.id}.`);
    // More credit for this customer than before is checked against their limits.
    const more = roundMoney(add.amount - (target && Number(owner.id) === Number(add.account.id) ? Number(target.credit_balance) : 0));
    if (more > 0) {
      const check = await evaluateCreditLimits(add.account, more, conn);
      if (check.breaches.length) {
        needsOverride = true;
        effects.push(`Over ${add.account.name}'s credit limits: ${check.breaches.map((b) => b.message).join(' ')}`);
        effects.push(req.limit_override ? 'Going past the limit is approved with this correction.' : 'Approve going past the limit to post it.');
      }
    }
  }

  // What each customer owes before and after.
  const changes = new Map<number, any[]>();
  if (target) changes.set(Number(owner.id), [{ removeCredit: { id: target.credit_row_id, balance: target.credit_balance } }]);
  if (add) changes.set(Number(add.account.id), [...(changes.get(Number(add.account.id)) || []), { addCredit: add.amount }]);
  for (const [accountId, list] of changes) {
    const name = accountId === Number(owner?.id) ? owner.name : add!.account.name;
    effects.push(outlookText(name, await customerOutlook(conn, accountId, list)));
  }

  return {
    effective_date: earliest(...[from?.date, add?.shift.date].filter(Boolean) as string[]),
    lines,
    documents: [],
    drafts: [],
    effects,
    needs_override: needsOverride,
  };
}

async function reverseSale(trx: Knex.Transaction, shiftCreditId: number, correctionId: number, at: string) {
  const sale = await trx('shift_credits').where({ id: shiftCreditId }).first();
  await trx('shift_credits').where({ id: sale.id }).update({ deleted_at: at, reversed_by_record_correction_id: correctionId });
  await releaseCreditAllocations(trx, Number(sale.credit_id), at);
  await trx('credits').where({ id: sale.credit_id }).update({
    balance: 0, status: 'reversed', deleted_at: at, reversed_by_record_correction_id: correctionId,
  });
  return trx('credits').where({ id: sale.credit_id }).first('account_id');
}

async function settle(trx: Knex.Transaction, accountIds: Iterable<number>) {
  for (const accountId of new Set(accountIds)) {
    await applyCustomerCredit(trx, accountId);
    await recomputeAccountBalance(accountId, trx);
  }
}

async function apply(trx: Knex.Transaction, planned: Plan, ctx: ApplyContext) {
  const out: Record<number, { created_record_id?: number }> = {};
  const now = new Date().toISOString();
  const accounts: number[] = [];
  const reverse = planned.lines.find((l) => l.action === 'reverse');
  const add = planned.lines.find((l) => l.action === 'add');
  const target = reverse ? await trx('shift_credits').where({ id: reverse.target_id }).first() : null;
  if (reverse) accounts.push(Number((await reverseSale(trx, Number(reverse.target_id), ctx.correctionId, now)).account_id));
  if (add) {
    const account = await trx('credit_accounts').where({ id: add.party_id }).first();
    const check = planned.needs_override ? await evaluateCreditLimits(account, add.amount, trx) : null;
    const description = planned.request.error_kind === 'missing' ? planned.request.description || null : target?.description ?? null;
    const [creditId] = await trx('credits').insert({
      customer_name: account.name,
      customer_phone: account.phone || null,
      amount: add.amount,
      balance: add.amount,
      shift_id: add.shift_id,
      description,
      status: 'outstanding',
      account_id: account.id,
      created_by_record_correction_id: ctx.correctionId,
    });
    const [saleId] = await trx('shift_credits').insert({
      shift_id: add.shift_id,
      customer_name: account.name,
      customer_phone: account.phone || null,
      amount: add.amount,
      description,
      credit_id: creditId,
      created_by_record_correction_id: ctx.correctionId,
    });
    if (check && check.breaches.length) {
      await recordCreditOverride(trx, {
        account, shiftId: add.shift_id, creditId: Number(creditId), check, approver: ctx.approver, recordedBy: ctx.actorId,
      });
    }
    out[add.seq] = { created_record_id: Number(saleId) };
    accounts.push(Number(account.id));
  }
  await settle(trx, accounts);
  return out;
}

async function undoBlocker(conn: Conn, correction: any, lines: any[]): Promise<string | null> {
  for (const line of lines.filter((l) => l.action === 'add')) {
    const created = await conn('shift_credits').where({ id: line.created_record_id }).first();
    if (!created) return 'Its credit sale is missing.';
    if (created.deleted_at) return `Its credit sale was corrected again${await laterCorrection(conn, created.reversed_by_record_correction_id)}. Undo that first.`;
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    const original = await conn('shift_credits').where({ id: line.target_id }).first();
    if (!original || Number(original.reversed_by_record_correction_id) !== Number(correction.id)) return 'The credit sale it reversed has changed since.';
  }
  return null;
}

async function undo(trx: Knex.Transaction, _correction: any, lines: any[], ctx: ApplyContext) {
  const now = new Date().toISOString();
  const accounts: number[] = [];
  for (const line of lines.filter((l) => l.action === 'add')) {
    accounts.push(Number((await reverseSale(trx, Number(line.created_record_id), ctx.correctionId, now)).account_id));
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    const sale = await trx('shift_credits').where({ id: line.target_id }).first();
    await trx('shift_credits').where({ id: sale.id }).update({ deleted_at: null, reversed_by_record_correction_id: null });
    const credit = await trx('credits').where({ id: sale.credit_id }).first();
    await trx('credits').where({ id: credit.id }).update({
      balance: credit.amount, status: 'outstanding', deleted_at: null, reversed_by_record_correction_id: null,
    });
    accounts.push(Number(credit.account_id));
  }
  await settle(trx, accounts);
  return [];
}

export const creditSaleRule: CorrectionRule = {
  recordType: 'credit_sale',
  errorKinds: ERROR_KINDS,
  unchanged: 'Fuel sales and tank stock: no change.',
  plan,
  apply,
  undoBlocker,
  undo,
};
