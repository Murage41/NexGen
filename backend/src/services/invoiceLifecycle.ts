import type { Knex } from 'knex';
import { recomputeAccountBalance } from './accountBalance';
import {
  addDaysToBusinessDate,
  getInvoiceRetailBaseline,
  nextInvoiceDocumentNumber,
  postInvoiceAccountingEvent,
} from './invoiceAccounting';
import {
  releaseInvoiceReservation,
  validateDraftReservationForIssue,
} from './invoiceDraftReservations';
import { recomputeInvoiceTotals, roundMoney } from './receivablePayments';

function httpError(message: string, http: number, code?: string): Error {
  return Object.assign(new Error(message), { http, code });
}

function actorId(value?: number | null) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function issueReservedCustomerInvoice(
  conn: Knex,
  input: {
    invoiceId: number;
    issueDate: string;
    actorId?: number | null;
  },
) {
  return conn.transaction(async (trx) => {
    const invoice = await trx('customer_invoices')
      .where({ id: input.invoiceId })
      .whereNull('deleted_at')
      .first();
    if (!invoice) throw httpError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
    if (invoice.status !== 'draft') {
      throw httpError('Only draft invoices can be issued', 400, 'INVOICE_NOT_DRAFT');
    }

    await validateDraftReservationForIssue(trx, invoice);
    const prepared = await trx('customer_invoices').where({ id: input.invoiceId }).first();
    const retailBaseline = await getInvoiceRetailBaseline(trx, input.invoiceId);
    const agreedTotal = roundMoney(Number(prepared.total_amount || 0));
    if (agreedTotal <= 0 || retailBaseline <= 0) {
      throw httpError('Invoice totals must be greater than zero', 400, 'INVALID_INVOICE_TOTAL');
    }

    const account = await trx('credit_accounts').where({ id: invoice.account_id }).first();
    const termsDays = Math.max(0, Math.trunc(Number(account?.payment_terms_days || 0)));
    const dueDate = addDaysToBusinessDate(input.issueDate, termsDays);
    const priceAdjustment = roundMoney(agreedTotal - retailBaseline);
    const invoiceNumber = await nextInvoiceDocumentNumber(trx, 'invoice', input.issueDate);
    await trx('customer_invoices').where({ id: input.invoiceId }).update({
      invoice_number: invoiceNumber,
      issue_date: input.issueDate,
      due_date: dueDate,
      status: 'issued',
      reservation_status: 'issued',
      reservation_updated_at: trx.fn.now(),
      retail_baseline_amount: retailBaseline,
      price_adjustment_amount: priceAdjustment,
      issued_at: trx.fn.now(),
      issued_by_employee_id: actorId(input.actorId),
    });

    await recomputeInvoiceTotals(input.invoiceId, trx);
    await recomputeAccountBalance(invoice.account_id, trx);
    await postInvoiceAccountingEvent(trx, {
      sourceKey: `invoice:${input.invoiceId}:issue`,
      accountId: Number(invoice.account_id),
      invoiceId: input.invoiceId,
      eventType: 'invoice_issue',
      postingDate: input.issueDate,
      receivableDelta: agreedTotal,
      revenueAdjustment: priceAdjustment,
      retailBaselineAmount: retailBaseline,
      documentAmount: agreedTotal,
      reason: 'Customer invoice issued',
      actorId: input.actorId,
    });

    return trx('customer_invoices').where({ id: input.invoiceId }).first();
  });
}

export async function voidIssuedCustomerInvoice(
  conn: Knex,
  input: {
    invoiceId: number;
    voidDate: string;
    reason: string;
    actorId?: number | null;
  },
) {
  const reason = String(input.reason || '').trim();
  if (reason.length < 10) {
    throw httpError(
      'A void reason of at least 10 characters is required.',
      400,
      'VOID_REASON_REQUIRED',
    );
  }

  return conn.transaction(async (trx) => {
    const invoice = await trx('customer_invoices')
      .where({ id: input.invoiceId })
      .whereNull('deleted_at')
      .first();
    if (!invoice) throw httpError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
    if (!['issued', 'partial', 'paid'].includes(invoice.status)) {
      throw httpError('Only issued invoices can be voided', 400, 'INVOICE_NOT_ISSUED');
    }
    if (input.voidDate < invoice.issue_date) {
      throw httpError('Void date cannot be before the issue date.', 400, 'INVALID_VOID_DATE');
    }

    const paid = await trx('invoice_payment_allocations as allocation')
      .join('invoice_payments as payment', 'allocation.payment_id', 'payment.id')
      .where('allocation.invoice_id', input.invoiceId)
      .where('payment.status', 'posted')
      .whereNull('payment.deleted_at')
      .sum('allocation.amount_applied as total')
      .first();
    if (Number((paid as any)?.total || 0) > 0) {
      throw httpError('Cannot void an invoice with allocated payments', 400, 'INVOICE_HAS_PAYMENTS');
    }

    const postedNotes = await trx('invoice_adjustment_notes')
      .where({ invoice_id: input.invoiceId, status: 'posted' })
      .count({ count: 'id' })
      .first();
    if (Number((postedNotes as any)?.count || 0) > 0) {
      throw httpError(
        'Reverse all credit or debit notes before voiding this invoice.',
        400,
        'INVOICE_HAS_ADJUSTMENTS',
      );
    }

    await releaseInvoiceReservation(trx, input.invoiceId);
    await trx('customer_invoices').where({ id: input.invoiceId }).update({
      status: 'void',
      balance: 0,
      reservation_status: 'released',
      reservation_updated_at: trx.fn.now(),
      voided_at: trx.fn.now(),
      voided_by_employee_id: actorId(input.actorId),
      void_reason: reason,
    });

    await recomputeAccountBalance(invoice.account_id, trx);
    await postInvoiceAccountingEvent(trx, {
      sourceKey: `invoice:${input.invoiceId}:void`,
      accountId: Number(invoice.account_id),
      invoiceId: input.invoiceId,
      eventType: 'invoice_void',
      postingDate: input.voidDate,
      receivableDelta: -Number(invoice.total_amount),
      revenueAdjustment: -Number(invoice.price_adjustment_amount || 0),
      retailBaselineAmount: -Number(invoice.retail_baseline_amount || 0),
      documentAmount: -Number(invoice.total_amount),
      reason,
      actorId: input.actorId,
    });

    return trx('customer_invoices').where({ id: input.invoiceId }).first();
  });
}
