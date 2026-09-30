import type { Knex } from 'knex';
import { computeShiftAccountability } from '../src/services/shiftAccountability';

// Corrections, phase 1 (docs/ROADMAP.md §3c). A closed record is never changed:
// it is corrected by a numbered Correction whose lines reverse the wrong record
// and/or add the right one (services/corrections.ts).
//
// 1. Closed shifts show their close snapshot. Shifts closed before snapshots
//    existed (2026-08-17) get one here, from their rows as they stand, marked
//    backfilled. The figures are gathered the way the shift screen gathered
//    them, so nothing the owner has seen moves.
// 2. The Correction tables, reason codes, and links from the records a
//    correction reversed, created or generated.
// 3. Guards: the database refuses changes to a closed shift's recorded facts
//    and to any snapshot. Status and link columns that legitimately change
//    later (an entry's invoice link or reversal, a credit's unpaid balance)
//    stay writable.

async function addColumn(knex: Knex, table: string, column: string, sql: string) {
  if (!(await knex.schema.hasColumn(table, column))) {
    await knex.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${sql}`);
  }
}

async function backfillSnapshots(knex: Knex) {
  const missing = await knex('shifts as s')
    .leftJoin('shift_close_reconciliations as r', 'r.shift_id', 's.id')
    .leftJoin('employees as e', 's.employee_id', 'e.id')
    .where('s.status', 'closed')
    .whereNull('r.id')
    .select('s.id', 's.end_time', 's.shift_date', 's.wage_paid', 'e.daily_wage');
  for (const shift of missing as any[]) {
    const id = Number(shift.id);
    const a = computeShiftAccountability({
      readings: await knex('pump_readings').join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .where('pump_readings.shift_id', id).where('pumps.active', true).select('pump_readings.*'),
      collections: await knex('shift_collections').where({ shift_id: id }).first(),
      shiftCredits: await knex('shift_credits').where({ shift_id: id }).whereNull('deleted_at'),
      invoiceConsumption: await knex('invoice_consumption').where({ shift_id: id }).whereNull('deleted_at'),
      creditReceipts: await knex('credit_payments').where({ shift_id: id, status: 'posted' }).whereNull('deleted_at'),
      expenses: await knex('shift_expenses').where({ shift_id: id }).whereNull('deleted_at'),
      employee_wage: Number(shift.wage_paid ?? shift.daily_wage ?? 0),
      payrollPayments: await knex('payroll_payments').where({ shift_id: id, status: 'posted' })
        .where((q) => q.whereNull('reference').orWhere('reference', 'not like', 'SHIFT-WAGE:%')),
    });
    await knex('shift_close_reconciliations').insert({
      shift_id: id,
      readings_reviewed: false,
      collections_reviewed: false,
      entries_reviewed: false,
      expected_sales: a.expected_sales,
      expected_shift_total: a.expected_shift_total,
      cash_received: a.total_cash,
      mpesa_received: a.total_mpesa,
      credit_receipts: a.total_credit_receipts,
      credits_issued: a.total_credits,
      invoice_consumption: a.total_invoice_consumption,
      expenses: a.total_expenses,
      direct_wage_payment: a.employee_wage,
      payroll_payments: a.total_payroll_payments,
      total_accounted: a.total_accounted,
      variance: a.variance,
      variance_type: a.variance < 0 ? 'deficit' : a.variance > 0 ? 'surplus' : 'balanced',
      variance_reason: null,
      approved_by_employee_id: null,
      approved_by_role: 'backfill',
      approved_at: shift.end_time || `${String(shift.shift_date).slice(0, 10)} 23:59:59`,
      backfilled: true,
    });
  }
}

// Refuse changing the named columns of a closed shift's rows, and deleting them.
async function guardClosedShiftRows(knex: Knex, table: string, columns: string[]) {
  const closed = `(SELECT status FROM shifts WHERE id = OLD.shift_id) = 'closed'`;
  const changed = columns.map((c) => `NEW."${c}" IS NOT OLD."${c}"`).join(' OR ');
  const message = "A closed shift's records cannot be changed. Correct them instead.";
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_${table}_closed_update
    BEFORE UPDATE OF ${columns.map((c) => `"${c}"`).join(', ')} ON "${table}"
    WHEN ${closed} AND (${changed})
    BEGIN SELECT RAISE(ABORT, "${message}"); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_${table}_closed_delete
    BEFORE DELETE ON "${table}"
    WHEN ${closed}
    BEGIN SELECT RAISE(ABORT, "${message}"); END`);
}

export async function up(knex: Knex): Promise<void> {
  await addColumn(knex, 'shift_close_reconciliations', 'backfilled', 'BOOLEAN NOT NULL DEFAULT 0');
  await backfillSnapshots(knex);

  if (!(await knex.schema.hasTable('correction_reasons'))) {
    await knex.schema.createTable('correction_reasons', (t) => {
      t.string('code').primary();
      t.string('label').notNullable();
      t.integer('sort').notNullable().defaultTo(0);
      t.boolean('active').notNullable().defaultTo(true);
    });
    await knex('correction_reasons').insert([
      { code: 'attendant_mistake', label: "Attendant's recording mistake", sort: 1 },
      { code: 'office_mistake', label: 'Office or admin recording mistake', sort: 2 },
      { code: 'customer_records', label: "The customer's records show otherwise", sort: 3 },
      { code: 'found_on_reconciling', label: 'Found when reconciling (issue book, statement, dip)', sort: 4 },
      { code: 'other', label: 'Other (explain in the note)', sort: 9 },
    ]);
  }

  if (!(await knex.schema.hasTable('corrections'))) {
    await knex.schema.createTable('corrections', (t) => {
      t.increments('id').primary();
      t.string('number').notNullable().unique();
      t.string('kind').notNullable().defaultTo('correction'); // 'correction' | 'undo'
      t.string('record_type').notNullable();
      t.string('error_kind').notNullable();
      t.string('reason_code').notNullable();
      t.text('reason_note').notNullable();
      t.date('posting_date').notNullable();
      t.date('effective_date').notNullable();
      t.string('status').notNullable().defaultTo('posted'); // 'posted' | 'undone'
      t.integer('undoes_correction_id').nullable();
      t.integer('undone_by_correction_id').nullable();
      t.string('plan_hash').notNullable();
      t.text('effects_json').notNullable();
      t.integer('approved_by_employee_id').nullable();
      t.string('approved_by_name').nullable();
      t.integer('created_by_employee_id').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['posting_date'], 'idx_corrections_posting');
    });
  }

  if (!(await knex.schema.hasTable('correction_lines'))) {
    await knex.schema.createTable('correction_lines', (t) => {
      t.increments('id').primary();
      t.integer('correction_id').notNullable().references('id').inTable('corrections');
      t.integer('seq').notNullable();
      t.string('action').notNullable(); // 'reverse' | 'add' | 'restore'
      t.string('record_type').notNullable();
      t.integer('target_id').nullable();
      t.integer('created_record_id').nullable();
      t.integer('shift_id').notNullable();
      t.boolean('shift_open').notNullable().defaultTo(false);
      t.string('party_type').nullable();
      t.integer('party_id').nullable();
      t.string('fuel_type').nullable();
      t.decimal('litres', 12, 2).nullable();
      t.decimal('unit_price', 10, 2).nullable();
      t.decimal('amount', 14, 2).notNullable().defaultTo(0);
      t.string('stage').nullable(); // 'unbilled' | 'draft' | 'invoiced'
      t.integer('invoice_id').nullable();
      t.string('document_type').nullable(); // 'credit_note' | 'debit_note'
      t.integer('document_id').nullable();
      // This line's change to its shift's result (accounted − expected).
      t.decimal('shift_effect', 14, 2).notNullable().defaultTo(0);
      t.string('charge_to').nullable(); // 'attendant' | 'station'
      t.integer('variance_entry_id').nullable();
      t.index(['correction_id'], 'idx_correction_lines_correction');
      t.index(['shift_id'], 'idx_correction_lines_shift');
      t.index(['record_type', 'target_id'], 'idx_correction_lines_target');
    });
  }

  await addColumn(knex, 'invoice_consumption', 'reversed_by_record_correction_id', 'INTEGER NULL');
  await addColumn(knex, 'invoice_consumption', 'created_by_record_correction_id', 'INTEGER NULL');
  await addColumn(knex, 'employee_variance_entries', 'record_correction_id', 'INTEGER NULL');
  await addColumn(knex, 'invoice_adjustment_notes', 'record_correction_id', 'INTEGER NULL');
  await addColumn(knex, 'customer_invoices', 'record_correction_id', 'INTEGER NULL');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_consumption_reversed_by_record_correction ON invoice_consumption (reversed_by_record_correction_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_consumption_created_by_record_correction ON invoice_consumption (created_by_record_correction_id)');

  const snapshotMessage = 'A close snapshot is never changed.';
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_snapshot_update BEFORE UPDATE ON shift_close_reconciliations
    BEGIN SELECT RAISE(ABORT, "${snapshotMessage}"); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_snapshot_delete BEFORE DELETE ON shift_close_reconciliations
    BEGIN SELECT RAISE(ABORT, "${snapshotMessage}"); END`);
  await guardClosedShiftRows(knex, 'pump_readings', ['shift_id', 'pump_id', 'opening_litres', 'closing_litres', 'opening_amount', 'closing_amount', 'litres_sold', 'amount_sold']);
  await guardClosedShiftRows(knex, 'shift_collections', ['shift_id', 'cash_amount', 'mpesa_amount']);
  await guardClosedShiftRows(knex, 'shift_expenses', ['shift_id', 'category', 'amount']);
  await guardClosedShiftRows(knex, 'invoice_consumption', ['shift_id', 'account_id', 'fuel_type', 'litres', 'retail_price_at_time', 'retail_amount']);
}

export async function down(): Promise<void> {
  throw new Error('Corrections are part of the financial record. Restore a verified pre-update backup instead.');
}
