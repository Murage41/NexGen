import type { Knex } from 'knex';
import type { ApplyContext, CorrectionRequest, CorrectionRule, Plan, PlanLine, RulePlan } from '../corrections';
import { httpError, kes, laterCorrection, methodName, type Conn } from './common';
import { fundsAmount, fundsShift, preCloseUndoBlocker } from './openingFunds';

const SOURCES = ['station_bank_safe', 'owner', 'other'];
const sourceName = (source: string) => source === 'station_bank_safe' ? 'station bank/safe' : source === 'owner' ? 'owner' : 'other custody movement';

async function activeMovement(conn: Conn, id: unknown) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw httpError('Choose the movement to reverse.', 400, 'TARGET_REQUIRED');
  const row = await conn('shift_funds_movements').where({ id: Number(id) }).first();
  if (!row) throw httpError('Funds movement not found.', 404, 'MOVEMENT_NOT_FOUND');
  if (row.deleted_at || row.reversed_by_record_correction_id) throw httpError('This funds movement was already reversed.', 409, 'MOVEMENT_NOT_ACTIVE');
  return row;
}

async function plan(conn: Conn, req: CorrectionRequest): Promise<RulePlan> {
  const target = req.error_kind === 'duplicate' ? await activeMovement(conn, req.target_id) : null;
  const shift = await fundsShift(conn, target?.shift_id ?? req.shift_id);
  const direction = target?.direction ?? req.category;
  const method = target?.method ?? req.payment_method;
  const source = target?.source ?? req.source;
  const amount = fundsAmount(target?.amount ?? req.amount);
  if (!['added', 'removed'].includes(String(direction))) throw httpError('Choose money added or money removed.', 400, 'DIRECTION_REQUIRED');
  if (!['cash', 'mpesa'].includes(String(method))) throw httpError('Choose cash or M-Pesa.', 400, 'METHOD_REQUIRED');
  if (!SOURCES.includes(String(source))) throw httpError('Choose the source or destination of this custody movement.', 400, 'SOURCE_REQUIRED');
  if (!target) {
    if (!req.reference || req.reference.length > 200) throw httpError('Enter a reference of up to 200 characters for the actual event.', 400, 'REFERENCE_REQUIRED');
    if (!req.description || req.description.length < 10 || req.description.length > 1000) throw httpError('Explain where the money came from or went (10 to 1,000 characters).', 400, 'DESTINATION_REQUIRED');
  }
  const effect = direction === 'added' ? -amount : amount;
  const line: PlanLine = {
    seq: 1, action: target ? 'reverse' : 'add', record_type: 'shift_funds', target_id: target ? Number(target.id) : null,
    shift_id: Number(shift.id), shift_open: shift.status === 'open', party_type: null, party_id: null, party_name: null,
    fuel_type: null, litres: null, unit_price: null, amount, stage: null, invoice_id: null, invoice_number: null,
    method, category: direction, shift_effect: target ? -effect : effect,
  };
  const history = await conn('shift_funds_movements').where({ shift_id: shift.id }).orderBy('id');
  const corrections = await conn('correction_lines').where({ shift_id: shift.id }).orderBy('id');
  return {
    effective_date: String(shift.shift_date).slice(0, 10), lines: [line], documents: [], drafts: [],
    state_key: JSON.stringify({ shift: shift.id, status: shift.status, basis: shift.reconciliation_basis, history, corrections }),
    effects: [
      `${target ? 'Reverse mistaken' : 'Record'} ${methodName(method)} ${direction === 'added' ? 'added from' : 'removed to'} ${sourceName(source)}: ${kes(amount)} in shift #${shift.id}.`,
      `${target?.reference ?? req.reference}: ${target?.reason ?? req.description}.`,
      'This is an otherwise unrecorded custody movement. Do not repeat an expense, wage or payment already recorded as a drawer payout.',
    ],
  };
}

async function apply(trx: Knex.Transaction, planned: Plan, ctx: ApplyContext) {
  const line = planned.lines[0];
  if (line.action === 'reverse') {
    await trx('shift_funds_movements').where({ id: line.target_id }).update({ deleted_at: new Date().toISOString(), reversed_by_record_correction_id: ctx.correctionId });
    return {};
  }
  const [id] = await trx('shift_funds_movements').insert({
    shift_id: line.shift_id, direction: line.category, method: line.method, amount: line.amount,
    source: planned.request.source, reference: planned.request.reference,
    reason: `${planned.request.description}. ${ctx.reason}`,
    created_by_record_correction_id: ctx.correctionId,
  });
  return { [line.seq]: { created_record_id: Number(id) } };
}

async function undoBlocker(conn: Conn, correction: any, lines: any[]) {
  const closed = await preCloseUndoBlocker(conn, lines);
  if (closed) return closed;
  for (const line of lines) {
    const row = await conn('shift_funds_movements').where({ id: line.action === 'add' ? line.created_record_id : line.target_id }).first();
    if (!row) return 'Its funds movement is missing.';
    if (line.action === 'add' && (row.deleted_at || row.reversed_by_record_correction_id)) {
      return `Its funds movement was reversed${await laterCorrection(conn, row.reversed_by_record_correction_id)}. Undo that first.`;
    }
    if (line.action === 'reverse' && Number(row.reversed_by_record_correction_id) !== Number(correction.id)) return 'The funds movement it reversed has changed since.';
  }
  return null;
}

async function undo(trx: Knex.Transaction, _correction: any, lines: any[], ctx: ApplyContext) {
  for (const line of lines) {
    if (line.action === 'add') {
      await trx('shift_funds_movements').where({ id: line.created_record_id }).update({ deleted_at: new Date().toISOString(), reversed_by_record_correction_id: ctx.correctionId });
    } else {
      await trx('shift_funds_movements').where({ id: line.target_id }).update({ deleted_at: null, reversed_by_record_correction_id: null });
    }
  }
  return [];
}

export const shiftFundsRule: CorrectionRule = {
  recordType: 'shift_funds', errorKinds: ['missing', 'duplicate'],
  unchanged: 'Sales, tank stock, trading profit and other shifts: no change.', plan, apply, undoBlocker, undo,
};
