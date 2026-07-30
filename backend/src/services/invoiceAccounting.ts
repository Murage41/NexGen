import type { Knex } from 'knex';

type DbConnection = Knex | Knex.Transaction;
export type InvoiceDocumentType = 'invoice' | 'credit_note' | 'debit_note';

export type AccountingEventInput = {
  sourceKey: string;
  accountId: number;
  invoiceId?: number | null;
  paymentId?: number | null;
  adjustmentNoteId?: number | null;
  eventType: string;
  postingDate: string;
  receivableDelta?: number;
  cashDelta?: number;
  revenueAdjustment?: number;
  retailBaselineAmount?: number;
  documentAmount?: number;
  paymentMethod?: string | null;
  receivingAccount?: string | null;
  reversalOfEventId?: number | null;
  reason?: string | null;
  actorId?: number | null;
};

const prefixes: Record<InvoiceDocumentType, string> = {
  invoice: 'CINV',
  credit_note: 'CN',
  debit_note: 'DN',
};

function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanActorId(actorId?: number | null) {
  const value = Number(actorId || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function addDaysToBusinessDate(date: string, days: number): string {
  const normalizedDays = Math.max(0, Math.trunc(Number(days) || 0));
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid business date');
  parsed.setUTCDate(parsed.getUTCDate() + normalizedDays);
  return parsed.toISOString().slice(0, 10);
}

export function receivingAccountForMethod(paymentMethod: string): string {
  switch (String(paymentMethod || '').toLowerCase()) {
    case 'cash':
      return 'cash_on_hand';
    case 'mpesa':
      return 'mpesa';
    case 'bank':
      return 'bank';
    case 'cheque':
      return 'cheque_clearing';
    default:
      return 'other';
  }
}

export async function nextInvoiceDocumentNumber(
  trx: Knex.Transaction,
  documentType: InvoiceDocumentType,
  businessDate: string,
) {
  const compactDate = businessDate.replace(/-/g, '');
  const prefix = prefixes[documentType];
  const existing = await trx('invoice_document_sequences')
    .where({ document_type: documentType, business_date: businessDate })
    .first();

  let sequence: number;
  if (existing) {
    sequence = Number(existing.last_number) + 1;
    await trx('invoice_document_sequences')
      .where({ document_type: documentType, business_date: businessDate })
      .update({ last_number: sequence, updated_at: trx.fn.now() });
  } else {
    const pattern = `${prefix}-${compactDate}-%`;
    const values = documentType === 'invoice'
      ? await trx('customer_invoices').where('invoice_number', 'like', pattern).pluck('invoice_number')
      : await trx('invoice_adjustment_notes').where('note_number', 'like', pattern).pluck('note_number');
    const maxExisting = values.reduce((max: number, value: unknown) => {
      const parsed = Number(String(value).split('-').pop());
      return Number.isInteger(parsed) && parsed > max ? parsed : max;
    }, 0);
    sequence = maxExisting + 1;
    await trx('invoice_document_sequences').insert({
      document_type: documentType,
      business_date: businessDate,
      last_number: sequence,
    });
  }

  return `${prefix}-${compactDate}-${String(sequence).padStart(3, '0')}`;
}

export async function postInvoiceAccountingEvent(
  trx: Knex.Transaction,
  input: AccountingEventInput,
) {
  await trx('invoice_accounting_events')
    .insert({
      source_key: input.sourceKey,
      account_id: input.accountId,
      invoice_id: input.invoiceId || null,
      payment_id: input.paymentId || null,
      adjustment_note_id: input.adjustmentNoteId || null,
      event_type: input.eventType,
      posting_date: input.postingDate,
      receivable_delta: roundMoney(input.receivableDelta || 0),
      cash_delta: roundMoney(input.cashDelta || 0),
      revenue_adjustment: roundMoney(input.revenueAdjustment || 0),
      retail_baseline_amount: roundMoney(input.retailBaselineAmount || 0),
      document_amount: roundMoney(input.documentAmount || 0),
      payment_method: input.paymentMethod || null,
      receiving_account: input.receivingAccount || null,
      reversal_of_event_id: input.reversalOfEventId || null,
      reason: input.reason || null,
      created_by_employee_id: cleanActorId(input.actorId),
    })
    .onConflict('source_key')
    .ignore();

  return trx('invoice_accounting_events').where({ source_key: input.sourceKey }).first();
}

export async function getInvoiceRetailBaseline(
  trx: DbConnection,
  invoiceId: number,
): Promise<number> {
  const row = await trx('invoice_lines as il')
    .join('invoice_consumption as ic', 'ic.invoice_line_id', 'il.id')
    .where('il.invoice_id', invoiceId)
    .whereNull('ic.deleted_at')
    .where(function (this: any) {
      this.whereNull('ic.entry_status').orWhere('ic.entry_status', 'active');
    })
    .sum({ total: 'ic.retail_amount' })
    .first();
  return roundMoney(Number((row as any)?.total || 0));
}
