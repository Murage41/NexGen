import crypto from 'crypto';
import type { Knex } from 'knex';
import { getStationProfile, stationLogo } from './stationProfile';
import { documentDefinition, fuelName, kes, litresLine, longDate, money2, renderPdf, type DocumentInput, type DocumentSection } from './documentLayout';
import { invoiceCustomerCredit } from './receivablePayments';

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

// Shares a total out over parts: each part's exact value is in units `scale`
// times finer than the result; parts are rounded down and the units still
// missing go to the largest remainders, so the parts add up to `total`
// exactly. Null when that cannot be done (the parts do not match the total).
function shareOut(exact: number[], scale: number, total: number): number[] | null {
  const parts = exact.map((value) => Math.floor(value / scale));
  let missing = total - parts.reduce((a, b) => a + b, 0);
  if (missing < 0 || missing > parts.length) return null;
  const byRemainder = exact.map((value, index) => ({ index, rest: value % scale })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of byRemainder) {
    if (missing === 0) break;
    parts[index] += 1;
    missing -= 1;
  }
  return parts;
}

// Fuel by shift: an invoice's fills per shift and line (fuel and pump price),
// each at the amount recorded at the pump, so the rows add up to the invoice.
// Meters give litres to 3 decimals and the line rounds the total to 2, so the
// litres are shared out (shareOut). Left out when the fills do not add up to
// the line (an invoice from before lines were billed at pump amounts).
async function fuelByShift(conn: Conn, lines: any[]): Promise<DocumentSection | undefined> {
  const fuelLines = lines.filter((line) => line.fuel_type !== 'adjustment');
  if (fuelLines.length === 0) return undefined;
  const entries: any[] = await conn('invoice_consumption as ic')
    .join('shifts as s', 'ic.shift_id', 's.id')
    .whereIn('ic.invoice_line_id', fuelLines.map((line) => line.id))
    .whereNull('ic.deleted_at')
    .where((q) => q.whereNull('ic.entry_status').orWhere('ic.entry_status', 'active'))
    .groupBy('ic.invoice_line_id', 'ic.shift_id', 's.shift_date')
    .select('ic.invoice_line_id as line_id', 'ic.shift_id', 's.shift_date')
    .sum({ litres: 'ic.litres' })
    .sum({ amount: 'ic.retail_amount' });

  const rows: Array<{ date: string; shift: string; fuel: string; centilitres: number; cents: number; day: string; shiftId: number; order: number }> = [];
  for (const [order, line] of fuelLines.entries()) {
    const own = entries.filter((entry) => Number(entry.line_id) === Number(line.id));
    if (own.length === 0) return undefined;
    // Millilitres shared out to centilitres; amounts in whole cents.
    const centilitres = shareOut(own.map((entry) => Math.round(Number(entry.litres) * 1000)), 10, Math.round(Number(line.total_litres) * 100));
    const cents = own.map((entry) => Math.round(Number(entry.amount) * 100));
    if (!centilitres || cents.reduce((a, b) => a + b, 0) !== Math.round(Number(line.line_total) * 100)) return undefined;
    own.forEach((entry, index) => rows.push({
      date: longDate(entry.shift_date),
      shift: `#${entry.shift_id}`,
      fuel: fuelName(line.fuel_type),
      centilitres: centilitres[index],
      cents: cents[index],
      day: String(entry.shift_date),
      shiftId: Number(entry.shift_id),
      order,
    }));
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.shiftId - b.shiftId || a.order - b.order);
  const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0) / 100;
  return {
    title: 'Fuel by shift',
    columns: [
      { header: 'Date', width: 80 }, { header: 'Shift', width: 55 }, { header: 'Fuel', width: '*' },
      { header: 'Litres', width: 70, right: true }, { header: 'Amount (KES)', width: 95, right: true },
    ],
    rows: rows.map((row) => [row.date, row.shift, row.fuel, money2(row.centilitres / 100), money2(row.cents / 100)]),
    total: ['Total', '', '', money2(sum((row) => row.centilitres)), money2(sum((row) => row.cents))],
  };
}

const STATEMENT_EVENTS: Record<string, string> = {
  invoice_issue: 'Invoice',
  invoice_void: 'Voided',
  invoice_payment: 'Payment',
  invoice_payment_reversal: 'Payment reversed',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
  credit_note_reversal: 'Credit note reversed',
  debit_note_reversal: 'Debit note reversed',
};

const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

// Statement of account for an invoice customer, as at today: the balance
// brought forward, every invoice, payment and note since `fromDate` with the
// running balance, the open invoices with their days overdue, the ageing, and
// fuel taken but not yet invoiced. Made on demand and not saved: it shows the
// account as it stands when printed (Business Central's customer statement).
export async function statementDocument(conn: Conn, accountId: number, fromDate: string, today: string) {
  const account = await conn('credit_accounts').where({ id: accountId }).whereNull('deleted_at').first();
  if (!account || account.type !== 'customer' || account.billing_mode !== 'invoice') {
    throw httpError('Invoice customer not found.', 404, 'ACCOUNT_NOT_FOUND');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fromDate || '')) || fromDate > today) {
    throw httpError('Choose the date the statement starts from.', 400, 'INVALID_DATE');
  }
  const base = await documentBase(conn);
  const party = await customer(conn, accountId);
  const cents = (value: unknown) => Math.round(Number(value || 0) * 100);

  const opening: any = await conn('invoice_accounting_events')
    .where({ account_id: accountId }).where('posting_date', '<', fromDate).sum({ total: 'receivable_delta' }).first();
  const events: any[] = await conn('invoice_accounting_events as e')
    .leftJoin('customer_invoices as i', 'e.invoice_id', 'i.id')
    .leftJoin('invoice_adjustment_notes as n', 'e.adjustment_note_id', 'n.id')
    .leftJoin('invoice_payments as p', 'e.payment_id', 'p.id')
    .where('e.account_id', accountId)
    .where('e.posting_date', '>=', fromDate)
    .where('e.posting_date', '<=', today)
    .orderBy('e.posting_date').orderBy('e.id')
    .select('e.posting_date', 'e.event_type', 'e.receivable_delta', 'i.invoice_number', 'i.document_kind', 'n.note_number', 'p.payment_method', 'p.reference');
  let running = cents(opening?.total);
  const broughtForward = running;
  let charged = 0;
  let credited = 0;
  const activity = events.map((event) => {
    const delta = cents(event.receivable_delta);
    running += delta;
    if (delta > 0) charged += delta; else credited += delta;
    const kind = event.event_type === 'invoice_issue' && event.document_kind === 'debit_note' ? 'Debit note' : STATEMENT_EVENTS[event.event_type] || 'Entry';
    const paid = event.event_type === 'invoice_payment' ? [event.payment_method, event.reference].filter(Boolean).join(' ') : '';
    return [longDate(event.posting_date), String(event.note_number || event.invoice_number || ''), paid ? `${kind}, ${paid}` : kind, money2(delta / 100), money2(running / 100)];
  });

  const open: any[] = await conn('customer_invoices')
    .where({ account_id: accountId }).whereNull('deleted_at').whereIn('status', ['issued', 'partial']).where('balance', '>', 0)
    .orderBy('due_date').orderBy('id')
    .select('invoice_number', 'issue_date', 'due_date', 'balance');
  const ageing = [0, 0, 0, 0, 0]; // not yet due, 1-30, 31-60, 61-90, over 90 days
  const openRows = open.map((invoice) => {
    const late = Math.max(0, daysFrom(String(invoice.due_date).slice(0, 10), today));
    ageing[late === 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4] += cents(invoice.balance);
    return [String(invoice.invoice_number), longDate(invoice.issue_date), longDate(invoice.due_date), late ? String(late) : '', money2(invoice.balance)];
  });
  const held = cents(await invoiceCustomerCredit(accountId, conn));

  // Fuel taken and not yet on an issued invoice (unbilled, or held by a draft).
  const waiting: any = await conn('invoice_consumption as ic')
    .join('shifts as s', 'ic.shift_id', 's.id')
    .leftJoin('invoice_lines as il', 'ic.invoice_line_id', 'il.id')
    .leftJoin('customer_invoices as ci', 'il.invoice_id', 'ci.id')
    .where('ic.account_id', accountId)
    .whereNull('ic.deleted_at')
    .where((q) => q.whereNull('ic.entry_status').orWhere('ic.entry_status', 'active'))
    .where((q) => q.whereNull('ic.invoice_line_id').orWhere('ci.status', 'draft'))
    .sum({ litres: 'ic.litres' }).sum({ amount: 'ic.retail_amount' })
    .min({ first: 's.shift_date' }).max({ last: 's.shift_date' })
    .first();

  const notes = [
    party.terms > 0 ? `Invoices are due ${party.terms} days after they are issued.` : 'Invoices are due on receipt.',
    ...(Number(waiting?.litres || 0) > 0
      ? [`Fuel taken and not yet invoiced: ${money2(waiting.litres)} L, ${kes(waiting.amount)} (${longDate(waiting.first)} to ${longDate(waiting.last)}). It goes on your next invoice.`]
      : []),
  ];
  const totals: DocumentInput['totals'] = [
    ...(held > 0 ? [{ label: 'Credit held for your next invoice', amount: -held / 100 }] : []),
    { label: 'Balance due', amount: running / 100, strong: true },
  ];

  return renderPdf(documentDefinition({
    ...base,
    title: 'STATEMENT',
    number: longDate(today),
    details: [['Statement date', longDate(today)], ['Activity from', longDate(fromDate)]],
    customer: party,
    lines: [
      { description: `Balance on ${longDate(dayBefore(fromDate))}`, litres: null, price: null, amount: broughtForward / 100 },
      { description: 'Invoices and debit notes', litres: null, price: null, amount: charged / 100 },
      { description: 'Payments and credits', litres: null, price: null, amount: credited / 100 },
    ],
    totals,
    notes,
    sections: [
      {
        title: 'Account activity',
        columns: [
          { header: 'Date', width: 72 }, { header: 'Document', width: 100 }, { header: 'Details', width: '*' },
          { header: 'Amount (KES)', width: 85, right: true }, { header: 'Balance (KES)', width: 90, right: true },
        ],
        rows: activity,
      },
      {
        title: 'Open invoices',
        columns: [
          { header: 'Invoice', width: 110 }, { header: 'Issued', width: 80 }, { header: 'Due', width: 80 },
          { header: 'Days overdue', width: '*', right: true }, { header: 'Balance (KES)', width: 95, right: true },
        ],
        rows: openRows,
      },
      {
        title: 'Ageing',
        columns: ['Not yet due', '1 to 30 days', '31 to 60 days', '61 to 90 days', 'Over 90 days'].map((header) => ({ header, width: '*' as const, right: true })),
        rows: open.length ? [ageing.map((value) => money2(value / 100))] : [],
      },
    ],
  }));
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

  const lineRows = await conn('invoice_lines').where({ invoice_id: invoice.id }).orderBy('fuel_type').orderBy('id');
  const byShift = isDebitNote ? undefined : await fuelByShift(conn, lineRows);
  const lines = lineRows
    .map((line: any) => isDebitNote && line.fuel_type === 'adjustment'
      ? { description: 'Monetary debit adjustment', litres: null, price: null, amount: Number(line.line_total) }
      : litresLine(line.fuel_type, line.total_litres, line.agreed_price, line.line_total));
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
    sections: byShift ? [byShift] : [],
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
  const applications = await conn('invoice_credit_applications as c')
    .join('customer_invoices as i', 'i.id', 'c.invoice_id')
    .where('c.note_id', note.id).whereNull('c.reversed_at')
    .select('c.amount', 'i.invoice_number');

  const totals: DocumentInput['totals'] = [{ label: 'Credit total', amount, strong: true }];
  if (applied != null) totals.push({ label: `Taken off ${invoice?.invoice_number || 'the invoice'}`, amount: applied });
  for (const application of applications) totals.push({ label: `Applied to ${application.invoice_number}`, amount: Number(application.amount) });
  if (held > 0) totals.push({ label: 'Held for the next invoice', amount: held });

  const pdf = await renderPdf(documentDefinition({
    ...base,
    title: 'CREDIT NOTE',
    number: note.note_number,
    details: [['Date', longDate(note.note_date)], ['Against invoice', invoice?.invoice_number || '']],
    customer: party,
    lines: [note.correction === 'amount'
      ? { description: 'Monetary credit adjustment', litres: null, price: null, amount }
      : litresLine(note.fuel_type, note.litres, note.unit_price, amount, note.correction === 'price' ? ': price correction' : '')],
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
