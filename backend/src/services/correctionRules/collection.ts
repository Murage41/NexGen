import type { Knex } from 'knex';
import crypto from 'crypto';
import type { ApplyContext, CorrectionRequest, CorrectionRule, PlanLine, RulePlan } from '../corrections';
import { roundMoney } from '../receivablePayments';
import { readShiftFinancials } from '../shiftFinancials';
import { cents, closedShift, httpError, kes, methodName, positiveAmount, type Conn } from './common';

// A closed shift keeps its recorded count. Signed correction lines supply
// independently corrected cash and M-Pesa totals, without moving real money.
// The old split-only request remains readable and supported.

const ERROR_KINDS = ['wrong_amount', 'wrong_split'];

async function currentSplit(conn: Conn, shiftId: number) {
  const collections = await conn('shift_collections').where({ shift_id: shiftId }).first();
  const financial = (await readShiftFinancials(conn, [shiftId])).get(shiftId);
  if (!financial || (!collections && !financial.original_snapshot)) {
    throw httpError(`Shift #${shiftId} has no saved closing counts to correct.`, 409, 'NO_COLLECTIONS');
  }
  const shift = await conn('shifts').where({ id: shiftId }).first();
  const history = await conn('correction_lines as l').join('corrections as c', 'l.correction_id', 'c.id')
    .where('l.shift_id', shiftId).orderBy('l.id')
    .select('l.*', 'c.kind as correction_kind', 'c.status as correction_status', 'c.plan_hash as correction_plan_hash',
      'c.undoes_correction_id', 'c.undone_by_correction_id');
  const state_key = crypto.createHash('sha256').update(JSON.stringify({ shift, collections, financial, history })).digest('hex');
  return { collections, cash: financial.current.total_cash, mpesa: financial.current.total_mpesa, state_key };
}

function closingAmount(value: unknown, method: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000
    || Math.round(value * 100) / 100 !== value) {
    throw httpError(`Enter the correct ${method} total as a number from zero to KES 100,000,000, with at most two decimal places.`, 400, 'INVALID_AMOUNT');
  }
  return value;
}

async function plan(conn: Conn, req: CorrectionRequest): Promise<RulePlan> {
  if (!(conn as Knex.Transaction).isTransaction) return (conn as Knex).transaction(trx => plan(trx, req));
  const shift = await closedShift(conn, req.shift_id, 'change the cash and M-Pesa');
  const split = await currentSplit(conn, shift.id);
  if (req.error_kind === 'wrong_amount') {
    const cash = closingAmount(req.cash_amount, 'cash');
    const mpesa = closingAmount(req.mpesa_amount, 'M-Pesa');
    const lines: PlanLine[] = [];
    for (const [method, before, after] of [['cash', split.cash, cash], ['mpesa', split.mpesa, mpesa]] as const) {
      if (cents(before) === cents(after)) continue;
      const base = {
        record_type: 'collection', target_id: split.collections ? Number(split.collections.id) : null,
        shift_id: shift.id, shift_open: false, party_type: null, party_id: null, party_name: null,
        fuel_type: null, litres: null, unit_price: null, stage: null, invoice_id: null, invoice_number: null,
        method, category: 'closing_total',
      };
      lines.push({ ...base, seq: lines.length + 1, action: 'reverse', amount: before, shift_effect: -before });
      lines.push({ ...base, seq: lines.length + 1, action: 'add', amount: after, shift_effect: after });
    }
    if (!lines.length) throw httpError('Nothing would change: enter a different cash or M-Pesa closing total.', 400, 'NO_CHANGE');
    return {
      effective_date: shift.date, lines, documents: [], drafts: [], state_key: split.state_key,
      effects: [
        `Shift #${shift.id}: closing cash ${kes(split.cash)} → ${kes(cash)}; closing M-Pesa ${kes(split.mpesa)} → ${kes(mpesa)}.`,
        `The combined closing count changes by ${kes(roundMoney(cash + mpesa - split.cash - split.mpesa))}.`,
        'This corrects the recorded count. It does not record a payment or move money.',
      ],
    };
  }
  const to = req.payment_method;
  if (to !== 'cash' && to !== 'mpesa') throw httpError('Say what the money really was: cash or M-Pesa.', 400, 'METHOD_REQUIRED');
  const fromMethod = to === 'mpesa' ? 'cash' : 'mpesa';
  const amount = positiveAmount(req.amount, 'Enter the amount recorded the wrong way round.');
  const available = fromMethod === 'cash' ? split.cash : split.mpesa;
  if (cents(amount) > cents(available)) {
    throw httpError(`Shift #${shift.id} shows ${kes(available)} in ${methodName(fromMethod)}; no more than that can move.`, 400, 'AMOUNT_EXCEEDS_SPLIT');
  }
  const mpesaAfter = roundMoney(split.mpesa + (to === 'mpesa' ? amount : -amount));
  const cashAfter = roundMoney(split.cash + (to === 'cash' ? amount : -amount));
  const base = {
    record_type: 'collection', target_id: split.collections ? Number(split.collections.id) : null, shift_id: shift.id, shift_open: false, party_type: null,
    party_id: null, party_name: null, fuel_type: null, litres: null, unit_price: null, amount, stage: null, invoice_id: null,
    invoice_number: null, shift_effect: 0,
  };
  const lines: PlanLine[] = [
    { ...base, seq: 1, action: 'reverse', method: fromMethod },
    { ...base, seq: 2, action: 'add', method: to },
  ];
  return {
    effective_date: shift.date,
    lines,
    documents: [],
    drafts: [],
    state_key: split.state_key,
    effects: [
      `Shift #${shift.id}: ${kes(amount)} recorded as ${methodName(fromMethod)} was ${methodName(to)}.`,
      `Cash ${kes(split.cash)} → ${kes(cashAfter)}; M-Pesa ${kes(split.mpesa)} → ${kes(mpesaAfter)}.`,
      "The drawer's total and the shift's result do not change.",
    ],
  };
}

async function apply() {
  return {};
}

// A later total or split correction was worked out from this one's count.
async function undoBlocker(conn: Conn, correction: any, lines: any[]): Promise<string | null> {
  const later = await conn('correction_lines as l')
    .join('corrections as c', 'l.correction_id', 'c.id')
    .where({ 'l.shift_id': lines[0].shift_id, 'l.record_type': 'collection', 'c.kind': 'correction', 'c.status': 'posted' })
    .where('c.id', '>', correction.id)
    .first('c.number');
  return later ? `${later.number} corrected the same shift's cash and M-Pesa since. Undo that first.` : null;
}

async function undo(_trx: Knex.Transaction, _correction: any, _lines: any[], _ctx: ApplyContext) {
  return [];
}

export const collectionRule: CorrectionRule = {
  recordType: 'collection',
  errorKinds: ERROR_KINDS,
  unchanged: 'Fuel sales and tank stock: no change.',
  plan,
  apply,
  undoBlocker,
  undo,
};
