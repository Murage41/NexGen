import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Per-shift tank snapshots: opening/closing stock per tank per shift
  await knex.schema.createTable('shift_tank_snapshots', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').unsigned().notNullable()
      .references('id').inTable('shifts').onDelete('CASCADE');
    t.integer('tank_id').unsigned().notNullable()
      .references('id').inTable('tanks');
    t.decimal('opening_stock_litres', 12, 2).notNullable();
    t.decimal('deliveries_litres', 12, 2).notNullable().defaultTo(0);
    t.decimal('sales_litres', 12, 2).notNullable().defaultTo(0);
    t.decimal('closing_stock_litres', 12, 2).notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['shift_id', 'tank_id']);
  });

  // Immutable audit trail of every tank stock change
  await knex.schema.createTable('tank_stock_ledger', (t) => {
    t.increments('id').primary();
    t.integer('tank_id').unsigned().notNullable()
      .references('id').inTable('tanks');
    t.string('event_type').notNullable(); // delivery, shift_sale, dip_adjustment, manual
    t.integer('reference_id').nullable();
    t.decimal('litres_change', 12, 2).notNullable();
    t.decimal('balance_after', 12, 2).notNullable();
    t.text('notes').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Add book stock comparison columns to tank_dips
  await knex.schema.alterTable('tank_dips', (t) => {
    t.decimal('book_stock_at_dip', 12, 2).nullable();
    t.decimal('variance_litres', 12, 2).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shift_tank_snapshots');
  await knex.schema.dropTableIfExists('tank_stock_ledger');
  await knex.schema.alterTable('tank_dips', (t) => {
    t.dropColumn('book_stock_at_dip');
    t.dropColumn('variance_litres');
  });
}
