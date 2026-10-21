import type { Knex } from 'knex';

type Conn = Knex | Knex.Transaction;

export const isEverIssuedInvoiceSql = (alias: string) =>
  `(${alias}.issue_date IS NOT NULL OR ${alias}.issued_at IS NOT NULL OR ${alias}.status <> 'draft')`;

export function invoiceSourceIsIssued(invoice: any): boolean {
  return Boolean(invoice && (invoice.issue_date || invoice.issued_at || invoice.status !== 'draft'));
}

export async function issuedSourceState(conn: Conn, entry: any) {
  if (!entry.invoice_line_id) {
    return { issued_source_locked: false, issued_invoice_id: null, issued_invoice_number: null };
  }
  const invoice = await conn('invoice_lines as line')
    .join('customer_invoices as invoice', 'line.invoice_id', 'invoice.id')
    .where('line.id', entry.invoice_line_id)
    .select('invoice.*')
    .first();
  if (!invoice) {
    throw Object.assign(new Error('The fuel entry has an incomplete invoice link. Run the integrity audit before correcting it.'), {
      http: 409, code: 'INVOICE_SOURCE_LINK_INCOMPLETE',
    });
  }
  const locked = invoiceSourceIsIssued(invoice);
  return {
    issued_source_locked: locked,
    issued_invoice_id: locked ? Number(invoice.id) : null,
    issued_invoice_number: locked ? String(invoice.invoice_number) : null,
  };
}

export async function assertIssuedSourceUnlocked(conn: Conn, entry: any) {
  const state = await issuedSourceState(conn, entry);
  if (state.issued_source_locked) {
    throw Object.assign(new Error(`This fuel entry is fixed on issued invoice ${state.issued_invoice_number}. Use a monetary credit or debit note on the invoice; its litres, customer, shift and source stay as issued.`), {
      http: 409, code: 'ISSUED_INVOICE_SOURCE_FIXED',
    });
  }
}
