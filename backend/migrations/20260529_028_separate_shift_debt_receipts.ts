import { Knex } from 'knex';

async function ensureIndex(knex: Knex, table: string, columns: string[], name: string): Promise<void> {
  const exists = await knex.schema.hasTable(table);
  if (!exists) return;
  const rows = await knex.raw(`PRAGMA index_list(${table})`);
  const list = Array.isArray(rows) ? rows : rows?.rows || [];
  if (list.some((row: any) => row.name === name)) return;
  await knex.schema.alterTable(table, (t) => t.index(columns, name));
}

async function recalcCollectionTotals(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE shift_collections
    SET total_collected = ROUND(
      CAST(COALESCE(cash_amount, 0) AS REAL) +
      CAST(COALESCE(mpesa_amount, 0) AS REAL) +
      CAST(COALESCE(credits_amount, 0) AS REAL),
      2
    )
  `);

  const hasMpesaFee = await knex.schema.hasColumn('shift_collections', 'mpesa_fee');
  const hasMpesaNet = await knex.schema.hasColumn('shift_collections', 'mpesa_net');
  if (hasMpesaFee && hasMpesaNet) {
    await knex.raw(`
      UPDATE shift_collections
      SET mpesa_fee = ROUND(CAST(COALESCE(mpesa_amount, 0) AS REAL) * 0.0055, 2),
          mpesa_net = ROUND(CAST(COALESCE(mpesa_amount, 0) AS REAL) - (CAST(COALESCE(mpesa_amount, 0) AS REAL) * 0.0055), 2)
    `);
  }
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('shift_collections')) || !(await knex.schema.hasTable('credit_payments'))) return;
  if (!(await knex.schema.hasColumn('credit_payments', 'shift_id'))) return;

  await ensureIndex(knex, 'credit_payments', ['shift_id'], 'idx_credit_payments_shift');

  // Earlier shift receipt handling added prior-debt payments into sales cash/M-Pesa.
  // From this migration forward, shift_collections is sales-only and credit_payments
  // with shift_id represent the separate drawer/bank movement.
  await knex.raw(`
    UPDATE shift_collections
    SET cash_amount = ROUND(
      CASE
        WHEN CAST(COALESCE(cash_amount, 0) AS REAL) >= COALESCE((
          SELECT SUM(CAST(cp.amount AS REAL))
          FROM credit_payments cp
          WHERE cp.shift_id = shift_collections.shift_id
            AND COALESCE(cp.payment_method, 'cash') != 'mpesa'
            AND cp.deleted_at IS NULL
        ), 0)
        THEN CAST(COALESCE(cash_amount, 0) AS REAL) - COALESCE((
          SELECT SUM(CAST(cp.amount AS REAL))
          FROM credit_payments cp
          WHERE cp.shift_id = shift_collections.shift_id
            AND COALESCE(cp.payment_method, 'cash') != 'mpesa'
            AND cp.deleted_at IS NULL
        ), 0)
        ELSE CAST(COALESCE(cash_amount, 0) AS REAL)
      END,
      2
    ),
    mpesa_amount = ROUND(
      CASE
        WHEN CAST(COALESCE(mpesa_amount, 0) AS REAL) >= COALESCE((
          SELECT SUM(CAST(cp.amount AS REAL))
          FROM credit_payments cp
          WHERE cp.shift_id = shift_collections.shift_id
            AND cp.payment_method = 'mpesa'
            AND cp.deleted_at IS NULL
        ), 0)
        THEN CAST(COALESCE(mpesa_amount, 0) AS REAL) - COALESCE((
          SELECT SUM(CAST(cp.amount AS REAL))
          FROM credit_payments cp
          WHERE cp.shift_id = shift_collections.shift_id
            AND cp.payment_method = 'mpesa'
            AND cp.deleted_at IS NULL
        ), 0)
        ELSE CAST(COALESCE(mpesa_amount, 0) AS REAL)
      END,
      2
    )
  `);

  await recalcCollectionTotals(knex);
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('shift_collections')) || !(await knex.schema.hasTable('credit_payments'))) return;
  if (!(await knex.schema.hasColumn('credit_payments', 'shift_id'))) return;

  await knex.raw(`
    UPDATE shift_collections
    SET cash_amount = ROUND(CAST(COALESCE(cash_amount, 0) AS REAL) + COALESCE((
          SELECT SUM(CAST(cp.amount AS REAL))
          FROM credit_payments cp
          WHERE cp.shift_id = shift_collections.shift_id
            AND COALESCE(cp.payment_method, 'cash') != 'mpesa'
            AND cp.deleted_at IS NULL
        ), 0), 2),
        mpesa_amount = ROUND(CAST(COALESCE(mpesa_amount, 0) AS REAL) + COALESCE((
          SELECT SUM(CAST(cp.amount AS REAL))
          FROM credit_payments cp
          WHERE cp.shift_id = shift_collections.shift_id
            AND cp.payment_method = 'mpesa'
            AND cp.deleted_at IS NULL
        ), 0), 2)
  `);

  await recalcCollectionTotals(knex);
  await knex.schema.alterTable('credit_payments', (t) => t.dropIndex(['shift_id'], 'idx_credit_payments_shift'));
}
