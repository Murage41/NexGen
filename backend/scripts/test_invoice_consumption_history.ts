import assert from 'assert';
import knex from 'knex';
import { getInvoiceConsumptionHistory } from '../src/services/invoiceConsumptionHistory';

async function run() {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  try {
    await db.schema.createTable('credit_accounts', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('phone').nullable();
      table.string('type').notNullable();
      table.string('billing_mode').nullable();
      table.integer('payment_terms_days').defaultTo(0);
      table.timestamp('deleted_at').nullable();
    });
    await db.schema.createTable('employees', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
    });
    await db.schema.createTable('shifts', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').notNullable();
      table.date('shift_date').notNullable();
      table.string('status').notNullable();
    });
    await db.schema.createTable('tanks', (table) => {
      table.increments('id').primary();
      table.string('label').notNullable();
    });
    await db.schema.createTable('pumps', (table) => {
      table.increments('id').primary();
      table.integer('tank_id').notNullable();
      table.string('label').notNullable();
      table.string('nozzle_label').nullable();
    });
    await db.schema.createTable('customer_invoices', (table) => {
      table.increments('id').primary();
      table.integer('account_id').notNullable();
      table.string('invoice_number').nullable();
      table.string('status').notNullable();
    });
    await db.schema.createTable('invoice_lines', (table) => {
      table.increments('id').primary();
      table.integer('invoice_id').notNullable();
    });
    await db.schema.createTable('invoice_consumption', (table) => {
      table.increments('id').primary();
      table.integer('account_id').notNullable();
      table.integer('shift_id').notNullable();
      table.integer('pump_id').nullable();
      table.integer('tank_id').nullable();
      table.string('fuel_type').notNullable();
      table.decimal('litres', 12, 2).notNullable();
      table.decimal('retail_price_at_time', 10, 2).notNullable();
      table.decimal('retail_amount', 14, 2).notNullable();
      table.integer('invoice_line_id').nullable();
      table.integer('correction_of_id').nullable();
      table.string('entry_status').nullable();
      table.string('correction_reason').nullable();
      table.timestamp('created_at').notNullable();
      table.timestamp('deleted_at').nullable();
    });

    await db('credit_accounts').insert([
      { id: 1, name: 'Invoice Customer', phone: '0700000000', type: 'customer', billing_mode: 'invoice', payment_terms_days: 30 },
      { id: 2, name: 'Money Customer', type: 'customer', billing_mode: 'money' },
    ]);
    await db('employees').insert({ id: 1, name: 'Attendant One' });
    await db('shifts').insert([
      { id: 10, employee_id: 1, shift_date: '2026-07-01', status: 'closed' },
      { id: 11, employee_id: 1, shift_date: '2026-07-02', status: 'closed' },
    ]);
    await db('tanks').insert({ id: 1, label: 'Main Tank' });
    await db('pumps').insert({ id: 1, tank_id: 1, label: 'Pump 1', nozzle_label: 'Nozzle A' });
    await db('customer_invoices').insert([
      { id: 20, account_id: 1, invoice_number: null, status: 'draft' },
      { id: 21, account_id: 1, invoice_number: 'INV-0001', status: 'issued' },
    ]);
    await db('invoice_lines').insert([
      { id: 30, invoice_id: 20 },
      { id: 31, invoice_id: 21 },
    ]);
    await db('invoice_consumption').insert([
      {
        id: 1, account_id: 1, shift_id: 10, pump_id: 1, tank_id: 1,
        fuel_type: 'diesel', litres: 10, retail_price_at_time: 180,
        retail_amount: 1800, entry_status: 'active', created_at: '2026-07-01T09:00:00Z',
      },
      {
        id: 2, account_id: 1, shift_id: 10, pump_id: 1, tank_id: 1,
        fuel_type: 'petrol', litres: 5, retail_price_at_time: 190,
        retail_amount: 950, invoice_line_id: 30, entry_status: 'active',
        created_at: '2026-07-01T10:00:00Z',
      },
      {
        id: 3, account_id: 1, shift_id: 11, pump_id: 1, tank_id: 1,
        fuel_type: 'diesel', litres: 8, retail_price_at_time: 180,
        retail_amount: 1440, invoice_line_id: 31, entry_status: 'active',
        created_at: '2026-07-02T09:00:00Z',
      },
      {
        id: 4, account_id: 1, shift_id: 11, pump_id: 1, tank_id: 1,
        fuel_type: 'diesel', litres: 7, retail_price_at_time: 180,
        retail_amount: 1260, entry_status: 'reversed',
        correction_reason: 'Corrected customer litres', deleted_at: '2026-07-02T11:00:00Z',
        created_at: '2026-07-02T10:00:00Z',
      },
      {
        id: 5, account_id: 1, shift_id: 11, pump_id: 1, tank_id: 1,
        fuel_type: 'diesel', litres: 6, retail_price_at_time: 180,
        retail_amount: 1080, correction_of_id: 4, entry_status: 'active',
        created_at: '2026-07-02T11:00:00Z',
      },
      {
        id: 6, account_id: 2, shift_id: 11, pump_id: 1, tank_id: 1,
        fuel_type: 'diesel', litres: 99, retail_price_at_time: 180,
        retail_amount: 17820, entry_status: 'active', created_at: '2026-07-02T12:00:00Z',
      },
    ]);

    const active = await getInvoiceConsumptionHistory(db, 1);
    assert.equal(active.pagination.total, 4);
    assert.equal(active.totals.active_litres, 29);
    assert.equal(active.totals.active_retail_amount, 5270);
    assert.equal(active.rows[0].id, 5);
    assert.equal(active.rows[0].employee_name, 'Attendant One');
    assert.equal(active.rows[0].pump_label, 'Pump 1');

    const reserved = await getInvoiceConsumptionHistory(db, 1, { status: 'reserved' });
    assert.equal(reserved.pagination.total, 1);
    assert.equal(reserved.rows[0].invoice_status, 'draft');
    const invoiced = await getInvoiceConsumptionHistory(db, 1, { status: 'invoiced' });
    assert.equal(invoiced.pagination.total, 1);
    assert.equal(invoiced.rows[0].invoice_number, 'INV-0001');
    const audit = await getInvoiceConsumptionHistory(db, 1, { status: 'all', pageSize: 2 });
    assert.equal(audit.pagination.total, 5);
    assert.equal(audit.pagination.total_pages, 3);
    assert.equal(audit.totals.active_litres, 29);
    assert.equal(audit.totals.reversed_litres, 7);
    const reversed = await getInvoiceConsumptionHistory(db, 1, { status: 'reversed' });
    assert.equal(reversed.rows[0].replacement_id, 5);
    assert.equal(reversed.rows[0].correction_reason, 'Corrected customer litres');
    const dateFuel = await getInvoiceConsumptionHistory(db, 1, {
      from: '2026-07-02',
      to: '2026-07-02',
      fuelType: 'diesel',
      status: 'active',
    });
    assert.equal(dateFuel.pagination.total, 2);
    assert.equal(dateFuel.totals.active_litres, 14);

    await assert.rejects(
      () => getInvoiceConsumptionHistory(db, 2),
      /Invoice customer not found/,
    );
    console.log('PASS invoice consumption history states, totals, filters, and pagination');
    console.log('PASS correction audit links and customer isolation');
  } finally {
    await db.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
