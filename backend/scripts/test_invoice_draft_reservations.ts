import assert from 'assert';
import fs from 'fs';
import path from 'path';
import knex, { Knex } from 'knex';
import {
  createReservedInvoiceDraft,
  refreshInvoiceDraftReservation,
  releaseInvoiceReservation,
  validateDraftReservationForIssue,
} from '../src/services/invoiceDraftReservations';

function connection(filename: string): Knex {
  return knex({
    client: 'sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(conn: any, done: (err: Error | null, connection?: any) => void) {
        conn.run('PRAGMA foreign_keys = ON', (foreignKeyError: Error | null) => {
          if (foreignKeyError) return done(foreignKeyError, conn);
          conn.run('PRAGMA busy_timeout = 5000', (busyError: Error | null) => {
            done(busyError, conn);
          });
        });
      },
    },
  });
}

async function createSchema(db: Knex) {
  await db.schema.createTable('credit_accounts', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('type').notNullable();
    table.string('billing_mode').notNullable();
    table.decimal('balance', 14, 2).defaultTo(0);
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
    table.string('status').notNullable();
    table.string('reservation_status').notNullable();
    table.timestamp('reserved_at').nullable();
    table.timestamp('reservation_updated_at').nullable();
    table.decimal('total_amount', 14, 2).notNullable();
    table.decimal('adjustment_total', 14, 2).notNullable().defaultTo(0);
    table.decimal('balance', 14, 2).notNullable();
    table.text('notes').nullable();
    table.timestamp('deleted_at').nullable();
    table.timestamp('created_at').defaultTo(db.fn.now());
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
  await db.schema.createTable('invoice_payment_allocations', (table) => {
    table.increments('id').primary();
    table.integer('payment_id').notNullable();
    table.integer('invoice_id').notNullable();
    table.decimal('amount_applied', 14, 2).notNullable();
  });
  await db.schema.createTable('invoice_payments', (table) => {
    table.increments('id').primary();
    table.string('status').notNullable().defaultTo('posted');
    table.timestamp('deleted_at').nullable();
  });
  await db.schema.createTable('invoice_adjustment_notes', (table) => {
    table.increments('id').primary();
    table.integer('invoice_id').notNullable();
    table.string('status').notNullable();
    table.decimal('signed_amount', 14, 2).notNullable();
  });
}

async function seedBase(db: Knex) {
  await db('credit_accounts').insert({
    id: 1,
    name: 'Diwafa',
    type: 'customer',
    billing_mode: 'invoice',
  });
  await db('shifts').insert([
    { id: 1, shift_date: '2026-07-01', status: 'closed' },
    { id: 2, shift_date: '2026-07-02', status: 'open' },
    { id: 3, shift_date: '2026-07-03', status: 'closed' },
  ]);
}

function consumption(
  id: number,
  shiftId: number,
  fuelType: string,
  litres: number,
  price: number,
) {
  return {
    id,
    account_id: 1,
    shift_id: shiftId,
    fuel_type: fuelType,
    litres,
    retail_price_at_time: price,
    retail_amount: litres * price,
    entry_status: 'active',
  };
}

async function testReservationLifecycle() {
  const db = connection(':memory:');
  try {
    await createSchema(db);
    await seedBase(db);
    await db('invoice_consumption').insert([
      consumption(1, 1, 'petrol', 10, 190),
      consumption(2, 1, 'diesel', 5, 180),
      consumption(3, 2, 'petrol', 99, 190),
    ]);

    const draft = await createReservedInvoiceDraft(db, {
      accountId: 1,
      fromDate: '2026-07-01',
      toDate: '2026-07-03',
      agreedPrices: { petrol: 185, diesel: 175 },
    });
    assert.equal(draft.added_entries, 2, 'Open-shift consumption must not be reserved');
    assert.equal(draft.reserved_entries, 2);
    assert.equal(Number(draft.invoice.total_amount), 2725);
    assert.equal(draft.invoice.reservation_status, 'reserved');

    const initialRows = await db('invoice_consumption').orderBy('id');
    assert(initialRows[0].invoice_line_id, 'Closed petrol row was not reserved');
    assert(initialRows[1].invoice_line_id, 'Closed diesel row was not reserved');
    assert.equal(initialRows[2].invoice_line_id, null, 'Open-shift row was incorrectly reserved');

    await assert.rejects(
      () => createReservedInvoiceDraft(db, {
        accountId: 1,
        fromDate: '2026-07-01',
        toDate: '2026-07-03',
      }),
      (error: any) => error.code === 'NO_RESERVABLE_CONSUMPTION',
      'A second draft must not claim rows already reserved by the first',
    );

    await db('invoice_consumption').insert(consumption(4, 3, 'petrol', 2, 192));
    await db.transaction(async (trx) => {
      const invoice = await trx('customer_invoices').where({ id: draft.invoice.id }).first();
      const validation = await validateDraftReservationForIssue(trx, invoice);
      assert.equal(validation.linkedEntries, 2, 'Issue must use the original snapshot');
    });
    assert.equal(
      (await db('invoice_consumption').where({ id: 4 }).first()).invoice_line_id,
      null,
      'Issue validation silently reserved later consumption',
    );

    const refreshed = await refreshInvoiceDraftReservation(db, Number(draft.invoice.id));
    assert.equal(refreshed.added_entries, 1);
    assert.equal(refreshed.reserved_entries, 3);
    const petrolLine = await db('invoice_lines')
      .where({ invoice_id: draft.invoice.id, fuel_type: 'petrol' })
      .first();
    assert.equal(Number(petrolLine.agreed_price), 185, 'Refresh changed the agreed price');
    assert.equal(Number(petrolLine.total_litres), 12);

    await db.transaction(async (trx) => {
      const released = await releaseInvoiceReservation(trx, Number(draft.invoice.id));
      assert.equal(released, 3);
      await trx('invoice_lines').where({ invoice_id: draft.invoice.id }).delete();
      await trx('customer_invoices').where({ id: draft.invoice.id }).delete();
    });
    assert.equal(
      Number((await db('invoice_consumption').whereNotNull('invoice_line_id').count({ count: 'id' }).first())?.count),
      0,
      'Deleting a draft did not release all reserved rows',
    );
  } finally {
    await db.destroy();
  }
}

async function testLegacyUpgradeAndInvalidMutation() {
  const db = connection(':memory:');
  try {
    await createSchema(db);
    await seedBase(db);
    await db('invoice_consumption').insert(consumption(10, 1, 'diesel', 7, 180));
    const [invoiceId] = await db('customer_invoices').insert({
      account_id: 1,
      invoice_number: 'DRAFT-LEGACY-1',
      from_date: '2026-07-01',
      to_date: '2026-07-01',
      status: 'draft',
      reservation_status: 'legacy_unreserved',
      total_amount: 1260,
      balance: 1260,
    });
    await db('invoice_lines').insert({
      invoice_id: invoiceId,
      fuel_type: 'diesel',
      total_litres: 7,
      agreed_price: 170,
      line_total: 1190,
    });

    await db.transaction(async (trx) => {
      const invoice = await trx('customer_invoices').where({ id: invoiceId }).first();
      await assert.rejects(
        () => validateDraftReservationForIssue(trx, invoice),
        (error: any) => error.code === 'DRAFT_REFRESH_REQUIRED',
      );
    });

    const upgraded = await refreshInvoiceDraftReservation(db, Number(invoiceId));
    assert.equal(upgraded.legacy_upgraded, true);
    assert.equal(Number((await db('invoice_lines').where({ invoice_id: invoiceId }).first()).agreed_price), 170);

    await db('invoice_consumption').where({ id: 10 }).update({ entry_status: 'reversed' });
    await assert.rejects(
      () => db.transaction(async (trx) => {
        const invoice = await trx('customer_invoices').where({ id: invoiceId }).first();
        await validateDraftReservationForIssue(trx, invoice);
      }),
      (error: any) => error.code === 'RESERVED_CONSUMPTION_INVALID',
      'A reserved row changed after drafting must block issue',
    );
  } finally {
    await db.destroy();
  }
}

async function testConcurrentReservation() {
  const tempDir = path.resolve(__dirname, '..', '.test-data');
  fs.mkdirSync(tempDir, { recursive: true });
  const filename = path.join(tempDir, 'invoice-draft-concurrency.db');
  for (const suffix of ['', '-shm', '-wal']) {
    if (fs.existsSync(`${filename}${suffix}`)) fs.unlinkSync(`${filename}${suffix}`);
  }

  const setup = connection(filename);
  await createSchema(setup);
  await seedBase(setup);
  await setup('invoice_consumption').insert(consumption(20, 1, 'petrol', 5, 190));
  await setup.destroy();

  const first = connection(filename);
  const second = connection(filename);
  try {
    const attempts = await Promise.allSettled([
      createReservedInvoiceDraft(first, {
        accountId: 1,
        fromDate: '2026-07-01',
        toDate: '2026-07-01',
      }),
      createReservedInvoiceDraft(second, {
        accountId: 1,
        fromDate: '2026-07-01',
        toDate: '2026-07-01',
      }),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);

    const drafts = await first('customer_invoices').count({ count: 'id' }).first();
    const linked = await first('invoice_consumption').whereNotNull('invoice_line_id').count({ count: 'id' }).first();
    assert.equal(Number(drafts?.count), 1, 'A losing transaction left a partial draft');
    assert.equal(Number(linked?.count), 1, 'Consumption was linked more than once');
  } finally {
    await first.destroy();
    await second.destroy();
    for (const suffix of ['', '-shm', '-wal']) {
      if (fs.existsSync(`${filename}${suffix}`)) fs.unlinkSync(`${filename}${suffix}`);
    }
  }
}

async function main() {
  await testReservationLifecycle();
  await testLegacyUpgradeAndInvalidMutation();
  await testConcurrentReservation();
  console.log('Invoice draft reservation tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
