// Phase 3D smoke test (standalone, no HTTP).
// Exercises the invoice payment + FIFO allocation lifecycle directly against
// the DB, mirroring route handler logic. Creates a controlled scenario with
// 2 issued invoices for an invoice-mode account, then verifies:
//   • partial payment → allocates fully to oldest, account balance decreases
//   • full payoff → both invoices status='paid', balance=0
//   • overpayment → unallocated stored, balance still floors at 0
//   • payment delete → reverses allocation, invoices revert status, balance restored
// Cleans everything up at the end.

const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './data/nexgen.db' },
  useNullAsDefault: true,
});

const out = (k, v) => console.log(`  ${k.padEnd(40)} ${v}`);
const fail = (m) => { console.error(`\n❌ ${m}`); process.exit(1); };
const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Mirror of recomputeAccountBalance (invoice-mode branch only)
async function recomputeInvoiceBalance(trx, accountId) {
  const issuedRow = await trx('customer_invoices')
    .where({ account_id: accountId }).whereNull('deleted_at')
    .whereIn('status', ['issued', 'partial', 'paid'])
    .sum('total_amount as total').first();
  const totalIssued = parseFloat(issuedRow?.total) || 0;
  const paidRow = await trx('invoice_payments')
    .where({ account_id: accountId }).whereNull('deleted_at')
    .sum('amount as total').first();
  const totalPaid = parseFloat(paidRow?.total) || 0;
  const balance = Math.max(0, totalIssued - totalPaid);
  await trx('credit_accounts').where({ id: accountId }).update({ balance });
  return balance;
}

// Mirror of recomputeInvoiceTotals
async function recomputeInvoiceTotals(trx, invoiceId) {
  const lSum = await trx('invoice_lines').where({ invoice_id: invoiceId }).sum('line_total as t').first();
  const total = round2(parseFloat(lSum?.t) || 0);
  const pSum = await trx('invoice_payment_allocations').where({ invoice_id: invoiceId }).sum('amount_applied as t').first();
  const paid = round2(parseFloat(pSum?.t) || 0);
  const balance = Math.max(0, round2(total - paid));
  const cur = await trx('customer_invoices').where({ id: invoiceId }).first();
  let next = cur.status;
  if (cur.status !== 'draft' && cur.status !== 'void') {
    if (paid >= total && total > 0) next = 'paid';
    else if (paid > 0) next = 'partial';
    else next = 'issued';
  }
  await trx('customer_invoices').where({ id: invoiceId }).update({ total_amount: total, balance, status: next });
}

// Mirror of allocatePayment (FIFO)
async function allocatePayment(trx, accountId, paymentId, amount) {
  let remaining = round2(amount);
  const allocations = [];
  const unpaid = await trx('customer_invoices')
    .where({ account_id: accountId }).whereNull('deleted_at')
    .whereIn('status', ['issued', 'partial'])
    .orderBy('issue_date', 'asc').orderBy('id', 'asc')
    .select('id', 'invoice_number', 'balance');
  for (const inv of unpaid) {
    if (remaining <= 0) break;
    const balance = round2(inv.balance);
    if (balance <= 0) continue;
    const apply = Math.min(remaining, balance);
    await trx('invoice_payment_allocations').insert({ payment_id: paymentId, invoice_id: inv.id, amount_applied: apply });
    remaining = round2(remaining - apply);
    allocations.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, amount_applied: apply });
    await recomputeInvoiceTotals(trx, inv.id);
  }
  return { allocations, unallocated: remaining };
}

(async () => {
  let accountId, invA, invB, payment1, payment2, payment3, consumptionIds = [];
  try {
    console.log('── Phase 3D Verification ───────────────────────');

    // 1. Find an invoice-mode account, save baseline balance
    const acct = await knex('credit_accounts').where({ billing_mode: 'invoice' }).whereNull('deleted_at').first();
    if (!acct) fail('No invoice-mode account');
    accountId = acct.id;
    const balanceBefore = round2(acct.balance);
    out('test account', `[${accountId}] ${acct.name}`);
    out('balance before', `KES ${balanceBefore.toFixed(2)}`);

    // 2. Build 2 issued invoices manually (cheaper than driving full draft→issue)
    //    We'll skip the consumption linking — totals just come from invoice_lines.
    //    Both with issue_date today; order by id to determine FIFO.
    const todayD = today();
    [invA] = await knex('customer_invoices').insert({
      account_id: accountId,
      invoice_number: `TEST3D-A-${Date.now()}`,
      from_date: todayD, to_date: todayD, issue_date: todayD,
      status: 'issued', total_amount: 10000, balance: 10000,
      notes: 'Phase 3D test invoice A',
    });
    [invB] = await knex('customer_invoices').insert({
      account_id: accountId,
      invoice_number: `TEST3D-B-${Date.now() + 1}`,
      from_date: todayD, to_date: todayD, issue_date: todayD,
      status: 'issued', total_amount: 5000, balance: 5000,
      notes: 'Phase 3D test invoice B',
    });
    await knex('invoice_lines').insert([
      { invoice_id: invA, fuel_type: 'diesel', total_litres: 50, agreed_price: 200, line_total: 10000 },
      { invoice_id: invB, fuel_type: 'petrol', total_litres: 25, agreed_price: 200, line_total: 5000 },
    ]);
    // Sync account balance to baseline + 15000
    await knex.transaction(async trx => { await recomputeInvoiceBalance(trx, accountId); });
    const balAfterIssue = round2((await knex('credit_accounts').where({ id: accountId }).first()).balance);
    out('after 2 invoices issued', `balance=${balAfterIssue} (expected ${balanceBefore + 15000})`);
    if (Math.abs(balAfterIssue - (balanceBefore + 15000)) > 0.01) fail('issued balance wrong');

    // ─── 3. PARTIAL PAYMENT — pay 6000 (less than invoice A's 10000) ─────
    const result1 = await knex.transaction(async trx => {
      const [pid] = await trx('invoice_payments').insert({
        account_id: accountId, amount: 6000, payment_method: 'cash', payment_date: todayD,
      });
      const r = await allocatePayment(trx, accountId, pid, 6000);
      await recomputeInvoiceBalance(trx, accountId);
      return { paymentId: pid, ...r };
    });
    payment1 = result1.paymentId;
    out('payment 1 (6000)', `allocations=${result1.allocations.length}, unallocated=${result1.unallocated}`);
    if (result1.allocations.length !== 1) fail('expected 1 allocation, got ' + result1.allocations.length);
    if (result1.allocations[0].invoice_id !== invA) fail('FIFO broken — should hit invoice A first');
    if (result1.allocations[0].amount_applied !== 6000) fail('amount_applied wrong');
    if (result1.unallocated !== 0) fail('expected 0 unallocated');

    const aAfter1 = await knex('customer_invoices').where({ id: invA }).first();
    out('  invoice A after p1', `status=${aAfter1.status} balance=${aAfter1.balance}`);
    if (aAfter1.status !== 'partial' || round2(aAfter1.balance) !== 4000) fail('A should be partial, balance 4000');
    const bAfter1 = await knex('customer_invoices').where({ id: invB }).first();
    if (bAfter1.status !== 'issued' || round2(bAfter1.balance) !== 5000) fail('B should still be issued/5000');

    const balAfter1 = round2((await knex('credit_accounts').where({ id: accountId }).first()).balance);
    out('  account balance after p1', `KES ${balAfter1}`);
    if (Math.abs(balAfter1 - (balanceBefore + 9000)) > 0.01) fail('balance after p1 wrong');

    // ─── 4. PAY OFF REMAINDER + PARTIAL B — pay 7000 ──────────────────
    //  Should: finish A's 4000, then pay 3000 toward B
    const result2 = await knex.transaction(async trx => {
      const [pid] = await trx('invoice_payments').insert({
        account_id: accountId, amount: 7000, payment_method: 'mpesa', payment_date: todayD,
      });
      const r = await allocatePayment(trx, accountId, pid, 7000);
      await recomputeInvoiceBalance(trx, accountId);
      return { paymentId: pid, ...r };
    });
    payment2 = result2.paymentId;
    out('payment 2 (7000)', `allocations=${result2.allocations.length}, unallocated=${result2.unallocated}`);
    if (result2.allocations.length !== 2) fail('expected 2 allocations (A finish + B partial)');
    if (result2.allocations[0].amount_applied !== 4000) fail('first alloc should be 4000 to A');
    if (result2.allocations[1].amount_applied !== 3000) fail('second alloc should be 3000 to B');

    const aAfter2 = await knex('customer_invoices').where({ id: invA }).first();
    out('  invoice A after p2', `status=${aAfter2.status} balance=${aAfter2.balance}`);
    if (aAfter2.status !== 'paid' || round2(aAfter2.balance) !== 0) fail('A should be paid/0');
    const bAfter2 = await knex('customer_invoices').where({ id: invB }).first();
    out('  invoice B after p2', `status=${bAfter2.status} balance=${bAfter2.balance}`);
    if (bAfter2.status !== 'partial' || round2(bAfter2.balance) !== 2000) fail('B should be partial/2000');

    // ─── 5. OVERPAYMENT — pay 5000 against remaining 2000 ─────────────
    const result3 = await knex.transaction(async trx => {
      const [pid] = await trx('invoice_payments').insert({
        account_id: accountId, amount: 5000, payment_method: 'cash', payment_date: todayD,
      });
      const r = await allocatePayment(trx, accountId, pid, 5000);
      await recomputeInvoiceBalance(trx, accountId);
      return { paymentId: pid, ...r };
    });
    payment3 = result3.paymentId;
    out('payment 3 (5000, overpay)', `allocations=${result3.allocations.length}, unallocated=${result3.unallocated}`);
    if (result3.unallocated !== 3000) fail('expected 3000 unallocated, got ' + result3.unallocated);
    if (result3.allocations.length !== 1 || result3.allocations[0].amount_applied !== 2000) fail('B should be paid 2000');

    const bAfter3 = await knex('customer_invoices').where({ id: invB }).first();
    if (bAfter3.status !== 'paid' || round2(bAfter3.balance) !== 0) fail('B should be paid/0');

    const balAfter3 = round2((await knex('credit_accounts').where({ id: accountId }).first()).balance);
    out('  account balance after p3', `KES ${balAfter3} (overpay clamped to baseline)`);
    if (Math.abs(balAfter3 - balanceBefore) > 0.01) fail('balance should be back to pre-test baseline');

    // ─── 6. DELETE payment 3 — should revert B from paid → partial, balance up ──
    await knex.transaction(async trx => {
      const affected = await trx('invoice_payment_allocations').where({ payment_id: payment3 }).pluck('invoice_id');
      await trx('invoice_payment_allocations').where({ payment_id: payment3 }).delete();
      await trx('invoice_payments').where({ id: payment3 }).update({ deleted_at: trx.fn.now() });
      for (const id of affected) await recomputeInvoiceTotals(trx, id);
      await recomputeInvoiceBalance(trx, accountId);
    });
    const bAfterDel = await knex('customer_invoices').where({ id: invB }).first();
    out('  invoice B after delete p3', `status=${bAfterDel.status} balance=${bAfterDel.balance}`);
    if (bAfterDel.status !== 'partial' || round2(bAfterDel.balance) !== 2000) fail('B should revert to partial/2000');

    const balAfterDel = round2((await knex('credit_accounts').where({ id: accountId }).first()).balance);
    out('  account balance after delete p3', `KES ${balAfterDel} (expected baseline+2000)`);
    if (Math.abs(balAfterDel - (balanceBefore + 2000)) > 0.01) fail('balance after delete wrong');

    // ─── 7. CLEANUP ────────────────────────────────────────────────────
    await knex('invoice_payment_allocations').whereIn('payment_id', [payment1, payment2, payment3]).delete();
    await knex('invoice_payments').whereIn('id', [payment1, payment2, payment3]).delete();
    await knex('invoice_lines').whereIn('invoice_id', [invA, invB]).delete();
    await knex('customer_invoices').whereIn('id', [invA, invB]).delete();
    await knex.transaction(async trx => { await recomputeInvoiceBalance(trx, accountId); });
    const balFinal = round2((await knex('credit_accounts').where({ id: accountId }).first()).balance);
    if (Math.abs(balFinal - balanceBefore) > 0.01) fail(`cleanup left balance ${balFinal} ≠ ${balanceBefore}`);
    out('cleanup', '✓ balance restored');

    console.log('\n✅ Phase 3D verification passed');
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Verification error:', e.message);
    console.error(e.stack);
    // Best-effort cleanup
    try {
      const ids = [payment1, payment2, payment3].filter(Boolean);
      if (ids.length) {
        await knex('invoice_payment_allocations').whereIn('payment_id', ids).delete();
        await knex('invoice_payments').whereIn('id', ids).delete();
      }
      if (invA || invB) {
        const invIds = [invA, invB].filter(Boolean);
        await knex('invoice_lines').whereIn('invoice_id', invIds).delete();
        await knex('customer_invoices').whereIn('id', invIds).delete();
      }
      if (accountId) await knex.transaction(async trx => { await recomputeInvoiceBalance(trx, accountId); });
    } catch (ce) { console.error('cleanup error:', ce.message); }
    process.exit(1);
  }
})();
