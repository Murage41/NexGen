import type { Knex } from 'knex';
import { recomputeAccountBalance } from './accountBalance';
import {
  addDaysToBusinessDate,
  nextInvoiceDocumentNumber,
  postInvoiceAccountingEvent,
} from './invoiceAccounting';
import { applyInvoiceCustomerCredit, recomputeInvoiceTotals, roundMoney } from './receivablePayments';
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
  await postInvoiceAccountingEvent(trx, {
    sourceKey: `adjustment-note:${noteId}:posted`,
    accountId: Number(invoice.account_id),
    invoiceId: Number(invoice.id),
    adjustmentNoteId: Number(noteId),
    eventType: 'credit_note',
    postingDate: input.noteDate,
    receivableDelta: -amount,
    revenueAdjustment: -amount,
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
    price_adjustment_amount: amount,
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
  await postInvoiceAccountingEvent(trx, {
    sourceKey: `debit-note:${billId}:issue`,
    accountId,
    invoiceId: Number(billId),
    eventType: 'debit_note',
    postingDate: input.noteDate,
    receivableDelta: amount,
    revenueAdjustment: amount,
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
      revenueAdjustment: -Number(note.signed_amount),
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
