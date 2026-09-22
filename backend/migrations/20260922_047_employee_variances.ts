import type { Knex } from 'knex';

// Attendant variances (services/employeeVariances.ts). Every closed shift's
// over/short is posted to the attendant's own variance account, which also
// holds their repayments, waivers and refunds. Pay is never reduced for it and
// shift close no longer asks for a recovery.
//
// Entries are never edited: a mistaken one is marked reversed. What an
// attendant owes, and what recovered each shift, is derived from the entries on
// every read, so there are no balances here to drift.
//
// The old staff-debt tables are not touched. Their state is carried over as
// entries: one row per shift from 17 Aug 2026 (when close figures began to be
// stored) and per shift that still has debt, each with a "legacy settlement"
// for whatever the old system recovered or cleared. Every row, and every
// employee's total, must come out exactly as the old records say, or this
// migration stops and changes nothing.

const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const kenyaDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const kes = (value: number) => `KES ${(value / 100).toFixed(2)}`;

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('employee_variance_entries')) return;

  await knex.schema.createTable('employee_variance_entries', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable()
      .references('id').inTable('employees').onDelete('RESTRICT');
    // shift | correction | repayment | waiver | refund
    // | legacy_settlement | legacy_kept | legacy_owed_back | legacy_reversal
    table.string('entry_type').notNullable();
    table.date('entry_date').notNullable();
    // What the entry does to what the employee owes: + more, - less.
    table.decimal('amount', 14, 2).notNullable();
    // Money the employee actually handed over: it can be paid back to them if
    // it ends up covering nothing.
    table.boolean('refundable').notNullable().defaultTo(false);
    table.integer('shift_id').unsigned().nullable()
      .references('id').inTable('shifts').onDelete('RESTRICT');
    table.integer('payment_id').unsigned().nullable()
      .references('id').inTable('credit_payments').onDelete('RESTRICT');
    table.integer('correction_id').unsigned().nullable()
      .references('id').inTable('shift_accountability_adjustments').onDelete('RESTRICT');
    table.string('method').nullable();
    table.string('reference').nullable();
    table.text('reason').nullable();
    table.text('details').nullable();
    table.string('legacy_source').nullable();
    table.integer('approved_by_employee_id').unsigned().nullable()
      .references('id').inTable('employees').onDelete('SET NULL');
    table.string('approved_by_name').nullable();
    table.integer('created_by_employee_id').unsigned().nullable()
      .references('id').inTable('employees').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.string('status').notNullable().defaultTo('posted');
    table.timestamp('reversed_at').nullable();
    table.integer('reversed_by_employee_id').unsigned().nullable()
      .references('id').inTable('employees').onDelete('SET NULL');
    table.text('reversal_reason').nullable();
    table.integer('reversed_by_correction_id').unsigned().nullable();
    table.index(['employee_id', 'entry_date'], 'idx_variance_entries_employee_date');
    table.index(['shift_id'], 'idx_variance_entries_shift');
    table.index(['entry_type', 'entry_date'], 'idx_variance_entries_type_date');
  });
  await knex.raw(
    `CREATE UNIQUE INDEX uq_variance_shift_entry ON employee_variance_entries (shift_id, employee_id)
     WHERE entry_type = 'shift' AND status = 'posted'`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_variance_repayment ON employee_variance_entries (payment_id)
     WHERE entry_type = 'repayment' AND status = 'posted'`,
  );

  await carryOverStaffDebts(knex);
}

type Key = { employeeId: number; shiftId: number };

async function carryOverStaffDebts(knex: Knex) {
  const startedOn = kenyaDate();
  const shifts = new Map<number, any>(
    (await knex('shifts').select('id', 'employee_id', 'shift_date', 'start_time', 'status'))
      .map((s: any) => [Number(s.id), s]),
  );
  const shiftDate = (id: number) => {
    const s = shifts.get(id);
    return String(s?.shift_date || s?.start_time || startedOn).slice(0, 10);
  };

  // The variance each closed shift's attendant is accountable for: the close
  // snapshot plus every later adjustment, except the 2026-09-10 recovery repair,
  // which rewrote the snapshot itself (same rule as shiftCorrections.ts).
  const snapshots = await knex('shift_close_reconciliations as r')
    .join('shifts as s', 'r.shift_id', 's.id')
    .where('s.status', 'closed')
    .select('r.shift_id', 'r.variance');
  const moved = new Map<number, number>();
  for (const a of await knex('shift_accountability_adjustments')
    .whereNot({ adjustment_type: 'recovery_mechanism_correction' })
    .select('shift_id', 'variance_before', 'variance_after')) {
    const id = Number(a.shift_id);
    moved.set(id, (moved.get(id) || 0) + cents(a.variance_after) - cents(a.variance_before));
  }
  const accountable = new Map<number, number>();
  for (const s of snapshots) {
    accountable.set(Number(s.shift_id), cents(s.variance) + (moved.get(Number(s.shift_id)) || 0));
  }

  const debts = await knex('staff_debts').select('*');
  const debtsByKey = new Map<string, any[]>();
  const keyOf = (k: Key) => `${k.employeeId}:${k.shiftId}`;
  for (const d of debts) {
    const key = keyOf({ employeeId: Number(d.employee_id), shiftId: Number(d.shift_id) });
    debtsByKey.set(key, [...(debtsByKey.get(key) || []), d]);
  }

  const keys = new Map<string, Key>();
  for (const [shiftId, variance] of accountable) {
    const shift = shifts.get(shiftId);
    if (!shift) continue;
    const key = { employeeId: Number(shift.employee_id), shiftId };
    if (variance !== 0 || debtsByKey.has(keyOf(key))) keys.set(keyOf(key), key);
  }
  for (const d of debts) {
    if (d.status === 'outstanding' && cents(d.balance) !== 0) {
      const key = { employeeId: Number(d.employee_id), shiftId: Number(d.shift_id) };
      keys.set(keyOf(key), key);
    }
  }

  const sumAllocations = async (table: string, debtIds: number[], joinPayments = false) => {
    if (!debtIds.length || !(await knex.schema.hasTable(table))) return 0;
    const query = knex(`${table} as a`).whereIn('a.staff_debt_id', debtIds).whereNull('a.reversed_at');
    if (joinPayments) query.join('credit_payments as p', 'a.payment_id', 'p.id').where('p.status', 'posted');
    const row: any = await query.sum({ total: 'a.amount' }).first();
    return cents(row?.total);
  };

  const ordered = [...keys.values()].sort(
    (a, b) => shiftDate(a.shiftId).localeCompare(shiftDate(b.shiftId)) || a.shiftId - b.shiftId || a.employeeId - b.employeeId,
  );
  const expectedByEmployee = new Map<number, number>();
  for (const key of ordered) {
    const own = debtsByKey.get(keyOf(key)) || [];
    const live = own.filter((d) => d.status !== 'voided');
    const outstanding = own
      .filter((d) => d.status === 'outstanding')
      .reduce((sum, d) => sum + cents(d.balance), 0);
    const shift = shifts.get(key.shiftId);
    const hasSnapshot = accountable.has(key.shiftId) && Number(shift?.employee_id) === key.employeeId;
    // Owed delta of the shift itself: a shortage is owed, a surplus is not.
    const shiftAmount = hasSnapshot
      ? -(accountable.get(key.shiftId) || 0)
      : live.reduce((sum, d) => sum + cents(d.original_deficit), 0);
    const date = shiftDate(key.shiftId);
    if (shiftAmount === 0 && outstanding === 0) continue;

    await knex('employee_variance_entries').insert({
      employee_id: key.employeeId,
      entry_type: 'shift',
      entry_date: date,
      amount: shiftAmount / 100,
      shift_id: key.shiftId,
      reason: hasSnapshot ? 'Variance approved when the shift closed' : 'Shortage recorded as staff debt',
      legacy_source: hasSnapshot ? `shift_close_reconciliations:${key.shiftId}` : `staff_debts:${live.map((d) => d.id).join(',')}`,
    });

    // Whatever the old system did about it, as one targeted entry (two when
    // part of it was money the employee handed over and part was not).
    const settle = shiftAmount - outstanding;
    if (settle === 0) {
      expectedByEmployee.set(key.employeeId, (expectedByEmployee.get(key.employeeId) || 0) + outstanding);
      continue;
    }
    const debtIds = own.map((d) => Number(d.id));
    let wageAtClose = live.reduce((sum, d) => sum + cents(d.deducted_from_wage), 0);
    if (!own.length && shiftAmount > 0) {
      const row: any = await knex('wage_deductions')
        .where({ shift_id: key.shiftId, employee_id: key.employeeId })
        .whereNull('deleted_at')
        .where('reason', 'like', 'Shift deficit%')
        .sum({ total: 'deduction_amount' })
        .first();
      wageAtClose = cents(row?.total);
    }
    const wageLater = await sumAllocations('shift_staff_debt_allocations', debtIds);
    const repaid = await sumAllocations('staff_debt_receipt_allocations', debtIds, true);
    const payroll = await sumAllocations('payroll_debt_allocations', debtIds);
    const handedOver = wageAtClose + wageLater + repaid + payroll;
    const details = {
      shortage: shiftAmount > 0 ? shiftAmount / 100 : 0,
      surplus: shiftAmount < 0 ? -shiftAmount / 100 : 0,
      outstanding: outstanding / 100,
      deducted_from_wage_at_close: wageAtClose / 100,
      deducted_from_later_wages: wageLater / 100,
      repaid: repaid / 100,
      payroll: payroll / 100,
      staff_debt_ids: debtIds,
    };
    const base = {
      employee_id: key.employeeId,
      entry_type: 'legacy_settlement',
      entry_date: date,
      shift_id: key.shiftId,
      legacy_source: `staff_debts:${debtIds.join(',') || 'none'}`,
    };

    if (shiftAmount < 0 || settle < 0) {
      // A surplus the station kept (the rule until now). It can only take
      // surplus that is there, so a later correction can't turn it into debt.
      if (shiftAmount < 0) {
        await knex('employee_variance_entries').insert({
          ...base,
          entry_type: 'legacy_kept',
          amount: -shiftAmount / 100,
          reason: 'Surplus kept by the station (before variances were netted)',
          details: JSON.stringify({ ...details, kept_by_station: -shiftAmount / 100 }),
        });
      }
      // Anything still owed on that shift beyond its own shortage.
      const owedBeyond = shiftAmount < 0 ? outstanding : outstanding - shiftAmount;
      if (owedBeyond > 0) {
        await knex('employee_variance_entries').insert({
          ...base,
          amount: owedBeyond / 100,
          reason: `Still owed under the old debt system: ${kes(owedBeyond)}`,
          details: JSON.stringify(details),
        });
      }
    } else {
      const cash = Math.min(settle, handedOver);
      const other = settle - cash;
      if (other > 0) {
        await knex('employee_variance_entries').insert({
          ...base,
          amount: -other / 100,
          reason: 'Cleared under the old debt system (owner clearance or adjustment)',
          details: JSON.stringify({ ...details, cleared: other / 100 }),
        });
      }
      if (cash > 0) {
        await knex('employee_variance_entries').insert({
          ...base,
          amount: -cash / 100,
          refundable: true,
          reason: 'Recovered under the old debt system (wage deductions and repayments)',
          details: JSON.stringify({ ...details, recovered: cash / 100 }),
        });
      }
    }
    expectedByEmployee.set(key.employeeId, (expectedByEmployee.get(key.employeeId) || 0) + outstanding);
  }

  // Money owed back to employees after a correction (not yet paid) carries
  // over as their refundable credit.
  const owedBack = await knex('staff_debt_adjustments')
    .where({ adjustment_type: 'employee_credit_review', status: 'review_required' })
    .select('*')
    .orderBy('id');
  for (const row of owedBack) {
    const employeeId = Number(row.employee_id || shifts.get(Number(row.shift_id))?.employee_id);
    if (!employeeId) throw new Error(`Owed-back entry #${row.id} has no employee. Nothing was changed.`);
    const [entryId] = await knex('employee_variance_entries').insert({
      employee_id: employeeId,
      entry_type: 'legacy_owed_back',
      entry_date: startedOn,
      amount: -cents(row.amount) / 100,
      refundable: true,
      shift_id: row.shift_id || null,
      reason: row.reason || 'Owed back to the employee after a correction',
      legacy_source: `staff_debt_adjustments:${row.id}`,
    });
    await knex('staff_debt_adjustments').where({ id: row.id }).update({
      status: 'migrated',
      settlement_method: 'variance_ledger',
      settlement_reference: `employee_variance_entries:${entryId}`,
      settled_at: new Date().toISOString(),
      settlement_date: startedOn,
    });
    expectedByEmployee.set(employeeId, (expectedByEmployee.get(employeeId) || 0) - cents(row.amount));
  }

  // Every employee's carried-over total must equal what the old records say
  // they owe (less what was owed back to them), to the cent.
  const outstandingByEmployee = new Map<number, number>();
  for (const d of debts) {
    if (d.status !== 'outstanding') continue;
    const id = Number(d.employee_id);
    outstandingByEmployee.set(id, (outstandingByEmployee.get(id) || 0) + cents(d.balance));
  }
  for (const row of owedBack) {
    const id = Number(row.employee_id || shifts.get(Number(row.shift_id))?.employee_id);
    outstandingByEmployee.set(id, (outstandingByEmployee.get(id) || 0) - cents(row.amount));
  }
  const ledger = await knex('employee_variance_entries').select('employee_id').sum({ total: 'amount' }).groupBy('employee_id');
  const ledgerByEmployee = new Map<number, number>(ledger.map((r: any) => [Number(r.employee_id), cents(r.total)]));
  for (const id of new Set([...outstandingByEmployee.keys(), ...ledgerByEmployee.keys()])) {
    const expected = outstandingByEmployee.get(id) || 0;
    const actual = ledgerByEmployee.get(id) || 0;
    if (expected !== actual || (expectedByEmployee.get(id) || 0) !== actual) {
      throw new Error(
        `Employee #${id}: the old records say ${kes(expected)}, the carried-over variances total ${kes(actual)}. Nothing was changed.`,
      );
    }
  }

  // Debt recovery drafted on a payroll run that is not approved yet would take
  // money from pay. Variances are no longer deducted, so it is cancelled.
  const drafts = await knex('payroll_deductions')
    .where({ deduction_type: 'staff_debt', status: 'draft' })
    .select('id', 'payroll_line_id', 'notes');
  for (const d of drafts) {
    await knex('payroll_deductions').where({ id: d.id }).update({
      status: 'reversed',
      reversed_at: knex.fn.now(),
      notes: `${d.notes ? `${d.notes} ` : ''}[Cancelled: variances are repaid separately, never deducted from pay]`,
    });
  }
  const lineIds = [...new Set(drafts.map((d: any) => Number(d.payroll_line_id)))];
  const runIds = new Set<number>();
  for (const lineId of lineIds) {
    const line = await knex('payroll_lines').where({ id: lineId }).first();
    const deductionRow: any = await knex('payroll_deductions')
      .where({ payroll_line_id: lineId }).whereNot({ status: 'reversed' }).sum({ total: 'amount' }).first();
    const paymentRow: any = await knex('payroll_payments')
      .where({ payroll_line_id: lineId, status: 'posted' }).sum({ total: 'amount' }).first();
    const deductions = cents(deductionRow?.total);
    const net = cents(line.gross_earnings) - deductions;
    const paid = cents(paymentRow?.total);
    const balance = Math.max(0, net - paid);
    await knex('payroll_lines').where({ id: lineId }).update({
      total_deductions: deductions / 100,
      net_pay: net / 100,
      paid_amount: paid / 100,
      balance_due: balance / 100,
      status: balance <= 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid',
      recovery_review: null,
    });
    runIds.add(Number(line.run_id));
  }
  for (const runId of runIds) {
    const totals: any = await knex('payroll_lines').where({ run_id: runId })
      .sum({ gross: 'gross_earnings', deductions: 'total_deductions', net: 'net_pay', paid: 'paid_amount' })
      .first();
    await knex('payroll_runs').where({ id: runId }).update({
      gross_total: cents(totals?.gross) / 100,
      deduction_total: cents(totals?.deductions) / 100,
      net_total: cents(totals?.net) / 100,
      paid_total: cents(totals?.paid) / 100,
    });
  }

  const settings = { variance_ledger_started_on: startedOn, variance_ledger_started_at: new Date().toISOString() };
  if (await knex.schema.hasTable('operational_settings')) {
    for (const [key, value] of Object.entries(settings)) {
      await knex('operational_settings')
        .insert({ key, value, updated_at: knex.fn.now() })
        .onConflict('key')
        .merge();
    }
  }
}

export async function down(): Promise<void> {
  throw new Error(
    'Attendant variance history must be preserved. Restore a verified pre-update backup only before new financial activity.',
  );
}
