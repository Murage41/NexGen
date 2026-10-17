import assert from 'node:assert/strict';
import { computeShiftAccountability, sumMoney } from '../src/services/shiftAccountability';
import { effectiveOpeningFromLines, snapshotFinancialFields, snapshotFigures } from '../src/services/shiftSnapshot';
import { readShiftFinancials, summarizeShiftFinancials } from '../src/services/shiftFinancials';

const base = {
  reconciliation_basis: 'balances_v1' as const,
  opening_cash_amount: 2000, opening_mpesa_amount: 3000,
  readings: [{ amount_sold: 10000 }],
  collections: { cash_amount: 6000, mpesa_amount: 5500 },
  shiftCredits: [{ amount: 1000 }], invoiceConsumption: [{ retail_amount: 2000 }],
  creditReceipts: [{ amount: 500, payment_method: 'cash' }],
  expenses: [{ amount: 400 }], employee_wage: 800, actual_wage_paid: 600,
};
const balanced = computeShiftAccountability(base);
assert.equal(balanced.expected_closing, 11500);
assert.equal(balanced.expected_shift_total, 15500);
assert.equal(balanced.total_accounted, 15500);
assert.equal(balanced.variance, 0);
assert.equal(balanced.expected_sales, 10000, 'Opening money is never a second sale.');
assert.equal(balanced.employee_wage, 600, 'Only wages actually paid from the drawer enter balance reconciliation.');
assert.equal(balanced.inferred_collections, 7500);
assert.equal(balanced.expected_receipts, 7500);
assert.equal(balanced.sales_accounted, 10000, 'Reconstructed receipts already include payouts; do not add them twice.');
assert.equal(balanced.sales_cash, null, 'Closing balances do not prove per-channel receipts.');
assert.equal(balanced.sales_mpesa, null);
assert.equal(balanced.expected_cash, null);
const short = computeShiftAccountability({ ...base, collections: { cash_amount: 5700, mpesa_amount: 5500 } });
assert.equal(short.variance, -300);
assert.equal(short.inferred_collections, 7200);
assert.equal(short.expected_receipts, 7500);
assert.equal(short.sales_variance, -300);

const removal = { direction: 'removed', method: 'mpesa', amount: 2500, source: 'station_bank_safe' };
const transfer = computeShiftAccountability({ ...base, collections: { cash_amount: 6000, mpesa_amount: 3000 }, fundsMovements: [removal] });
assert.equal(transfer.expected_closing, 9000);
assert.equal(transfer.variance, 0);
assert.equal(transfer.inferred_collections, 7500, 'Internal transfer changes custody, not receipts.');
const topup = computeShiftAccountability({ ...base, collections: { cash_amount: 7000, mpesa_amount: 5500 }, fundsMovements: [{ direction: 'added', method: 'cash', amount: 1000, source: 'owner' }] });
assert.equal(topup.expected_closing, 12500);
assert.equal(topup.variance, 0);
assert.equal(topup.inferred_collections, 7500, 'Funding is not trading income.');
const empty = {
  reconciliation_basis: 'balances_v1' as const, opening_cash_amount: 2000, opening_mpesa_amount: 3000,
  readings: [], collections: { cash_amount: 1000, mpesa_amount: 3000 }, shiftCredits: [],
  invoiceConsumption: [], creditReceipts: [], expenses: [{ amount: 1000 }], employee_wage: 800, actual_wage_paid: 0,
};
const belowOpening = computeShiftAccountability(empty);
assert.equal(belowOpening.expected_closing, 4000);
assert.equal(belowOpening.variance, 0);
assert.equal(belowOpening.inferred_collections, 0);
assert.equal(belowOpening.employee_wage, 0, 'Explicit zero actual payment is not earned wage.');
const mpesa = computeShiftAccountability({ ...empty, opening_cash_amount: 0, opening_mpesa_amount: 20000,
  readings: [{ amount_sold: 30000 }], collections: { cash_amount: 0, mpesa_amount: 25000 }, expenses: [],
  fundsMovements: [{ ...removal, amount: 25000 }] });
assert.equal(mpesa.expected_closing, 25000);
assert.equal(mpesa.inferred_collections, 30000);
assert.equal(mpesa.variance, 0);
const zero = computeShiftAccountability({ ...empty, opening_cash_amount: 0, opening_mpesa_amount: 0,
  collections: { cash_amount: 0, mpesa_amount: 0 }, expenses: [] });
assert.equal(zero.opening_total, 0);
assert.equal(zero.variance, 0);
const ignored = computeShiftAccountability({ ...base, fundsMovements: [
  { ...removal, deleted_at: '2026-10-16' }, { ...removal, reversed_by_record_correction_id: 1 },
] });
assert.equal(ignored.variance, 0, 'Reversed movements do not contribute again.');
const payroll = computeShiftAccountability({ ...base, collections: { cash_amount: 5800, mpesa_amount: 5500 },
  payrollPayments: [{ amount: 200, payment_method: 'cash' }, { amount: 900, payment_method: 'bank' }] });
assert.equal(payroll.total_payroll_payments, 200, 'Office bank payroll is not a shift drawer payment.');
assert.equal(payroll.variance, 0);
assert.equal(payroll.inferred_collections, 7500);

const shift = { id: 1, reconciliation_basis: 'balances_v1', opening_cash_amount: 2000, opening_mpesa_amount: 3000 };
const lines = [
  { record_type: 'opening_funds', method: 'cash', action: 'reverse', amount: 2000, shift_open: true },
  { record_type: 'opening_funds', method: 'cash', action: 'add', amount: 2500, shift_open: true },
];
const beforeClose = effectiveOpeningFromLines(shift, lines);
assert.equal(beforeClose.opening_cash_amount, 2500);
const changed = computeShiftAccountability({ ...base, ...beforeClose });
assert.equal(changed.variance, -500, 'Increasing an opening lowers this shift result.');
const saved = {
  ...snapshotFinancialFields(changed), expected_sales: changed.expected_sales, expected_shift_total: changed.expected_shift_total,
  cash_received: changed.total_cash, mpesa_received: changed.total_mpesa, credits_issued: changed.total_credits,
  credit_receipts: changed.total_credit_receipts, invoice_consumption: changed.total_invoice_consumption,
  expenses: changed.total_expenses, direct_wage_payment: changed.employee_wage, payroll_payments: changed.total_payroll_payments,
  total_accounted: changed.total_accounted, variance: changed.variance,
};
const original = snapshotFigures(saved);
assert.equal(original.opening_cash_amount, 2500);
assert.equal(original.inferred_collections, 7000);
assert.equal(original.sales_accounted, 9500);
assert.equal(original.sales_collections, 6500);
assert.equal(original.sales_cash, null, 'Original balance view also avoids invented channel receipts.');
assert.equal(original.sales_mpesa, null);
const afterClose = effectiveOpeningFromLines(shift, [...lines,
  { record_type: 'opening_funds', method: 'cash', action: 'reverse', amount: 2500, shift_open: false },
  { record_type: 'opening_funds', method: 'cash', action: 'add', amount: 1800, shift_open: false },
]);
assert.equal(afterClose.opening_cash_amount, 1800, 'Current starts with raw declaration, not the already corrected snapshot.');
assert.equal(original.opening_cash_amount, 2500, 'Post-close corrections preserve the original close.');
assert.equal(effectiveOpeningFromLines({ ...shift, id: 2, opening_cash_amount: 1200, opening_mpesa_amount: 800 }, []).opening_cash_amount, 1200);

const legacy = computeShiftAccountability({ ...base, reconciliation_basis: 'legacy' });
assert.equal(legacy.opening_cash_amount, null, 'Historical opening is unknown, not a captured zero.');
assert.equal(legacy.expected_shift_total, 10500);
assert.equal(legacy.employee_wage, 800, 'Legacy wage basis remains unchanged.');
assert.equal(legacy.sales_cash, 5500);
assert.equal(legacy.variance, 5200);
const summary = summarizeShiftFinancials([{ current: balanced, collection_count_recorded: true } as any, { current: legacy, actual_wage_paid: 600, drawer_payroll_paid: 0 } as any]);
assert.equal(summary.collection_basis, 'mixed');
assert.equal(summary.total_cash, null);
assert.equal(summary.sales_cash, null);
assert.equal(summary.closing_cash, 12000);
assert.equal(summary.balance_inferred_collections, 7500);
assert.equal(summary.opening_total, 5000);
assert.equal(summary.inferred_collections, 20000, 'Mixed reconstruction uses actual legacy drawer wage, not its preserved gross reconciliation basis.');
assert.equal(summary.drawer_business_payouts, 2000);
const uncounted = summarizeShiftFinancials([{ current: computeShiftAccountability({ ...empty, collections: null, expenses: [] }), collection_count_recorded: false } as any]);
assert.equal(uncounted.uncounted_balance_shifts, 1);
assert.equal(uncounted.opening_total, 5000, 'The actual declaration is still shown.');
assert.equal(uncounted.inferred_collections, 0, 'No count is not evidence of negative receipts.');
assert.equal(uncounted.balance_inferred_collections, 0);
assert.equal(uncounted.sales_collections, 0);
assert.equal(uncounted.closing_total, 0, 'Uncounted openings are never fabricated closing counts.');
assert.equal(sumMoney(Array.from({ length: 1000 }, () => ({ amount: 0.01 })), row => row.amount), 10);
async function checkCountEvidence() {
  const knex = (await import('knex')).default;
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  try {
    await db.schema.createTable('shifts', t => {
      t.increments('id'); t.string('status'); t.string('reconciliation_basis');
      t.decimal('opening_cash_amount'); t.decimal('opening_mpesa_amount'); t.integer('collections_revision');
    });
    await db.schema.createTable('shift_collections', t => {
      t.increments('id'); t.integer('shift_id'); t.decimal('cash_amount'); t.decimal('mpesa_amount'); t.decimal('credits_amount');
    });
    await db('shifts').insert({ id: 1, status: 'open', reconciliation_basis: 'balances_v1', opening_cash_amount: 2000, opening_mpesa_amount: 3000, collections_revision: 0 });
    let view = (await readShiftFinancials(db, [1])).get(1)!;
    assert.equal(view.collection_count_recorded, false);
    assert.equal(summarizeShiftFinancials([view]).inferred_collections, 0);
    await db('shift_collections').insert({ shift_id: 1, cash_amount: 0, mpesa_amount: 0, credits_amount: 100 });
    view = (await readShiftFinancials(db, [1])).get(1)!;
    assert.equal(view.collection_count_recorded, false, 'An automatic credit-cache row is not a saved cash/M-Pesa count.');
    assert.equal(summarizeShiftFinancials([view]).uncounted_balance_shifts, 1);
    assert.equal(summarizeShiftFinancials([view]).balance_inferred_collections, 0);
    await db('shifts').where({ id: 1 }).update({ collections_revision: 1 });
    view = (await readShiftFinancials(db, [1])).get(1)!;
    assert.equal(view.collection_count_recorded, true, 'An explicit saved zero count is valid evidence.');
    assert.equal(summarizeShiftFinancials([view]).uncounted_balance_shifts, 0);
    assert.equal(summarizeShiftFinancials([view]).balance_inferred_collections, -5000);
  } finally { await db.destroy(); }
}
checkCountEvidence().then(() => {
  console.log('PASS: float equations, custody movements, actual drawer payouts, independent declarations, original/current snapshots, saved-count evidence and legacy compatibility.');
}).catch(err => { console.error(err); process.exitCode = 1; });
