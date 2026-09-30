import crypto from 'crypto';
import type { Knex } from 'knex';
import type { Approver } from './approval';
import { roundMoney } from './receivablePayments';
import { syncVarianceAccount } from './employeeVariances';
import { refreshInvoiceDraftReservation } from './invoiceDraftReservations';
import { recomputeInvoiceTotals } from './receivablePayments';
import { fuelOnAccountRule } from './correctionRules/fuelOnAccount';

// Corrections (docs/ROADMAP.md §3c, docs/CORRECTIONS.md). A closed record is
// never changed. A mistake found later is fixed by a numbered Correction whose
// lines reverse the wrong record, add the right one, or both. What it produces
// depends on how far the record has gone (not yet invoiced, in a draft, on an
// issued invoice): the rule for its record type decides, not the admin.
//
// Every correction line carries its change to its shift's result (accounted −
// expected). For each closed shift a correction touches, the change reaches
// the shift's attendant through the variance ledger, which nets within the
// shift (a surplus absorbs a later worsening first): an improvement always;
// a worsening only if the admin says it is theirs, otherwise the station
// carries it. The shift itself keeps its close snapshot.
//
// The admin's PIN approves a hash of exactly what the preview showed; posting
// rebuilds the plan and refuses if anything changed in between.

type Conn = Knex | Knex.Transaction;

export type CorrectionRequest = {
  record_type: string;
  error_kind: string;
  target_id?: number | null;
  shift_id?: number | null;
  account_id?: number | null;
  fuel_type?: string | null;
  litres?: number | null;
  charge_to?: 'attendant' | 'station' | null;
  reason_code: string;
  reason_note: string;
};

export type PlanLine = {
  seq: number;
  action: 'reverse' | 'add' | 'restore';
  record_type: string;
  target_id: number | null;
  shift_id: number;
  shift_open: boolean;
  party_type: string | null;
  party_id: number | null;
  party_name: string | null;
  fuel_type: string | null;
  litres: number | null;
  unit_price: number | null;
  amount: number;
  stage: 'unbilled' | 'draft' | 'invoiced' | null;
  invoice_id: number | null;
  invoice_number: string | null;
  shift_effect: number;
};

export type PlanDocument = {
  type: 'credit_note' | 'debit_note';
  line_seq: number;
  account_id: number;
  invoice_id: number | null;
  invoice_number: string | null;
  fuel_type: string;
  litres: number;
  unit_price: number;
  amount: number;
  shift_id: number | null;
  // What the shift counted for these litres (its pump price): the shift's
  // result carries that part, so only the price difference is revenue.
  shift_value: number;
  held_as_credit: number;
};

export type RulePlan = {
  effective_date: string;
  lines: PlanLine[];
  documents: PlanDocument[];
  drafts: number[];
  effects: string[];
};

export type ShiftImpact = {
  shift_id: number;
  shift_date: string;
  attendant_id: number | null;
  attendant_name: string | null;
  as_closed: number;
  earlier: number;
  change: number;
  corrected: number;
  worse: boolean;
  shortage_now: number;
  shortage_if_attendant: number;
};

export type Plan = RulePlan & {
  request: CorrectionRequest;
  posting_date: string;
  shifts: ShiftImpact[];
  needs_choice: boolean;
  plan_hash: string;
};

export type ApplyContext = {
  correctionId: number;
  number: string;
  reason: string;
  date: string;
  approver: Approver;
  actorId: number | null;
};

// What each record type contributes. Phase 1: fuel on account.
export type CorrectionRule = {
  recordType: string;
  errorKinds: string[];
  plan(conn: Conn, request: CorrectionRequest): Promise<RulePlan>;
  // Writes the records and documents; returns the created record and
  // document ids per line seq.
  apply(trx: Knex.Transaction, plan: Plan, ctx: ApplyContext): Promise<Record<number, { created_record_id?: number; document_type?: string; document_id?: number; invoice_id?: number }>>;
  undoBlocker(conn: Conn, correction: any, lines: any[]): Promise<string | null>;
  undo(trx: Knex.Transaction, correction: any, lines: any[], ctx: ApplyContext): Promise<number[]>;
};

const RULES: Record<string, CorrectionRule> = { fuel_on_account: fuelOnAccountRule };

export const httpError = (message: string, http: number, code: string) => Object.assign(new Error(message), { http, code });
export const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const result = (value: number) => (value < 0 ? `shortage ${kes(-value)}` : value > 0 ? `surplus ${kes(value)}` : 'balanced');

function rule(recordType: string) {
  const found = RULES[recordType];
  if (!found) throw httpError('This kind of record cannot be corrected yet.', 400, 'RECORD_TYPE_UNSUPPORTED');
  return found;
}

export async function correctionReasons(conn: Conn) {
  return conn('correction_reasons').where({ active: true }).orderBy('sort').select('code', 'label');
}

function normalize(request: any): CorrectionRequest {
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
  return {
    record_type: String(request?.record_type || ''),
    error_kind: String(request?.error_kind || ''),
    target_id: num(request?.target_id),
    shift_id: num(request?.shift_id),
    account_id: num(request?.account_id),
    fuel_type: request?.fuel_type ? String(request.fuel_type).trim().toLowerCase() : null,
    litres: num(request?.litres),
    charge_to: request?.charge_to === 'attendant' || request?.charge_to === 'station' ? request.charge_to : null,
    reason_code: String(request?.reason_code || ''),
    reason_note: String(request?.reason_note || '').trim(),
  };
}

// A shift's attendant shortage from the variance ledger (positive = owed).
async function shiftShortage(conn: Conn, employeeId: number, shiftId: number) {
  const row: any = await conn('employee_variance_entries')
    .where({ employee_id: employeeId, shift_id: shiftId, status: 'posted' })
    .whereIn('entry_type', ['shift', 'correction'])
    .sum({ total: 'amount' })
    .first();
  return roundMoney(Number(row?.total || 0));
}

async function shiftImpacts(conn: Conn, lines: PlanLine[]): Promise<ShiftImpact[]> {
  const byShift = new Map<number, number>();
  for (const line of lines) {
    if (line.shift_open) continue;
    byShift.set(line.shift_id, roundMoney((byShift.get(line.shift_id) || 0) + line.shift_effect));
  }
  const impacts: ShiftImpact[] = [];
  for (const [shiftId, change] of byShift) {
    const shift = await conn('shifts as s')
      .leftJoin('employees as e', 's.employee_id', 'e.id')
      .leftJoin('shift_close_reconciliations as r', 'r.shift_id', 's.id')
      .where('s.id', shiftId)
      .first('s.id', 's.shift_date', 's.employee_id', 'e.name as employee_name', 'r.variance');
    const earlier: any = await conn('correction_lines').where({ shift_id: shiftId }).sum({ total: 'shift_effect' }).first();
    const asClosed = roundMoney(Number(shift?.variance || 0));
    const before = roundMoney(asClosed + Number(earlier?.total || 0));
    const shortage = shift?.employee_id ? await shiftShortage(conn, Number(shift.employee_id), shiftId) : 0;
    impacts.push({
      shift_id: shiftId,
      shift_date: String(shift?.shift_date || '').slice(0, 10),
      attendant_id: shift?.employee_id ? Number(shift.employee_id) : null,
      attendant_name: shift?.employee_name || null,
      as_closed: asClosed,
      earlier: roundMoney(Number(earlier?.total || 0)),
      change,
      corrected: roundMoney(before + change),
      worse: change < 0,
      shortage_now: shortage,
      shortage_if_attendant: roundMoney(shortage - change),
    });
  }
  return impacts;
}

function shiftEffects(impacts: ShiftImpact[], chargeTo: string | null) {
  const lines: string[] = [];
  for (const s of impacts) {
    if (s.change === 0) continue;
    const who = s.attendant_name || 'The attendant';
    lines.push(`Shift #${s.shift_id} (${s.shift_date}): ${result(s.as_closed)} at close; ${result(s.corrected)} after this correction.`);
    if (!s.worse) {
      lines.push(`${who}: the shift is better by ${kes(s.change)}; their shortage on it goes from ${kes(Math.max(0, s.shortage_now))} to ${kes(Math.max(0, s.shortage_if_attendant))} (a surplus is the station's).`);
    } else if (chargeTo === 'attendant') {
      lines.push(`${who} carries it: their shortage on shift #${s.shift_id} goes from ${kes(Math.max(0, s.shortage_now))} to ${kes(Math.max(0, s.shortage_if_attendant))}.`);
    } else if (chargeTo === 'station') {
      lines.push(`The station carries ${kes(-s.change)}; ${who}'s shortage stays ${kes(Math.max(0, s.shortage_now))}.`);
    } else {
      lines.push(`Shift #${s.shift_id} is worse by ${kes(-s.change)}: choose who carries it.`);
    }
  }
  return lines;
}

export async function previewCorrection(conn: Conn, raw: any, postingDate: string): Promise<Plan> {
  const request = normalize(raw);
  const handler = rule(request.record_type);
  if (!handler.errorKinds.includes(request.error_kind)) throw httpError('Choose what was wrong.', 400, 'INVALID_ERROR_KIND');
  const reason = await conn('correction_reasons').where({ code: request.reason_code, active: true }).first();
  if (request.reason_code && !reason) throw httpError('Choose a reason from the list.', 400, 'INVALID_REASON');
  const rulePlan = await handler.plan(conn, request);
  const shifts = await shiftImpacts(conn, rulePlan.lines);
  const needsChoice = shifts.some((s) => s.worse && s.attendant_id);
  const effects = [
    ...rulePlan.effects,
    ...shiftEffects(shifts, request.charge_to ?? null),
    'Tank stock and fuel cost: no change (the pump meters measured the fuel).',
  ];
  const hashed = {
    request: { ...request },
    posting_date: postingDate,
    lines: rulePlan.lines.map(({ party_name, invoice_number, ...line }) => line),
    documents: rulePlan.documents,
    shifts: shifts.map((s) => ({ shift_id: s.shift_id, change: s.change })),
  };
  return {
    ...rulePlan,
    effects,
    request,
    posting_date: postingDate,
    shifts,
    needs_choice: needsChoice,
    plan_hash: crypto.createHash('sha256').update(JSON.stringify(hashed)).digest('hex'),
  };
}

async function nextNumber(trx: Knex.Transaction, date: string) {
  const prefix = `C-${date.slice(0, 4)}-`;
  const last = await trx('corrections').where('number', 'like', `${prefix}%`).orderBy('id', 'desc').first('number');
  const next = last ? Number(String(last.number).slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// After a correction commits: the drafts it touched take or let go of fuel.
export async function tidyDrafts(conn: Knex, draftIds: number[]) {
  for (const draftId of new Set(draftIds)) await tidyDraft(conn, draftId);
}

async function tidyDraft(conn: Knex, draftId: number) {
  const draft = await conn('customer_invoices').where({ id: draftId }).first('status');
  if (draft?.status !== 'draft') return;
  try {
    await refreshInvoiceDraftReservation(conn, draftId);
    // A fuel line left with nothing on it goes.
    for (const line of await conn('invoice_lines').where({ invoice_id: draftId }).select('id')) {
      const linked: any = await conn('invoice_consumption').where({ invoice_line_id: line.id }).count({ n: 'id' }).first();
      if (Number(linked?.n || 0) === 0) await conn('invoice_lines').where({ id: line.id }).delete();
    }
    await conn.transaction((trx) => recomputeInvoiceTotals(draftId, trx));
  } catch (err: any) {
    console.error('[corrections:tidyDraft] ERROR', { draftId, error: err.message });
  }
}

async function postAttendantEntries(trx: Knex.Transaction, plan: Plan, ctx: ApplyContext) {
  const entries: Record<number, number> = {};
  for (const shift of plan.shifts) {
    if (!shift.attendant_id || shift.change === 0) continue;
    if (shift.worse && plan.request.charge_to !== 'attendant') continue;
    const [entryId] = await trx('employee_variance_entries').insert({
      employee_id: shift.attendant_id,
      entry_type: 'correction',
      shift_id: shift.shift_id,
      entry_date: ctx.date,
      amount: roundMoney(-shift.change),
      refundable: false,
      reference: ctx.number,
      reason: `${ctx.number}: ${ctx.reason}`,
      approved_by_employee_id: ctx.approver.id || null,
      approved_by_name: ctx.approver.name,
      created_by_employee_id: ctx.actorId,
      record_correction_id: ctx.correctionId,
    });
    await syncVarianceAccount(trx, shift.attendant_id);
    entries[shift.shift_id] = Number(entryId);
  }
  return entries;
}

// Posts inside the caller's transaction; returns the drafts to tidy after it
// commits (tidyDrafts).
export async function postCorrection(
  trx: Knex.Transaction,
  raw: any,
  input: { planHash: string; approver: Approver; actorId?: number | null; date: string },
) {
  const request = normalize(raw);
  if (request.reason_note.length < 10) throw httpError('Explain the correction (at least 10 characters).', 400, 'REASON_REQUIRED');
  if (!request.reason_code) throw httpError('Choose a reason.', 400, 'REASON_REQUIRED');
  const handler = rule(request.record_type);
  const posted = await (async () => {
    const plan = await previewCorrection(trx, request, input.date);
    if (plan.plan_hash !== input.planHash) {
      throw httpError('Something changed since the preview. Check the correction again.', 409, 'PLAN_CHANGED');
    }
    if (plan.needs_choice && !request.charge_to) throw httpError('Choose who carries the change.', 400, 'CHOICE_REQUIRED');
    const number = await nextNumber(trx, input.date);
    const [correctionId] = await trx('corrections').insert({
      number,
      kind: 'correction',
      record_type: request.record_type,
      error_kind: request.error_kind,
      reason_code: request.reason_code,
      reason_note: request.reason_note,
      posting_date: input.date,
      effective_date: plan.effective_date,
      status: 'posted',
      plan_hash: plan.plan_hash,
      effects_json: JSON.stringify(plan.effects),
      approved_by_employee_id: input.approver.id || null,
      approved_by_name: input.approver.name,
      created_by_employee_id: Number(input.actorId) > 0 ? Number(input.actorId) : null,
    });
    const ctx: ApplyContext = {
      correctionId: Number(correctionId),
      number,
      reason: request.reason_note,
      date: input.date,
      approver: input.approver,
      actorId: Number(input.actorId) > 0 ? Number(input.actorId) : null,
    };
    const applied = await handler.apply(trx, plan, ctx);
    const variance = await postAttendantEntries(trx, plan, ctx);
    // Who carries each shift's change: an improvement is the attendant's; a
    // worsening is whoever the admin chose; a shift without an attendant, the station.
    const carrier = new Map(plan.shifts.map((s) => [
      s.shift_id,
      !s.attendant_id ? 'station' : s.worse ? request.charge_to || 'station' : 'attendant',
    ]));
    const firstOnShift = new Set<number>();
    for (const line of plan.lines) {
      const extra = applied[line.seq] || {};
      const first = !firstOnShift.has(line.shift_id);
      firstOnShift.add(line.shift_id);
      await trx('correction_lines').insert({
        correction_id: correctionId,
        seq: line.seq,
        action: line.action,
        record_type: line.record_type,
        target_id: line.target_id,
        created_record_id: extra.created_record_id ?? null,
        shift_id: line.shift_id,
        shift_open: line.shift_open,
        party_type: line.party_type,
        party_id: line.party_id,
        fuel_type: line.fuel_type,
        litres: line.litres,
        unit_price: line.unit_price,
        amount: line.amount,
        stage: line.stage,
        invoice_id: extra.invoice_id ?? line.invoice_id,
        document_type: extra.document_type ?? null,
        document_id: extra.document_id ?? null,
        shift_effect: line.shift_effect,
        charge_to: carrier.get(line.shift_id) ?? null,
        variance_entry_id: first ? variance[line.shift_id] ?? null : null,
      });
    }
    return { id: Number(correctionId), drafts: plan.drafts };
  })();
  return posted;
}

export async function undoBlocker(conn: Conn, correctionId: number): Promise<string | null> {
  const correction = await conn('corrections').where({ id: correctionId }).first();
  if (!correction) return 'Correction not found.';
  if (correction.kind === 'undo') return 'This is an undo; make a new correction instead.';
  if (correction.status !== 'posted') return 'This correction was already undone.';
  const lines = await conn('correction_lines').where({ correction_id: correctionId }).orderBy('seq');
  return rule(correction.record_type).undoBlocker(conn, correction, lines);
}

export async function undoCorrection(
  trx: Knex.Transaction,
  input: { correctionId: number; reasonNote: string; approver: Approver; actorId?: number | null; date: string },
) {
  const reason = String(input.reasonNote || '').trim();
  if (reason.length < 10) throw httpError('Say why the correction is being undone (at least 10 characters).', 400, 'REASON_REQUIRED');
  const done = await (async () => {
    const blocker = await undoBlocker(trx, input.correctionId);
    if (blocker) throw httpError(blocker, 409, 'UNDO_BLOCKED');
    const original = await trx('corrections').where({ id: input.correctionId }).first();
    const lines = await trx('correction_lines').where({ correction_id: original.id }).orderBy('seq');
    const number = await nextNumber(trx, input.date);
    const [undoId] = await trx('corrections').insert({
      number,
      kind: 'undo',
      record_type: original.record_type,
      error_kind: 'undo',
      reason_code: 'other',
      reason_note: reason,
      posting_date: input.date,
      effective_date: original.effective_date,
      status: 'posted',
      undoes_correction_id: original.id,
      plan_hash: original.plan_hash,
      effects_json: JSON.stringify([`Undoes ${original.number}.`]),
      approved_by_employee_id: input.approver.id || null,
      approved_by_name: input.approver.name,
      created_by_employee_id: Number(input.actorId) > 0 ? Number(input.actorId) : null,
    });
    const ctx: ApplyContext = {
      correctionId: Number(undoId),
      number,
      reason,
      date: input.date,
      approver: input.approver,
      actorId: Number(input.actorId) > 0 ? Number(input.actorId) : null,
    };
    const drafts = await rule(original.record_type).undo(trx, original, lines, ctx);
    for (const line of lines) {
      await trx('correction_lines').insert({
        correction_id: undoId,
        seq: line.seq,
        action: line.action === 'add' ? 'reverse' : 'restore',
        record_type: line.record_type,
        target_id: line.action === 'add' ? line.created_record_id : line.target_id,
        shift_id: line.shift_id,
        shift_open: line.shift_open,
        party_type: line.party_type,
        party_id: line.party_id,
        fuel_type: line.fuel_type,
        litres: line.litres,
        unit_price: line.unit_price,
        amount: line.amount,
        stage: line.stage,
        invoice_id: line.invoice_id,
        shift_effect: roundMoney(-Number(line.shift_effect)),
        charge_to: line.charge_to,
      });
    }
    // The attendant's part, cancelled by an opposite entry.
    for (const entry of await trx('employee_variance_entries').where({ record_correction_id: original.id, status: 'posted' })) {
      await trx('employee_variance_entries').insert({
        employee_id: entry.employee_id,
        entry_type: 'correction',
        shift_id: entry.shift_id,
        entry_date: input.date,
        amount: roundMoney(-Number(entry.amount)),
        refundable: false,
        reference: number,
        reason: `${number}: undoes ${original.number}: ${reason}`,
        approved_by_employee_id: input.approver.id || null,
        approved_by_name: input.approver.name,
        created_by_employee_id: ctx.actorId,
        record_correction_id: undoId,
      });
      await syncVarianceAccount(trx, Number(entry.employee_id));
    }
    await trx('corrections').where({ id: original.id }).update({ status: 'undone', undone_by_correction_id: undoId });
    return { id: Number(undoId), drafts };
  })();
  return done;
}

export async function correctionDetail(conn: Conn, id: number) {
  const correction = await conn('corrections as c')
    .leftJoin('correction_reasons as r', 'c.reason_code', 'r.code')
    .where('c.id', id)
    .first('c.*', 'r.label as reason_label');
  if (!correction) throw httpError('Correction not found.', 404, 'CORRECTION_NOT_FOUND');
  const lines = await conn('correction_lines as l')
    .leftJoin('credit_accounts as a', function () {
      this.on('l.party_id', '=', 'a.id').andOn(conn.raw("l.party_type = 'invoice_customer'"));
    })
    .leftJoin('customer_invoices as i', 'l.invoice_id', 'i.id')
    .where('l.correction_id', id)
    .orderBy('l.seq')
    .select('l.*', 'a.name as party_name', 'i.invoice_number');
  for (const line of lines as any[]) {
    if (line.document_type === 'credit_note') {
      line.document_number = (await conn('invoice_adjustment_notes').where({ id: line.document_id }).first('note_number'))?.note_number || null;
    } else if (line.document_type === 'debit_note') {
      line.document_number = (await conn('customer_invoices').where({ id: line.document_id }).first('invoice_number'))?.invoice_number || null;
    }
  }
  const related = await conn('corrections').whereIn('id', [correction.undoes_correction_id, correction.undone_by_correction_id].filter(Boolean)).select('id', 'number');
  return {
    ...correction,
    effects: JSON.parse(correction.effects_json || '[]'),
    lines,
    related,
    undo_blocked_by: correction.kind === 'undo' ? 'This is an undo.' : await undoBlocker(conn, id),
  };
}

export async function listCorrections(conn: Conn, filters: { from?: string; to?: string; shiftId?: number; accountId?: number; limit?: number }) {
  const query = conn('corrections as c')
    .leftJoin('correction_reasons as r', 'c.reason_code', 'r.code')
    .orderBy('c.id', 'desc')
    .limit(Math.min(Number(filters.limit) || 200, 500))
    .select('c.*', 'r.label as reason_label');
  if (filters.from) query.where('c.posting_date', '>=', filters.from);
  if (filters.to) query.where('c.posting_date', '<=', filters.to);
  if (filters.shiftId) query.whereIn('c.id', conn('correction_lines').where({ shift_id: filters.shiftId }).select('correction_id'));
  if (filters.accountId) query.whereIn('c.id', conn('correction_lines').where({ party_id: filters.accountId }).select('correction_id'));
  const rows = await query;
  for (const row of rows as any[]) {
    row.effects = JSON.parse(row.effects_json || '[]');
    delete row.effects_json;
  }
  return rows;
}

// What a closed shift shows about the corrections made to it since close.
export async function shiftCorrections(conn: Conn, shiftId: number, asClosedVariance: number | null) {
  const lines = await conn('correction_lines as l')
    .join('corrections as c', 'l.correction_id', 'c.id')
    .leftJoin('credit_accounts as a', 'l.party_id', 'a.id')
    .where('l.shift_id', shiftId)
    .orderBy('c.id')
    .orderBy('l.seq')
    .select('l.*', 'c.number', 'c.kind', 'c.status', 'c.posting_date', 'c.reason_note', 'c.error_kind', 'a.name as party_name');
  const change = roundMoney(lines.reduce((sum: number, l: any) => sum + Number(l.shift_effect || 0), 0));
  return {
    lines,
    change,
    corrected_variance: asClosedVariance === null ? null : roundMoney(asClosedVariance + change),
  };
}
