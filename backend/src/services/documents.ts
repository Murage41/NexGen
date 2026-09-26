import crypto from 'crypto';
import type { Knex } from 'knex';
import { getStationProfile, stationLogo } from './stationProfile';
import { documentDefinition, litresLine, longDate, renderPdf, type DocumentInput } from './documentLayout';

// Stored documents (M8). An issued invoice, debit-note bill or credit note gets
// its PDF once, made from the station profile as it is then, and that same file
// is served ever after: a reprint years later matches what the customer got.
// Issuing saves it; one issued before M8 gets it the first time it is opened.
// The PDFs live in the database (stored_documents), so every backup has them.

type Conn = Knex | Knex.Transaction;
export type DocumentKind = 'customer_invoice' | 'credit_note';

const httpError = (message: string, http: number, code: string) => Object.assign(new Error(message), { http, code });

export async function storedDocument(conn: Conn, kind: DocumentKind, recordId: number) {
  return conn('stored_documents').where({ kind, record_id: recordId }).first();
}

async function documentBase(conn: Conn) {
  const profile = await getStationProfile(conn);
  if (!profile.trading_name) {
    throw httpError(
      'Fill in the station profile in Settings (at least the station name) before documents can be made.',
      409,
      'STATION_PROFILE_INCOMPLETE',
    );
  }
  return { profile, logo: await stationLogo(conn) };
}

async function save(conn: Conn, kind: DocumentKind, recordId: number, number: string, content: Buffer, actorId?: number | null) {
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  try {
    await conn('stored_documents').insert({
      kind,
      record_id: recordId,
      document_number: number,
      content,
      sha256,
      byte_size: content.length,
      created_by_employee_id: actorId || null,
    });
  } catch (err: any) {
    // Saved by another request a moment earlier: that one stands.
    if (!/UNIQUE/i.test(String(err.message))) throw err;
  }
  return storedDocument(conn, kind, recordId);
}

async function customer(conn: Conn, accountId: number) {
  const account = await conn('credit_accounts').where({ id: accountId }).first('name', 'phone', 'kra_pin', 'payment_terms_days');
  return { name: account?.name || '', phone: account?.phone || null, kra_pin: account?.kra_pin || null, terms: Number(account?.payment_terms_days || 0) };
}

// An invoice or DN- debit-note bill.
export async function invoiceDocument(conn: Conn, invoiceId: number, actorId?: number | null) {
  const existing = await storedDocument(conn, 'customer_invoice', invoiceId);
  if (existing) return existing;
  const invoice = await conn('customer_invoices').where({ id: invoiceId }).whereNull('deleted_at').first();
  if (!invoice) throw httpError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
  if (invoice.status === 'draft') throw httpError('A draft has no document yet. Issue the invoice first.', 400, 'INVOICE_NOT_ISSUED');
  if (invoice.status === 'void') throw httpError('This invoice was voided before its document was saved.', 400, 'INVOICE_VOID');
  const base = await documentBase(conn);
  const party = await customer(conn, Number(invoice.account_id));
  const isDebitNote = invoice.document_kind === 'debit_note';

  const lines = (await conn('invoice_lines').where({ invoice_id: invoice.id }).orderBy('fuel_type').orderBy('id'))
    .map((line: any) => litresLine(line.fuel_type, line.total_litres, line.agreed_price, line.line_total));
  const credits = await conn('invoice_credit_applications as c')
    .join('invoice_adjustment_notes as n', 'c.note_id', 'n.id')
    .where('c.invoice_id', invoice.id)
    .whereNull('c.reversed_at')
    .select('c.amount', 'n.note_number');
  const credit = credits.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const total = Number(invoice.total_amount || 0);
  const corrects = invoice.corrects_invoice_id
    ? await conn('customer_invoices').where({ id: invoice.corrects_invoice_id }).first('invoice_number')
    : null;

  const details: Array<[string, string]> = isDebitNote
    ? [['Date', longDate(invoice.issue_date)], ['Due date', longDate(invoice.due_date)]]
    : [['Issue date', longDate(invoice.issue_date)], ['Due date', longDate(invoice.due_date)], ['Period', `${longDate(invoice.from_date)} to ${longDate(invoice.to_date)}`]];
  if (corrects?.invoice_number) details.push(['Corrects', corrects.invoice_number]);
  if (invoice.shift_id) details.push(['Shift', `#${invoice.shift_id}`]);

  const totals: DocumentInput['totals'] = credit > 0
    ? [
      { label: 'Total', amount: total },
      { label: `Less credit (${credits.map((c: any) => c.note_number).join(', ')})`, amount: -credit },
      { label: 'Amount due', amount: Math.max(0, total - credit), strong: true },
    ]
    : [{ label: 'Amount due', amount: total, strong: true }];
  const notes = [
    ...(isDebitNote && invoice.reason ? [`Reason: ${invoice.reason}`] : []),
    party.terms > 0 ? `Please pay by ${longDate(invoice.due_date)} (${party.terms} days).` : 'Payment is due on receipt.',
  ];

  const pdf = await renderPdf(documentDefinition({
    ...base,
    title: isDebitNote ? 'DEBIT NOTE' : 'INVOICE',
    number: invoice.invoice_number,
    details,
    customer: party,
    lines,
    totals,
    notes,
  }));
  return save(conn, 'customer_invoice', invoice.id, invoice.invoice_number, pdf, actorId);
}

export async function creditNoteDocument(conn: Conn, noteId: number, actorId?: number | null) {
  const existing = await storedDocument(conn, 'credit_note', noteId);
  if (existing) return existing;
  const note = await conn('invoice_adjustment_notes').where({ id: noteId }).first();
  if (!note || note.note_type !== 'credit_note') throw httpError('Credit note not found', 404, 'NOTE_NOT_FOUND');
  if (note.status !== 'posted') throw httpError('This credit note was reversed before its document was saved.', 400, 'NOTE_REVERSED');
  const base = await documentBase(conn);
  const party = await customer(conn, Number(note.account_id));
  const invoice = await conn('customer_invoices').where({ id: note.invoice_id }).first('invoice_number');
  const amount = Math.abs(Number(note.amount || 0));
  const applied = note.applied_amount == null ? null : Number(note.applied_amount);
  const held = Number(note.unapplied_amount || 0);

  const totals: DocumentInput['totals'] = [{ label: 'Credit total', amount, strong: true }];
  if (applied != null) totals.push({ label: `Taken off ${invoice?.invoice_number || 'the invoice'}`, amount: applied });
  if (held > 0) totals.push({ label: 'Held for the next invoice', amount: held });

  const pdf = await renderPdf(documentDefinition({
    ...base,
    title: 'CREDIT NOTE',
    number: note.note_number,
    details: [['Date', longDate(note.note_date)], ['Against invoice', invoice?.invoice_number || '']],
    customer: party,
    lines: [litresLine(note.fuel_type, note.litres, note.unit_price, amount, note.correction === 'price' ? ': price correction' : '')],
    totals,
    notes: [`Reason: ${note.reason}`],
  }));
  return save(conn, 'credit_note', note.id, note.note_number, pdf, actorId);
}

// Called right after issuing or posting. Never fails the issue: without a
// station profile the document waits until it is first opened.
export async function saveDocumentAfterPosting(conn: Conn, kind: DocumentKind, recordId: number, actorId?: number | null) {
  try {
    if (kind === 'customer_invoice') await invoiceDocument(conn, recordId, actorId);
    else await creditNoteDocument(conn, recordId, actorId);
  } catch (err: any) {
    if (err.code === 'STATION_PROFILE_INCOMPLETE') return;
    console.error('[documents:save] ERROR', { kind, recordId, error: err.message });
  }
}
