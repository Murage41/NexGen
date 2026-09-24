import type { Knex } from 'knex';
import { recomputeAccountBalance } from './accountBalance';
import {
  addDaysToBusinessDate,
  getRetailPriceAsOf,
  nextInvoiceDocumentNumber,
  postInvoiceAccountingEvent,
} from './invoiceAccounting';
import { applyInvoiceCustomerCredit, recomputeInvoiceTotals, roundMoney } from './receivablePayments';
import { syncVarianceAccount } from './employeeVariances';
import type { Approver } from './approval';

// Credit and debit notes for invoice customers. An issued invoice is final:
// it is corrected only by a note that refers to it (KRA eTIMS works the same
// way). Invoice customers take fuel on account, so every note is fuel, litres
// and a price per litre, never a bare amount:
//
// - What was wrong is the litres (fewer or more than the invoice says: priced
//   at the invoice's agreed price for that fuel) or the price (the same litres
//   at the difference per litre).
// - A credit note reduces what the customer owes. It reduces its own invoice
//   by what is still unpaid on it; anything beyond that is the customer's
//   credit, which pays their open invoices and then the next one issued. It is
//   never paid out (owner decision 2026-09-24). It can never credit more of a
//   fuel than the invoice billed.
// - A debit note increases what the customer owes. It is its own bill
//   (customer_invoices.document_kind 'debit_note'): numbered DN-, due and
//   payable like an invoice, referring to the invoice it corrects or to the
//   shift the fuel came from, so it works for a customer with no invoice yet.
// - Notes are dated the day they are posted and approved by an administrator.
//   A note is never edited; a wrong credit note is reversed, a wrong unpaid
//   debit note is voided, and a paid one is corrected by a credit note.
// - A note on a shift can name that shift's attendant instead of the station:
//   litres they recorded on the customer to cover their drawer (credit note),
//   or a customer's litres they never recorded, which left their drawer short
//   (debit note). Their shortage on that shift goes up (or down) by the litres
//   at the shift's pump price, which is what the drawer was really short; the
//   station's revenue then changes only by the customer's price difference on
//   those litres. Reversing the note (voiding the debit note) undoes it.
// Tank stock never changes: the fuel left the pumps either way. A note only
// changes who owes it.

export type NoteInput = {
  noteType: 'credit_note' | 'debit_note';
  correction: 'litres' | 'price';
  fuelType: string;
  litres: number;
  unitPrice?: number | null;
  reason: string;
  shiftId?: number | null;
  // The shift's attendant owes it (credit note) or is owed it (debit note),
  // instead of the station.
  attendant?: boolean;
  noteDate: string;
  approver: Approver;
  actorId?: number | null;
};

function httpError(message: string, http: number, code?: string): Error {
  return Object.assign(new Error(message), { http, code });
}

function actorId(value?: number | null) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const cents = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const kes = (value: number) => `KES ${value.toFixed(2)}`;

function validateReason(value: string, label: string) {
  const reason = String(value || '').trim();
  if (reason.length < 10) {
    throw httpError(`${label} must be at least 10 characters.`, 400, 'ADJUSTMENT_REASON_REQUIRED');
  }
  return reason;
}

function parseNote(input: NoteInput) {
  if (input.noteType !== 'credit_note' && input.noteType !== 'debit_note') {
    throw httpError('note_type must be credit_note or debit_note', 400, 'INVALID_NOTE_TYPE');
  }
  if (input.correction !== 'litres' && input.correction !== 'price') {
    throw httpError('Say what was wrong: the litres or the price.', 400, 'INVALID_CORRECTION');
  }
  const fuelType = String(input.fuelType || '').trim().toLowerCase();
  if (!fuelType) throw httpError('Choose the fuel.', 400, 'INVALID_ADJUSTMENT_QUANTITY');
  const litres = roundMoney(Number(input.litres));
  if (!Number.isFinite(litres) || litres <= 0) throw httpError('Enter the litres.', 400, 'INVALID_ADJUSTMENT_QUANTITY');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.noteDate)) {
    throw httpError('note_date must use YYYY-MM-DD format', 400, 'INVALID_NOTE_DATE');
  }
  return { fuelType, litres, reason: validateReason(input.reason, 'Adjustment reason') };
}

async function invoiceAccount(trx: Knex.Transaction, accountId: number) {
  const account = await trx('credit_accounts').where({ id: accountId }).whereNull('deleted_at').first();
  if (!account || account.type !== 'customer' || account.billing_mode !== 'invoice') {
    throw httpError('Invoice customer not found.', 404, 'ACCOUNT_NOT_FOUND');
  }
  return account;
}

// The price per litre of a note against an invoice line.
function notePrice(correction: 'litres' | 'price', line: any, unitPrice: unknown, litres: number) {
  const agreed = roundMoney(Number(line.agreed_price));
  if (correction === 'litres') return agreed;
  const difference = roundMoney(Number(unitPrice));
  if (!Number.isFinite(difference) || difference <= 0) {
    throw httpError('Enter the price difference per litre.', 400, 'INVALID_ADJUSTMENT_QUANTITY');
  }
  if (litres > roundMoney(Number(line.total_litres))) {
    throw httpError(`The invoice billed ${Number(line.total_litres).toFixed(2)} L of ${line.fuel_type}.`, 400, 'CREDIT_LITRES_EXCEED_INVOICE');
  }
  return difference;
}

export type NoteAttendant = {
  employee_id: number;
  employee_name: string;
  shift_id: number;
  // The shift's pump price for the fuel, and the litres at it.
  price: number;
  amount: number;
  // Credit notes: litres of the customer's on the shift not yet put on them.
  available_litres: number | null;
};

type Link = { invoice_note_id: number } | { invoice_id: number };

// The attendant a note names: whoever worked its shift, at the shift's pump
// price. A credit note can put on them only litres recorded on this customer
// in that shift (on this invoice) that are not on them already; a debit
// note's litres were never recorded, so it takes the pump price of the day.
export async function noteAttendant(
  conn: Knex | Knex.Transaction,
  input: {
    accountId: number;
    invoiceId: number | null;
    noteType: string;
    correction: string;
    fuelType: string;
    litres: number;
    shiftId: number | null;
  },
): Promise<NoteAttendant> {
  if (input.correction !== 'litres') {
    throw httpError("Only litres can be the attendant's. The invoice price is not theirs.", 400, 'ATTENDANT_LITRES_ONLY');
  }
  if (!input.shiftId) throw httpError('Enter the shift number: its attendant is the one who owes it.', 400, 'SHIFT_REQUIRED');
  const shift = await conn('shifts as s')
    .leftJoin('employees as e', 's.employee_id', 'e.id')
    .where('s.id', input.shiftId)
    .first('s.id', 's.status', 's.shift_date', 's.employee_id', 'e.name');
  if (!shift) throw httpError(`Shift #${input.shiftId} not found.`, 404, 'SHIFT_NOT_FOUND');
  if (shift.status !== 'closed') throw httpError(`Shift #${input.shiftId} is not closed.`, 409, 'SHIFT_NOT_CLOSED');
  if (!shift.employee_id) throw httpError(`Shift #${input.shiftId} has no attendant.`, 409, 'SHIFT_NO_ATTENDANT');
  const fuelType = String(input.fuelType || '').trim().toLowerCase();
  const litres = roundMoney(Number(input.litres) || 0);

  let price: number;
  let available: number | null = null;
  if (input.noteType === 'credit_note') {
    const recordedQuery = conn('invoice_consumption as ic')
      .where({ 'ic.account_id': input.accountId, 'ic.shift_id': shift.id, 'ic.fuel_type': fuelType })
      .whereNull('ic.deleted_at')
      .where((q) => q.whereNull('ic.entry_status').orWhere('ic.entry_status', 'active'));
    if (input.invoiceId) {
      recordedQuery.whereIn('ic.invoice_line_id', conn('invoice_lines').where({ invoice_id: input.invoiceId }).select('id'));
    }
    const recorded: any = await recordedQuery.sum({ litres: 'ic.litres', value: 'ic.retail_amount' }).first();
    if (!(cents(recorded?.litres) > 0)) {
      throw httpError(
        `No ${fuelType} was recorded on this customer${input.invoiceId ? ' for this invoice' : ''} in shift #${shift.id}.`,
        400,
        'ATTENDANT_NOT_ON_SHIFT',
      );
    }
    const onAttendant: any = await conn('invoice_adjustment_notes as n')
      .join('employee_variance_entries as v', 'v.invoice_note_id', 'n.id')
      .where({ 'n.account_id': input.accountId, 'n.shift_id': shift.id, 'n.fuel_type': fuelType, 'n.status': 'posted', 'v.status': 'posted' })
      .sum({ litres: 'n.litres' })
      .first();
    const left = cents(recorded.litres) - cents(onAttendant?.litres);
    available = Math.max(0, left) / 100;
    if (cents(litres) > left) {
      throw httpError(
        `Shift #${shift.id} recorded ${Number(recorded.litres).toFixed(2)} L of ${fuelType} on this customer; ${(cents(onAttendant?.litres) / 100).toFixed(2)} L of it are already on the attendant.`,
        400,
        'ATTENDANT_LITRES_EXCEED_SHIFT',
      );
    }
    // The price the shift recorded them at.
    price = roundMoney(Number(recorded.value) / Number(recorded.litres));
  } else {
    const day = String(shift.shift_date).slice(0, 10);
    const retail = await getRetailPriceAsOf(conn, fuelType, day);
    if (retail === null) throw httpError(`No ${fuelType} pump price was set on ${day}.`, 409, 'NO_PUMP_PRICE');
    price = roundMoney(retail);
  }
  return {
    employee_id: Number(shift.employee_id),
    employee_name: String(shift.name || 'The attendant'),
    shift_id: Number(shift.id),
    price,
    amount: roundMoney(litres * price),
    available_litres: available,
  };
}

// The attendant's side of a note: a 'correction' of their shortage on the
// shift, like a balance move on their own shift.
async function postAttendantEntry(
  trx: Knex.Transaction,
  attendant: NoteAttendant,
  signedAmount: number,
  link: Link,
  documentNumber: string,
  label: string,
  input: NoteInput,
) {
  await trx('employee_variance_entries').insert({
    employee_id: attendant.employee_id,
    entry_type: 'correction',
    shift_id: attendant.shift_id,
    entry_date: input.noteDate,
    amount: signedAmount,
    refundable: false,
    reference: documentNumber,
    reason: label,
    approved_by_employee_id: input.approver.id,
    approved_by_name: input.approver.name,
    created_by_employee_id: actorId(input.actorId),
    ...link,
  });
  await syncVarianceAccount(trx, attendant.employee_id);
}

// Undoes a note's attendant entry when the note is reversed or its debit
// note voided.
export async function reverseAttendantEntries(trx: Knex.Transaction, link: Link, reason: string, actor?: number | null) {
  const entries = await trx('employee_variance_entries').where({ ...link, status: 'posted' });
  for (const entry of entries) {
    await trx('employee_variance_entries').where({ id: entry.id }).update({
      status: 'reversed',
      reversed_at: new Date().toISOString(),
      reversed_by_employee_id: actorId(actor),
      reversal_reason: reason,
    });
    await syncVarianceAccount(trx, Number(entry.employee_id));
  }
}

const litresText = (litres: number, fuelType: string) => `${litres.toFixed(2)} L of ${fuelType}`;

// A credit note against an issued invoice (or debit-note bill).
async function postCreditNote(trx: Knex.Transaction, invoice: any, input: NoteInput) {
  const { fuelType, litres, reason } = parseNote(input);
  const line = await trx('invoice_lines').where({ invoice_id: invoice.id, fuel_type: fuelType }).first();
  if (!line) throw httpError(`The invoice has no ${fuelType} line.`, 400, 'FUEL_NOT_ON_INVOICE');
  const unitPrice = notePrice(input.correction, line, input.unitPrice, litres);
  if (input.correction === 'price' && unitPrice > roundMoney(Number(line.agreed_price))) {
    throw httpError(`The invoice price was ${kes(Number(line.agreed_price))} a litre.`, 400, 'CREDIT_PRICE_EXCEEDS_INVOICE');
  }
  const amount = roundMoney(litres * unitPrice);
  const attendant = input.attendant
    ? await noteAttendant(trx, {
      accountId: Number(invoice.account_id),
      invoiceId: Number(invoice.id),
      noteType: 'credit_note',
      correction: input.correction,
      fuelType,
      litres,
      shiftId: input.shiftId || null,
    })
    : null;

  const posted = await trx('invoice_adjustment_notes')
    .where({ invoice_id: invoice.id, status: 'posted' })
    .select('note_type', 'correction', 'fuel_type', 'litres', 'amount');
  if (input.correction === 'litres') {
    const credited = posted
      .filter((n: any) => n.note_type === 'credit_note' && n.fuel_type === fuelType && n.correction !== 'price')
      .reduce((sum: number, n: any) => sum + cents(n.litres), 0);
    if (credited + cents(litres) > cents(line.total_litres)) {
      throw httpError(
        `The invoice billed ${Number(line.total_litres).toFixed(2)} L of ${fuelType}; ${(credited / 100).toFixed(2)} L are already credited.`,
        400,
        'CREDIT_LITRES_EXCEED_INVOICE',
      );
    }
  }
  // Never more of a fuel's value than the invoice billed for it.
  const creditedValue = posted
    .filter((n: any) => n.note_type === 'credit_note' && n.fuel_type === fuelType)
    .reduce((sum: number, n: any) => sum + cents(n.amount), 0);
  const debitedValue = posted
    .filter((n: any) => n.note_type === 'debit_note' && n.fuel_type === fuelType)
    .reduce((sum: number, n: any) => sum + cents(n.amount), 0);
  if (creditedValue + cents(amount) > cents(line.line_total) + debitedValue) {
    throw httpError(
      `The invoice billed ${kes((cents(line.line_total) + debitedValue) / 100)} of ${fuelType}; ${kes(creditedValue / 100)} is already credited.`,
      400,
      'CREDIT_NOTE_EXCEEDS_BILLED',
    );
  }

  // What is still unpaid on the invoice takes it first; the rest is credit.
  const applied = Math.min(cents(amount), Math.max(0, cents(invoice.balance)));
  const noteNumber = await nextInvoiceDocumentNumber(trx, 'credit_note', input.noteDate);
  const [noteId] = await trx('invoice_adjustment_notes').insert({
    account_id: invoice.account_id,
    invoice_id: invoice.id,
    note_number: noteNumber,
    note_type: 'credit_note',
    note_date: input.noteDate,
    amount,
    signed_amount: -amount,
    applied_amount: applied / 100,
    unapplied_amount: (cents(amount) - applied) / 100,
    correction: input.correction,
    fuel_type: fuelType,
    litres,
    unit_price: unitPrice,
    reason,
    shift_id: input.shiftId || null,
    status: 'posted',
    approved_by_employee_id: input.approver.id,
    approved_by_name: input.approver.name,
    created_by_employee_id: actorId(input.actorId),
  });
  await recomputeInvoiceTotals(Number(invoice.id), trx);
  if (attendant) {
    const account = await trx('credit_accounts').where({ id: invoice.account_id }).first('name');
    await postAttendantEntry(
      trx,
      attendant,
      attendant.amount,
      { invoice_note_id: Number(noteId) },
      noteNumber,
      `Credit note ${noteNumber}: ${litresText(litres, fuelType)} recorded on ${account?.name} in shift #${attendant.shift_id} were not taken (at ${kes(attendant.price)} a litre): ${reason}`,
      input,
    );
  }
  await postInvoiceAccountingEvent(trx, {
    sourceKey: `adjustment-note:${noteId}:posted`,
    accountId: Number(invoice.account_id),
    invoiceId: Number(invoice.id),
    adjustmentNoteId: Number(noteId),
    eventType: 'credit_note',
    postingDate: input.noteDate,
    receivableDelta: -amount,
    // The station loses the fuel, unless the attendant owes it: then only the
    // customer's price difference on those litres.
    revenueAdjustment: attendant ? roundMoney(attendant.amount - amount) : -amount,
    documentAmount: -amount,
    reason,
    actorId: input.actorId,
  });
  await applyInvoiceCustomerCredit(trx, Number(invoice.account_id));
  await recomputeAccountBalance(invoice.account_id, trx);
  return trx('invoice_adjustment_notes').where({ id: noteId }).first();
}

// A debit note: a bill of its own, correcting an invoice or charging fuel from
// a shift that was recorded on someone else.
async function createDebitNoteBill(
  trx: Knex.Transaction,
  accountId: number,
  correctedInvoice: any | null,
  input: NoteInput,
) {
  const { fuelType, litres, reason } = parseNote(input);
  const account = await invoiceAccount(trx, accountId);
  let unitPrice: number;
  if (correctedInvoice) {
    const line = await trx('invoice_lines').where({ invoice_id: correctedInvoice.id, fuel_type: fuelType }).first();
    if (!line) throw httpError(`The invoice has no ${fuelType} line.`, 400, 'FUEL_NOT_ON_INVOICE');
    unitPrice = notePrice(input.correction, line, input.unitPrice, litres);
  } else {
    if (input.correction !== 'litres') {
      throw httpError('A price correction needs the invoice it corrects.', 400, 'INVALID_CORRECTION');
    }
    unitPrice = roundMoney(Number(input.unitPrice));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw httpError('Enter the price per litre.', 400, 'INVALID_ADJUSTMENT_QUANTITY');
    }
  }
  let fromDate = input.noteDate;
  if (input.shiftId) {
    const shift = await trx('shifts').where({ id: input.shiftId }).first('shift_date', 'status');
    if (!shift) throw httpError(`Shift #${input.shiftId} not found.`, 404, 'SHIFT_NOT_FOUND');
    if (shift.status !== 'closed') throw httpError(`Shift #${input.shiftId} is not closed.`, 409, 'SHIFT_NOT_CLOSED');
    fromDate = String(shift.shift_date).slice(0, 10);
  }
  const amount = roundMoney(litres * unitPrice);
  const attendant = input.attendant
    ? await noteAttendant(trx, {
      accountId,
      invoiceId: correctedInvoice?.id ?? null,
      noteType: 'debit_note',
      correction: input.correction,
      fuelType,
      litres,
      shiftId: input.shiftId || null,
    })
    : null;
  // Extra revenue, unless the attendant's drawer was short by these litres:
  // then only the customer's price difference on them.
  const revenue = attendant ? roundMoney(amount - attendant.amount) : amount;
  const termsDays = Math.max(0, Math.trunc(Number(account.payment_terms_days || 0)));
  const number = await nextInvoiceDocumentNumber(trx, 'debit_note', input.noteDate);
  const [billId] = await trx('customer_invoices').insert({
    account_id: accountId,
    invoice_number: number,
    document_kind: 'debit_note',
    from_date: fromDate,
    to_date: fromDate,
    issue_date: input.noteDate,
    due_date: addDaysToBusinessDate(input.noteDate, termsDays),
    status: 'issued',
    reservation_status: 'not_applicable',
    total_amount: amount,
    // Its revenue: voiding it reverses this (invoiceLifecycle.ts).
    price_adjustment_amount: revenue,
    balance: amount,
    reason,
    notes: reason,
    shift_id: input.shiftId || null,
    corrects_invoice_id: correctedInvoice?.id || null,
    issued_at: trx.fn.now(),
    issued_by_employee_id: actorId(input.actorId),
    approved_by_employee_id: input.approver.id,
    approved_by_name: input.approver.name,
  });
  await trx('invoice_lines').insert({
    invoice_id: billId,
    fuel_type: fuelType,
    total_litres: litres,
    agreed_price: unitPrice,
    line_total: amount,
  });
  await recomputeInvoiceTotals(Number(billId), trx);
  if (attendant) {
    await postAttendantEntry(
      trx,
      attendant,
      -attendant.amount,
      { invoice_id: Number(billId) },
      number,
      `Debit note ${number}: ${litresText(litres, fuelType)} taken by ${account.name} in shift #${attendant.shift_id} were not recorded (at ${kes(attendant.price)} a litre): ${reason}`,
      input,
    );
  }
  await postInvoiceAccountingEvent(trx, {
    sourceKey: `debit-note:${billId}:issue`,
    accountId,
    invoiceId: Number(billId),
    eventType: 'debit_note',
    postingDate: input.noteDate,
    receivableDelta: amount,
    revenueAdjustment: revenue,
    documentAmount: amount,
    reason,
    actorId: input.actorId,
  });
  // Credit the customer holds pays it.
  await applyInvoiceCustomerCredit(trx, accountId);
  await recomputeAccountBalance(accountId, trx);
  return trx('customer_invoices').where({ id: billId }).first();
}

// A note against an issued invoice: a credit note on it, or a debit-note bill
// correcting it.
export async function postInvoiceAdjustment(conn: Knex, input: NoteInput & { invoiceId: number }) {
  return conn.transaction(async (trx) => {
    const invoice = await trx('customer_invoices').where({ id: input.invoiceId }).whereNull('deleted_at').first();
    if (!invoice) throw httpError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
    if (!['issued', 'partial', 'paid'].includes(invoice.status)) {
      throw httpError('Credit and debit notes can only be posted to an issued invoice.', 400, 'INVOICE_NOT_ISSUED');
    }
    await invoiceAccount(trx, Number(invoice.account_id));
    if (input.noteType === 'debit_note') {
      const bill = await createDebitNoteBill(trx, Number(invoice.account_id), invoice, input);
      return { debit_note: bill, invoice: await trx('customer_invoices').where({ id: invoice.id }).first() };
    }
    const note = await postCreditNote(trx, invoice, input);
    return { note, invoice: await trx('customer_invoices').where({ id: invoice.id }).first() };
  });
}

// A debit note for a customer without an invoice to correct: fuel from a
// shift that was recorded on someone else, or missed.
export async function postStandaloneDebitNote(conn: Knex, input: NoteInput & { accountId: number }) {
  if (!input.shiftId) throw httpError('Enter the shift the fuel was taken on.', 400, 'SHIFT_REQUIRED');
  return conn.transaction((trx) => createDebitNoteBill(trx, input.accountId, null, { ...input, noteType: 'debit_note' }));
}

export async function reverseInvoiceAdjustment(
  conn: Knex,
  input: {
    noteId: number;
    reversalDate: string;
    reason: string;
    actorId?: number | null;
  },
) {
  const reason = validateReason(input.reason, 'Reversal reason');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reversalDate)) {
    throw httpError('reversal_date must use YYYY-MM-DD format', 400, 'INVALID_REVERSAL_DATE');
  }

  return conn.transaction(async (trx) => {
    const note = await trx('invoice_adjustment_notes').where({ id: input.noteId }).first();
    if (!note) throw httpError('Adjustment note not found', 404, 'ADJUSTMENT_NOT_FOUND');
    if (note.status !== 'posted') {
      throw httpError('Adjustment note has already been reversed.', 409, 'ADJUSTMENT_ALREADY_REVERSED');
    }
    if (input.reversalDate < note.note_date) {
      throw httpError('Reversal date cannot be before the note date.', 400, 'INVALID_REVERSAL_DATE');
    }

    // Credit it gave other invoices comes back off them.
    const applications = await trx('invoice_credit_applications').where({ note_id: note.id }).whereNull('reversed_at');
    await trx('invoice_credit_applications').where({ note_id: note.id }).whereNull('reversed_at').update({ reversed_at: trx.fn.now() });
    await trx('invoice_adjustment_notes').where({ id: input.noteId }).update({
      status: 'reversed',
      unapplied_amount: 0,
      reversed_at: trx.fn.now(),
      reversed_by_employee_id: actorId(input.actorId),
      reversal_reason: reason,
    });
    await reverseAttendantEntries(trx, { invoice_note_id: Number(note.id) }, `${note.note_number} reversed: ${reason}`, input.actorId);
    try {
      await recomputeInvoiceTotals(Number(note.invoice_id), trx);
    } catch (err: any) {
      if (err?.code === 'INVOICE_OVERALLOCATED' && note.note_type === 'debit_note') {
        throw httpError('This debit note has been paid, so it cannot be reversed. Issue a credit note instead.', 409, 'DEBIT_NOTE_PAID');
      }
      throw err;
    }
    for (const invoiceId of new Set(applications.map((a: any) => Number(a.invoice_id)))) {
      await recomputeInvoiceTotals(invoiceId, trx);
    }
    await recomputeAccountBalance(note.account_id, trx);

    const originalEvent = await trx('invoice_accounting_events')
      .where({ source_key: `adjustment-note:${input.noteId}:posted` })
      .first();
    await postInvoiceAccountingEvent(trx, {
      sourceKey: `adjustment-note:${input.noteId}:reversal`,
      accountId: Number(note.account_id),
      invoiceId: Number(note.invoice_id),
      adjustmentNoteId: input.noteId,
      eventType: `${note.note_type}_reversal`,
      postingDate: input.reversalDate,
      receivableDelta: -Number(note.signed_amount),
      revenueAdjustment: originalEvent ? -Number(originalEvent.revenue_adjustment || 0) : -Number(note.signed_amount),
      documentAmount: -Number(note.signed_amount),
      reversalOfEventId: originalEvent?.id || null,
      reason,
      actorId: input.actorId,
    });

    const reversed = await trx('invoice_adjustment_notes').where({ id: input.noteId }).first();
    const updatedInvoice = await trx('customer_invoices').where({ id: note.invoice_id }).first();
    return { note: reversed, invoice: updatedInvoice };
  });
}
