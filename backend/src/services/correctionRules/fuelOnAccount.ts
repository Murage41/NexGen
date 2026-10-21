import type { Knex } from 'knex';
import type { ApplyContext, CorrectionRequest, CorrectionRule, Plan, PlanLine, RulePlan } from '../corrections';
import { getRetailPriceAsOf } from '../invoiceAccounting';
import { assertIssuedSourceUnlocked, invoiceSourceIsIssued } from '../issuedInvoiceSource';
import { resolveConsumptionSource } from '../invoiceConsumption';
import { roundMoney } from '../receivablePayments';
import { cents, closedShift, httpError, kes } from './common';

// Corrections of fuel on account (an invoice customer's fuel entry on a closed
// shift). Fuel on account is how a metered sale was paid, like cash or M-Pesa:
// correcting it never touches tank stock, fuel cost or pump sales, only who
// owes for the fuel and the shift's result.
//
// What was wrong decides the lines: the wrong entry is reversed, the right one
// added (on the shift, at that shift's pump price), or both. How far the entry
// has gone decides the rest:
// - not yet invoiced: nothing else;
// - in a draft invoice: the draft is refreshed after posting;
// Issued invoice source stays fixed. Its money is corrected with linked notes.

type Conn = Knex | Knex.Transaction;

const ERROR_KINDS = ['wrong_litres', 'wrong_fuel', 'wrong_customer', 'wrong_shift', 'duplicate', 'missing'];

const litresText = (litres: unknown, fuel: string) => `${Number(litres).toFixed(2)} L of ${fuel}`;
const invoiceName = (invoice: any) => invoice.invoice_number || `draft invoice #${invoice.id}`;
const active = (q: any) => q.whereNull('deleted_at').where((w: any) => w.whereNull('entry_status').orWhere('entry_status', 'active'));

async function liveEntry(conn: Conn, entryId: number) {
  const entry = await conn('invoice_consumption').where({ id: entryId }).first();
  if (!entry) throw httpError('Fuel entry not found.', 404, 'ENTRY_NOT_FOUND');
  if (entry.deleted_at || (entry.entry_status && entry.entry_status !== 'active')) {
    throw httpError('This entry was already removed or corrected.', 409, 'ENTRY_NOT_ACTIVE');
  }
  return entry;
}

async function invoiceCustomer(conn: Conn, accountId: unknown) {
  const account = Number(accountId)
    ? await conn('credit_accounts').where({ id: Number(accountId) }).whereNull('deleted_at').first('id', 'name', 'type', 'billing_mode')
    : null;
  if (!account || account.type !== 'customer' || account.billing_mode !== 'invoice') {
    throw httpError('Choose an invoice customer.', 400, 'NOT_INVOICE_CUSTOMER');
  }
  return { id: Number(account.id), name: String(account.name) };
}

// Where an entry stands: not yet invoiced, reserved in a draft, or billed.
async function entryStage(conn: Conn, entry: any) {
  if (!entry.invoice_line_id) return { stage: 'unbilled' as const, invoice: null, line: null };
  const line = await conn('invoice_lines').where({ id: entry.invoice_line_id }).first();
  const invoice = line ? await conn('customer_invoices').where({ id: line.invoice_id }).first() : null;
  if (!invoice) throw httpError('The fuel entry has an incomplete invoice link. Run the integrity audit before correcting it.', 409, 'INVOICE_SOURCE_LINK_INCOMPLETE');
  if (!invoiceSourceIsIssued(invoice)) return { stage: 'draft' as const, invoice, line };
  return { stage: 'invoiced' as const, invoice, line };
}

async function pumpPrice(conn: Conn, fuel: string, shift: { id: number; date: string }) {
  const price = await getRetailPriceAsOf(conn, fuel, shift.date);
  if (price === null || !(Number(price) > 0)) throw httpError(`No ${fuel} pump price was set on ${shift.date}.`, 409, 'NO_PUMP_PRICE');
  return roundMoney(Number(price));
}

// Never more fuel on account than the pumps sold on the shift.
async function checkPumpSales(conn: Conn, shiftId: number, fuel: string, litres: number, exceptEntryId: number | null) {
  const sold: any = await conn('pump_readings as r')
    .join('pumps as p', 'r.pump_id', 'p.id')
    .where({ 'r.shift_id': shiftId, 'p.fuel_type': fuel })
    .sum({ litres: 'r.litres_sold' })
    .first();
  const others = active(conn('invoice_consumption').where({ shift_id: shiftId, fuel_type: fuel }));
  if (exceptEntryId) others.whereNot({ id: exceptEntryId });
  const onAccount: any = await others.sum({ litres: 'litres' }).first();
  if (cents(onAccount?.litres) + cents(litres) > cents(sold?.litres)) {
    throw httpError(
      `The ${fuel} pumps sold ${Number(sold?.litres || 0).toFixed(2)} L in shift #${shiftId}; ${Number(onAccount?.litres || 0).toFixed(2)} L of it are already on account.`,
      400,
      'LITRES_EXCEED_PUMP_SALES',
    );
  }
}

// A draft of the customer's that will take unbilled fuel from that day.
async function draftCovering(conn: Conn, accountId: number, date: string) {
  return conn('customer_invoices')
    .where({ account_id: accountId, status: 'draft' })
    .whereNull('deleted_at')
    .where('from_date', '<=', date)
    .where('to_date', '>=', date)
    .orderBy('id')
    .first('id', 'invoice_number');
}

async function plan(conn: Conn, req: CorrectionRequest): Promise<RulePlan> {
  const lines: PlanLine[] = [];
  const drafts = new Set<number>();
  const effects: string[] = [];

  let target: any = null;
  let from: { id: number; date: string } | null = null;
  let owner: { id: number; name: string } | null = null;
  let where: Awaited<ReturnType<typeof entryStage>> = { stage: 'unbilled', invoice: null, line: null };
  if (req.error_kind !== 'missing') {
    if (!req.target_id) throw httpError('Choose the fuel entry to correct.', 400, 'TARGET_REQUIRED');
    target = await liveEntry(conn, req.target_id);
    from = await closedShift(conn, target.shift_id, 'change or delete the entry');
    owner = await invoiceCustomer(conn, target.account_id);
    await assertIssuedSourceUnlocked(conn, target);
    where = await entryStage(conn, target);
  }

  // The right entry, if there is one.
  let add: null | { account: { id: number; name: string }; shift: { id: number; date: string }; fuel: string; litres: number; price: number } = null;
  const litresIn = (fallback?: number) => {
    const litres = roundMoney(Number(req.litres ?? fallback));
    if (!(litres > 0)) throw httpError('Enter the litres the customer took.', 400, 'INVALID_LITRES');
    return litres;
  };
  switch (req.error_kind) {
    case 'wrong_litres': {
      const litres = litresIn();
      if (cents(litres) === cents(target.litres)) throw httpError('Nothing would change: enter the right litres.', 400, 'NO_CHANGE');
      add = { account: owner!, shift: from!, fuel: target.fuel_type, litres, price: roundMoney(Number(target.retail_price_at_time)) };
      break;
    }
    case 'wrong_fuel': {
      const fuel = String(req.fuel_type || '');
      if (!fuel || fuel === target.fuel_type) throw httpError('Choose the fuel the customer took.', 400, 'NO_CHANGE');
      add = { account: owner!, shift: from!, fuel, litres: litresIn(Number(target.litres)), price: await pumpPrice(conn, fuel, from!) };
      break;
    }
    case 'wrong_customer': {
      const account = await invoiceCustomer(conn, req.account_id);
      if (account.id === owner!.id) throw httpError('Choose the customer who took the fuel.', 400, 'NO_CHANGE');
      add = { account, shift: from!, fuel: target.fuel_type, litres: Number(target.litres), price: roundMoney(Number(target.retail_price_at_time)) };
      break;
    }
    case 'wrong_shift': {
      const shift = await closedShift(conn, req.shift_id, 'record the fuel');
      if (shift.id === from!.id) throw httpError('Choose the shift the fuel was taken on.', 400, 'NO_CHANGE');
      add = { account: owner!, shift, fuel: target.fuel_type, litres: Number(target.litres), price: await pumpPrice(conn, target.fuel_type, shift) };
      break;
    }
    case 'missing': {
      const fuel = String(req.fuel_type || '');
      if (!fuel) throw httpError('Choose the fuel.', 400, 'FUEL_REQUIRED');
      const shift = await closedShift(conn, req.shift_id, 'record the fuel');
      add = { account: await invoiceCustomer(conn, req.account_id), shift, fuel, litres: litresIn(), price: await pumpPrice(conn, fuel, shift) };
      break;
    }
    default:
      break;
  }

  if (target) {
    lines.push({
      seq: 1,
      action: 'reverse',
      record_type: 'fuel_on_account',
      target_id: Number(target.id),
      shift_id: from!.id,
      shift_open: false,
      party_type: 'invoice_customer',
      party_id: owner!.id,
      party_name: owner!.name,
      fuel_type: target.fuel_type,
      litres: Number(target.litres),
      unit_price: roundMoney(Number(target.retail_price_at_time)),
      amount: roundMoney(Number(target.retail_amount)),
      stage: where.stage,
      invoice_id: where.invoice ? Number(where.invoice.id) : null,
      invoice_number: where.invoice ? invoiceName(where.invoice) : null,
      shift_effect: -roundMoney(Number(target.retail_amount)),
    });
    effects.push(
      `Reversed: fuel entry #${target.id}, ${litresText(target.litres, target.fuel_type)} on ${owner!.name} in shift #${from!.id} (${kes(target.retail_amount)}).`,
    );
    if (where.stage === 'draft') {
      drafts.add(Number(where.invoice.id));
      effects.push(`It comes off ${invoiceName(where.invoice)}, which is refreshed.`);
    }
  }

  if (add) {
    await checkPumpSales(conn, add.shift.id, add.fuel, add.litres, target ? Number(target.id) : null);
    const amount = roundMoney(add.litres * add.price);
    const draft = await draftCovering(conn, add.account.id, add.shift.date);
    if (draft) drafts.add(Number(draft.id));
    lines.push({
      seq: 2,
      action: 'add',
      record_type: 'fuel_on_account',
      target_id: target ? Number(target.id) : null,
      shift_id: add.shift.id,
      shift_open: false,
      party_type: 'invoice_customer',
      party_id: add.account.id,
      party_name: add.account.name,
      fuel_type: add.fuel,
      litres: add.litres,
      unit_price: add.price,
      amount,
      stage: draft ? 'draft' : 'unbilled',
      invoice_id: draft ? Number(draft.id) : null,
      invoice_number: draft ? invoiceName(draft) : null,
      shift_effect: amount,
    });
    effects.push(
      `Added: ${litresText(add.litres, add.fuel)} on ${add.account.name} in shift #${add.shift.id} at the shift's pump price ${kes(add.price)} a litre = ${kes(amount)}.`,
    );
    if (draft) effects.push(`It goes on ${invoiceName(draft)}, which is refreshed.`);
    else effects.push(`${add.account.name} is billed for it on their next invoice.`);
  }

  const dates = lines.map((l) => (l.shift_id === from?.id ? from!.date : add!.shift.date)).sort();
  return { effective_date: dates[0], lines, documents: [], drafts: [...drafts], effects };
}

async function apply(trx: Knex.Transaction, planned: Plan, ctx: ApplyContext) {
  const out: Record<number, { created_record_id?: number; document_type?: string; document_id?: number; invoice_id?: number }> = {};
  const now = new Date().toISOString();
  const reason = `${ctx.number}: ${ctx.reason}`;
  const reverse = planned.lines.find((l) => l.action === 'reverse');
  const add = planned.lines.find((l) => l.action === 'add');
  const target = reverse ? await trx('invoice_consumption').where({ id: reverse.target_id }).first() : null;

  if (reverse) {
    await assertIssuedSourceUnlocked(trx, target);
    await trx('invoice_consumption').where({ id: target.id }).update({
      deleted_at: now,
      updated_at: now,
      entry_status: 'reversed',
      reversed_at: now,
      reversed_by_employee_id: ctx.actorId,
      correction_reason: reason,
      reversed_by_record_correction_id: ctx.correctionId,
      invoice_line_id: null,
    });
  }

  let createdId: number | null = null;
  if (add) {
    const source = target && add.fuel_type === target.fuel_type
      ? { pump_id: target.pump_id, tank_id: target.tank_id }
      : await resolveConsumptionSource(trx, { fuelType: add.fuel_type as 'petrol' | 'diesel' });
    [createdId] = await trx('invoice_consumption').insert({
      account_id: add.party_id,
      shift_id: add.shift_id,
      pump_id: source.pump_id,
      tank_id: source.tank_id,
      fuel_type: add.fuel_type,
      litres: add.litres,
      retail_price_at_time: add.unit_price,
      retail_amount: add.amount,
      entry_status: 'active',
      invoice_line_id: null,
      correction_of_id: target ? target.id : null,
      correction_reason: reason,
      created_by_record_correction_id: ctx.correctionId,
      created_by_employee_id: ctx.actorId,
    });
    out[add.seq] = { created_record_id: Number(createdId) };
  }

  return out;
}

async function undoBlocker(conn: Conn, _correction: any, lines: any[]): Promise<string | null> {
  const documents = lines.filter((l) => l.document_id);
  if (documents.length) {
    const numbers: string[] = [];
    for (const line of documents) {
      const row = line.document_type === 'credit_note'
        ? await conn('invoice_adjustment_notes').where({ id: line.document_id }).first('note_number as number')
        : await conn('customer_invoices').where({ id: line.document_id }).first('invoice_number as number');
      numbers.push(row?.number || `#${line.document_id}`);
    }
    return `It made ${numbers.join(' and ')} on an issued invoice. Its source stays fixed; use a monetary note on the invoice.`;
  }
  for (const line of lines.filter((l) => l.action === 'add')) {
    const created = await conn('invoice_consumption').where({ id: line.created_record_id }).first();
    if (!created) return 'Its fuel entry is missing.';
    if (created.deleted_at || (created.entry_status && created.entry_status !== 'active')) {
      const later = created.reversed_by_record_correction_id
        ? await conn('corrections').where({ id: created.reversed_by_record_correction_id }).first('number')
        : null;
      return `Its fuel entry was corrected again${later ? ` by ${later.number}` : ''}. Undo that first.`;
    }
    const stage = await entryStage(conn, created);
    if (stage.stage === 'invoiced') return `Its fuel is now fixed on invoice ${invoiceName(stage.invoice)}. Use a monetary note on the invoice.`;
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    const original = await conn('invoice_consumption').where({ id: line.target_id }).first();
    if (original) {
      const stage = await entryStage(conn, original);
      if (stage.stage === 'invoiced') return `Its original fuel is fixed on invoice ${invoiceName(stage.invoice)}. Use a monetary note on the invoice.`;
    }
    if (!original || Number(original.reversed_by_record_correction_id) !== Number(line.correction_id)) {
      return 'The entry it reversed has changed since.';
    }
  }
  return null;
}

async function undo(trx: Knex.Transaction, correction: any, lines: any[], ctx: ApplyContext) {
  const drafts: number[] = [];
  const now = new Date().toISOString();
  for (const line of lines.filter((l) => l.action === 'add')) {
    const created = await trx('invoice_consumption').where({ id: line.created_record_id }).first();
    await assertIssuedSourceUnlocked(trx, created);
    const stage = await entryStage(trx, created);
    if (stage.stage === 'draft') drafts.push(Number(stage.invoice.id));
    await trx('invoice_consumption').where({ id: created.id }).update({
      deleted_at: now,
      updated_at: now,
      entry_status: 'reversed',
      reversed_at: now,
      reversed_by_employee_id: ctx.actorId,
      correction_reason: `${ctx.number}: undoes ${correction.number}: ${ctx.reason}`,
      reversed_by_record_correction_id: ctx.correctionId,
      invoice_line_id: null,
    });
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    const original = await trx('invoice_consumption').where({ id: line.target_id }).first();
    await assertIssuedSourceUnlocked(trx, original);
    await trx('invoice_consumption').where({ id: line.target_id }).update({
      deleted_at: null,
      updated_at: now,
      entry_status: 'active',
      reversed_at: null,
      reversed_by_employee_id: null,
      correction_reason: null,
      reversed_by_record_correction_id: null,
    });
    const shift = await trx('shifts').where({ id: line.shift_id }).first('shift_date');
    const draft = await draftCovering(trx, Number(line.party_id), String(shift.shift_date).slice(0, 10));
    if (draft) drafts.push(Number(draft.id));
  }
  return drafts;
}

export const fuelOnAccountRule: CorrectionRule = {
  recordType: 'fuel_on_account',
  errorKinds: ERROR_KINDS,
  unchanged: 'Tank stock and fuel cost: no change (the pump meters measured the fuel).',
  plan,
  apply,
  undoBlocker,
  undo,
};
