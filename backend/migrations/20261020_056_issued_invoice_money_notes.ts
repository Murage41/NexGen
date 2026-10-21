import type { Knex } from 'knex';

const message = 'Issued invoice source stays fixed. Use a monetary credit or debit note.';
// Keep this migration self-contained; the matching runtime predicate lives
// in issuedInvoiceSource.ts and must not change an installed guard later.
const issued = (alias: string) => `(${alias}.issue_date IS NOT NULL OR ${alias}.issued_at IS NOT NULL OR ${alias}.status <> 'draft')`;

async function changedColumns(knex: Knex, table: string, candidates?: string[]) {
  const available = Object.keys(await knex(table).columnInfo());
  const columns = candidates ? candidates.filter((column) => available.includes(column)) : available;
  return columns.map((column) => `NEW."${column}" IS NOT OLD."${column}"`).join(' OR ');
}

// No historical data is rewritten or relinked. Existing issued links become
// the fixed boundary; customer money continues through notes and payments.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('customer_invoices'))
    || !(await knex.schema.hasTable('invoice_lines'))
    || !(await knex.schema.hasTable('invoice_consumption'))) return;

  const oldSourceIssued = `EXISTS (SELECT 1 FROM invoice_lines line
    JOIN customer_invoices invoice ON invoice.id = line.invoice_id
    WHERE line.id = OLD.invoice_line_id AND ${issued('invoice')})`;
  const newSourceIssued = `EXISTS (SELECT 1 FROM invoice_lines line
    JOIN customer_invoices invoice ON invoice.id = line.invoice_id
    WHERE line.id = NEW.invoice_line_id AND ${issued('invoice')})`;
  const sourceChanged = await changedColumns(knex, 'invoice_consumption');
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_source_update
    BEFORE UPDATE ON invoice_consumption
    WHEN (${oldSourceIssued} AND (${sourceChanged}))
      OR (NEW.invoice_line_id IS NOT OLD.invoice_line_id AND ${newSourceIssued})
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_source_delete
    BEFORE DELETE ON invoice_consumption WHEN ${oldSourceIssued}
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_source_insert
    BEFORE INSERT ON invoice_consumption WHEN ${newSourceIssued}
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);

  const oldLineIssued = `EXISTS (SELECT 1 FROM customer_invoices invoice
    WHERE invoice.id = OLD.invoice_id AND ${issued('invoice')})`;
  const newLineIssued = `EXISTS (SELECT 1 FROM customer_invoices invoice
    WHERE invoice.id = NEW.invoice_id AND ${issued('invoice')})`;
  const lineChanged = await changedColumns(knex, 'invoice_lines');
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_line_update
    BEFORE UPDATE ON invoice_lines
    WHEN (${oldLineIssued} OR ${newLineIssued}) AND (${lineChanged})
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_line_delete
    BEFORE DELETE ON invoice_lines WHEN ${oldLineIssued}
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_line_insert
    BEFORE INSERT ON invoice_lines WHEN ${newLineIssued}
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);

  const headerChanged = await changedColumns(knex, 'customer_invoices', [
    'id', 'account_id', 'invoice_number', 'from_date', 'to_date', 'issue_date',
    'due_date', 'total_amount', 'notes', 'created_at', 'deleted_at',
    'retail_baseline_amount', 'price_adjustment_amount', 'issued_at',
    'issued_by_employee_id', 'document_kind', 'reason', 'shift_id',
    'corrects_invoice_id', 'approved_by_employee_id', 'approved_by_name',
    'record_correction_id',
  ]);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_invoice_facts
    BEFORE UPDATE ON customer_invoices
    WHEN ${issued('OLD')} AND (${headerChanged})
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_invoice_status
    BEFORE UPDATE OF status ON customer_invoices WHEN ${issued('OLD')}
      AND (NEW.status NOT IN ('issued', 'partial', 'paid', 'void')
        OR (OLD.status = 'void' AND NEW.status <> 'void')
        OR (NEW.status = 'void' AND OLD.status <> 'void' AND
          (COALESCE(OLD.document_kind, 'invoice') <> 'debit_note'
            OR EXISTS (SELECT 1 FROM invoice_consumption source
              JOIN invoice_lines line ON source.invoice_line_id = line.id
              WHERE line.invoice_id = OLD.id))))
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_issued_invoice_delete
    BEFORE DELETE ON customer_invoices WHEN ${issued('OLD')}
    BEGIN SELECT RAISE(ABORT, '${message}'); END`);
  if (await knex.schema.hasTable('credit_accounts') && await knex.schema.hasTable('invoice_adjustment_notes')) {
    await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_held_invoice_credit_account_mode
      BEFORE UPDATE OF billing_mode ON credit_accounts
      WHEN OLD.billing_mode = 'invoice' AND NEW.billing_mode IS NOT 'invoice'
        AND EXISTS (SELECT 1 FROM invoice_adjustment_notes note
          WHERE note.account_id = OLD.id AND note.status = 'posted' AND note.unapplied_amount > 0)
      BEGIN SELECT RAISE(ABORT, 'This customer holds invoice credit. Keep invoice mode available for that credit.'); END`);
  }
}

export async function down(): Promise<void> {
  throw new Error('Issued invoice history cannot be rolled back. Restore a verified pre-update backup instead.');
}
