import type { Knex } from 'knex';
import type { ApplyContext, CorrectionRequest, CorrectionRule, PlanLine, RulePlan } from '../corrections';
import { roundMoney } from '../receivablePayments';
import { cents, closedShift, httpError, kes, methodName, positiveAmount, type Conn } from './common';

// Cash and M-Pesa recorded the wrong way round on a closed shift's
// collections (one total of each per shift). The drawer's total and the
// shift's result do not change; only the split, and with it the M-Pesa fee at
// the shift's rate. Nothing is rewritten: the correction's two lines (out of
// one, into the other) are the record, shown on the shift and in the register.

const ERROR_KINDS = ['wrong_split'];

// The shift's M-Pesa fee rate (services/mpesaFees.ts reads the same table, but
// on its own connection, which a correction's transaction would block).
async function feeRate(conn: Conn, date: string) {
  const row = await conn('mpesa_fee_config').where('effective_date', '<=', date)
    .orderBy('effective_date', 'desc').orderBy('id', 'desc').first('fee_value');
  return row ? Number(row.fee_value) : 0.55;
}
const fee = (gross: number, rate: number) => Math.round(gross * (rate / 100) * 100) / 100;

// The split as closed plus earlier corrections of it.
async function currentSplit(conn: Conn, shiftId: number) {
  const collections = await conn('shift_collections').where({ shift_id: shiftId }).first();
  if (!collections) throw httpError(`Shift #${shiftId} has no collections recorded.`, 409, 'NO_COLLECTIONS');
  const lines = await conn('correction_lines').where({ shift_id: shiftId, record_type: 'collection' }).select('action', 'method', 'amount');
  let cash = cents(collections.cash_amount);
  let mpesa = cents(collections.mpesa_amount);
  for (const line of lines) {
    const sign = line.action === 'reverse' ? -1 : 1;
    if (line.method === 'mpesa') mpesa += sign * cents(line.amount);
    else cash += sign * cents(line.amount);
  }
  return { collections, cash: cash / 100, mpesa: mpesa / 100 };
}

async function plan(conn: Conn, req: CorrectionRequest): Promise<RulePlan> {
  const shift = await closedShift(conn, req.shift_id, 'change the cash and M-Pesa');
  const to = req.payment_method;
  if (to !== 'cash' && to !== 'mpesa') throw httpError('Say what the money really was: cash or M-Pesa.', 400, 'METHOD_REQUIRED');
  const fromMethod = to === 'mpesa' ? 'cash' : 'mpesa';
  const amount = positiveAmount(req.amount, 'Enter the amount recorded the wrong way round.');
  const split = await currentSplit(conn, shift.id);
  const available = fromMethod === 'cash' ? split.cash : split.mpesa;
  if (cents(amount) > cents(available)) {
    throw httpError(`Shift #${shift.id} shows ${kes(available)} in ${methodName(fromMethod)}; no more than that can move.`, 400, 'AMOUNT_EXCEEDS_SPLIT');
  }
  const rate = await feeRate(conn, shift.date);
  const mpesaAfter = roundMoney(split.mpesa + (to === 'mpesa' ? amount : -amount));
  const cashAfter = roundMoney(split.cash + (to === 'cash' ? amount : -amount));
  const feeDelta = roundMoney(fee(mpesaAfter, rate) - fee(split.mpesa, rate));
  const base = {
    record_type: 'collection', target_id: Number(split.collections.id), shift_id: shift.id, shift_open: false, party_type: null,
    party_id: null, party_name: null, fuel_type: null, litres: null, unit_price: null, amount, stage: null, invoice_id: null,
    invoice_number: null, shift_effect: 0,
  };
  const lines: PlanLine[] = [
    { ...base, seq: 1, action: 'reverse', method: fromMethod },
    { ...base, seq: 2, action: 'add', method: to, fee_delta: feeDelta },
  ];
  return {
    effective_date: shift.date,
    lines,
    documents: [],
    drafts: [],
    effects: [
      `Shift #${shift.id}: ${kes(amount)} recorded as ${methodName(fromMethod)} was ${methodName(to)}.`,
      `Cash ${kes(split.cash)} → ${kes(cashAfter)}; M-Pesa ${kes(split.mpesa)} → ${kes(mpesaAfter)}.`,
      `The M-Pesa fee ${feeDelta >= 0 ? 'rises' : 'falls'} by ${kes(Math.abs(feeDelta))} (${rate}% at the shift's rate).`,
      "The drawer's total and the shift's result do not change.",
    ],
  };
}

async function apply() {
  return {};
}

// A later split correction on the same shift was worked out from this one.
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
