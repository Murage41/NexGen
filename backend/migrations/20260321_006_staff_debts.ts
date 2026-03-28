import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('staff_debts'))) {
    await knex.schema.createTable('staff_debts', (t) => {
      t.increments('id').primary();
      t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees');
      t.integer('shift_id').unsigned().notNullable().references('id').inTable('shifts');
      t.float('original_deficit').notNullable(); // Full deficit amount from the shift
      t.float('deducted_from_wage').notNullable().defaultTo(0); // Amount deducted this shift
      t.float('carried_forward').notNullable().defaultTo(0); // Amount added to running debt
      t.string('status').notNullable().defaultTo('outstanding'); // outstanding, cleared
      t.float('balance').notNullable().defaultTo(0); // Remaining balance of this debt entry
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // Add debt_deduction column to wage_deductions to track which debt is being repaid
  if (await knex.schema.hasTable('wage_deductions')) {
    const hasDebtId = await knex.schema.hasColumn('wage_deductions', 'debt_id');
    if (!hasDebtId) {
      await knex.schema.alterTable('wage_deductions', (t) => {
        t.integer('debt_id').nullable().references('id').inTable('staff_debts');
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('wage_deductions')) {
    const hasDebtId = await knex.schema.hasColumn('wage_deductions', 'debt_id');
    if (hasDebtId) {
      await knex.schema.alterTable('wage_deductions', (t) => {
        t.dropColumn('debt_id');
      });
    }
  }
  await knex.schema.dropTableIfExists('staff_debts');
}
