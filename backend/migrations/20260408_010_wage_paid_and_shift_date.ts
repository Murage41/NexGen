import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add new columns
  await knex.schema.alterTable('shifts', (table) => {
    table.float('wage_paid').defaultTo(0);
    table.date('shift_date').nullable();
  });

  // Backfill shift_date from start_time for all existing shifts
  await knex.raw(`UPDATE shifts SET shift_date = DATE(start_time) WHERE shift_date IS NULL`);

  // Backfill wage_paid for closed shifts:
  // If a wage_deduction exists, use final_wage; otherwise use employees.daily_wage
  await knex.raw(`
    UPDATE shifts SET wage_paid = COALESCE(
      (SELECT wd.final_wage FROM wage_deductions wd WHERE wd.shift_id = shifts.id),
      (SELECT e.daily_wage FROM employees e WHERE e.id = shifts.employee_id),
      0
    ) WHERE status = 'closed' AND (wage_paid = 0 OR wage_paid IS NULL)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shifts', (table) => {
    table.dropColumn('wage_paid');
    table.dropColumn('shift_date');
  });
}
