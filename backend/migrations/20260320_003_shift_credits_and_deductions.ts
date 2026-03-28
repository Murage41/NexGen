import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Itemized shift credits (replaces the single credits_amount)
  if (!(await knex.schema.hasTable('shift_credits')))
  await knex.schema.createTable('shift_credits', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable().references('id').inTable('shifts');
    t.string('customer_name').notNullable();
    t.string('customer_phone').nullable();
    t.decimal('amount', 12, 2).notNullable();
    t.text('description').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Wage deductions for shift deficits
  if (!(await knex.schema.hasTable('wage_deductions')))
  await knex.schema.createTable('wage_deductions', (t) => {
    t.increments('id').primary();
    t.integer('shift_id').notNullable().references('id').inTable('shifts');
    t.integer('employee_id').notNullable().references('id').inTable('employees');
    t.decimal('original_wage', 12, 2).notNullable();
    t.decimal('deduction_amount', 12, 2).notNullable();
    t.decimal('final_wage', 12, 2).notNullable();
    t.string('reason').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('wage_deductions');
  await knex.schema.dropTableIfExists('shift_credits');
}
