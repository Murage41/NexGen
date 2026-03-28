import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Employees
  await knex.schema.createTable('employees', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.decimal('daily_wage', 10, 2).notNullable().defaultTo(0);
    t.string('phone').defaultTo('');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Tanks
  await knex.schema.createTable('tanks', (t) => {
    t.increments('id').primary();
    t.string('label').notNullable();
    t.string('fuel_type').notNullable(); // 'petrol' | 'diesel'
    t.decimal('capacity_litres', 12, 2).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Pumps
  await knex.schema.createTable('pumps', (t) => {
    t.increments('id').primary();
    t.string('label').notNullable();
    t.string('nozzle_label').notNullable();
    t.string('fuel_type').notNullable();
    t.integer('tank_id').unsigned().references('id').inTable('tanks').onDelete('SET NULL');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Shifts
  await knex.schema.createTable('shifts', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
    t.timestamp('start_time').notNullable().defaultTo(knex.fn.now());
    t.timestamp('end_time');
    t.string('status').notNullable().defaultTo('open'); // 'open' | 'closed'
    t.text('notes');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Pump Readings
  await knex.schema.createTable('pump_readings', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').unsigned().notNullable().references('id').inTable('shifts').onDelete('CASCADE');
    t.integer('pump_id').unsigned().notNullable().references('id').inTable('pumps');
    t.decimal('opening_litres', 14, 2).notNullable().defaultTo(0);
    t.decimal('closing_litres', 14, 2).notNullable().defaultTo(0);
    t.decimal('opening_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('closing_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('litres_sold', 14, 2).notNullable().defaultTo(0);
    t.decimal('amount_sold', 14, 2).notNullable().defaultTo(0);
  });

  // Shift Collections
  await knex.schema.createTable('shift_collections', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').unsigned().notNullable().unique().references('id').inTable('shifts').onDelete('CASCADE');
    t.decimal('cash_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('mpesa_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('credits_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_collected', 14, 2).notNullable().defaultTo(0);
  });

  // Shift Expenses
  await knex.schema.createTable('shift_expenses', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').unsigned().notNullable().references('id').inTable('shifts').onDelete('CASCADE');
    t.string('category').notNullable();
    t.string('description').defaultTo('');
    t.decimal('amount', 14, 2).notNullable();
  });

  // Fuel Prices
  await knex.schema.createTable('fuel_prices', (t) => {
    t.increments('id').primary();
    t.string('fuel_type').notNullable();
    t.decimal('price_per_litre', 10, 2).notNullable();
    t.date('effective_date').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Fuel Deliveries
  await knex.schema.createTable('fuel_deliveries', (t) => {
    t.increments('id').primary();
    t.integer('tank_id').unsigned().notNullable().references('id').inTable('tanks');
    t.string('supplier').notNullable();
    t.decimal('litres', 12, 2).notNullable();
    t.decimal('cost_per_litre', 10, 2).notNullable();
    t.decimal('total_cost', 14, 2).notNullable();
    t.date('date').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Tank Dips
  await knex.schema.createTable('tank_dips', (t) => {
    t.increments('id').primary();
    t.integer('tank_id').unsigned().notNullable().references('id').inTable('tanks');
    t.decimal('measured_litres', 12, 2).notNullable();
    t.timestamp('timestamp').notNullable().defaultTo(knex.fn.now());
  });

  // Credits
  await knex.schema.createTable('credits', (t) => {
    t.increments('id').primary();
    t.string('customer_name').notNullable();
    t.string('customer_phone');
    t.decimal('amount', 14, 2).notNullable();
    t.decimal('balance', 14, 2).notNullable();
    t.integer('shift_id').unsigned().references('id').inTable('shifts');
    t.string('description');
    t.string('status').notNullable().defaultTo('outstanding');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Credit Payments
  await knex.schema.createTable('credit_payments', (t) => {
    t.increments('id').primary();
    t.integer('credit_id').unsigned().notNullable().references('id').inTable('credits').onDelete('CASCADE');
    t.decimal('amount', 14, 2).notNullable();
    t.string('payment_method').notNullable(); // 'cash' | 'mpesa'
    t.date('date').notNullable();
    t.text('notes');
  });

  // Expenses
  await knex.schema.createTable('expenses', (t) => {
    t.increments('id').primary();
    t.string('category').notNullable();
    t.string('description').defaultTo('');
    t.decimal('amount', 14, 2).notNullable();
    t.date('date').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Invoices
  await knex.schema.createTable('invoices', (t) => {
    t.increments('id').primary();
    t.integer('credit_id').unsigned().notNullable().references('id').inTable('credits');
    t.string('invoice_number').notNullable().unique();
    t.decimal('amount', 14, 2).notNullable();
    t.date('date').notNullable();
    t.string('status').notNullable().defaultTo('unpaid');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'invoices', 'credit_payments', 'credits', 'tank_dips', 'fuel_deliveries',
    'fuel_prices', 'shift_expenses', 'shift_collections', 'pump_readings',
    'shifts', 'pumps', 'tanks', 'employees', 'expenses',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
