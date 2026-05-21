import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('tank_stock_adjustments'))) {
    await knex.schema.createTable('tank_stock_adjustments', (t) => {
      t.increments('id').primary();
      t.integer('tank_id').unsigned().notNullable().references('id').inTable('tanks');
      t.decimal('litres_change', 12, 2).notNullable();
      t.string('reason').notNullable();
      t.text('notes').notNullable();
      t.date('adjustment_date').notNullable();
      t.text('adjustment_timestamp').notNullable();
      t.decimal('cost_per_litre', 10, 2).nullable();
      t.decimal('total_cost', 14, 2).nullable();
      t.integer('reference_dip_id').unsigned().nullable().references('id').inTable('tank_dips');
      t.integer('created_by_employee_id').unsigned().nullable().references('id').inTable('employees');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tank_id', 'adjustment_timestamp']);
      t.index('reason');
    });
  }

  if (!(await knex.schema.hasTable('tank_adjustment_batches'))) {
    await knex.schema.createTable('tank_adjustment_batches', (t) => {
      t.increments('id').primary();
      t.integer('adjustment_id').unsigned().notNullable().references('id').inTable('tank_stock_adjustments').onDelete('CASCADE');
      t.integer('tank_id').unsigned().notNullable().references('id').inTable('tanks');
      t.string('fuel_type').notNullable();
      t.decimal('original_litres', 12, 2).notNullable();
      t.decimal('remaining_litres', 12, 2).notNullable();
      t.decimal('cost_per_litre', 10, 2).notNullable().defaultTo(0);
      t.date('date').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['tank_id', 'date']);
    });
  }

  if (!(await knex.schema.hasTable('tank_adjustment_batch_effects'))) {
    await knex.schema.createTable('tank_adjustment_batch_effects', (t) => {
      t.increments('id').primary();
      t.integer('adjustment_id').unsigned().notNullable().references('id').inTable('tank_stock_adjustments').onDelete('CASCADE');
      t.integer('delivery_batch_id').unsigned().nullable().references('id').inTable('delivery_batches').onDelete('SET NULL');
      t.integer('adjustment_batch_id').unsigned().nullable().references('id').inTable('tank_adjustment_batches').onDelete('SET NULL');
      t.decimal('litres', 12, 2).notNullable();
      t.decimal('cost_per_litre', 10, 2).notNullable().defaultTo(0);
      t.decimal('total_cost', 14, 2).notNullable().defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index('adjustment_id');
    });
  }

  if (await knex.schema.hasTable('batch_consumption')) {
    const hasAdjustmentBatchId = await knex.schema.hasColumn('batch_consumption', 'adjustment_batch_id');
    if (!hasAdjustmentBatchId) {
      await knex.schema.alterTable('batch_consumption', (t) => {
        t.integer('adjustment_batch_id').unsigned().nullable().references('id').inTable('tank_adjustment_batches').onDelete('SET NULL');
      });
    }
  }

  if (!(await knex.schema.hasTable('supplier_payment_allocations'))) {
    await knex.schema.createTable('supplier_payment_allocations', (t) => {
      t.increments('id').primary();
      t.integer('payment_id').unsigned().notNullable().references('id').inTable('supplier_payments').onDelete('CASCADE');
      t.integer('invoice_id').unsigned().notNullable().references('id').inTable('supplier_invoices');
      t.decimal('amount', 14, 2).notNullable();
      t.timestamp('deleted_at').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index('payment_id');
      t.index('invoice_id');
    });
  }

  const existingSpecificPayments = await knex('supplier_payments')
    .whereNotNull('invoice_id')
    .whereNull('deleted_at')
    .select('id', 'invoice_id', 'amount');
  for (const p of existingSpecificPayments) {
    const exists = await knex('supplier_payment_allocations')
      .where({ payment_id: p.id, invoice_id: p.invoice_id })
      .first();
    if (!exists) {
      await knex('supplier_payment_allocations').insert({
        payment_id: p.id,
        invoice_id: p.invoice_id,
        amount: p.amount,
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('batch_consumption')) {
    const hasAdjustmentBatchId = await knex.schema.hasColumn('batch_consumption', 'adjustment_batch_id');
    if (hasAdjustmentBatchId) {
      await knex.schema.alterTable('batch_consumption', (t) => {
        t.dropColumn('adjustment_batch_id');
      });
    }
  }

  await knex.schema.dropTableIfExists('supplier_payment_allocations');
  await knex.schema.dropTableIfExists('tank_adjustment_batch_effects');
  await knex.schema.dropTableIfExists('tank_adjustment_batches');
  await knex.schema.dropTableIfExists('tank_stock_adjustments');
}
