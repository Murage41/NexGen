import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Delivery batches: tracks remaining fuel per delivery for FIFO costing
  await knex.schema.createTable('delivery_batches', (t) => {
    t.increments('id').primary();
    t.integer('delivery_id').unsigned().notNullable()
      .references('id').inTable('fuel_deliveries').onDelete('CASCADE');
    t.integer('tank_id').unsigned().notNullable()
      .references('id').inTable('tanks');
    t.string('fuel_type').notNullable();
    t.decimal('original_litres', 12, 2).notNullable();
    t.decimal('remaining_litres', 12, 2).notNullable();
    t.decimal('cost_per_litre', 10, 2).notNullable();
    t.date('date').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Batch consumption: records which shift consumed how much from which batch
  await knex.schema.createTable('batch_consumption', (t) => {
    t.increments('id').primary();
    t.integer('batch_id').unsigned().nullable()
      .references('id').inTable('delivery_batches').onDelete('SET NULL');
    t.integer('shift_id').unsigned().notNullable()
      .references('id').inTable('shifts').onDelete('CASCADE');
    t.integer('tank_id').unsigned().notNullable()
      .references('id').inTable('tanks');
    t.decimal('litres_consumed', 12, 2).notNullable();
    t.decimal('cost_per_litre', 10, 2).notNullable().defaultTo(0);
    t.decimal('total_cost', 14, 2).notNullable().defaultTo(0);
    t.timestamp('consumed_at').defaultTo(knex.fn.now());
  });

  // Add COGS column to shift_tank_snapshots
  await knex.schema.alterTable('shift_tank_snapshots', (t) => {
    t.decimal('cogs', 14, 2).nullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('batch_consumption');
  await knex.schema.dropTableIfExists('delivery_batches');
  await knex.schema.alterTable('shift_tank_snapshots', (t) => {
    t.dropColumn('cogs');
  });
}
