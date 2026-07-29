import assert from 'node:assert/strict';
import knexFactory from 'knex';
import { up as migrateCompensation } from '../migrations/20260728_032_employee_compensation_plans';
import { createCompensationPlanSchema } from '../src/schemas';
import {
  describeCompensationPlan,
  getCompensationPlan,
  previousCalendarDate,
} from '../src/services/compensation';

async function main() {
  const db = knexFactory({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  try {
    await db.raw('PRAGMA foreign_keys = ON');
    await db.schema.createTable('employees', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.decimal('daily_wage', 10, 2).notNullable().defaultTo(0);
      table.string('phone');
      table.boolean('active').notNullable().defaultTo(true);
      table.string('role').notNullable().defaultTo('attendant');
      table.string('pin');
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    await db.schema.createTable('shifts', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').notNullable().references('id').inTable('employees');
      table.date('shift_date');
      table.timestamp('start_time');
      table.string('status');
    });
    await db.schema.createTable('shift_readings', (table) => {
      table.increments('id').primary();
      table.integer('shift_id').notNullable().references('id').inTable('shifts');
      table.decimal('litres_sold', 14, 3).notNullable().defaultTo(0);
    });

    const [employeeId] = await db('employees').insert({
      name: 'Legacy Employee',
      daily_wage: 750,
    });
    const [shiftId] = await db('shifts').insert({
      employee_id: employeeId,
      shift_date: '2026-07-01',
      start_time: '2026-07-01 08:00:00',
      status: 'closed',
    });
    const [readingId] = await db('shift_readings').insert({
      shift_id: shiftId,
      litres_sold: 125.5,
    });

    const migrationQueries: string[] = [];
    const captureQuery = (query: { sql?: string }) => {
      migrationQueries.push(String(query.sql || ''));
    };
    db.on('query', captureQuery);
    await migrateCompensation(db);
    db.off('query', captureQuery);

    const legacyPlan = await getCompensationPlan(employeeId, '2026-07-01', db);
    assert.ok(legacyPlan);
    assert.equal(legacyPlan.name, 'Legacy per-shift wage');
    assert.equal(legacyPlan.components.length, 1);
    assert.equal(legacyPlan.components[0].component_type, 'fixed_per_shift');
    assert.equal(legacyPlan.components[0].amount, 750);
    assert.equal(describeCompensationPlan(legacyPlan), 'KES 750/shift');

    const migratedShift = await db('shifts').where({ id: shiftId }).first();
    assert.equal(Number(migratedShift.compensation_plan_id), legacyPlan.id);
    const preservedReading = await db('shift_readings').where({ id: readingId }).first();
    assert.equal(Number(preservedReading.shift_id), shiftId);
    assert.equal(Number(preservedReading.litres_sold), 125.5);
    assert.equal(
      migrationQueries.some((sql) => /drop\s+table\s+["`]?shifts/i.test(sql)),
      false,
    );
    assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);

    await migrateCompensation(db);
    assert.equal(
      Number((await db('employee_compensation_plans').count('* as count').first())?.count || 0),
      1,
    );
    assert.equal(
      Number((await db('employee_compensation_components').count('* as count').first())?.count || 0),
      1,
    );

    const validHybrid = createCompensationPlanSchema.parse({
      name: 'Monthly plus volume',
      pay_schedule: 'monthly',
      effective_from: '2026-08-01',
      components: [
        { component_type: 'fixed_periodic', amount: 30000 },
        { component_type: 'litre_rate', rate: 0.25, fuel_type: 'diesel' },
      ],
    });
    assert.equal(validHybrid.components.length, 2);

    assert.equal(createCompensationPlanSchema.safeParse({
      name: 'Invalid commission',
      pay_schedule: 'weekly',
      effective_from: '2026-08-01',
      components: [{ component_type: 'sales_percentage', rate: 101 }],
    }).success, false);
    assert.equal(previousCalendarDate('2026-03-01'), '2026-02-28');

    console.log('PASS legacy compensation migration preserves wage and shift linkage');
    console.log('PASS effective-date and hybrid compensation validation');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL compensation plan tests');
  console.error(error);
  process.exit(1);
});
