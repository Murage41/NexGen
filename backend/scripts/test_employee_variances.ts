import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Attendant variances (services/employeeVariances.ts, migration 047). Part one
// checks the netting rules on plain entries; part two carries a realistic old
// staff-debt history over and checks nothing is lost. Runs on a private
// temporary database; never touches data/nexgen.db.

let nextId = 1;
type Entry = Parameters<typeof import('../src/services/employeeVariances')['computeVarianceStatement']>[0][number];
const entry = (type: string, date: string, amount: number, extra: Partial<Entry> = {}): Entry => ({
  id: nextId++,
  employee_id: 1,
  entry_type: type,
  entry_date: date,
  amount,
  status: 'posted',
  shift_id: null,
  ...extra,
});
let shiftSeq = 100;
// A shift's variance as the shift page shows it: negative = short.
const shift = (date: string, variance: number, extra: Partial<Entry> = {}) =>
  entry('shift', date, -variance, { shift_id: ++shiftSeq, shift_date: date, ...extra });

async function netting() {
  const { computeVarianceStatement: statement } = await import('../src/services/employeeVariances');

  // A. The ASPrime Cashier Variance Manager screenshot, one month:
  // 52.42 - 57.84 + 1.88 + 90.28 - 0.38 = 86.36 owed.
  {
    const entries = [
      shift('2026-09-14', -52.42),
      shift('2026-09-15', 57.84),
      shift('2026-09-16', -1.88),
      shift('2026-09-17', -90.28),
      shift('2026-09-21', 0.38),
    ];
    const s = statement(entries, '2026-09-22');
    assert.equal(s.totals.owes, 86.36);
    assert.equal(s.totals.net, 86.36);
    assert.equal(s.totals.surplus_available, 0);
    const byDate = new Map(s.rows.map((r) => [r.date, r]));
    assert.equal(byDate.get('2026-09-14')!.recovered_by.surplus, 52.42);
    assert.equal(byDate.get('2026-09-14')!.real_variance, 0);
    assert.equal(byDate.get('2026-09-15')!.surplus_used, 57.84);
    // 5.42 left from the 57.84 surplus, then the 0.38 surplus.
    assert.equal(byDate.get('2026-09-17')!.real_variance, -86.36);
    assert.equal(byDate.get('2026-09-17')!.recovered, 3.92);
    assert.equal(s.rows.reduce((sum, r) => Math.round((sum + r.real_variance) * 100) / 100, 0), -86.36);
    console.log('PASS the ASPrime example nets to 86.36 within the month');
  }

  // B. Unused surplus stays with the station at month end.
  {
    const s = statement([shift('2026-09-30', 100), shift('2026-10-01', -60)], '2026-10-02');
    assert.equal(s.totals.owes, 60);
    assert.equal(s.totals.kept_by_station, 100);
    assert.equal(s.rows.find((r) => r.date === '2026-09-30')!.status, 'kept');
    // Still this month: the surplus is available, not kept.
    const same = statement([shift('2026-09-30', 100)], '2026-09-30');
    assert.equal(same.totals.surplus_available, 100);
    assert.equal(same.totals.net, -100);
    assert.equal(same.rows[0].status, 'available');
    console.log('PASS unused surplus stays with the station at month end');
  }

  // C. A surplus pays what is owed from an earlier month; D. order within a
  // month does not matter.
  {
    const c = statement([shift('2026-08-31', -100), shift('2026-09-01', 30)], '2026-09-10');
    assert.equal(c.totals.owes, 70);
    const d1 = statement([shift('2026-09-02', 50), shift('2026-09-05', -80)], '2026-09-10');
    const d2 = statement([shift('2026-09-02', -80), shift('2026-09-05', 50)], '2026-09-10');
    assert.equal(d1.totals.owes, 30);
    assert.equal(d2.totals.owes, 30);
    console.log('PASS surplus pays older months, and order within a month does not matter');
  }

  // E. A correction that reduces a repaid shortage makes the difference
  // refundable; a refund uses it up.
  {
    const short = shift('2026-09-01', -100);
    const entries = [
      short,
      entry('repayment', '2026-09-02', -100, { refundable: true }),
      entry('correction', '2026-09-05', -40, { shift_id: short.shift_id, shift_date: '2026-09-01' }),
    ];
    let s = statement(entries, '2026-09-05');
    assert.equal(s.totals.owes, 0);
    assert.equal(s.totals.refundable, 40);
    assert.equal(s.rows[0].variance, -60);
    assert.equal(s.rows[0].closed_variance, -100);
    assert.equal(s.rows[0].corrected, true);
    s = statement([...entries, entry('refund', '2026-09-06', 40)], '2026-09-06');
    assert.equal(s.totals.refundable, 0);
    assert.equal(s.totals.owes, 0);
    console.log('PASS a correction frees a repayment as refundable; a refund uses it');
  }

  // F. A correction that frees surplus leaves it with the station, never
  // refundable.
  {
    const short = shift('2026-09-01', -100);
    const s = statement([
      short,
      shift('2026-09-03', 100),
      entry('correction', '2026-10-05', -40, { shift_id: short.shift_id, shift_date: '2026-09-01' }),
    ], '2026-10-05');
    assert.equal(s.totals.owes, 0);
    assert.equal(s.totals.refundable, 0);
    assert.equal(s.totals.kept_by_station, 40);
    console.log('PASS surplus freed by a correction stays with the station');
  }

  // G. A waiver never creates money owed to the employee.
  {
    const short = shift('2026-09-01', -100);
    const s = statement([
      short,
      entry('waiver', '2026-09-02', -100, { shift_id: short.shift_id }),
      entry('correction', '2026-09-03', -30, { shift_id: short.shift_id, shift_date: '2026-09-01' }),
    ], '2026-09-03');
    assert.equal(s.totals.owes, 0);
    assert.equal(s.totals.refundable, 0);
    const waiver = s.events.find((e) => e.type === 'waiver')!;
    assert.equal(waiver.applied, 70);
    assert.equal(waiver.unused, 30);
    console.log('PASS a waiver only writes off what is owed');
  }

  // H. Carried-over history: what the old system recovered in cash comes back
  // as refundable when a correction reduces the shortage; what it cleared
  // does not.
  {
    const old = shift('2026-08-28', -1362.32, { legacy_source: 'shift_close_reconciliations:93' });
    const legacy = (amount: number, refundable: boolean) =>
      entry('legacy_settlement', '2026-08-28', amount, { shift_id: old.shift_id, shift_date: '2026-08-28', refundable });
    let s = statement([old, legacy(-1203, true)], '2026-09-22');
    assert.equal(s.totals.owes, 159.32);
    assert.equal(s.rows[0].recovered_by.recovered_before, 1203);
    assert.equal(s.rows[0].before_variances, true);
    s = statement([old, legacy(-1203, true),
      entry('correction', '2026-09-22', -200, { shift_id: old.shift_id, shift_date: '2026-08-28' })], '2026-09-22');
    assert.equal(s.totals.owes, 0);
    assert.equal(s.totals.refundable, 40.68);

    const cleared = shift('2026-08-17', -428.56);
    const clear = entry('legacy_settlement', '2026-08-17', -428.56, { shift_id: cleared.shift_id, shift_date: '2026-08-17' });
    s = statement([cleared, clear,
      entry('correction', '2026-09-22', -100, { shift_id: cleared.shift_id, shift_date: '2026-08-17' })], '2026-09-22');
    assert.equal(s.totals.owes, 0);
    assert.equal(s.totals.refundable, 0);

    // Part cleared, part repaid: the cleared part goes first, so a reduction
    // frees the repaid part (the rule corrections used before).
    const mixed = shift('2026-08-20', -100);
    s = statement([
      mixed,
      entry('legacy_settlement', '2026-08-20', -30, { shift_id: mixed.shift_id, shift_date: '2026-08-20', refundable: true }),
      entry('legacy_settlement', '2026-08-20', -70, { shift_id: mixed.shift_id, shift_date: '2026-08-20', refundable: false }),
      entry('correction', '2026-09-22', -50, { shift_id: mixed.shift_id, shift_date: '2026-08-20' }),
    ], '2026-09-22');
    assert.equal(s.totals.refundable, 30);

    // A surplus the station kept before variances started.
    const kept = shift('2026-09-09', 500.6);
    s = statement([kept, entry('legacy_kept', '2026-09-09', 500.6, { shift_id: kept.shift_id, shift_date: '2026-09-09' })], '2026-09-22');
    assert.equal(s.totals.net, 0);
    assert.equal(s.rows[0].status, 'kept');
    assert.equal(s.rows[0].kept_by_station, 500.6);
    // Corrected later to a shortage of 100: the kept surplus was never real,
    // so only the shortage is owed.
    s = statement([kept, entry('legacy_kept', '2026-09-09', 500.6, { shift_id: kept.shift_id, shift_date: '2026-09-09' }),
      entry('correction', '2026-09-22', 600.6, { shift_id: kept.shift_id, shift_date: '2026-09-09' })], '2026-09-22');
    assert.equal(s.totals.owes, 100);
    assert.equal(s.rows[0].kept_by_station, 0);
    console.log('PASS carried-over recoveries follow the old refund rule');
  }

  // I. Money owed back pays the next shortage; reversing a repayment that was
  // refunded leaves the refund owed.
  {
    let s = statement([
      entry('legacy_owed_back', '2026-09-22', -0.05, { refundable: true }),
      shift('2026-09-23', -10),
    ], '2026-09-23');
    assert.equal(s.totals.owes, 9.95);
    const short = shift('2026-09-01', -100);
    const repayment = entry('repayment', '2026-09-02', -100, { refundable: true });
    const base = [
      short,
      repayment,
      entry('correction', '2026-09-05', -100, { shift_id: short.shift_id, shift_date: '2026-09-01' }),
      entry('refund', '2026-09-06', 100),
    ];
    assert.equal(statement(base, '2026-09-06').totals.net, 0);
    s = statement(base.map((e) => (e.id === repayment.id ? { ...e, status: 'reversed' } : e)), '2026-09-07');
    assert.equal(s.totals.owes, 100);
    console.log('PASS owed-back credit pays the next shortage; a refunded repayment reversed is owed');
  }
}

async function carryOver() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-variances-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'variances-test-desktop-key-0000';
  const { default: db } = await import('../src/database');
  const { getVarianceStatement } = await import('../src/services/employeeVariances');
  const { getKenyaDate } = await import('../src/utils/timezone');
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    // Everything up to, not including, the variances migration.
    for (;;) {
      const [, pending] = await db.migrate.list();
      const next = pending[0];
      const name = typeof next === 'string' ? next : next?.file || next?.name;
      if (!name || String(name).includes('047_employee_variances')) break;
      await db.migrate.up();
    }

    const person = async (name: string, role = 'attendant') => {
      const [id] = await db('employees').insert({ name, daily_wage: 800, pin: 'test-only', role, active: true });
      return id as number;
    };
    const mutati = await person('Mutati');
    const ema = await person('Ema');
    const francis = await person('Francis');
    const admin = await person('Owner', 'admin');
    let seq = 0;
    const closed = async (employee: number, date: string, variance: number | null) => {
      const [id] = await db('shifts').insert({ employee_id: employee, shift_date: date, start_time: `${date}T06:00:00Z`, status: 'closed', wage_paid: 800 });
      if (variance !== null) {
        await db('shift_close_reconciliations').insert({
          shift_id: id, readings_reviewed: true, collections_reviewed: true, entries_reviewed: true,
          expected_sales: 0, expected_shift_total: 0, cash_received: 0, mpesa_received: 0, credit_receipts: 0,
          credits_issued: 0, invoice_consumption: 0, expenses: 0, direct_wage_payment: 800, payroll_payments: 0,
          total_accounted: 0, variance, variance_type: variance < 0 ? 'deficit' : variance > 0 ? 'surplus' : 'balanced',
          approved_at: `${date}T20:00:00Z`,
        });
      }
      seq += 1;
      return id as number;
    };
    const debt = async (employee: number, shiftId: number, original: number, balance: number, fields: any = {}) => {
      const [id] = await db('staff_debts').insert({
        employee_id: employee, shift_id: shiftId, original_deficit: original, deducted_from_wage: 0,
        carried_forward: original, balance, status: balance > 0 ? 'outstanding' : 'cleared', recovery_status: 'confirmed', ...fields,
      });
      return id as number;
    };
    const [mutatiAccount] = await db('credit_accounts').insert({ name: 'Mutati', type: 'employee', employee_id: mutati, balance: 0 });

    // Before close snapshots: an old cleared debt and a fully wage-deducted
    // shortage are history only.
    const old = await closed(mutati, '2026-07-28', null);
    await debt(mutati, old, 282.87, 0);
    // From 17 Aug: wage-deducted at close, no debt row.
    const s72 = await closed(mutati, '2026-08-17', -83.63);
    await db('wage_deductions').insert({ shift_id: s72, employee_id: mutati, original_wage: 800, deduction_amount: 83.63, final_wage: 716.37, reason: 'Shift deficit of KES 83.63' });
    // A surplus the station kept.
    const s82 = await closed(mutati, '2026-08-18', 203.35);
    // Part deducted at close, repaid later: 1362.32 - 193.23 - 139.77 - 870 = 159.32.
    const s93 = await closed(mutati, '2026-08-28', -1362.32);
    const d93 = await debt(mutati, s93, 1362.32, 159.32, { deducted_from_wage: 193.23, carried_forward: 1169.09 });
    const s95 = await closed(mutati, '2026-08-30', -16.84);
    const [wd95] = await db('wage_deductions').insert({ shift_id: s95, employee_id: mutati, original_wage: 800, deduction_amount: 156.61, final_wage: 643.39, reason: 'Shift deficit of KES 16.84' });
    await db('shift_staff_debt_allocations').insert([
      { shift_id: s95, wage_deduction_id: wd95, staff_debt_id: d93, amount: 89.77 },
      { shift_id: s95, wage_deduction_id: wd95, staff_debt_id: d93, amount: 50 },
      { shift_id: s95, wage_deduction_id: wd95, staff_debt_id: d93, amount: 120, reversed_at: '2026-09-10T00:00:00Z' },
    ]);
    for (const [amount, date] of [[120, '2026-09-09'], [350, '2026-09-09'], [400, '2026-09-11']] as const) {
      const [paymentId] = await db('credit_payments').insert({ account_id: mutatiAccount, amount, payment_method: 'cash', payment_type: 'staff_debt', date, status: 'posted' });
      await db('staff_debt_receipt_allocations').insert({ payment_id: paymentId, staff_debt_id: d93, amount });
    }
    const s97 = await closed(mutati, '2026-09-01', -1951.99);
    await debt(mutati, s97, 1951.99, 1951.99);
    // A phantom debt that was voided on a surplus shift.
    const s105 = await closed(mutati, '2026-09-09', 11.04);
    await debt(mutati, s105, 338.96, 0, { status: 'voided' });
    const s107 = await closed(mutati, '2026-09-11', -101.46);
    await debt(mutati, s107, 101.46, 101.46);
    // Ema: cleared by the owner, and a large surplus.
    const s92 = await closed(ema, '2026-08-27', -4196.92);
    const d92 = await debt(ema, s92, 4196.92, 0);
    await db('staff_debt_reviews').insert({ staff_debt_id: d92, status: 'confirmed', reason: 'Administrative clearance of KES 4196.92 to zero.' });
    await closed(ema, '2026-08-18', 7091.58);
    // Francis: owed back 0.05 after an old correction.
    const s28 = await closed(francis, '2026-06-29', null);
    const [header] = await db('shift_accountability_adjustments').insert({ shift_id: s28, adjustment_type: 'historical_invoice_consumption_repair', amount_delta: 0.05, variance_before: -500.05, variance_after: -500, reason: 'repair' });
    await db('staff_debt_adjustments').insert({ shift_id: s28, employee_id: francis, accountability_adjustment_id: header, adjustment_type: 'employee_credit_review', amount: 0.05, status: 'review_required', reason: 'owed back' });
    // A payroll run not yet approved that still drafts a debt recovery.
    const [period] = await db('payroll_periods').insert({ name: 'September', pay_schedule: 'monthly', period_start: '2026-09-01', period_end: '2026-09-30', status: 'calculated' });
    const [run] = await db('payroll_runs').insert({ period_id: period, status: 'calculated', gross_total: 20000, deduction_total: 500, net_total: 19500, paid_total: 0 });
    const [line] = await db('payroll_lines').insert({ run_id: run, employee_id: ema, gross_earnings: 20000, total_deductions: 500, net_pay: 19500, paid_amount: 0, balance_due: 19500, status: 'unpaid', recovery_review: '{"amount":500}' });
    await db('payroll_deductions').insert({ payroll_line_id: line, employee_id: ema, deduction_type: 'staff_debt', amount: 500, status: 'draft' });

    await db.migrate.latest();

    const m = await getVarianceStatement(db, mutati);
    assert.equal(m.totals.owes, 2212.77);
    assert.equal(m.totals.net, 2212.77);
    const row = (id: number) => m.rows.find((r) => r.shift_id === id)!;
    assert.equal(row(s93).real_variance, -159.32);
    assert.equal(row(s93).recovered, 1203);
    assert.equal(row(s93).recovered_by.recovered_before, 1203);
    assert.equal(row(s97).real_variance, -1951.99);
    assert.equal(row(s107).real_variance, -101.46);
    assert.equal(row(s72).status, 'settled');
    assert.equal(row(s72).recovered_by.recovered_before, 83.63);
    assert.equal(row(s82).status, 'kept');
    assert.equal(row(s105).kept_by_station, 11.04);
    assert.equal(m.rows.some((r) => r.shift_id === old), false, 'shifts before close figures stay in the old history');
    for (const r of m.rows) assert.equal(r.before_variances, true);

    const e = await getVarianceStatement(db, ema);
    assert.equal(e.totals.net, 0);
    assert.equal(e.rows.find((r) => r.shift_id === s92)!.recovered_by.cleared_before, 4196.92);
    const f = await getVarianceStatement(db, francis);
    assert.equal(f.totals.refundable, 0.05);
    assert.equal(f.totals.net, -0.05);
    const owedBack = await db('staff_debt_adjustments').where({ shift_id: s28 }).first();
    assert.equal(owedBack.status, 'migrated');
    assert.equal(owedBack.settlement_method, 'variance_ledger');

    // Nothing in the old tables changed except those two records.
    assert.equal(Number((await db('staff_debts').where({ id: d93 }).first()).balance), 159.32);
    const draft = await db('payroll_deductions').where({ payroll_line_id: line }).first();
    assert.equal(draft.status, 'reversed');
    const refreshed = await db('payroll_lines').where({ id: line }).first();
    assert.equal(Number(refreshed.total_deductions), 0);
    assert.equal(Number(refreshed.balance_due), 20000);
    assert.equal(refreshed.recovery_review, null);
    assert.equal(Number((await db('payroll_runs').where({ id: run }).first()).deduction_total), 0);
    const started = await db('operational_settings').where({ key: 'variance_ledger_started_on' }).first();
    assert.match(String(started?.value), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(admin && seq > 0);
    console.log('PASS old staff debts carry over to the cent, with every shift since 17 Aug listed');

    // ---- The real close route: pays in full, posts the variance, no recovery ----
    const { default: shiftsRouter } = await import('../src/routes/shifts');
    const app = express();
    app.use(express.json());
    app.use('/shifts', shiftsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const attendant = await person('Close Test');
    const [plan] = await db('employee_compensation_plans').insert({
      employee_id: attendant, name: 'Daily', pay_schedule: 'daily', effective_from: '2026-01-01', version: 1, status: 'active',
    });
    await db('employee_compensation_components').insert({ plan_id: plan, component_type: 'fixed_per_shift', amount: 800 });
    const [tank] = await db('tanks').insert({ label: 'Petrol Tank', fuel_type: 'petrol', capacity_litres: 10000 });
    const [pump] = await db('pumps').insert({ label: 'Pump 1', nozzle_label: 'P1', fuel_type: 'petrol', tank_id: tank, active: true });
    const today = getKenyaDate();
    const [open] = await db('shifts').insert({
      employee_id: attendant, compensation_plan_id: plan, shift_date: today,
      start_time: new Date(Date.now() - 3600 * 1000).toISOString(), status: 'open', wage_paid: 0,
    });
    await db('pump_readings').insert({ shift_id: open, pump_id: pump, opening_litres: 0, closing_litres: 50, opening_amount: 0, closing_amount: 10000, litres_sold: 50, amount_sold: 10000 });
    await db('shift_collections').insert({ shift_id: open, cash_amount: 9000, mpesa_amount: 0, credits_amount: 0, total_collected: 9000 });
    // Sold 10,000; 9,000 counted and the 800 wage paid from the drawer: short 200.
    const closeResponse = await fetch(`http://127.0.0.1:${port}/shifts/${open}/close`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-desktop-key': process.env.DESKTOP_KEY! },
      body: JSON.stringify({
        wage_paid: 800,
        reconciliation: { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true },
        // What a phone on an older bundle might still send: ignored.
        recovery_decision: { version: 'a'.repeat(64), amount: 200 },
      }),
    });
    assert.equal(closeResponse.status, 200, await closeResponse.text());
    const closedShift = await db('shifts').where({ id: open }).first();
    assert.deepEqual([closedShift.status, Number(closedShift.wage_paid), Number(closedShift.direct_wage_cash_amount), closedShift.recovery_review],
      ['closed', 800, 800, null], 'the wage is paid in full and nothing is recovered');
    const posted = await db('employee_variance_entries').where({ shift_id: open, entry_type: 'shift' }).first();
    assert.deepEqual([Number(posted.amount), String(posted.entry_date).slice(0, 10)], [200, today]);
    assert.equal((await getVarianceStatement(db, attendant)).totals.owes, 200);
    assert.equal((await db('staff_debts').where({ shift_id: open })).length, 0, 'no old staff debt is written');
    assert.equal((await db('credit_payments').where({ payment_type: 'staff_debt', date: today })).length, 0, 'no repayment is taken at close');
    console.log('PASS closing a shift pays the wage in full and posts its variance; nothing is recovered');
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await db.destroy();
  }
}

async function main() {
  await netting();
  await carryOver();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
