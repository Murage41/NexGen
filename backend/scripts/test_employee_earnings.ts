import assert from 'node:assert/strict';
import knexFactory from 'knex';
import { up as migrateCompensation } from '../migrations/20260728_032_employee_compensation_plans';
import { up as migrateEarnings } from '../migrations/20260728_033_employee_earnings';
import {
  calculateShiftEarnings,
  generateShiftEarnings,
  getCompensationPlanById,
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
      table.timestamp('end_time');
      table.string('status');
      table.decimal('wage_paid', 14, 2).defaultTo(0);
    });
    await db.schema.createTable('wage_deductions', (table) => {
      table.increments('id').primary();
      table.integer('shift_id');
      table.decimal('original_wage', 14, 2);
      table.decimal('deduction_amount', 14, 2);
      table.timestamp('deleted_at');
    });

    const [employeeId] = await db('employees').insert({ name: 'Hybrid Employee', daily_wage: 500 });
    const [legacyShiftId] = await db('shifts').insert({
      employee_id: employeeId,
      shift_date: '2026-07-01',
      start_time: '2026-07-01 08:00:00',
      end_time: '2026-07-02 08:00:00',
      status: 'closed',
      wage_paid: 450,
    });
    await db('wage_deductions').insert({
      shift_id: legacyShiftId,
      original_wage: 500,
      deduction_amount: 50,
    });

    await migrateCompensation(db);
    await migrateEarnings(db);

    const migratedEarning = await db('employee_earnings')
      .where({ shift_id: legacyShiftId, source_type: 'legacy_shift' })
      .first();
    assert.equal(Number(migratedEarning.gross_amount), 500);

    const [hybridPlanId] = await db('employee_compensation_plans').insert({
      employee_id: employeeId,
      name: 'Hybrid',
      pay_schedule: 'monthly',
      effective_from: '2026-08-01',
      status: 'active',
      version: 2,
      currency: 'KES',
    });
    await db('employee_compensation_components').insert([
      { plan_id: hybridPlanId, component_type: 'fixed_per_shift', amount: 500 },
      { plan_id: hybridPlanId, component_type: 'sales_percentage', rate: 2 },
      { plan_id: hybridPlanId, component_type: 'litre_rate', rate: 0.5, fuel_type: 'diesel' },
      { plan_id: hybridPlanId, component_type: 'fixed_periodic', amount: 30000 },
    ]);
    const plan = await getCompensationPlanById(hybridPlanId, db);
    assert.ok(plan);

    const readings = [
      { fuel_type: 'petrol', amount_sold: 10000, litres_sold: 100 },
      { fuel_type: 'diesel', amount_sold: 20000, litres_sold: 200 },
    ];
    const calculations = calculateShiftEarnings(plan, readings);
    assert.equal(calculations.length, 3);
    assert.equal(calculations.reduce((sum, row) => sum + row.gross_amount, 0), 1200);

    const [shiftId] = await db('shifts').insert({
      employee_id: employeeId,
      compensation_plan_id: hybridPlanId,
      shift_date: '2026-08-01',
      start_time: '2026-08-01 08:00:00',
      status: 'open',
    });
    const shift = await db('shifts').where({ id: shiftId }).first();
    await db.transaction((trx) => generateShiftEarnings(
      shift,
      readings,
      '2026-08-02 08:00:00',
      trx,
    ));
    await db.transaction((trx) => generateShiftEarnings(
      shift,
      readings,
      '2026-08-02 08:00:00',
      trx,
    ));

    const stored = await db('employee_earnings').where({ shift_id: shiftId });
    assert.equal(stored.length, 3);
    assert.equal(stored.reduce((sum, row) => sum + Number(row.gross_amount), 0), 1200);

    console.log('PASS legacy earnings snapshot preserves recorded gross wage');
    console.log('PASS hybrid shift earnings calculation and idempotent persistence');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('FAIL employee earnings tests');
  console.error(error);
  process.exit(1);
});
