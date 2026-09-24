import assert from 'assert';
import knex, { type Knex } from 'knex';
import {
  postInvoiceAdjustment,
  reverseInvoiceAdjustment,
} from '../src/services/invoiceAdjustments';
import {
  issueReservedCustomerInvoice,
  voidIssuedCustomerInvoice,
} from '../src/services/invoiceLifecycle';
import {
  recordInvoicePayment,
  reverseInvoicePayment,
} from '../src/services/receivablePayments';
import { auditReceivableIntegrity } from '../src/services/receivableIntegrity';

function money(value: unknown) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function dbConnection() {
  return knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
}

async function createSchema(db: Knex) {
  await db.schema.createTable('credit_accounts', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('type').notNullable();
    table.string('billing_mode').notNullable();
    table.integer('payment_terms_days').notNullable().defaultTo(0);
    table.decimal('balance', 14, 2).notNullable().defaultTo(0);
    table.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('shifts', (table) => {
    table.increments('id').primary();
    table.date('shift_date').notNullable();
    table.string('status').notNullable();
  });
  await db.schema.createTable('customer_invoices', (table) => {
    table.increments('id').primary();
    table.integer('account_id').notNullable();
    table.string('invoice_number').notNullable().unique();
    table.date('from_date').notNullable();
    table.date('to_date').notNullable();
    table.date('issue_date').nullable();
    table.date('due_date').nullable();
    table.string('status').notNullable();
    table.string('reservation_status').notNullable();
    table.timestamp('reserved_at').nullable();
    table.timestamp('reservation_updated_at').nullable();
    table.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    table.decimal('retail_baseline_amount', 14, 2).notNullable().defaultTo(0);
    table.decimal('price_adjustment_amount', 14, 2).notNullable().defaultTo(0);
    table.decimal('adjustment_total', 14, 2).notNullable().defaultTo(0);
    table.decimal('balance', 14, 2).notNullable().defaultTo(0);
    table.text('notes').nullable();
    table.timestamp('issued_at').nullable();
    table.integer('issued_by_employee_id').nullable();
    table.timestamp('voided_at').nullable();
    table.integer('voided_by_employee_id').nullable();
    table.text('void_reason').nullable();
    table.timestamp('deleted_at').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    // Migration 049: debit notes are bills of their own.
    table.string('document_kind').notNullable().defaultTo('invoice');
    table.text('reason').nullable();
    table.integer('shift_id').nullable();
    table.integer('corrects_invoice_id').nullable();
    table.integer('approved_by_employee_id').nullable();
    table.string('approved_by_name').nullable();
  });
  await db.schema.createTable('invoice_lines', (table) => {
    table.increments('id').primary();
    table.integer('invoice_id').notNullable();
    table.string('fuel_type').notNullable();
    table.decimal('total_litres', 12, 2).notNullable();
    table.decimal('agreed_price', 10, 2).notNullable();
    table.decimal('line_total', 14, 2).notNullable();
  });
  await db.schema.createTable('invoice_consumption', (table) => {
    table.increments('id').primary();
    table.integer('account_id').notNullable();
    table.integer('shift_id').notNullable();
    table.string('fuel_type').notNullable();
    table.decimal('litres', 12, 2).notNullable();
    table.decimal('retail_price_at_time', 10, 2).notNullable();
    table.decimal('retail_amount', 14, 2).notNullable();
    table.integer('invoice_line_id').nullable();
    table.string('entry_status').nullable().defaultTo('active');
    table.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('invoice_payments', (table) => {
    table.increments('id').primary();
    table.integer('account_id').notNullable();
    table.decimal('amount', 14, 2).notNullable();
    table.string('payment_method').notNullable();
    table.date('payment_date').notNullable();
    table.string('reference').nullable();
    table.text('notes').nullable();
    table.string('status').notNullable().defaultTo('posted');
    table.string('received_into').nullable();
    table.integer('created_by_employee_id').nullable();
    table.timestamp('reversed_at').nullable();
    table.integer('reversed_by_employee_id').nullable();
    table.text('reversal_reason').nullable();
    table.timestamp('deleted_at').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
  });
  await db.schema.createTable('invoice_payment_allocations', (table) => {
    table.increments('id').primary();
    table.integer('payment_id').notNullable();
    table.integer('invoice_id').notNullable();
    table.decimal('amount_applied', 14, 2).notNullable();
  });
  await db.schema.createTable('invoice_document_sequences', (table) => {
    table.string('document_type').notNullable();
    table.date('business_date').notNullable();
    table.integer('last_number').notNullable();
    table.timestamp('updated_at').defaultTo(db.fn.now());
    table.primary(['document_type', 'business_date']);
  });
  await db.schema.createTable('invoice_adjustment_notes', (table) => {
    table.increments('id').primary();
    table.integer('account_id').notNullable();
    table.integer('invoice_id').notNullable();
    table.string('note_number').notNullable().unique();
    table.string('note_type').notNullable();
    table.date('note_date').notNullable();
    table.decimal('amount', 14, 2).notNullable();
    table.decimal('signed_amount', 14, 2).notNullable();
    table.string('fuel_type').nullable();
    table.decimal('litres', 12, 2).nullable();
    table.decimal('unit_price', 10, 2).nullable();
    table.text('reason').notNullable();
    table.string('status').notNullable();
    table.integer('created_by_employee_id').nullable();
    table.timestamp('reversed_at').nullable();
    table.integer('reversed_by_employee_id').nullable();
    table.text('reversal_reason').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    // Migration 049.
    table.string('correction').nullable();
    table.decimal('applied_amount', 14, 2).nullable();
    table.decimal('unapplied_amount', 14, 2).notNullable().defaultTo(0);
    table.integer('shift_id').nullable();
    table.integer('approved_by_employee_id').nullable();
    table.string('approved_by_name').nullable();
  });
  await db.schema.createTable('invoice_credit_applications', (table) => {
    table.increments('id').primary();
    table.integer('note_id').notNullable();
    table.integer('invoice_id').notNullable();
    table.decimal('amount', 14, 2).notNullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
    table.timestamp('reversed_at').nullable();
  });
  await db.schema.createTable('invoice_accounting_events', (table) => {
    table.increments('id').primary();
    table.string('source_key').notNullable().unique();
    table.integer('account_id').notNullable();
    table.integer('invoice_id').nullable();
    table.integer('payment_id').nullable();
    table.integer('adjustment_note_id').nullable();
    table.string('event_type').notNullable();
    table.date('posting_date').notNullable();
    table.decimal('receivable_delta', 14, 2).notNullable().defaultTo(0);
    table.decimal('cash_delta', 14, 2).notNullable().defaultTo(0);
    table.decimal('revenue_adjustment', 14, 2).notNullable().defaultTo(0);
    table.decimal('retail_baseline_amount', 14, 2).notNullable().defaultTo(0);
    table.decimal('document_amount', 14, 2).notNullable().defaultTo(0);
    table.string('payment_method').nullable();
    table.string('receiving_account').nullable();
    table.integer('reversal_of_event_id').nullable();
    table.text('reason').nullable();
    table.integer('created_by_employee_id').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
  });
}

async function seedDraft(db: Knex) {
  const [accountId] = await db('credit_accounts').insert({
    name: 'Diwafa',
    type: 'customer',
    billing_mode: 'invoice',
    payment_terms_days: 30,
  });
  const [shiftId] = await db('shifts').insert({
    shift_date: '2026-07-29',
    status: 'closed',
  });
  const [invoiceId] = await db('customer_invoices').insert({
    account_id: accountId,
    invoice_number: 'DRAFT-ACCOUNTING-TEST',
    from_date: '2026-07-29',
    to_date: '2026-07-29',
    status: 'draft',
    reservation_status: 'reserved',
    total_amount: 1850,
    balance: 1850,
  });
  const [lineId] = await db('invoice_lines').insert({
    invoice_id: invoiceId,
    fuel_type: 'petrol',
    total_litres: 10,
    agreed_price: 185,
    line_total: 1850,
  });
  await db('invoice_consumption').insert({
    account_id: accountId,
    shift_id: shiftId,
    fuel_type: 'petrol',
    litres: 10,
    retail_price_at_time: 190,
    retail_amount: 1900,
    invoice_line_id: lineId,
    entry_status: 'active',
  });
  return { accountId: Number(accountId), invoiceId: Number(invoiceId) };
}

async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: any) => error.code === code);
}

async function run() {
  const db = dbConnection();
  try {
    await createSchema(db);
    const { accountId, invoiceId } = await seedDraft(db);

    const issued = await issueReservedCustomerInvoice(db, {
      invoiceId,
      issueDate: '2026-07-30',
      actorId: 0,
    });
    assert.equal(issued.invoice_number, 'CINV-20260730-001');
    assert.equal(issued.due_date, '2026-08-29');
    assert.equal(money(issued.retail_baseline_amount), 1900);
    assert.equal(money(issued.price_adjustment_amount), -50);
    assert.equal(money((await db('credit_accounts').where({ id: accountId }).first()).balance), 1850);

    const issueEvent = await db('invoice_accounting_events')
      .where({ source_key: `invoice:${invoiceId}:issue` })
      .first();
    assert.equal(money(issueEvent.receivable_delta), 1850);
    assert.equal(money(issueEvent.revenue_adjustment), -50);

    const paymentResult = await recordInvoicePayment(db, {
      accountId,
      amount: 1000,
      paymentMethod: 'mpesa',
      paymentDate: '2026-07-31',
    });
    const paymentId = Number(paymentResult.payment.id);
    assert.equal(paymentResult.payment.received_into, 'mpesa');
    assert.equal(money(paymentResult.outstanding_balance), 850);

    // Notes are fuel, litres and a price per litre (services/invoiceAdjustments.ts).
    const approver = { id: 1, name: 'Test Admin' };
    const note = (fields: Record<string, unknown>) => postInvoiceAdjustment(db, {
      invoiceId, noteDate: '2026-07-31', approver, reason: 'Verified correction for this invoice', ...fields,
    } as any);
    // Price: agreed 165, invoiced 185 on 10 L.
    const credit = await note({ noteType: 'credit_note', correction: 'price', fuelType: 'petrol', litres: 10, unitPrice: 20 });
    assert.equal(credit.note.note_number, 'CN-20260731-001');
    assert.equal(money(credit.invoice.balance), 650);
    await expectCode(() => note({ noteType: 'credit_note', correction: 'price', fuelType: 'petrol', litres: 10, unitPrice: 186 }), 'CREDIT_PRICE_EXCEEDS_INVOICE');
    // Litres: 6 L not taken, at the invoice price (1,110): more than the 650
    // unpaid, so 460 is the customer's credit.
    const quantityCredit = await note({ noteType: 'credit_note', correction: 'litres', fuelType: 'petrol', litres: 6 });
    assert.equal(money(quantityCredit.note.amount), 1110);
    assert.deepEqual([money(quantityCredit.note.applied_amount), money(quantityCredit.note.unapplied_amount)], [650, 460]);
    assert.equal(money(quantityCredit.invoice.balance), 0);
    await expectCode(() => note({ noteType: 'credit_note', correction: 'litres', fuelType: 'petrol', litres: 5 }), 'CREDIT_LITRES_EXCEED_INVOICE');

    // A debit note is a bill of its own; the customer's credit pays it.
    const debit = await note({ noteType: 'debit_note', correction: 'litres', fuelType: 'petrol', litres: 0.5 });
    const debitBill = debit.debit_note;
    assert.equal(debitBill.invoice_number, 'DN-20260731-001');
    assert.equal(money(debitBill.total_amount), 92.5);
    const paidByCredit = await db('customer_invoices').where({ id: debitBill.id }).first();
    assert.deepEqual([money(paidByCredit.balance), paidByCredit.status], [0, 'paid'], 'the credit paid the debit note');

    const reversedPayment = await reverseInvoicePayment(db, {
      paymentId,
      reversalDate: '2026-08-01',
      reason: 'M-Pesa transaction was reversed by provider',
    });
    assert.equal(reversedPayment.payment.status, 'reversed');
    assert.equal(
      Number((await db('invoice_payment_allocations').where({ payment_id: paymentId }).count({ count: 'id' }).first())?.count),
      1,
      'Payment reversal deleted its allocation audit trail',
    );
    // The remaining credit (367.50) paid part of what the reversal left owing.
    assert.equal(money((await db('customer_invoices').where({ id: invoiceId }).first()).balance), 632.5);
    await expectCode(
      () => reverseInvoicePayment(db, {
        paymentId,
        reversalDate: '2026-08-01',
        reason: 'Duplicate reversal should be rejected',
      }),
      'PAYMENT_ALREADY_REVERSED',
    );

    // Reversing the litres credit takes its credit back off everything it paid.
    const reversedQuantityCredit = await reverseInvoiceAdjustment(db, {
      noteId: Number(quantityCredit.note.id),
      reversalDate: '2026-08-01',
      reason: 'Quantity correction was withdrawn after review',
    });
    assert.equal(money(reversedQuantityCredit.invoice.balance), 1650);
    assert.equal(money((await db('customer_invoices').where({ id: debitBill.id }).first()).balance), 92.5);

    const reversedCredit = await reverseInvoiceAdjustment(db, {
      noteId: Number(credit.note.id),
      reversalDate: '2026-08-01',
      reason: 'Customer pricing correction was withdrawn',
    });
    assert.equal(money(reversedCredit.invoice.balance), 1850);
    // An unpaid debit note is voided.
    const voidedDebit = await voidIssuedCustomerInvoice(db, {
      invoiceId: Number(debitBill.id),
      voidDate: '2026-08-01',
      reason: 'Debit note entered by mistake',
    });
    assert.equal(voidedDebit.status, 'void');

    await expectCode(
      () => voidIssuedCustomerInvoice(db, {
        invoiceId,
        voidDate: '2026-08-01',
        reason: 'short',
      }),
      'VOID_REASON_REQUIRED',
    );
    const voided = await voidIssuedCustomerInvoice(db, {
      invoiceId,
      voidDate: '2026-08-01',
      reason: 'Invoice cancelled and will be reissued',
    });
    assert.equal(voided.status, 'void');
    assert.equal(money(voided.balance), 0);
    assert.equal((await db('invoice_consumption').first()).invoice_line_id, null);
    assert.equal(money((await db('credit_accounts').where({ id: accountId }).first()).balance), 0);

    const eventTotals = await db('invoice_accounting_events')
      .sum({
        receivable: 'receivable_delta',
        cash: 'cash_delta',
        revenueAdjustment: 'revenue_adjustment',
      })
      .first();
    assert.equal(money(eventTotals?.receivable), 0, 'Accounting events did not net receivables to zero');
    assert.equal(money(eventTotals?.cash), 0, 'Payment and reversal did not net cash to zero');
    assert.equal(money(eventTotals?.revenueAdjustment), 0, 'Issue, notes, and void did not net revenue adjustment to zero');
    const audit = await auditReceivableIntegrity(db);
    assert.equal(audit.ok, true, JSON.stringify(audit.issues));

    const sequenceRows = await db('invoice_document_sequences').orderBy(['document_type', 'business_date']);
    assert.equal(sequenceRows.length, 3);
    console.log('PASS invoice terms, issue accounting, and atomic document numbers');
    console.log('PASS credit/debit notes and immutable note reversals');
    console.log('PASS payment reversal preserves allocations and reverses cash/receivables');
    console.log('PASS invoice void releases consumption and nets accounting events');
  } finally {
    await db.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
