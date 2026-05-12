// Phase 3C smoke test (standalone, no HTTP).
// Exercises the invoice draft → issue → void lifecycle directly against
// the DB, mirroring route handler logic. Uses a controlled test consumption
// row so it doesn't interfere with real data, and cleans everything up.

const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './data/nexgen.db' },
  useNullAsDefault: true,
});

const out = (k, v) => console.log(`  ${k.padEnd(36)} ${v}`);
const fail = (m) => { console.error(`\n❌ ${m}`); process.exit(1); };

// Mirror of backend/src/services/accountBalance.ts recomputeAccountBalance
// (invoice-mode branch only — that's all this test exercises)
async function recomputeInvoiceAccountBalance(trx, accountId) {
  const issuedRow = await trx('customer_invoices')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .whereIn('status', ['issued', 'partial', 'paid'])
    .sum('total_amount as total')
    .first();
  const totalIssued = parseFloat(issuedRow?.total) || 0;

  const paidRow = await trx('invoice_payments')
    .where({ account_id: accountId })
    .whereNull('deleted_at')
    .sum('amount as total')
    .first();
  const totalPaid = parseFloat(paidRow?.total) || 0;

  const balance = Math.max(0, totalIssued - totalPaid);
  await trx('credit_accounts').where({ id: accountId }).update({ balance });
  return balance;
}

(async () => {
  let invoiceId, lineIds = [], consumptionId;
  const testMarker = `PHASE3C-TEST-${Date.now()}`;

  try {
    console.log('── Phase 3C Verification ───────────────────────');

    // 1. Sanity — tables exist
    for (const t of ['customer_invoices', 'invoice_lines', 'invoice_consumption', 'invoice_payments', 'invoice_payment_allocations']) {
      const ok = await knex.schema.hasTable(t);
      out(`table ${t}`, ok ? '✓' : '✗');
      if (!ok) fail(`table ${t} missing`);
    }

    // 2. Find an invoice-mode account
    const account = await knex('credit_accounts')
      .where({ billing_mode: 'invoice' })
      .whereNull('deleted_at')
      .first();
    if (!account) fail('No invoice-mode account');
    out('test account', `[${account.id}] ${account.name}`);
    const balanceBefore = Number(account.balance) || 0;
    out('balance before', `KES ${balanceBefore.toFixed(2)}`);

    // 3. Find a shift — prefer one with a shift_date today or recent
    const shift = await knex('shifts').orderBy('id', 'desc').first();
    if (!shift) fail('No shift to attach test consumption to');
    const shiftDate = shift.shift_date || (shift.start_time || '').slice(0, 10);
    out('shift', `#${shift.id} (${shiftDate})`);

    // 4. Get diesel retail price on that date
    const price = await knex('fuel_prices')
      .where({ fuel_type: 'diesel' })
      .where('effective_date', '<=', shiftDate)
      .orderBy('effective_date', 'desc')
      .orderBy('id', 'desc')
      .first();
    if (!price) fail('No diesel price');
    const retail = Number(price.price_per_litre);
    out('diesel retail', `KES ${retail}`);

    // 5. Insert test consumption (50 L diesel)
    const litres = 50;
    const retailAmount = Math.round(litres * retail * 100) / 100;
    [consumptionId] = await knex('invoice_consumption').insert({
      account_id: account.id,
      shift_id: shift.id,
      tank_id: null,
      fuel_type: 'diesel',
      litres,
      retail_price_at_time: retail,
      retail_amount: retailAmount,
    });
    out('test consumption id', consumptionId);
    out('retail amount', `KES ${retailAmount}`);

    // ─── 6. SIMULATE POST / (create draft) ────────────────────────────
    await knex.transaction(async (trx) => {
      const rows = await trx('invoice_consumption as ic')
        .leftJoin('shifts as s', 'ic.shift_id', 's.id')
        .where('ic.account_id', account.id)
        .whereNull('ic.deleted_at')
        .whereNull('ic.invoice_line_id')
        .where('s.shift_date', '>=', shiftDate)
        .where('s.shift_date', '<=', shiftDate)
        .select('ic.fuel_type', 'ic.litres', 'ic.retail_amount');

      if (rows.length === 0) throw new Error('no unbilled consumption in range');

      const byFuel = {};
      for (const r of rows) {
        const ft = r.fuel_type;
        if (!byFuel[ft]) byFuel[ft] = { litres: 0, retail: 0 };
        byFuel[ft].litres += Number(r.litres);
        byFuel[ft].retail += Number(r.retail_amount);
      }

      [invoiceId] = await trx('customer_invoices').insert({
        account_id: account.id,
        invoice_number: `DRAFT-${account.id}-${Date.now()}`,
        from_date: shiftDate,
        to_date: shiftDate,
        status: 'draft',
        total_amount: 0,
        balance: 0,
        notes: testMarker,
      });

      let total = 0;
      for (const [fuel_type, v] of Object.entries(byFuel)) {
        const L = Math.round(v.litres * 100) / 100;
        const avg = v.litres > 0 ? v.retail / v.litres : 0;
        const agreed = Math.round(avg * 100) / 100;
        const lt = Math.round(L * agreed * 100) / 100;
        total += lt;
        await trx('invoice_lines').insert({
          invoice_id: invoiceId,
          fuel_type,
          total_litres: L,
          agreed_price: agreed,
          line_total: lt,
        });
      }
      total = Math.round(total * 100) / 100;
      await trx('customer_invoices').where({ id: invoiceId }).update({ total_amount: total, balance: total });
    });

    const draft = await knex('customer_invoices').where({ id: invoiceId }).first();
    lineIds = await knex('invoice_lines').where({ invoice_id: invoiceId }).pluck('id');
    out('draft created', `#${invoiceId} status=${draft.status} total=${draft.total_amount}`);
    if (draft.status !== 'draft') fail(`expected status=draft, got ${draft.status}`);
    if (!Number(draft.total_amount) || Number(draft.total_amount) < retailAmount - 0.01) {
      fail(`draft total ${draft.total_amount} < expected ${retailAmount}`);
    }

    // ─── 7. SIMULATE PUT /:id/lines/:lineId (edit agreed_price) ─────────
    const dieselLineId = lineIds[0];
    const negotiatedPrice = Math.round((retail - 5) * 100) / 100; // 5 KES discount
    await knex.transaction(async (trx) => {
      const line = await trx('invoice_lines').where({ id: dieselLineId }).first();
      const newLineTotal = Math.round(Number(line.total_litres) * negotiatedPrice * 100) / 100;
      await trx('invoice_lines').where({ id: dieselLineId }).update({
        agreed_price: negotiatedPrice,
        line_total: newLineTotal,
      });
      const lSum = await trx('invoice_lines').where({ invoice_id: invoiceId }).sum('line_total as t').first();
      const t = Math.round((Number(lSum.t) || 0) * 100) / 100;
      await trx('customer_invoices').where({ id: invoiceId }).update({ total_amount: t, balance: t });
    });

    const afterEdit = await knex('customer_invoices').where({ id: invoiceId }).first();
    out('after line edit', `agreed=${negotiatedPrice} total=${afterEdit.total_amount}`);
    const expectedTotal = Math.round(litres * negotiatedPrice * 100) / 100;
    if (Math.abs(Number(afterEdit.total_amount) - expectedTotal) > 0.01) {
      fail(`edited total ${afterEdit.total_amount} ≠ expected ${expectedTotal}`);
    }

    // ─── 8. SIMULATE POST /:id/issue ──────────────────────────────────
    await knex.transaction(async (trx) => {
      const lines = await trx('invoice_lines').where({ invoice_id: invoiceId });
      const lineByFuel = {};
      for (const l of lines) lineByFuel[l.fuel_type] = l;

      const rows = await trx('invoice_consumption as ic')
        .leftJoin('shifts as s', 'ic.shift_id', 's.id')
        .where('ic.account_id', account.id)
        .whereNull('ic.deleted_at')
        .whereNull('ic.invoice_line_id')
        .where('s.shift_date', '>=', shiftDate)
        .where('s.shift_date', '<=', shiftDate)
        .select('ic.id', 'ic.fuel_type', 'ic.litres', 'ic.retail_amount');

      const rowsByFuel = {};
      const litresByFuel = {};
      for (const r of rows) {
        if (!rowsByFuel[r.fuel_type]) { rowsByFuel[r.fuel_type] = []; litresByFuel[r.fuel_type] = 0; }
        rowsByFuel[r.fuel_type].push(r.id);
        litresByFuel[r.fuel_type] += Number(r.litres);
      }
      for (const [ft, ids] of Object.entries(rowsByFuel)) {
        const line = lineByFuel[ft];
        await trx('invoice_consumption').whereIn('id', ids).update({ invoice_line_id: line.id });
        const L = Math.round(litresByFuel[ft] * 100) / 100;
        const lt = Math.round(L * Number(line.agreed_price) * 100) / 100;
        await trx('invoice_lines').where({ id: line.id }).update({ total_litres: L, line_total: lt });
      }

      // Next invoice_number
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const prefix = `CINV-${today}-`;
      const cRow = await trx('customer_invoices').where('invoice_number', 'like', `${prefix}%`).count('* as c').first();
      const seq = String((Number(cRow?.c) || 0) + 1).padStart(3, '0');
      const invNum = `${prefix}${seq}`;

      await trx('customer_invoices').where({ id: invoiceId }).update({
        invoice_number: invNum,
        issue_date: new Date().toISOString().slice(0, 10),
        status: 'issued',
      });

      // recomputeInvoiceTotals (lines only, no payments yet)
      const lSum = await trx('invoice_lines').where({ invoice_id: invoiceId }).sum('line_total as t').first();
      const t = Math.round((Number(lSum.t) || 0) * 100) / 100;
      await trx('customer_invoices').where({ id: invoiceId }).update({ total_amount: t, balance: t });

      await recomputeInvoiceAccountBalance(trx, account.id);
    });

    const issued = await knex('customer_invoices').where({ id: invoiceId }).first();
    out('issued', `${issued.invoice_number} status=${issued.status} balance=${issued.balance}`);
    if (issued.status !== 'issued') fail(`expected status=issued, got ${issued.status}`);
    if (!/^CINV-\d{8}-\d{3}$/.test(issued.invoice_number)) fail(`bad invoice_number: ${issued.invoice_number}`);

    const linkedConsumption = await knex('invoice_consumption').where({ id: consumptionId }).first();
    out('consumption.invoice_line_id', linkedConsumption.invoice_line_id);
    if (!linkedConsumption.invoice_line_id) fail('consumption row not linked to invoice_line');

    const acctAfterIssue = await knex('credit_accounts').where({ id: account.id }).first();
    out('account balance after issue', `KES ${Number(acctAfterIssue.balance).toFixed(2)}`);
    const expectedBalance = balanceBefore + Number(issued.total_amount);
    if (Math.abs(Number(acctAfterIssue.balance) - expectedBalance) > 0.01) {
      fail(`balance ${acctAfterIssue.balance} ≠ expected ${expectedBalance.toFixed(2)}`);
    }

    // ─── 9. SIMULATE POST /:id/void ───────────────────────────────────
    await knex.transaction(async (trx) => {
      const lIds = await trx('invoice_lines').where({ invoice_id: invoiceId }).pluck('id');
      await trx('invoice_consumption').whereIn('invoice_line_id', lIds).update({ invoice_line_id: null });
      await trx('customer_invoices').where({ id: invoiceId }).update({ status: 'void', balance: 0 });
      await recomputeInvoiceAccountBalance(trx, account.id);
    });

    const voided = await knex('customer_invoices').where({ id: invoiceId }).first();
    out('voided', `status=${voided.status} balance=${voided.balance}`);
    if (voided.status !== 'void') fail(`expected status=void, got ${voided.status}`);

    const unlinkConsumption = await knex('invoice_consumption').where({ id: consumptionId }).first();
    if (unlinkConsumption.invoice_line_id !== null) fail('consumption still linked after void');
    out('consumption unlinked', '✓');

    const acctAfterVoid = await knex('credit_accounts').where({ id: account.id }).first();
    out('account balance after void', `KES ${Number(acctAfterVoid.balance).toFixed(2)}`);
    if (Math.abs(Number(acctAfterVoid.balance) - balanceBefore) > 0.01) {
      fail(`balance ${acctAfterVoid.balance} ≠ expected ${balanceBefore.toFixed(2)} (pre-test)`);
    }

    // ─── 10. CLEANUP ───────────────────────────────────────────────────
    await knex('invoice_lines').where({ invoice_id: invoiceId }).delete();
    await knex('customer_invoices').where({ id: invoiceId }).delete();
    await knex('invoice_consumption').where({ id: consumptionId }).delete();
    // restore balance just in case (should already be restored by the last recompute)
    await knex.transaction(async (trx) => {
      await recomputeInvoiceAccountBalance(trx, account.id);
    });
    out('cleanup', '✓');

    console.log('\n✅ Phase 3C verification passed');
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Verification error:', e.message);
    console.error(e.stack);
    // Best-effort cleanup
    try {
      if (invoiceId) {
        await knex('invoice_lines').where({ invoice_id: invoiceId }).delete();
        await knex('customer_invoices').where({ id: invoiceId }).delete();
      }
      if (consumptionId) await knex('invoice_consumption').where({ id: consumptionId }).delete();
    } catch {}
    process.exit(1);
  }
})();
