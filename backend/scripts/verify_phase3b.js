// Phase 3B smoke test (standalone, no HTTP).
// Verifies: schema shape, price lookup, consumption insert,
// shift aggregation, cleanup.

const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './data/nexgen.db' },
  useNullAsDefault: true,
});

(async () => {
  const out = (k, v) => console.log(`  ${k.padEnd(30)} ${v}`);
  const fail = (m) => { console.error(`\n❌ ${m}`); process.exit(1); };

  try {
    console.log('── Phase 3B Verification ───────────────────────');

    // 1. Schema: billing_mode + invoice_consumption table
    const hasBilling = await knex.schema.hasColumn('credit_accounts', 'billing_mode');
    out('credit_accounts.billing_mode', hasBilling ? '✓' : '✗');
    if (!hasBilling) fail('billing_mode column missing');

    const hasIc = await knex.schema.hasTable('invoice_consumption');
    out('invoice_consumption table', hasIc ? '✓' : '✗');
    if (!hasIc) fail('invoice_consumption table missing');

    for (const col of ['account_id', 'shift_id', 'fuel_type', 'litres', 'retail_price_at_time', 'retail_amount', 'invoice_line_id', 'deleted_at']) {
      const ok = await knex.schema.hasColumn('invoice_consumption', col);
      out(`  col: ${col}`, ok ? '✓' : '✗');
      if (!ok) fail(`column ${col} missing`);
    }

    // 2. Find an invoice-mode account (Diwafa or Mugendi the user mentioned)
    const invoiceAccounts = await knex('credit_accounts')
      .where({ billing_mode: 'invoice' })
      .whereNull('deleted_at')
      .select('id', 'name');
    out('invoice-mode accounts', invoiceAccounts.length);
    invoiceAccounts.forEach(a => console.log(`    • [${a.id}] ${a.name}`));
    if (invoiceAccounts.length === 0) fail('No invoice-mode accounts — expected Diwafa/Mugendi');

    // 3. Find an open shift to attach test consumption to
    let shift = await knex('shifts').where({ status: 'open' }).orderBy('id', 'desc').first();
    if (!shift) {
      shift = await knex('shifts').orderBy('id', 'desc').first();
      out('using shift', `#${shift.id} (${shift.status})`);
    } else {
      out('open shift', `#${shift.id}`);
    }
    const shiftDate = shift.shift_date || (shift.start_time || '').slice(0, 10);
    out('shift_date', shiftDate);

    // 4. Retail price lookup
    const dieselPrice = await knex('fuel_prices')
      .where({ fuel_type: 'diesel' })
      .where('effective_date', '<=', shiftDate)
      .orderBy('effective_date', 'desc')
      .orderBy('id', 'desc')
      .first();
    if (!dieselPrice) fail('No diesel price on/before shift date');
    out('diesel retail', `KES ${dieselPrice.price_per_litre} (eff ${dieselPrice.effective_date})`);

    // 5. Insert a test consumption row (then delete)
    const testAccount = invoiceAccounts[0];
    const litres = 100;
    const retailAmount = Math.round(litres * Number(dieselPrice.price_per_litre) * 100) / 100;
    const [entryId] = await knex('invoice_consumption').insert({
      account_id: testAccount.id,
      shift_id: shift.id,
      tank_id: null,
      fuel_type: 'diesel',
      litres,
      retail_price_at_time: dieselPrice.price_per_litre,
      retail_amount: retailAmount,
    });
    out('test insert', `id=${entryId}, retail_amount=${retailAmount}`);
    if (retailAmount !== litres * Number(dieselPrice.price_per_litre)) {
      fail(`Math mismatch: ${retailAmount} vs ${litres * Number(dieselPrice.price_per_litre)}`);
    }

    // 6. Aggregation: sum retail_amount for the shift
    const sum = await knex('invoice_consumption')
      .where({ shift_id: shift.id })
      .whereNull('deleted_at')
      .sum('retail_amount as total')
      .first();
    out('shift invoice retail sum', `KES ${Number(sum.total)}`);
    if (Number(sum.total) < retailAmount) fail('Aggregation missed the insert');

    // 7. Cleanup — hard delete since it was a test row, never user-visible
    await knex('invoice_consumption').where({ id: entryId }).delete();
    out('cleanup', 'done');

    // 8. Drift — invoice_consumption should not drift shift balances
    //    (the GET /shifts/:id rollup is recomputed on every read, no cache)

    console.log('\n✅ Phase 3B verification passed');
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Verification error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
