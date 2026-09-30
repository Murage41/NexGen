import type { Knex } from 'knex';
import type { ApplyContext, CorrectionRequest, CorrectionRule, Plan, PlanDocument, PlanLine, RulePlan } from '../corrections';
import { getRetailPriceAsOf } from '../invoiceAccounting';
import { createDebitNoteBill, postCreditNote } from '../invoiceAdjustments';
import { resolveConsumptionSource } from '../invoiceConsumption';
import { roundMoney } from '../receivablePayments';

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
// - on an issued invoice (paid or not): a credit note for what was billed and
//   should not have been, a debit note for what should have been billed and
//   was not, both at the invoice's agreed price (a fuel the invoice has no line
//   for is billed at the shift's pump price). Credit beyond what the invoice
//   still owes is held for the customer's next bill. Fuel moved to another
//   customer goes to that customer's unbilled fuel.

type Conn = Knex | Knex.Transaction;

const ERROR_KINDS = ['wrong_litres', 'wrong_fuel', 'wrong_customer', 'wrong_shift', 'duplicate', 'missing'];
const ISSUED = ['issued', 'partial', 'paid'];

const httpError = (message: string, http: number, code: string) => Object.assign(new Error(message), { http, code });
const cents = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

async function closedShift(conn: Conn, shiftId: unknown, what: string) {
  if (!Number(shiftId)) throw httpError('Choose the shift.', 400, 'SHIFT_REQUIRED');
  const shift = await conn('shifts').where({ id: Number(shiftId) }).first('id', 'status', 'shift_date');
  if (!shift) throw httpError(`Shift #${shiftId} not found.`, 404, 'SHIFT_NOT_FOUND');
  if (shift.status !== 'closed') {
    throw httpError(`Shift #${shift.id} is still open: ${what} on the shift itself.`, 409, 'SHIFT_OPEN');
  }
  return { id: Number(shift.id), date: String(shift.shift_date).slice(0, 10) };
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
  const invoice = line ? await conn('customer_invoices').where({ id: line.invoice_id }).whereNull('deleted_at').first() : null;
  if (!invoice || invoice.status === 'void') return { stage: 'unbilled' as const, invoice: null, line: null };
  if (invoice.status === 'draft') return { stage: 'draft' as const, invoice, line };
  if (!ISSUED.includes(invoice.status)) throw httpError(`Invoice ${invoiceName(invoice)} is ${invoice.status}.`, 409, 'INVOICE_STATE');
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
  const documents: PlanDocument[] = [];
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
    // Where the right entry is billed: the same customer's issued invoice keeps
    // billing it (a note covers any difference; a fuel it had no line for is
    // billed by the debit note); otherwise the customer's draft for that day,
    // or their next invoice.
    const onIssued = where.stage === 'invoiced' && add.account.id === owner?.id;
    const staysBilled = onIssued && add.fuel === target.fuel_type;
    const draft = onIssued ? null : await draftCovering(conn, add.account.id, add.shift.date);
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
      stage: onIssued ? 'invoiced' : draft ? 'draft' : 'unbilled',
      invoice_id: staysBilled ? Number(where.invoice.id) : draft ? Number(draft.id) : null,
      invoice_number: staysBilled ? invoiceName(where.invoice) : draft ? invoiceName(draft) : null,
      shift_effect: amount,
    });
    effects.push(
      `Added: ${litresText(add.litres, add.fuel)} on ${add.account.name} in shift #${add.shift.id} at the shift's pump price ${kes(add.price)} a litre = ${kes(amount)}.`,
    );
    if (staysBilled) effects.push(`It stays on invoice ${invoiceName(where.invoice)}.`);
    else if (draft) effects.push(`It goes on ${invoiceName(draft)}, which is refreshed.`);
    else if (!onIssued) effects.push(`${add.account.name} is billed for it on their next invoice.`);
  }

  // On an issued invoice: the notes.
  if (where.stage === 'invoiced') {
    const invoice = where.invoice;
    const agreed = roundMoney(Number(where.line.agreed_price));
    const reverse = lines[0];
    const addLine = lines.find((l) => l.action === 'add');
    const credit = (litres: number, shiftValue: number, seq: number) => {
      documents.push({
        type: 'credit_note', line_seq: seq, account_id: owner!.id, invoice_id: Number(invoice.id), invoice_number: invoiceName(invoice),
        fuel_type: target.fuel_type, litres, unit_price: agreed, amount: roundMoney(litres * agreed), shift_id: from!.id,
        shift_value: shiftValue, held_as_credit: 0,
      });
    };
    if (req.error_kind === 'duplicate' || req.error_kind === 'wrong_customer') {
      credit(Number(target.litres), reverse.amount, 1);
    } else if (req.error_kind === 'wrong_litres') {
      const difference = roundMoney(addLine!.litres! - Number(target.litres));
      const shiftValue = roundMoney(addLine!.amount - reverse.amount);
      if (difference < 0) credit(-difference, -shiftValue, 2);
      else {
        documents.push({
          type: 'debit_note', line_seq: 2, account_id: owner!.id, invoice_id: Number(invoice.id), invoice_number: invoiceName(invoice),
          fuel_type: target.fuel_type, litres: difference, unit_price: agreed, amount: roundMoney(difference * agreed), shift_id: from!.id,
          shift_value: shiftValue, held_as_credit: 0,
        });
      }
    } else if (req.error_kind === 'wrong_fuel') {
      credit(Number(target.litres), reverse.amount, 1);
      const line = await conn('invoice_lines').where({ invoice_id: invoice.id, fuel_type: addLine!.fuel_type }).first();
      const price = line ? roundMoney(Number(line.agreed_price)) : addLine!.unit_price!;
      documents.push({
        type: 'debit_note', line_seq: 2, account_id: owner!.id, invoice_id: line ? Number(invoice.id) : null,
        invoice_number: line ? invoiceName(invoice) : null, fuel_type: addLine!.fuel_type!, litres: addLine!.litres!, unit_price: price,
        amount: roundMoney(addLine!.litres! * price), shift_id: from!.id, shift_value: addLine!.amount, held_as_credit: 0,
      });
    } else if (req.error_kind === 'wrong_shift') {
      effects.push(`Invoice ${invoiceName(invoice)} stays as it is: the fuel was billed correctly; only its shift changes.`);
    }

    // Never credit more litres of a fuel than the invoice billed.
    let owed = Math.max(0, cents(invoice.balance));
    for (const doc of documents) {
      if (doc.type === 'credit_note') {
        const credited: any = await conn('invoice_adjustment_notes')
          .where({ invoice_id: invoice.id, note_type: 'credit_note', fuel_type: doc.fuel_type, status: 'posted' })
          .whereNot({ correction: 'price' })
          .sum({ litres: 'litres' })
          .first();
        if (cents(credited?.litres) + cents(doc.litres) > cents(where.line.total_litres)) {
          throw httpError(
            `Invoice ${invoiceName(invoice)} billed ${Number(where.line.total_litres).toFixed(2)} L of ${doc.fuel_type}; ${Number(credited?.litres || 0).toFixed(2)} L are already credited.`,
            400,
            'CREDIT_LITRES_EXCEED_INVOICE',
          );
        }
        const applied = Math.min(cents(doc.amount), owed);
        owed -= applied;
        doc.held_as_credit = (cents(doc.amount) - applied) / 100;
        effects.push(
          `Credit note on invoice ${doc.invoice_number}: ${litresText(doc.litres, doc.fuel_type)} at the invoice price ${kes(doc.unit_price)} a litre = ${kes(doc.amount)}.`,
        );
        if (doc.held_as_credit > 0) {
          effects.push(`${kes(doc.held_as_credit)} of it is more than the invoice still owes: it is held as credit for ${owner!.name}'s next bill.`);
        }
      } else {
        effects.push(
          `Debit note (a new bill to ${owner!.name}): ${litresText(doc.litres, doc.fuel_type)} at ${doc.invoice_id ? 'the invoice price' : "the shift's pump price"} ${kes(doc.unit_price)} a litre = ${kes(doc.amount)}${doc.invoice_id ? `, correcting invoice ${doc.invoice_number}` : ''}. Credit ${owner!.name} holds pays it first.`,
        );
      }
    }
    // A note already on the invoice may be the same mistake.
    const earlier = await conn('invoice_adjustment_notes')
      .where({ invoice_id: invoice.id, status: 'posted' })
      .whereNull('record_correction_id')
      .select('note_number', 'note_type', 'fuel_type', 'litres');
    for (const note of earlier) {
      effects.push(
        `Check: invoice ${invoiceName(invoice)} already has ${note.note_type === 'credit_note' ? 'credit' : 'debit'} note ${note.note_number} (${litresText(note.litres, note.fuel_type)}). Make sure it was not for this same mistake.`,
      );
    }
  }

  const dates = lines.map((l) => (l.shift_id === from?.id ? from!.date : add!.shift.date)).sort();
  return { effective_date: dates[0], lines, documents, drafts: [...drafts], effects };
}

async function apply(trx: Knex.Transaction, planned: Plan, ctx: ApplyContext) {
  const out: Record<number, { created_record_id?: number; document_type?: string; document_id?: number; invoice_id?: number }> = {};
  const now = new Date().toISOString();
  const reason = `${ctx.number}: ${ctx.reason}`;
  const reverse = planned.lines.find((l) => l.action === 'reverse');
  const add = planned.lines.find((l) => l.action === 'add');
  const target = reverse ? await trx('invoice_consumption').where({ id: reverse.target_id }).first() : null;

  if (reverse) {
    await trx('invoice_consumption').where({ id: target.id }).update({
      deleted_at: now,
      updated_at: now,
      entry_status: 'reversed',
      reversed_at: now,
      reversed_by_employee_id: ctx.actorId,
      correction_reason: reason,
      reversed_by_record_correction_id: ctx.correctionId,
      // Billed fuel stays on its invoice (a note corrects it); a draft lets go.
      ...(reverse.stage === 'invoiced' ? {} : { invoice_line_id: null }),
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
      invoice_line_id: add.stage === 'invoiced' && add.invoice_id ? target.invoice_line_id : null,
      correction_of_id: target ? target.id : null,
      correction_reason: reason,
      created_by_record_correction_id: ctx.correctionId,
      created_by_employee_id: ctx.actorId,
    });
    out[add.seq] = { created_record_id: Number(createdId) };
  }

  for (const doc of planned.documents) {
    const input = {
      noteType: doc.type,
      correction: 'litres' as const,
      fuelType: doc.fuel_type,
      litres: doc.litres,
      unitPrice: doc.unit_price,
      reason,
      shiftId: doc.shift_id,
      shiftValue: doc.shift_value,
      noteDate: ctx.date,
      approver: ctx.approver,
      actorId: ctx.actorId,
    };
    if (doc.type === 'credit_note') {
      const invoice = await trx('customer_invoices').where({ id: doc.invoice_id }).first();
      const note = await postCreditNote(trx, invoice, input);
      await trx('invoice_adjustment_notes').where({ id: note.id }).update({ record_correction_id: ctx.correctionId });
      out[doc.line_seq] = { ...out[doc.line_seq], document_type: 'credit_note', document_id: Number(note.id) };
    } else {
      const corrected = doc.invoice_id ? await trx('customer_invoices').where({ id: doc.invoice_id }).first() : null;
      const bill = await createDebitNoteBill(trx, doc.account_id, corrected, input);
      await trx('customer_invoices').where({ id: bill.id }).update({ record_correction_id: ctx.correctionId });
      // A fuel the invoice did not bill is billed by the debit note.
      if (createdId && add && add.fuel_type !== target?.fuel_type) {
        const line = await trx('invoice_lines').where({ invoice_id: bill.id }).first('id');
        await trx('invoice_consumption').where({ id: createdId }).update({ invoice_line_id: line.id });
        out[doc.line_seq] = { ...out[doc.line_seq], invoice_id: Number(bill.id) };
      }
      out[doc.line_seq] = { ...out[doc.line_seq], document_type: 'debit_note', document_id: Number(bill.id) };
    }
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
    return `It made ${numbers.join(' and ')} on an issued invoice. Correct the entry again instead: that makes the opposite note.`;
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
    if (stage.stage === 'invoiced') return `Its fuel is now on invoice ${invoiceName(stage.invoice)}. Correct the entry again instead.`;
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    const original = await conn('invoice_consumption').where({ id: line.target_id }).first();
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
  plan,
  apply,
  undoBlocker,
  undo,
};
