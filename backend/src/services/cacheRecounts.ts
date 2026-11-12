import type { Knex } from 'knex';

// Three stored balances are kept for speed and must always equal their source
// records (ENGINEERING-STANDARDS.md §2, Category C):
//   a customer debt   credits.balance            = amount - active payment allocations
//   a supplier bill   supplier_invoices.balance  = amount - live payment allocations
//                                                   - old direct payments with no allocation rows
//   a fuel batch      remaining_litres           = original_litres - litres sold from it
//                                                   - litres a stock adjustment took from it
// A reversal counts the balance again with these formulas instead of adding
// back what was taken off, and the drift check compares every row with them.
// One formula per balance, used by both, so the two can never disagree.

type Conn = Knex | Knex.Transaction;

const cents = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const litres = (value: number) => Math.round(value * 1000) / 1000;

function httpError(message: string, http: number, code: string) {
  return Object.assign(new Error(message), { http, httpStatus: http, code });
}

const CREDIT_PAID = `(SELECT COALESCE(SUM(a.amount_applied), 0) FROM credit_payment_allocations a
  WHERE a.credit_id = c.id AND a.reversed_at IS NULL)`;

const BILL_PAID = `((SELECT COALESCE(SUM(a.amount), 0) FROM supplier_payment_allocations a
    JOIN supplier_payments p ON p.id = a.payment_id
    WHERE a.invoice_id = i.id AND a.deleted_at IS NULL AND p.deleted_at IS NULL)
  + (SELECT COALESCE(SUM(p.amount), 0) FROM supplier_payments p
    WHERE p.invoice_id = i.id AND p.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM supplier_payment_allocations a WHERE a.payment_id = p.id)))`;

// Old general supplier payments (before migration 026) paid bills without
// saying which: a bill of such a supplier cannot be counted from its records.
const SUPPLIER_HAS_UNTRACKED = `EXISTS (SELECT 1 FROM supplier_payments p
  WHERE p.supplier_id = i.supplier_id AND p.deleted_at IS NULL AND p.invoice_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM supplier_payment_allocations a WHERE a.payment_id = p.id))`;

const usedFrom = (column: 'batch_id' | 'adjustment_batch_id', effectColumn: 'delivery_batch_id' | 'adjustment_batch_id', effects: boolean) =>
  `((SELECT COALESCE(SUM(x.litres_consumed), 0) FROM batch_consumption x WHERE x.${column} = b.id)
  + ${effects ? `(SELECT COALESCE(SUM(e.litres), 0) FROM tank_adjustment_batch_effects e WHERE e.${effectColumn} = b.id)` : '0'})`;

// Stock adjustments came with migration 026; very small test schemas leave them out.
async function batchFormulas(conn: Conn) {
  const effects = await conn.schema.hasTable('tank_adjustment_batch_effects');
  const adjustmentBatches = await conn.schema.hasTable('tank_adjustment_batches')
    && await conn.schema.hasColumn('batch_consumption', 'adjustment_batch_id');
  return {
    delivery: usedFrom('batch_id', 'delivery_batch_id', effects),
    adjustment: adjustmentBatches ? usedFrom('adjustment_batch_id', 'adjustment_batch_id', effects) : null,
  };
}

/** Count one customer debt's remaining balance again from its payments. */
export async function recountCreditBalance(conn: Conn, creditId: number): Promise<number | null> {
  const row: any = await conn('credits as c').where('c.id', creditId)
    .first('c.id', 'c.amount', 'c.deleted_at', conn.raw(`${CREDIT_PAID} as paid`));
  if (!row || row.deleted_at) return null;
  const balanceCents = cents(row.amount) - cents(row.paid);
  if (balanceCents < 0) {
    throw httpError(`Debt ${creditId} has more payments than its amount. Run the System check in Settings.`, 409, 'CREDIT_OVERALLOCATED');
  }
  const balance = balanceCents / 100;
  await conn('credits').where({ id: creditId }).update({
    balance,
    status: balanceCents === 0 ? 'paid' : balanceCents >= cents(row.amount) ? 'outstanding' : 'partial',
  });
  return balance;
}

/** Count one supplier bill's balance again from its payments. */
export async function recountSupplierBill(conn: Conn, billId: number): Promise<number | null> {
  const row: any = await conn('supplier_invoices as i').where('i.id', billId)
    .first('i.id', 'i.amount', 'i.deleted_at', conn.raw(`${BILL_PAID} as paid`), conn.raw(`${SUPPLIER_HAS_UNTRACKED} as untracked`));
  if (!row) return null;
  if (Number(row.untracked)) {
    throw httpError(
      'This supplier has old payments recorded before payment tracking, so the bill balance cannot be counted from its records. Reconcile it manually.',
      409,
      'SUPPLIER_HISTORY_INCOMPLETE',
    );
  }
  const balanceCents = cents(row.amount) - cents(row.paid);
  if (balanceCents < 0) {
    throw httpError(`Supplier bill ${billId} has more payments than its amount. Run the System check in Settings.`, 409, 'SUPPLIER_BILL_OVERPAID');
  }
  const balance = balanceCents / 100;
  // A voided bill (its delivery was deleted) keeps its void status and zero balance.
  if (row.deleted_at) return balance;
  await conn('supplier_invoices').where({ id: billId }).update({
    balance,
    status: balanceCents === 0 ? 'paid' : balanceCents >= cents(row.amount) ? 'unpaid' : 'partial',
  });
  return balance;
}

/** Count fuel batches' remaining litres again from what was sold or adjusted out of them. */
export async function recountBatches(
  conn: Conn,
  ids: { deliveryBatchIds?: Iterable<number>; adjustmentBatchIds?: Iterable<number> },
): Promise<void> {
  const formulas = await batchFormulas(conn);
  const groups = [
    { table: 'delivery_batches', used: formulas.delivery, ids: [...new Set(ids.deliveryBatchIds || [])] },
    { table: 'tank_adjustment_batches', used: formulas.adjustment, ids: [...new Set(ids.adjustmentBatchIds || [])] },
  ];
  for (const group of groups) {
    if (group.ids.length === 0 || !group.used) continue;
    const rows: any[] = await conn(`${group.table} as b`).whereIn('b.id', group.ids)
      .select('b.id', 'b.original_litres', conn.raw(`${group.used} as used`));
    for (const row of rows) {
      const remaining = litres(Number(row.original_litres || 0) - Number(row.used || 0));
      if (remaining < -0.005) {
        throw httpError(`Fuel batch ${row.id} has more litres taken out than it held. Run the System check in Settings.`, 409, 'BATCH_OVERDRAWN');
      }
      await conn(group.table).where({ id: row.id }).update({ remaining_litres: Math.max(0, remaining) });
    }
  }
}

export type StoredBalanceDrift = {
  kind: 'credit' | 'supplier_bill' | 'payment_on_deleted_bill' | 'delivery_batch' | 'adjustment_batch';
  id: number;
  stored: number;
  counted: number;
  difference: number;
};

/** Every row whose stored balance differs from its records (read only). */
export async function findStoredBalanceDrift(conn: Conn): Promise<StoredBalanceDrift[]> {
  const out: StoredBalanceDrift[] = [];
  const push = (kind: StoredBalanceDrift['kind'], rows: any[], scale = 100) => {
    for (const row of rows) {
      const stored = Math.round(Number(row.stored || 0) * scale) / scale;
      const counted = Math.round(Number(row.counted || 0) * scale) / scale;
      out.push({ kind, id: Number(row.id), stored, counted, difference: Math.round((stored - counted) * scale) / scale });
    }
  };
  push('credit', await conn('credits as c').whereNull('c.deleted_at')
    .whereRaw(`ABS(c.balance - (c.amount - ${CREDIT_PAID})) >= 0.01`)
    .select('c.id', 'c.balance as stored', conn.raw(`c.amount - ${CREDIT_PAID} as counted`)));
  push('supplier_bill', await conn('supplier_invoices as i').whereNull('i.deleted_at')
    .whereRaw(`NOT ${SUPPLIER_HAS_UNTRACKED}`)
    .whereRaw(`ABS(i.balance - (i.amount - ${BILL_PAID})) >= 0.01`)
    .select('i.id', 'i.balance as stored', conn.raw(`i.amount - ${BILL_PAID} as counted`)));
  // A deleted bill must not carry live payments: the money would vanish from
  // what we owe when the payment is voided.
  push('payment_on_deleted_bill', await conn('supplier_invoices as i').whereNotNull('i.deleted_at')
    .whereRaw(`${BILL_PAID} > 0`)
    .select('i.id', conn.raw('0 as stored'), conn.raw(`${BILL_PAID} as counted`)));
  const formulas = await batchFormulas(conn);
  push('delivery_batch', await conn('delivery_batches as b')
    .whereRaw(`ABS(b.remaining_litres - (b.original_litres - ${formulas.delivery})) >= 0.01`)
    .select('b.id', 'b.remaining_litres as stored', conn.raw(`b.original_litres - ${formulas.delivery} as counted`)), 1000);
  if (formulas.adjustment) {
    push('adjustment_batch', await conn('tank_adjustment_batches as b')
      .whereRaw(`ABS(b.remaining_litres - (b.original_litres - ${formulas.adjustment})) >= 0.01`)
      .select('b.id', 'b.remaining_litres as stored', conn.raw(`b.original_litres - ${formulas.adjustment} as counted`)), 1000);
  }
  return out;
}
