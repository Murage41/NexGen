import fs from 'fs';
import os from 'os';
import path from 'path';
import knex from 'knex';
import { performance } from 'perf_hooks';
import { getInvoiceCustomerMonitor } from '../src/services/invoiceCustomerMonitor';

const ACCOUNTS = Number(process.env.STRESS_ACCOUNTS || 600);
const CONSUMPTION_ROWS = Number(process.env.STRESS_CONSUMPTION_ROWS || 30000);
const INVOICE_ROWS = Number(process.env.STRESS_INVOICE_ROWS || 4000);
const ITERATIONS = Number(process.env.STRESS_ITERATIONS || 8);
const MAX_AVG_MS = Number(process.env.STRESS_MAX_AVG_MS || 1500);

const round2 = (n: number) => Math.round(n * 100) / 100;

function kenyaDate(offset: number): string {
  const d = new Date(Date.UTC(2026, 0, 1 + offset));
  return d.toISOString().slice(0, 10);
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `nexgen-invoice-monitor-stress-${Date.now()}.db`);
  const db = knex({
    client: 'sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
  });

  try {
    await db.schema.createTable('credit_accounts', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
      t.string('phone').nullable();
      t.string('type').notNullable();
      t.string('billing_mode').notNullable();
      t.decimal('balance', 14, 2).notNullable().defaultTo(0);
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
    await db.schema.createTable('shifts', (t) => {
      t.increments('id').primary();
      t.date('shift_date').notNullable();
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
      t.index(['account_id', 'shift_id']);
      t.index('invoice_line_id');
    });
    await db.schema.createTable('customer_invoices', (t) => {
      t.increments('id').primary();
      t.integer('account_id').notNullable();
      t.string('invoice_number').notNullable();
      t.date('from_date').notNullable();
      t.date('to_date').notNullable();
      t.date('issue_date').nullable();
      t.string('status').notNullable();
      t.decimal('total_amount', 14, 2).notNullable();
      t.decimal('balance', 14, 2).notNullable();
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.index(['account_id', 'status']);
      t.index('issue_date');
    });

    const accounts = Array.from({ length: ACCOUNTS }, (_, i) => ({
      id: i + 1,
      name: `Invoice Customer ${String(i + 1).padStart(4, '0')}`,
      phone: `07${String(10000000 + i).slice(-8)}`,
      type: 'customer',
      billing_mode: 'invoice',
      balance: 0,
    }));
    await db.batchInsert('credit_accounts', accounts, 500);

    const shifts = Array.from({ length: Math.max(365, Math.ceil(CONSUMPTION_ROWS / 20)) }, (_, i) => ({
      id: i + 1,
      shift_date: kenyaDate(i % 365),
    }));
    await db.batchInsert('shifts', shifts, 500);

    const consumption = Array.from({ length: CONSUMPTION_ROWS }, (_, i) => {
      const accountId = (i % ACCOUNTS) + 1;
      const shiftId = (i % shifts.length) + 1;
      const fuelType = i % 3 === 0 ? 'diesel' : 'petrol';
      const litres = round2(5 + (i % 140) * 0.73);
      const price = fuelType === 'diesel' ? 188.5 : 196.75;
      const invoiceLineId = i % 4 === 0 ? (i % 1000) + 1 : null;
      return {
        account_id: accountId,
        shift_id: shiftId,
        tank_id: null,
        fuel_type: fuelType,
        litres,
        retail_price_at_time: price,
        retail_amount: round2(litres * price),
        invoice_line_id: invoiceLineId,
      };
    });
    await db.batchInsert('invoice_consumption', consumption, 200);

    const statuses = ['issued', 'partial', 'paid', 'draft', 'void'];
    const invoices = Array.from({ length: INVOICE_ROWS }, (_, i) => {
      const accountId = (i % ACCOUNTS) + 1;
      const status = statuses[i % statuses.length];
      const total = round2(15000 + (i % 700) * 43.7);
      const balance = status === 'paid' || status === 'void'
        ? 0
        : status === 'partial'
          ? round2(total / 2)
          : total;
      return {
        account_id: accountId,
        invoice_number: status === 'draft' ? `DRAFT-${i}` : `CINV-20260717-${String(i).padStart(5, '0')}`,
        from_date: kenyaDate(i % 300),
        to_date: kenyaDate((i % 300) + 15),
        issue_date: status === 'draft' ? null : kenyaDate((i % 300) + 16),
        status,
        total_amount: total,
        balance,
      };
    });
    await db.batchInsert('customer_invoices', invoices, 200);

    const times: number[] = [];
    let result: any = null;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();
      result = await getInvoiceCustomerMonitor(db as any, { recentLimit: 5 });
      times.push(performance.now() - start);
    }

    const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
    const max = Math.max(...times);
    const customerCount = result?.summary?.customer_count || 0;
    const unbilledEntries = result?.summary?.unbilled_entries || 0;

    console.log(`Seeded ${ACCOUNTS} customers, ${CONSUMPTION_ROWS} consumption rows, ${INVOICE_ROWS} invoices.`);
    console.log(`Monitor returned ${customerCount} customers and ${unbilledEntries} unbilled rows.`);
    console.log(`Iterations: ${ITERATIONS}; avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms`);

    if (customerCount !== ACCOUNTS) throw new Error(`Expected ${ACCOUNTS} customers, got ${customerCount}`);
    if (unbilledEntries <= 0) throw new Error('Expected unbilled entries in monitor summary');
    if (avg > MAX_AVG_MS) throw new Error(`Average monitor time ${avg.toFixed(1)}ms exceeded ${MAX_AVG_MS}ms`);
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
