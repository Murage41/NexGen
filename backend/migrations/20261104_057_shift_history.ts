import type { Knex } from 'knex';

// Edit history for open shifts (docs/ROADMAP.md, item 2): every save that
// changes a closing reading, an opening reading or the cash/M-Pesa count, and
// every entry removed from an open shift, keeps who, when and old -> new.
// Rows are facts: never changed and never deleted.
export async function up(knex: Knex): Promise<void> {
  // Shift expenses had no time or author: History could only count them.
  for (const [column, sql] of [['created_at', 'TIMESTAMP NULL'], ['created_by_employee_id', 'INTEGER NULL']]) {
    if (await knex.schema.hasTable('shift_expenses') && !(await knex.schema.hasColumn('shift_expenses', column))) {
      await knex.raw(`ALTER TABLE "shift_expenses" ADD COLUMN "${column}" ${sql}`);
    }
  }
  if (!(await knex.schema.hasTable('shift_history'))) {
    await knex.schema.createTable('shift_history', t => {
      t.increments('id').primary();
      t.integer('shift_id').notNullable().references('id').inTable('shifts');
      t.string('kind', 30).notNullable();
      t.text('changes').notNullable();
      t.integer('employee_id').nullable().references('id').inTable('employees');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['shift_id'], 'idx_shift_history_shift');
    });
  }
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_shift_history_update
    BEFORE UPDATE ON shift_history
    BEGIN SELECT RAISE(ABORT, 'Shift history cannot be changed.'); END`);
  await knex.raw(`CREATE TRIGGER IF NOT EXISTS guard_shift_history_delete
    BEFORE DELETE ON shift_history
    BEGIN SELECT RAISE(ABORT, 'Shift history cannot be deleted.'); END`);
}

export async function down(): Promise<void> {
  throw new Error('Shift history cannot be rolled back. Restore a verified pre-update backup instead.');
}
