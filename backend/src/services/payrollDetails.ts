import type { Knex } from 'knex';
import { money, recoveryPreview, employeeDebtSummary } from './employeeDebt';

export async function payrollRecoveryPreview(
  lineId: number,
  db: Knex | Knex.Transaction,
) {
  const line = await db('payroll_lines').where({ id: lineId }).first();
  const deductions = await db('payroll_deductions')
    .where({ payroll_line_id: lineId })
    .whereNot({ status: 'reversed' });
  const payments = await db('payroll_payments').where({
    payroll_line_id: lineId,
    status: 'posted',
  });
  const other = money(
    deductions
      .filter(
        (d) => !(d.deduction_type === 'staff_debt' && d.status === 'draft'),
      )
      .reduce((s, d) => s + Number(d.amount), 0),
  );
  const paid = money(payments.reduce((s, p) => s + Number(p.amount), 0));
  return recoveryPreview(
    Number(line.employee_id),
    money(Number(line.gross_earnings) - other - paid),
    db,
    {
      line: line.id,
      other: deductions
        .filter((d) => d.deduction_type !== 'staff_debt')
        .map((d) => [d.id, d.amount, d.status]),
      payments: payments.map((p) => [p.id, p.amount]),
    },
  );
}

// Allocations describe how a recorded payment/offset settles earnings, not cash handed over on each source shift.
export async function allocatePayrollSettlements(
  lineId: number,
  db: Knex.Transaction | Knex,
) {
  const line = await db('payroll_lines').where({ id: lineId }).first();
  if (!line?.settlement_version) return;
  const earnings = await db('payroll_line_earnings as l')
    .join('employee_earnings as e', 'l.earning_id', 'e.id')
    .where({ 'l.payroll_line_id': lineId })
    .whereNull('l.released_at')
    .select('e.*')
    .orderBy('e.earning_date')
    .orderBy('e.id');
  const deductions = await db('payroll_deductions')
    .where({ payroll_line_id: lineId, status: 'approved' })
    .orderBy('id');
  const payments = await db('payroll_payments')
    .where({ payroll_line_id: lineId, status: 'posted' })
    .orderBy('payment_date')
    .orderBy('id');
  const sources: any[] = [
    ...deductions.map((d) => ({
      type: 'deduction',
      id: d.id,
      amount: d.amount,
      deduction_id: /^SHIFT-WAGE-DEDUCTION:/.test(
        d.authorization_reference || '',
      )
        ? Number(d.authorization_reference.split(':')[1])
        : null,
    })),
    ...payments.map((p) => ({
      type: 'payment',
      id: p.id,
      amount: p.amount,
      shift_id: /^SHIFT-WAGE:/.test(p.reference || '') ? p.shift_id : null,
    })),
  ];
  for (const source of sources.filter((s) => s.deduction_id)) {
    const d = await db('wage_deductions')
      .where({ id: source.deduction_id })
      .first();
    source.shift_id = d?.shift_id;
  }
  let existing = await db('payroll_settlement_allocations')
    .where({ payroll_line_id: lineId })
    .whereNull('reversed_at');
  for (const row of existing) {
    if (
      !sources.some(
        (s) =>
          s.type === row.source_type && Number(s.id) === Number(row.source_id),
      )
    ) {
      await db('payroll_settlement_allocations')
        .where({ id: row.id })
        .update({ reversed_at: db.fn.now() });
    }
  }
  existing = await db('payroll_settlement_allocations')
    .where({ payroll_line_id: lineId })
    .whereNull('reversed_at');
  const available = new Map<number, number>(
    earnings.map((e) => [
      Number(e.id),
      money(
        Number(e.gross_amount) -
          existing
            .filter((a) => Number(a.earning_id) === Number(e.id))
            .reduce((s, a) => s + Number(a.amount), 0),
      ),
    ]),
  );
  // Anchor direct shift settlements before assigning general payroll payments oldest first.
  sources.sort(
    (a, b) => Number(Boolean(b.shift_id)) - Number(Boolean(a.shift_id)),
  );
  for (const source of sources) {
    let remaining = money(
      Number(source.amount) -
        existing
          .filter(
            (a) =>
              a.source_type === source.type &&
              Number(a.source_id) === Number(source.id),
          )
          .reduce((s, a) => s + Number(a.amount), 0),
    );
    const candidates = source.shift_id
      ? earnings.filter((e) => Number(e.shift_id) === Number(source.shift_id))
      : earnings;
    for (const earning of candidates) {
      if (remaining <= 0) break;
      const amount = money(
        Math.min(
          remaining,
          Math.max(0, available.get(Number(earning.id)) || 0),
        ),
      );
      if (!amount) continue;
      await db('payroll_settlement_allocations').insert({
        payroll_line_id: lineId,
        earning_id: earning.id,
        source_type: source.type,
        source_id: source.id,
        amount,
      });
      available.set(
        Number(earning.id),
        money((available.get(Number(earning.id)) || 0) - amount),
      );
      remaining = money(remaining - amount);
    }
    if (remaining > 0)
      throw new Error(
        'Settlement exceeds the available source earnings. Reconcile this payroll before continuing.',
      );
  }
}

export async function enrichPayrollLine(
  line: any,
  db: Knex | Knex.Transaction,
) {
  const planIds = [
    ...new Set(line.earnings.map((e: any) => e.plan_id).filter(Boolean)),
  ] as number[];
  const plans = planIds.length
    ? await db('employee_compensation_plans').whereIn('id', planIds)
    : [];
  const components = planIds.length
    ? await db('employee_compensation_components').whereIn('plan_id', planIds)
    : [];
  const allocations = await db('payroll_settlement_allocations')
    .where({ payroll_line_id: line.id })
    .whereNull('reversed_at');
  const groups = new Map<string, any>();
  for (const earning of line.earnings) {
    earning.plan =
      plans.find((p) => Number(p.id) === Number(earning.plan_id)) || null;
    earning.component =
      components.find((c) => Number(c.id) === Number(earning.component_id)) ||
      null;
    const key = earning.shift_id
      ? `shift:${earning.shift_id}`
      : `period:${earning.plan_id}`;
    const row = groups.get(key) || {
      key,
      shift_id: earning.shift_id,
      date: earning.earning_date,
      plan: earning.plan,
      components: [],
      gross: 0,
      paid: 0,
      deductions: 0,
      legacy: !line.settlement_version,
    };
    row.components.push(earning);
    row.gross = money(row.gross + Number(earning.gross_amount));
    row.paid = money(
      row.paid +
        allocations
          .filter(
            (a) => a.earning_id === earning.id && a.source_type === 'payment',
          )
          .reduce((s, a) => s + Number(a.amount), 0),
    );
    row.deductions = money(
      row.deductions +
        allocations
          .filter(
            (a) => a.earning_id === earning.id && a.source_type === 'deduction',
          )
          .reduce((s, a) => s + Number(a.amount), 0),
    );
    row.remaining = row.legacy
      ? null
      : money(row.gross - row.paid - row.deductions);
    groups.set(key, row);
  }
  line.shift_details = [...groups.values()].sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      Number(a.shift_id || 0) - Number(b.shift_id || 0),
  );
  line.shift_count = line.shift_details.filter((r: any) => r.shift_id).length;
  line.recovery = await payrollRecoveryPreview(line.id, db);
  line.recovery_review = line.recovery_review
    ? JSON.parse(line.recovery_review)
    : null;
  line.debt_allocations = await db('payroll_debt_allocations as a')
    .join('payroll_deductions as d', 'a.deduction_id', 'd.id')
    .join('staff_debts as debt', 'a.staff_debt_id', 'debt.id')
    .where({ 'd.payroll_line_id': line.id })
    .select('a.*', 'debt.shift_id', 'debt.created_at as debt_date');
  line.warnings = [];
  for (const payment of line.payments.filter(
    (p: any) => p.status === 'posted' && /^SHIFT-WAGE:/.test(p.reference || ''),
  )) {
    const shift = await db('shifts').where({ id: payment.shift_id }).first();
    if (
      shift &&
      Number(shift.wage_paid || 0) === 0 &&
      shift.direct_wage_cash_amount == null &&
      Number(payment.amount) > 0
    ) {
      line.warnings.push(
        `Earlier payment of KES ${money(payment.amount).toFixed(2)} on shift #${payment.shift_id} conflicts with its zero recorded wage. Verify actual cash before correcting.`,
      );
    }
  }
  if (!line.settlement_version)
    line.warnings.push(
      'Historical payroll: per-shift settlement allocations were not recorded. Period payment totals are shown without inventing individual shift payments.',
    );
  return line;
}
