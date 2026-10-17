import type { Knex } from 'knex';
import type { ApplyContext, CorrectionRequest, CorrectionRule, PlanLine, RulePlan } from '../corrections';
import { cents, httpError, kes, methodName, type Conn } from './common';

// The declaration stays as entered. Signed correction lines supply its current
// value, independently of any preceding or subsequent shift.
export async function fundsShift(conn: Conn, shiftId: unknown) {
  if (!Number.isSafeInteger(Number(shiftId)) || Number(shiftId) <= 0) throw httpError('Choose the shift.', 400, 'SHIFT_REQUIRED');
  const shift = await conn('shifts').where({ id: Number(shiftId) }).first();
  if (!shift) throw httpError('Shift not found.', 404, 'SHIFT_NOT_FOUND');
  if (!['open', 'closed'].includes(shift.status)) throw httpError('This shift cannot record funds movements.', 409, 'SHIFT_NOT_ACTIVE');
  if (shift.reconciliation_basis !== 'balances_v1') {
    throw httpError('Opening funds were not captured for this historical shift. Its original calculation is preserved.', 409, 'LEGACY_SHIFT');
  }
  return shift;
}

export function fundsAmount(value: unknown, allowZero = false) {
  const numeric = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(numeric)
    || numeric < 0 || numeric > 100_000_000 || (!allowZero && cents(numeric) <= 0)) {
    throw httpError(allowZero ? 'Enter an opening amount from zero to KES 100,000,000.' : 'Enter a positive amount up to KES 100,000,000.', 400, 'INVALID_AMOUNT');
  }
  return cents(numeric) / 100;
}

export async function preCloseUndoBlocker(conn: Conn, lines: any[]) {
  for (const shiftId of new Set(lines.filter((line) => Boolean(line.shift_open)).map((line) => Number(line.shift_id)))) {
    const shift = await conn('shifts').where({ id: shiftId }).first('status');
    if (shift?.status !== 'open') return 'This entry was included when the shift closed. Make a new correction to the closed shift instead.';
  }
  return null;
}

async function plan(conn: Conn, req: CorrectionRequest): Promise<RulePlan> {
  const shift = await fundsShift(conn, req.shift_id);
  const method = req.payment_method;
  if (!['cash', 'mpesa'].includes(String(method))) throw httpError('Choose cash or M-Pesa.', 400, 'METHOD_REQUIRED');
  const amount = fundsAmount(req.amount, true);
  const raw = method === 'cash' ? shift.opening_cash_amount : shift.opening_mpesa_amount;
  if (raw === null || raw === undefined) throw httpError('This shift has no opening declaration for that method.', 409, 'OPENING_NOT_CAPTURED');
  const history = await conn('correction_lines').where({ shift_id: shift.id }).orderBy('id');
  const openingHistory = history.filter((line: any) => line.record_type === 'opening_funds' && line.method === method);
  const current = openingHistory.reduce((total: number, line: any) => total + (line.action === 'reverse' ? -1 : 1) * cents(line.amount), cents(raw)) / 100;
  if (cents(current) === cents(amount)) throw httpError('Nothing would change: enter the correct opening amount.', 400, 'NO_CHANGE');
  const base = {
    record_type: 'opening_funds', target_id: Number(shift.id), shift_id: Number(shift.id), shift_open: shift.status === 'open',
    party_type: null, party_id: null, party_name: null, fuel_type: null, litres: null, unit_price: null,
    stage: null, invoice_id: null, invoice_number: null, method,
  };
  const lines: PlanLine[] = [
    { ...base, seq: 1, action: 'reverse', amount: current, shift_effect: current },
    { ...base, seq: 2, action: 'add', amount, shift_effect: -amount },
  ];
  return {
    effective_date: String(shift.shift_date).slice(0, 10), lines, documents: [], drafts: [],
    state_key: JSON.stringify({ shift: shift.id, status: shift.status, basis: shift.reconciliation_basis, raw, history }),
    effects: [
      `Shift #${shift.id}: opening ${methodName(method)} ${kes(current)} → ${kes(amount)}.`,
      'The original opening declaration is preserved. Only this shift changes; its closing count does not change.',
    ],
  };
}

async function undoBlocker(conn: Conn, correction: any, lines: any[]) {
  const closed = await preCloseUndoBlocker(conn, lines);
  if (closed) return closed;
  const first = lines[0];
  const later = await conn('correction_lines as l').join('corrections as c', 'l.correction_id', 'c.id')
    .where({ 'l.shift_id': first.shift_id, 'l.record_type': 'opening_funds', 'l.method': first.method, 'c.kind': 'correction', 'c.status': 'posted' })
    .where('c.id', '>', correction.id).first('c.number');
  return later ? `${later.number} corrected the same opening amount since. Undo that first.` : null;
}

export const openingFundsRule: CorrectionRule = {
  recordType: 'opening_funds', errorKinds: ['wrong_amount'],
  unchanged: 'Sales, tank stock, profit and other shifts: no change.', plan,
  async apply() { return {}; }, undoBlocker,
  async undo(_trx: Knex.Transaction, _correction: any, _lines: any[], _ctx: ApplyContext) { return []; },
};
