import fs from 'fs';
import os from 'os';
import path from 'path';
import knex from 'knex';
import { up as migrateConsumptionControls } from '../migrations/20260730_035_invoice_consumption_controls';
import {
  resolveConsumptionSource,
  validateInvoiceConsumptionAgainstReadings,
} from '../src/services/invoiceConsumption';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectError(action: () => Promise<unknown> | unknown, text: string) {
  try {
    await action();
  } catch (err: any) {
    assert(String(err.message).includes(text), `Expected "${text}", got "${err.message}"`);
    return;
  }
  throw new Error(`Expected operation to fail with "${text}"`);
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `nexgen-invoice-consumption-${Date.now()}.db`);
  const db = knex({
    client: 'sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(conn: any, done: (err: Error | null, conn?: any) => void) {
        conn.run('PRAGMA foreign_keys = ON', (err: Error | null) => done(err, conn));
      },
    },
  });

  try {
    await db.schema.createTable('employees', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
    });
    await db.schema.createTable('shifts', (t) => {
      t.increments('id').primary();
      t.integer('employee_id').nullable();
      t.string('status').notNullable();
    });
    await db.schema.createTable('staff_debts', (t) => {
      t.increments('id').primary();
      t.integer('shift_id').notNullable();
      t.decimal('balance', 14, 2).notNullable();
    });
    await db.schema.createTable('tanks', (t) => {
      t.increments('id').primary();
      t.string('label').notNullable();
      t.string('fuel_type').notNullable();
    });
    await db.schema.createTable('pumps', (t) => {
      t.increments('id').primary();
      t.string('label').notNullable();
      t.string('nozzle_label').notNullable();
      t.string('fuel_type').notNullable();
      t.integer('tank_id').nullable();
      t.boolean('active').notNullable().defaultTo(true);
    });
    await db.schema.createTable('invoice_consumption', (t) => {
      t.increments('id').primary();
      t.integer('account_id').notNullable();
      t.integer('shift_id').notNullable();
      t.integer('tank_id').nullable();
      t.string('fuel_type').notNullable();
      t.decimal('litres', 12, 2).notNullable();
      t.decimal('retail_price_at_time', 10, 2).notNullable();
      t.decimal('retail_amount', 14, 2).notNullable();
      t.integer('invoice_line_id').nullable();
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
    await db('invoice_consumption').insert({
      account_id: 1,
      shift_id: 1,
      fuel_type: 'petrol',
      litres: 1,
      retail_price_at_time: 200,
      retail_amount: 200,
      deleted_at: '2026-07-01 00:00:00',
    });

    await migrateConsumptionControls(db);
    await migrateConsumptionControls(db);
    for (const column of [
      'pump_id',
      'created_by_employee_id',
      'correction_of_id',
      'entry_status',
      'reversed_at',
      'reversed_by_employee_id',
      'correction_reason',
      'updated_at',
    ]) {
      assert(await db.schema.hasColumn('invoice_consumption', column), `Migration did not add ${column}`);
    }
    assert(await db.schema.hasTable('shift_accountability_adjustments'), 'Shift accountability table missing');
    assert(await db.schema.hasTable('staff_debt_adjustments'), 'Staff debt adjustment table missing');
    const legacy = await db('invoice_consumption').first();
    assert(legacy.entry_status === 'deleted', 'Legacy deleted row was not classified');

    const [petrolTank] = await db('tanks').insert({ label: 'Petrol Main', fuel_type: 'petrol' });
    const [dieselTank] = await db('tanks').insert({ label: 'Diesel Main', fuel_type: 'diesel' });
    const [petrolPump] = await db('pumps').insert({
      label: 'Pump 1',
      nozzle_label: 'P1',
      fuel_type: 'petrol',
      tank_id: petrolTank,
      active: true,
    });
    const [dieselPump] = await db('pumps').insert({
      label: 'Pump 2',
      nozzle_label: 'D1',
      fuel_type: 'diesel',
      tank_id: dieselTank,
      active: true,
    });

    const autoSource = await resolveConsumptionSource(db, { fuelType: 'petrol' });
    assert(autoSource.pump_id === petrolPump, 'Single fuel source was not auto-selected');
    assert(autoSource.tank_id === petrolTank, 'Auto-selected pump did not derive its tank');

    await expectError(
      () => resolveConsumptionSource(db, { fuelType: 'petrol', pumpId: dieselPump }),
      'dispenses diesel',
    );
    await expectError(
      () => resolveConsumptionSource(db, { fuelType: 'petrol', tankId: dieselTank }),
      'contains diesel',
    );

    const [secondPetrolPump] = await db('pumps').insert({
      label: 'Pump 3',
      nozzle_label: 'P2',
      fuel_type: 'petrol',
      tank_id: petrolTank,
      active: true,
    });
    const ambiguous = await resolveConsumptionSource(db, { fuelType: 'petrol' });
    assert(ambiguous.pump_id === null && ambiguous.source_required, 'Multiple sources should require selection');
    const explicit = await resolveConsumptionSource(db, {
      fuelType: 'petrol',
      pumpId: secondPetrolPump,
      tankId: petrolTank,
    });
    assert(explicit.pump_id === secondPetrolPump, 'Explicit valid source was not retained');

    const valid = validateInvoiceConsumptionAgainstReadings(
      [
        { pump_id: petrolPump, fuel_type: 'petrol', litres_sold: 70 },
        { pump_id: secondPetrolPump, fuel_type: 'petrol', litres_sold: 30 },
        { pump_id: dieselPump, fuel_type: 'diesel', litres_sold: 40 },
      ],
      [
        { pump_id: petrolPump, fuel_type: 'petrol', litres: 60 },
        { pump_id: secondPetrolPump, fuel_type: 'petrol', litres: 20 },
        { pump_id: null, fuel_type: 'diesel', litres: 25 },
      ],
    );
    assert(valid.by_fuel.petrol.remaining_litres === 20, 'Petrol remaining litres are wrong');
    assert(valid.by_fuel.diesel.remaining_litres === 15, 'Diesel remaining litres are wrong');
    assert(valid.missing_source_entries === 1, 'Missing source count is wrong');

    await expectError(
      () => validateInvoiceConsumptionAgainstReadings(
        [{ pump_id: petrolPump, fuel_type: 'petrol', litres_sold: 50 }],
        [{ pump_id: null, fuel_type: 'petrol', litres: 50.02 }],
      ),
      'sold only 50.00 L',
    );
    await expectError(
      () => validateInvoiceConsumptionAgainstReadings(
        [
          { pump_id: petrolPump, fuel_type: 'petrol', litres_sold: 50 },
          { pump_id: secondPetrolPump, fuel_type: 'petrol', litres_sold: 50 },
        ],
        [{ pump_id: petrolPump, fuel_type: 'petrol', litres: 60 }],
      ),
      'source sold only 50.00 L',
    );

    console.log('PASS additive invoice-consumption migration is repeatable');
    console.log('PASS tank, fuel, pump, and automatic-source validation');
    console.log('PASS shift fuel and per-pump litre over-allocation guards');
  } finally {
    await db.destroy();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbFile}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
