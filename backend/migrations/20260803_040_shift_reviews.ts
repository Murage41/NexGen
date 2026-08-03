import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('shift_reviews'))) {
    await knex.schema.createTable('shift_reviews', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').unsigned().notNullable().unique()
        .references('id').inTable('shifts').onDelete('RESTRICT');
      table.string('review_status').notNullable().defaultTo('pending_review');
      table.text('notes').nullable();
      table.integer('reviewed_by_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.string('reviewed_by_role').nullable();
      table.timestamp('reviewed_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.index(['review_status', 'shift_id'], 'idx_shift_reviews_status_shift');
    });
  }

  if (!(await knex.schema.hasTable('shift_review_events'))) {
    await knex.schema.createTable('shift_review_events', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').unsigned().notNullable()
        .references('id').inTable('shifts').onDelete('RESTRICT');
      table.string('from_status').nullable();
      table.string('to_status').notNullable();
      table.text('notes').nullable();
      table.integer('actor_employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      table.string('actor_role').notNullable().defaultTo('admin');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['shift_id', 'created_at', 'id'], 'idx_shift_review_events_timeline');
    });
  }

  await knex.raw(`
    INSERT INTO shift_reviews (
      shift_id, review_status, created_at, updated_at
    )
    SELECT
      shifts.id,
      'pending_review',
      COALESCE(shifts.end_time, shifts.created_at, CURRENT_TIMESTAMP),
      COALESCE(shifts.end_time, shifts.created_at, CURRENT_TIMESTAMP)
    FROM shifts
    WHERE shifts.status = 'closed'
      AND NOT EXISTS (
        SELECT 1 FROM shift_reviews WHERE shift_reviews.shift_id = shifts.id
      )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shift_review_events');
  await knex.schema.dropTableIfExists('shift_reviews');
}
