import type { Knex } from 'knex';
import { recomputeAccountBalance } from './accountBalance';
import {
  nextInvoiceDocumentNumber,
  postInvoiceAccountingEvent,
} from './invoiceAccounting';
import { recomputeInvoiceTotals, roundMoney } from './receivablePayments';

export type InvoiceAdjustmentInput = {
  invoiceId: number;
  noteType: 'credit_note' | 'debit_note';
  noteDate: string;
  amount?: number;
  fuelType?: string | null;
  litres?: number | null;
  unitPrice?: number | null;
  reason: string;
  actorId?: number | null;
};

function httpError(message: string, http: number, code?: string): Error {
  return Object.assign(new Error(message), { http, code });
}

function actorId(value?: number | null) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validateReason(value: string, label: string) {
  const reason = String(value || '').trim();
  if (reason.length < 10) {
    throw httpError(`${label} must be at least 10 characters.`, 400, 'ADJUSTMENT_REASON_REQUIRED');
  }
  return reason;
}

function normalizeAdjustmentAmount(input: InvoiceAdjustmentInput) {
  const hasQuantityDetail = (
    input.fuelType !== undefined && input.fuelType !== null
    || input.litres !== undefined && input.litres !== null
    || input.unitPrice !== undefined && input.unitPrice !== null
  );
  if (hasQuantityDetail) {
    const fuelType = String(input.fuelType || '').trim().toLowerCase();
    const litres = roundMoney(Number(input.litres));
    const unitPrice = roundMoney(Number(input.unitPrice));
    if (!fuelType || !Number.isFinite(litres) || litres <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw httpError(
        'Fuel type, positive litres, and positive unit price are all required for a quantity adjustment.',
        400,
        'INVALID_ADJUSTMENT_QUANTITY',
      );
    }
    const calculated = roundMoney(litres * unitPrice);
    if (
      input.amount !== undefined
      && Number.isFinite(Number(input.amount))
      && roundMoney(Number(input.amount)) !== calculated
    ) {
      throw httpError(
        'Adjustment amount must equal litres multiplied by unit price.',
        400,
        'ADJUSTMENT_AMOUNT_MISMATCH',
      );
    }
    return { amount: calculated, fuelType, litres, unitPrice };
  }

  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpError('Adjustment amount must be greater than zero.', 400, 'INVALID_ADJUSTMENT_AMOUNT');
  }
  return { amount, fuelType: null, litres: null, unitPrice: null };
}

export async function postInvoiceAdjustment(conn: Knex, input: InvoiceAdjustmentInput) {
  if (input.noteType !== 'credit_note' && input.noteType !== 'debit_note') {
    throw httpError('note_type must be credit_note or debit_note', 400, 'INVALID_NOTE_TYPE');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.noteDate)) {
    throw httpError('note_date must use YYYY-MM-DD format', 400, 'INVALID_NOTE_DATE');
  }
  const reason = validateReason(input.reason, 'Adjustment reason');
  const normalized = normalizeAdjustmentAmount(input);

  return conn.transaction(async (trx) => {
    const invoice = await trx('customer_invoices')
      .where({ id: input.invoiceId })
      .whereNull('deleted_at')
      .first();
    if (!invoice) throw httpError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
    if (!['issued', 'partial', 'paid'].includes(invoice.status)) {
      throw httpError(
        'Credit and debit notes can only be posted to an issued invoice.',
        400,
        'INVOICE_NOT_ISSUED',
      );
    }
    if (input.noteDate < invoice.issue_date) {
      throw httpError('Adjustment date cannot be before the invoice issue date.', 400, 'INVALID_NOTE_DATE');
    }

    if (normalized.fuelType) {
      const matchingLine = await trx('invoice_lines')
        .where({ invoice_id: input.invoiceId, fuel_type: normalized.fuelType })
        .first();
      if (!matchingLine) {
        throw httpError(
          `The invoice has no ${normalized.fuelType} line.`,
          400,
          'FUEL_NOT_ON_INVOICE',
        );
      }
      if (
        input.noteType === 'credit_note'
        && Number(normalized.litres) > Number(matchingLine.total_litres)
      ) {
        throw httpError(
          'Credit-note litres cannot exceed the original invoice line litres.',
          400,
          'CREDIT_LITRES_EXCEED_INVOICE',
        );
      }
      if (input.noteType === 'credit_note') {
        const credited = await trx('invoice_adjustment_notes')
          .where({
            invoice_id: input.invoiceId,
            note_type: 'credit_note',
            fuel_type: normalized.fuelType,
            status: 'posted',
          })
          .sum({ litres: 'litres' })
          .first();
        const cumulativeLitres = roundMoney(
          Number((credited as any)?.litres || 0) + Number(normalized.litres),
        );
        if (cumulativeLitres > roundMoney(Number(matchingLine.total_litres))) {
          throw httpError(
            'Cumulative credit-note litres cannot exceed the original invoice line litres.',
            400,
            'CREDIT_LITRES_EXCEED_INVOICE',
          );
        }
      }
    }

    if (
      input.noteType === 'credit_note'
      && roundMoney(normalized.amount) > roundMoney(Number(invoice.balance || 0))
    ) {
      throw httpError(
        `Credit note KES ${normalized.amount.toFixed(2)} exceeds the current invoice balance of KES ${Number(invoice.balance || 0).toFixed(2)}.`,
        400,
        'CREDIT_NOTE_EXCEEDS_BALANCE',
      );
    }

    const noteNumber = await nextInvoiceDocumentNumber(trx, input.noteType, input.noteDate);
    const signedAmount = input.noteType === 'credit_note'
      ? -normalized.amount
      : normalized.amount;
    const [noteId] = await trx('invoice_adjustment_notes').insert({
      account_id: invoice.account_id,
      invoice_id: input.invoiceId,
      note_number: noteNumber,
      note_type: input.noteType,
      note_date: input.noteDate,
      amount: normalized.amount,
      signed_amount: signedAmount,
      fuel_type: normalized.fuelType,
      litres: normalized.litres,
      unit_price: normalized.unitPrice,
      reason,
      status: 'posted',
      created_by_employee_id: actorId(input.actorId),
    });

    await recomputeInvoiceTotals(input.invoiceId, trx);
    await recomputeAccountBalance(invoice.account_id, trx);
    await postInvoiceAccountingEvent(trx, {
      sourceKey: `adjustment-note:${noteId}:posted`,
      accountId: Number(invoice.account_id),
      invoiceId: input.invoiceId,
      adjustmentNoteId: Number(noteId),
      eventType: input.noteType,
      postingDate: input.noteDate,
      receivableDelta: signedAmount,
      revenueAdjustment: signedAmount,
      documentAmount: signedAmount,
      reason,
      actorId: input.actorId,
    });

    const note = await trx('invoice_adjustment_notes').where({ id: noteId }).first();
    const updatedInvoice = await trx('customer_invoices').where({ id: input.invoiceId }).first();
    return { note, invoice: updatedInvoice };
  });
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

    await trx('invoice_adjustment_notes').where({ id: input.noteId }).update({
      status: 'reversed',
      reversed_at: trx.fn.now(),
      reversed_by_employee_id: actorId(input.actorId),
      reversal_reason: reason,
    });
    await recomputeInvoiceTotals(Number(note.invoice_id), trx);
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
