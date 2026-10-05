import type { Knex } from 'knex';
import type { ApplyContext, CorrectionRequest, CorrectionRule, Plan, PlanLine, RulePlan } from '../corrections';
import { recomputeAccountBalance } from '../accountBalance';
import { applyCustomerCredit, reverseMoneyAccountPaymentInTransaction, roundMoney } from '../receivablePayments';
import {
  cents, closedShift, customerOutlook, earliest, httpError, kes, laterCorrection, methodName, moneyCustomer,
  outlookText, positiveAmount, type Conn, type ShiftRef,
} from './common';

// Corrections of a debt receipt: a credit customer's payment taken into a
// closed shift's drawer, in cash or M-Pesa. A receipt adds to what the drawer
// should hold, so removing one makes that shift's result better and adding one
// makes it worse; cash and M-Pesa the wrong way round changes neither (only
// the split). The customer side is the payment itself: reversing it puts back
// what it paid off; an added payment pays the customer's debts, oldest first,
// and anything beyond them is held as their credit (the money was received).

const ERROR_KINDS = ['wrong_customer', 'wrong_amount', 'wrong_method', 'wrong_shift', 'duplicate', 'missing'];

async function liveReceipt(conn: Conn, paymentId: number) {
  const payment = await conn('credit_payments').where({ id: paymentId }).first();
  if (!payment || payment.deleted_at) throw httpError('Payment not found.', 404, 'PAYMENT_NOT_FOUND');
  if ((payment.status || 'posted') !== 'posted') throw httpError('This payment was already reversed or corrected.', 409, 'PAYMENT_NOT_ACTIVE');
  if (!payment.shift_id) throw httpError('This payment was not taken in a shift.', 400, 'NOT_SHIFT_RECEIPT');
  // Its money must still be all there: none of it refunded since.
  const refunded: any = await conn('customer_refund_allocations as allocation')
    .join('customer_refunds as refund', 'allocation.refund_id', 'refund.id')
    .where('allocation.payment_id', payment.id)
    .where('refund.status', 'posted')
    .sum({ total: 'allocation.amount' })
    .first();
  if (cents(refunded?.total) > 0) {
    throw httpError('Part of this payment was held as credit and has been refunded to the customer, so it cannot be corrected.', 409, 'PAYMENT_PARTLY_REFUNDED');
  }
  const applied: any = await conn('credit_payment_allocations').where({ payment_id: payment.id }).whereNull('reversed_at')
    .sum({ total: 'amount_applied' }).first();
  if (cents(applied?.total) + cents(payment.unapplied_amount) !== cents(payment.amount)) {
    throw httpError('This payment\'s history is incomplete. Run the receivables integrity audit first.', 409, 'PAYMENT_ALLOCATION_INCOMPLETE');
  }
  return payment;
}

function method(value: unknown) {
  if (value !== 'cash' && value !== 'mpesa') throw httpError('Choose cash or M-Pesa.', 400, 'METHOD_REQUIRED');
  return value;
}

async function plan(conn: Conn, req: CorrectionRequest): Promise<RulePlan> {
  const lines: PlanLine[] = [];
  const effects: string[] = [];
  let target: any = null;
  let from: ShiftRef | null = null;
  let owner: any = null;
  if (req.error_kind !== 'missing') {
    if (!req.target_id) throw httpError('Choose the payment to correct.', 400, 'TARGET_REQUIRED');
    target = await liveReceipt(conn, req.target_id);
    from = await closedShift(conn, target.shift_id, 'reverse the payment');
    owner = await moneyCustomer(conn, target.account_id);
  }

  let add: null | { account: any; shift: ShiftRef; amount: number; method: string } = null;
  const same = () => ({ account: owner, shift: from!, amount: roundMoney(Number(target.amount)), method: String(target.payment_method || 'cash') });
  switch (req.error_kind) {
    case 'wrong_customer': {
      const account = await moneyCustomer(conn, req.account_id);
      if (Number(account.id) === Number(owner.id)) throw httpError('Choose the customer who paid.', 400, 'NO_CHANGE');
      add = { ...same(), account };
      break;
    }
    case 'wrong_amount': {
      const amount = positiveAmount(req.amount, 'Enter the amount received.');
      if (cents(amount) === cents(target.amount)) throw httpError('Nothing would change: enter the amount received.', 400, 'NO_CHANGE');
      add = { ...same(), amount };
      break;
    }
    case 'wrong_method':
      add = { ...same(), method: target.payment_method === 'mpesa' ? 'cash' : 'mpesa' };
      break;
    case 'wrong_shift': {
      const shift = await closedShift(conn, req.shift_id, 'record the payment');
      if (shift.id === from!.id) throw httpError('Choose the shift the payment was received in.', 400, 'NO_CHANGE');
      add = { ...same(), shift };
      break;
    }
    case 'missing': {
      const shift = await closedShift(conn, req.shift_id, 'record the payment');
      add = {
        account: await moneyCustomer(conn, req.account_id),
        shift,
        amount: positiveAmount(req.amount, 'Enter the amount received.'),
        method: method(req.payment_method),
      };
      break;
    }
    default:
      break;
  }

  if (target) {
    lines.push({
      seq: 1, action: 'reverse', record_type: 'debt_receipt', target_id: Number(target.id), shift_id: from!.id, shift_open: false,
      party_type: 'customer', party_id: Number(owner.id), party_name: owner.name, fuel_type: null, litres: null, unit_price: null,
      amount: roundMoney(Number(target.amount)), stage: null, invoice_id: null, invoice_number: null,
      // Less money expected in the drawer.
      shift_effect: roundMoney(Number(target.amount)), method: target.payment_method || 'cash',
    });
    effects.push(`Reversed: ${kes(target.amount)} paid by ${owner.name} in ${methodName(target.payment_method)} in shift #${from!.id}.`);
  }
  if (add) {
    lines.push({
      seq: 2, action: 'add', record_type: 'debt_receipt', target_id: target ? Number(target.id) : null, shift_id: add.shift.id,
      shift_open: false, party_type: 'customer', party_id: Number(add.account.id), party_name: add.account.name, fuel_type: null,
      litres: null, unit_price: null, amount: add.amount, stage: null, invoice_id: null, invoice_number: null,
      shift_effect: -add.amount, method: add.method,
    });
    effects.push(`Added: ${kes(add.amount)} paid by ${add.account.name} in ${methodName(add.method)} in shift #${add.shift.id}.`);
  }
  if (req.error_kind === 'wrong_method') {
    effects.push(`Shift #${from!.id}: the drawer took ${kes(target.amount)} more in ${methodName(add!.method)} and that much less in ${methodName(target.payment_method)} for debts. The shift's result does not change.`);
  }

  const changes = new Map<number, any[]>();
  if (target) changes.set(Number(owner.id), [{ removePayment: target }]);
  if (add) changes.set(Number(add.account.id), [...(changes.get(Number(add.account.id)) || []), { addPayment: add.amount }]);
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
  };
}

async function reverseReceipt(trx: Knex.Transaction, paymentId: number, correctionId: number, reason: string, actorId: number | null) {
  await reverseMoneyAccountPaymentInTransaction(trx, { paymentId, reason, actorId, skipBalanceRefresh: true });
  await trx('credit_payments').where({ id: paymentId }).update({ reversed_by_record_correction_id: correctionId });
  return trx('credit_payments').where({ id: paymentId }).first('account_id');
}

async function settle(trx: Knex.Transaction, accountIds: Iterable<number>) {
  for (const accountId of new Set(accountIds)) {
    await applyCustomerCredit(trx, accountId);
    await recomputeAccountBalance(accountId, trx);
  }
}

async function apply(trx: Knex.Transaction, planned: Plan, ctx: ApplyContext) {
  const out: Record<number, { created_record_id?: number }> = {};
  const accounts: number[] = [];
  const reason = `${ctx.number}: ${ctx.reason}`;
  const reverse = planned.lines.find((l) => l.action === 'reverse');
  const add = planned.lines.find((l) => l.action === 'add');
  if (reverse) accounts.push(Number((await reverseReceipt(trx, Number(reverse.target_id), ctx.correctionId, reason, ctx.actorId)).account_id));
  if (add) {
    const shift = await trx('shifts').where({ id: add.shift_id }).first('shift_date');
    const [paymentId] = await trx('credit_payments').insert({
      credit_id: null,
      account_id: add.party_id,
      amount: add.amount,
      payment_method: add.method,
      payment_type: 'account',
      date: String(shift.shift_date).slice(0, 10),
      notes: reason,
      status: 'posted',
      shift_id: add.shift_id,
      // Pays their debts when settled below; the rest is their credit.
      unapplied_amount: add.amount,
      created_by_record_correction_id: ctx.correctionId,
    });
    out[add.seq] = { created_record_id: Number(paymentId) };
    accounts.push(Number(add.party_id));
  }
  await settle(trx, accounts);
  return out;
}

async function undoBlocker(conn: Conn, correction: any, lines: any[]): Promise<string | null> {
  for (const line of lines.filter((l) => l.action === 'add')) {
    const created = await conn('credit_payments').where({ id: line.created_record_id }).first();
    if (!created) return 'Its payment is missing.';
    if (created.status !== 'posted') return `Its payment was corrected again${await laterCorrection(conn, created.reversed_by_record_correction_id)}. Undo that first.`;
    try {
      await liveReceipt(conn, Number(created.id));
    } catch (err: any) {
      return err.message;
    }
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    const original = await conn('credit_payments').where({ id: line.target_id }).first();
    if (!original || Number(original.reversed_by_record_correction_id) !== Number(correction.id)) return 'The payment it reversed has changed since.';
  }
  return null;
}

async function undo(trx: Knex.Transaction, correction: any, lines: any[], ctx: ApplyContext) {
  const accounts: number[] = [];
  const reason = `${ctx.number}: undoes ${correction.number}: ${ctx.reason}`;
  for (const line of lines.filter((l) => l.action === 'add')) {
    accounts.push(Number((await reverseReceipt(trx, Number(line.created_record_id), ctx.correctionId, reason, ctx.actorId)).account_id));
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    const payment = await trx('credit_payments').where({ id: line.target_id }).first();
    // Back as it was received; it pays the customer's debts again below.
    await trx('credit_payments').where({ id: payment.id }).update({
      status: 'posted',
      reversed_at: null,
      reversed_by_employee_id: null,
      reversal_reason: null,
      unapplied_amount: payment.amount,
      reversed_by_record_correction_id: null,
    });
    accounts.push(Number(payment.account_id));
  }
  await settle(trx, accounts);
  return [];
}

export const debtReceiptRule: CorrectionRule = {
  recordType: 'debt_receipt',
  errorKinds: ERROR_KINDS,
  unchanged: 'Fuel sales and tank stock: no change.',
  plan,
  apply,
  undoBlocker,
  undo,
};
