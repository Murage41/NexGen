import type { Knex } from 'knex';
import { getKenyaDate } from '../utils/timezone';
import { positiveMoney, settlementError } from './employeeDebt';
import type { Approver } from './approval';

// Attendant variances: every closed shift's over/short, owed by (or in favour
// of) the attendant who ran it. Pay is never reduced for it; the employee
// repays separately. See docs/ATTENDANT-VARIANCES.md.
//
// Entries (employee_variance_entries) are immutable; a mistaken one is marked
// reversed. Nothing here stores a balance: what recovered each shift and what
// is owed are derived from the entries on every read by
// computeVarianceStatement, oldest first:
//
// - A shortage is owed. A surplus pays whatever is owed at that point; the rest
//   can pay later shortages in the same month and stays with the station at
//   month end. A surplus is never paid out in cash (owner decision 2026-09-22).
// - A repayment pays what is owed, oldest first. What it doesn't cover is the
//   employee's money: it pays their next shortages, or is refunded.
// - A waiver writes off what is owed (a loss the station takes). It never
//   creates money owed to the employee.
// - A closed-shift correction changes its shift's variance, so what covered
//   that shift is recalculated: freed surplus stays with the station, freed
//   repayments become refundable.

type Conn = Knex | Knex.Transaction;
type Trx = Knex.Transaction;

export const VARIANCE_REPAYMENT_METHODS = ['cash', 'mpesa', 'bank_transfer'] as const;
export const VARIANCE_REFUND_METHODS = ['cash', 'mpesa'] as const;

export type VarianceEntry = {
  id: number;
  employee_id: number;
  entry_type: string;
  entry_date: string;
  amount: number;
  refundable?: boolean | number | null;
  shift_id?: number | null;
  shift_date?: string | null;
  payment_id?: number | null;
  correction_id?: number | null;
  method?: string | null;
  reference?: string | null;
  reason?: string | null;
  details?: any;
  legacy_source?: string | null;
  approved_by_name?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
  status?: string | null;
};

const toCents = (value: unknown) => Math.round(Number(value || 0) * 100);
const toMoney = (cents: number) => cents / 100;
const monthOf = (date: string) => String(date || '').slice(0, 7);
const kes = (value: number) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// How a shortage was covered, in cents while computing.
type Covered = {
  surplus: number;
  repaid: number;
  waived: number;
  recovered_before: number;
  cleared_before: number;
};
const emptyCovered = (): Covered => ({ surplus: 0, repaid: 0, waived: 0, recovered_before: 0, cleared_before: 0 });

type Owner = { covered: Covered; charges: Charge[] };
type Charge = { owner: Owner; remaining: number };
type RowState = Owner & {
  shift_id: number;
  date: string;
  seq: number;
  amount: number;
  closed: number;
  entries: VarianceEntry[];
  legacy: EventState[];
  surplus_used: number;
  kept_by_station: number;
  lapsed: number;
  pool: PoolItem | null;
};
type EventState = Owner & { entry: VarianceEntry; applied: number; unused: number };
type PoolItem = { row: RowState; remaining: number; month: string };
type CashItem = { owner: EventState; remaining: number; kind: 'repaid' | 'recovered_before' };

export type VarianceRow = ReturnType<typeof rowView>;
export type VarianceStatement = ReturnType<typeof computeVarianceStatement>;

function rowView(row: RowState) {
  const owed = row.charges.reduce((sum, c) => sum + c.remaining, 0);
  const available = row.pool?.remaining || 0;
  const covered = row.covered;
  const recovered = covered.surplus + covered.repaid + covered.waived + covered.recovered_before + covered.cleared_before;
  const corrections = row.entries.filter((e) => e.entry_type === 'correction');
  const isShortage = row.amount > 0;
  return {
    shift_id: row.shift_id,
    date: row.date,
    // Signed like the shift page: negative = short, positive = over.
    variance: toMoney(-row.amount),
    closed_variance: toMoney(-row.closed),
    corrected: corrections.length > 0,
    corrections: corrections.map((e) => ({
      id: e.id,
      correction_id: e.correction_id ?? null,
      date: e.entry_date,
      change: toMoney(-toCents(e.amount)),
      reason: e.reason || null,
    })),
    recovered: toMoney(recovered),
    recovered_by: {
      surplus: toMoney(covered.surplus),
      repaid: toMoney(covered.repaid),
      waived: toMoney(covered.waived),
      recovered_before: toMoney(covered.recovered_before),
      cleared_before: toMoney(covered.cleared_before),
    },
    surplus_used: toMoney(row.surplus_used),
    kept_by_station: toMoney(row.kept_by_station),
    available: toMoney(available),
    owed: toMoney(owed),
    // What is left: negative = still owed, positive = surplus still usable.
    real_variance: toMoney(available - owed),
    status: isShortage
      ? (owed > 0 ? 'open' : 'settled')
      : row.amount < 0
        ? (available > 0 ? 'available' : row.kept_by_station > 0 ? 'kept' : 'used')
        : (owed > 0 ? 'open' : 'settled'),
    before_variances: row.legacy.length > 0 || row.entries.some((e) => Boolean(e.legacy_source)),
    legacy: row.legacy.map((ev) => ({
      id: ev.entry.id,
      amount: toMoney(toCents(ev.entry.amount)),
      reason: ev.entry.reason || null,
      details: ev.entry.details ?? null,
    })),
  };
}

function eventView(ev: EventState) {
  const e = ev.entry;
  const owed = ev.charges.reduce((sum, c) => sum + c.remaining, 0);
  return {
    id: e.id,
    type: e.entry_type,
    date: e.entry_date,
    amount: Math.abs(toMoney(toCents(e.amount))),
    shift_id: e.shift_id ?? null,
    payment_id: e.payment_id ?? null,
    method: e.method || null,
    reference: e.reference || null,
    reason: e.reason || null,
    approved_by_name: e.approved_by_name || null,
    created_by_name: e.created_by_name || null,
    created_at: e.created_at || null,
    // Credits: how much of it paid shortages, and what it covered nothing of.
    applied: toMoney(ev.applied),
    unused: toMoney(ev.unused),
    // Charges (refunds, reversed old repayments): what is still owed of it.
    owed: toMoney(owed),
  };
}

// Pure: the statement of one employee's entries as of a date. Entries of other
// employees must not be passed in.
export function computeVarianceStatement(input: VarianceEntry[], asOf: string) {
  const rows = new Map<number, RowState>();
  const events: EventState[] = [];
  const newEvent = (entry: VarianceEntry): EventState => ({
    entry, applied: 0, unused: 0, covered: emptyCovered(), charges: [],
  });
  const rowFor = (entry: VarianceEntry) => {
    const id = Number(entry.shift_id);
    let row = rows.get(id);
    if (!row) {
      row = {
        shift_id: id,
        date: String(entry.shift_date || entry.entry_date).slice(0, 10),
        seq: Number(entry.id),
        amount: 0,
        closed: 0,
        entries: [],
        legacy: [],
        covered: emptyCovered(),
        charges: [],
        surplus_used: 0,
        kept_by_station: 0,
        lapsed: 0,
        pool: null,
      };
      rows.set(id, row);
    }
    row.seq = Math.min(row.seq, Number(entry.id));
    return row;
  };

  for (const entry of input) {
    if ((entry.status || 'posted') !== 'posted') continue;
    if ((entry.entry_type === 'shift' || entry.entry_type === 'correction') && entry.shift_id) {
      const row = rowFor(entry);
      row.amount += toCents(entry.amount);
      if (entry.entry_type === 'shift') row.closed += toCents(entry.amount);
      row.entries.push(entry);
    } else if ((entry.entry_type === 'legacy_settlement' || entry.entry_type === 'legacy_kept') && entry.shift_id) {
      rowFor(entry).legacy.push(newEvent(entry));
    } else {
      events.push(newEvent(entry));
    }
  }

  const charges: Charge[] = [];
  let pool: PoolItem[] = [];
  let cash: CashItem[] = [];
  const prune = () => {
    for (let i = charges.length - 1; i >= 0; i -= 1) if (charges[i].remaining <= 0) charges.splice(i, 1);
    pool = pool.filter((item) => item.remaining > 0);
    cash = cash.filter((item) => item.remaining > 0);
  };
  const lapse = (month: string) => {
    for (const item of pool) {
      if (item.month < month && item.remaining > 0) {
        item.row.lapsed += item.remaining;
        item.row.kept_by_station += item.remaining;
        item.remaining = 0;
      }
    }
    prune();
  };
  const payCharges = (targets: Charge[], amount: number, kind: keyof Covered) => {
    let left = amount;
    for (const charge of targets) {
      if (left <= 0) break;
      const take = Math.min(charge.remaining, left);
      if (take <= 0) continue;
      charge.remaining -= take;
      charge.owner.covered[kind] += take;
      left -= take;
    }
    prune();
    return amount - left;
  };
  const addCharge = (owner: Owner, amount: number, useSurplus: boolean) => {
    let left = amount;
    if (useSurplus) {
      for (const item of pool) {
        if (left <= 0) break;
        const take = Math.min(item.remaining, left);
        item.remaining -= take;
        item.row.surplus_used += take;
        owner.covered.surplus += take;
        left -= take;
      }
    }
    for (const item of cash) {
      if (left <= 0) break;
      const take = Math.min(item.remaining, left);
      item.remaining -= take;
      item.owner.applied += take;
      owner.covered[item.kind] += take;
      left -= take;
    }
    prune();
    if (left > 0) {
      const charge = { owner, remaining: left };
      charges.push(charge);
      owner.charges.push(charge);
    }
  };

  // Oldest first by business date; on the same date, in the order recorded (a
  // shift's row sits where its close was recorded).
  type Item = { date: string; seq: number; row?: RowState; event?: EventState };
  const items: Item[] = [
    ...[...rows.values()].map((row) => ({ date: row.date, seq: row.seq, row })),
    ...events.map((event) => ({ date: String(event.entry.entry_date).slice(0, 10), seq: Number(event.entry.id), event })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);

  for (const item of items) {
    lapse(monthOf(item.date));
    if (item.row) {
      const row = item.row;
      if (row.amount > 0) {
        addCharge(row, row.amount, true);
      } else if (row.amount < 0) {
        row.pool = { row, remaining: -row.amount, month: monthOf(row.date) };
        pool.push(row.pool);
      }
      // What the old debt system did about this shift, before the surplus pays
      // anything: the surplus it kept, what it cleared, what the employee
      // handed over, then anything it still charged.
      const order = (ev: EventState) => {
        const amount = toCents(ev.entry.amount);
        if (ev.entry.entry_type === 'legacy_kept') return 0;
        return amount > 0 ? 3 : ev.entry.refundable ? 2 : 1;
      };
      for (const ev of [...row.legacy].sort((a, b) => order(a) - order(b) || a.entry.id - b.entry.id)) {
        const amount = toCents(ev.entry.amount);
        if (ev.entry.entry_type === 'legacy_kept') {
          // Only surplus that is still there: a correction may have shrunk it.
          const take = Math.min(row.pool?.remaining || 0, amount);
          if (row.pool) row.pool.remaining -= take;
          row.kept_by_station += take;
          ev.applied += take;
          ev.unused += amount - take;
          prune();
        } else if (amount < 0) {
          const kind = ev.entry.refundable ? 'recovered_before' : 'cleared_before';
          const used = payCharges(row.charges, -amount, kind);
          ev.applied += used;
          const left = -amount - used;
          if (left > 0) {
            if (ev.entry.refundable) cash.push({ owner: ev, remaining: left, kind: 'recovered_before' });
            else ev.unused += left;
          }
        } else if (amount > 0) {
          addCharge(row, amount, false);
        }
      }
      // A surplus pays what is owed at this point; the rest waits in the pool.
      if (row.pool && row.pool.remaining > 0) {
        const used = payCharges(charges, row.pool.remaining, 'surplus');
        row.pool.remaining -= used;
        row.surplus_used += used;
        prune();
      }
      continue;
    }

    const ev = item.event!;
    const amount = toCents(ev.entry.amount);
    switch (ev.entry.entry_type) {
      case 'repayment':
      case 'legacy_owed_back': {
        const used = payCharges(charges, -amount, 'repaid');
        ev.applied += used;
        if (-amount - used > 0) cash.push({ owner: ev, remaining: -amount - used, kind: 'repaid' });
        break;
      }
      case 'waiver': {
        const target = ev.entry.shift_id ? rows.get(Number(ev.entry.shift_id)) : null;
        const used = payCharges(target ? target.charges : charges, -amount, 'waived');
        ev.applied += used;
        ev.unused += -amount - used;
        break;
      }
      case 'refund':
        addCharge(ev, amount, false);
        break;
      default:
        // legacy_reversal, and anything newer this code doesn't know: a charge
        // is owed like a shortage, a credit pays like a waiver.
        if (amount > 0) addCharge(ev, amount, true);
        else if (amount < 0) {
          const used = payCharges(charges, -amount, 'waived');
          ev.applied += used;
          ev.unused += -amount - used;
        }
    }
  }
  lapse(monthOf(asOf));

  const owes = charges.reduce((sum, c) => sum + c.remaining, 0);
  const surplusAvailable = pool.reduce((sum, item) => sum + item.remaining, 0);
  const refundable = cash.reduce((sum, item) => sum + item.remaining, 0);
  const rowViews = [...rows.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq)
    .map(rowView);
  return {
    as_of: asOf,
    rows: rowViews,
    events: events
      .sort((a, b) => String(b.entry.entry_date).localeCompare(String(a.entry.entry_date)) || b.entry.id - a.entry.id)
      .map(eventView),
    totals: {
      owes: toMoney(owes),
      surplus_available: toMoney(surplusAvailable),
      refundable: toMoney(refundable),
      // Positive: the employee owes this. Negative: in their favour.
      net: toMoney(owes - surplusAvailable - refundable),
      kept_by_station: toMoney([...rows.values()].reduce((sum, row) => sum + row.kept_by_station, 0)),
    },
  };
}

// ---------------------------------------------------------------- reading --

function hydrate(row: any): VarianceEntry {
  let details = row.details;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      details = null;
    }
  }
  return {
    ...row,
    amount: Number(row.amount),
    refundable: Boolean(row.refundable),
    details,
    shift_date: row.shift_date ? String(row.shift_date).slice(0, 10) : null,
    entry_date: String(row.entry_date).slice(0, 10),
  };
}

// Posted entries, or as they stood at the end of asOf: entries dated after it
// left out, and entries reversed after it counted as posted.
export async function loadVarianceEntries(conn: Conn, filter: { employeeId?: number; asOf?: string } = {}) {
  let query = conn('employee_variance_entries as v')
    .leftJoin('shifts as s', 'v.shift_id', 's.id')
    .leftJoin('employees as creator', 'v.created_by_employee_id', 'creator.id')
    .select('v.*', 's.shift_date', 'creator.name as created_by_name');
  if (filter.employeeId) query = query.where('v.employee_id', filter.employeeId);
  if (filter.asOf) {
    const asOf = filter.asOf;
    query = query
      .where('v.entry_date', '<=', asOf)
      .where((q) => {
        q.where('v.status', 'posted').orWhere((r) => {
          r.where('v.status', 'reversed').whereRaw("date(v.reversed_at, '+3 hours') > ?", [asOf]);
        });
      });
  } else {
    query = query.where('v.status', 'posted');
  }
  const rows = await query.orderBy('v.id');
  return rows.map((row: any) => hydrate({ ...row, status: 'posted' }));
}

export async function varianceStartDate(conn: Conn): Promise<string | null> {
  if (!(await conn.schema.hasTable('operational_settings'))) return null;
  const row = await conn('operational_settings').where({ key: 'variance_ledger_started_on' }).first('value');
  return row?.value || null;
}

export async function getVarianceStatement(conn: Conn, employeeId: number, options: { asOf?: string } = {}) {
  const employee = await conn('employees').where({ id: employeeId }).first('id', 'name', 'active');
  if (!employee) throw settlementError('Employee not found.', 404);
  const asOf = options.asOf || getKenyaDate();
  const entries = await loadVarianceEntries(conn, { employeeId, asOf: options.asOf });
  return {
    employee: { id: Number(employee.id), name: employee.name, active: Boolean(employee.active) },
    started_on: await varianceStartDate(conn),
    ...computeVarianceStatement(entries, asOf),
  };
}

// Totals for every employee with entries, as of a date (default today).
export async function getVarianceTotals(conn: Conn, options: { asOf?: string } = {}) {
  const asOf = options.asOf || getKenyaDate();
  const entries = await loadVarianceEntries(conn, { asOf: options.asOf });
  const byEmployee = new Map<number, VarianceEntry[]>();
  for (const entry of entries) {
    const id = Number(entry.employee_id);
    byEmployee.set(id, [...(byEmployee.get(id) || []), entry]);
  }
  const totals = new Map<number, VarianceStatement['totals']>();
  for (const [id, list] of byEmployee) totals.set(id, computeVarianceStatement(list, asOf).totals);
  return totals;
}

export async function totalOwedByAttendants(conn: Conn, options: { asOf?: string } = {}) {
  let owes = 0;
  for (const totals of (await getVarianceTotals(conn, options)).values()) owes += toCents(totals.owes);
  return toMoney(owes);
}

// Shortages still owed on the given shifts, as of today (daily and monthly
// "unrecovered losses").
export async function owedOnShifts(conn: Conn, shiftIds: number[]) {
  if (!shiftIds.length) return 0;
  const employeeIds = await conn('employee_variance_entries')
    .whereIn('shift_id', shiftIds)
    .distinct('employee_id')
    .pluck('employee_id');
  const wanted = new Set(shiftIds.map(Number));
  let owed = 0;
  for (const employeeId of employeeIds) {
    const statement = computeVarianceStatement(await loadVarianceEntries(conn, { employeeId: Number(employeeId) }), getKenyaDate());
    for (const row of statement.rows) if (wanted.has(row.shift_id)) owed += toCents(row.owed);
  }
  return toMoney(owed);
}

// Activity in a period for reports: shortages and surpluses of shifts in it,
// corrections, repayments, waivers and refunds posted in it, surplus left with
// the station at its month ends, and what attendants owed at its end.
export async function varianceActivity(conn: Conn, from: string, to: string) {
  const entries = await loadVarianceEntries(conn, { asOf: to });
  const inPeriod = (date: string | null | undefined) => Boolean(date) && String(date) >= from && String(date) <= to;
  let shortages = 0;
  let surpluses = 0;
  let corrections = 0;
  let repaid = 0;
  let waived = 0;
  let refunded = 0;
  for (const e of entries) {
    const amount = toCents(e.amount);
    if (e.entry_type === 'shift' && !e.legacy_source && inPeriod(e.entry_date)) {
      if (amount > 0) shortages += amount;
      else surpluses -= amount;
    }
    if (e.entry_type === 'correction' && inPeriod(e.entry_date)) corrections += amount;
    if (e.entry_type === 'repayment' && inPeriod(e.entry_date)) repaid -= amount;
    if (e.entry_type === 'waiver' && inPeriod(e.entry_date)) waived -= amount;
    if (e.entry_type === 'refund' && inPeriod(e.entry_date)) refunded += amount;
  }
  const byEmployee = new Map<number, VarianceEntry[]>();
  for (const entry of entries) {
    byEmployee.set(Number(entry.employee_id), [...(byEmployee.get(Number(entry.employee_id)) || []), entry]);
  }
  let owedAtEnd = 0;
  let kept = 0;
  // Surplus left at the end of the period's last month stays with the station
  // then, so when the period ends on a month end, look from the next day.
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const lapseFrom = next.toISOString().slice(0, 10);
  for (const list of byEmployee.values()) {
    const statement = computeVarianceStatement(list, lapseFrom);
    owedAtEnd += toCents(statement.totals.owes);
    for (const row of statement.rows) {
      if (inPeriod(row.date) && !row.before_variances) kept += toCents(row.kept_by_station);
    }
  }
  return {
    shortages: toMoney(shortages),
    surpluses: toMoney(surpluses),
    // Positive: corrections added to what attendants owe.
    corrections: toMoney(corrections),
    repaid: toMoney(repaid),
    waived: toMoney(waived),
    refunded: toMoney(refunded),
    kept_by_station: toMoney(kept),
    owed_at_end: toMoney(owedAtEnd),
  };
}

// Refunds paid to employees in a period, by method (cash flow).
export async function varianceRefundsPaid(conn: Conn, from: string, to: string) {
  const rows = await conn('employee_variance_entries')
    .where({ entry_type: 'refund', status: 'posted' })
    .whereBetween('entry_date', [from, to])
    .select('method')
    .sum({ total: 'amount' })
    .groupBy('method');
  const byMethod: Record<string, number> = {};
  let total = 0;
  for (const row of rows as any[]) {
    byMethod[row.method || 'cash'] = toMoney(toCents(row.total));
    total += toCents(row.total);
  }
  return { total: toMoney(total), by_method: byMethod };
}

// ---------------------------------------------------------------- writing --

// The account a repayment's cash record is kept against. Employees are not
// customers: these accounts never appear on Credits.
export async function ensureRepaymentAccount(trx: Trx, employeeId: number) {
  const existing = await trx('credit_accounts').where({ employee_id: employeeId, type: 'employee' }).first();
  if (existing) return existing;
  const employee = await trx('employees').where({ id: employeeId }).first('name');
  if (!employee) throw settlementError('Employee not found.', 404);
  const [id] = await trx('credit_accounts').insert({
    employee_id: employeeId,
    type: 'employee',
    name: employee.name,
    balance: 0,
  });
  return trx('credit_accounts').where({ id }).first();
}

// Keeps the old account figure equal to what is owed, for anything still
// reading it.
export async function syncVarianceAccount(trx: Conn, employeeId: number) {
  const statement = computeVarianceStatement(await loadVarianceEntries(trx, { employeeId }), getKenyaDate());
  await trx('credit_accounts')
    .where({ employee_id: employeeId, type: 'employee' })
    .update({ balance: statement.totals.owes });
  return statement.totals;
}

export async function postShiftVariance(
  trx: Trx,
  shift: { id: number; employee_id: number; shift_date: string },
  variance: number,
  actorId: number | null,
) {
  if (toCents(variance) === 0) return null;
  const [id] = await trx('employee_variance_entries').insert({
    employee_id: shift.employee_id,
    entry_type: 'shift',
    entry_date: String(shift.shift_date).slice(0, 10),
    amount: toMoney(-toCents(variance)),
    shift_id: shift.id,
    reason: 'Variance when the shift closed',
    created_by_employee_id: actorId,
  });
  await syncVarianceAccount(trx, shift.employee_id);
  return Number(id);
}

// A closed-shift correction moved the shift's variance from before to after.
export async function postCorrectionVariance(
  trx: Trx,
  input: {
    shift: { id: number; employee_id: number };
    correctionId: number;
    varianceBefore: number;
    varianceAfter: number;
    postingDate: string;
    reason: string;
    actorId: number | null;
  },
) {
  const change = toCents(input.varianceAfter) - toCents(input.varianceBefore);
  if (change === 0) return null;
  const [id] = await trx('employee_variance_entries').insert({
    employee_id: input.shift.employee_id,
    entry_type: 'correction',
    entry_date: input.postingDate,
    amount: toMoney(-change),
    shift_id: input.shift.id,
    correction_id: input.correctionId,
    reason: input.reason,
    created_by_employee_id: input.actorId,
  });
  await syncVarianceAccount(trx, input.shift.employee_id);
  return Number(id);
}

function validDate(value: unknown) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw settlementError('Enter a valid date.', 400);
  }
  if (date > getKenyaDate()) throw settlementError('The date cannot be in the future.', 400);
  return date;
}

// A repayment's cash record (credit_payments, counted by the drawer when taken
// on an open shift, and by cash flow otherwise) plus its variance entry.
export async function recordVarianceRepayment(
  trx: Trx,
  employeeId: number,
  input: {
    amount: unknown;
    payment_method: unknown;
    date: unknown;
    reference?: unknown;
    notes?: unknown;
    shift_id?: unknown;
  },
  actorId: number | null,
  links: { correctionOfId?: number | null; correctionId?: number | null; allowBeyondOwed?: boolean } = {},
) {
  const amount = positiveMoney(input.amount);
  const method = String(input.payment_method || '');
  if (!(VARIANCE_REPAYMENT_METHODS as readonly string[]).includes(method)) {
    throw settlementError('Choose cash, M-Pesa or bank transfer.', 400);
  }
  const date = validDate(input.date);
  const reference = String(input.reference || '').trim().slice(0, 100);
  // A correction's replacement keeps the original's notes instead.
  if (method !== 'cash' && !reference && !links.correctionId) {
    throw settlementError('Enter the M-Pesa or bank reference.', 400);
  }
  const notes = String(input.notes || '').trim().slice(0, 500);
  const shiftId = input.shift_id ? Number(input.shift_id) : null;
  if (shiftId && !links.correctionId) {
    const shift = await trx('shifts').where({ id: shiftId, status: 'open' }).first();
    if (!shift || !['cash', 'mpesa'].includes(method)) {
      throw settlementError('Money taken into a drawer needs an open shift and cash or M-Pesa.');
    }
    if (String(shift.shift_date).slice(0, 10) !== date) {
      throw settlementError('The repayment date must be the date of the shift receiving it.');
    }
  }
  const statement = await getVarianceStatement(trx, employeeId);
  if (!links.allowBeyondOwed && toCents(amount) > toCents(statement.totals.owes)) {
    throw settlementError(
      statement.totals.owes > 0
        ? `${statement.employee.name} owes ${kes(statement.totals.owes)}. A repayment can't be more than that.`
        : `${statement.employee.name} owes nothing.`,
      409,
    );
  }
  const account = await ensureRepaymentAccount(trx, employeeId);
  const [paymentId] = await trx('credit_payments').insert({
    account_id: account.id,
    credit_id: null,
    amount,
    payment_method: method,
    payment_type: 'staff_debt',
    date,
    shift_id: shiftId,
    notes: [reference, notes].filter(Boolean).join(': ') || null,
    status: 'posted',
    created_by_employee_id: actorId,
    ...(links.correctionOfId ? { correction_of_id: links.correctionOfId } : {}),
    ...(links.correctionId ? { created_by_correction_id: links.correctionId } : {}),
  });
  await trx('employee_variance_entries').insert({
    employee_id: employeeId,
    entry_type: 'repayment',
    entry_date: date,
    amount: toMoney(-toCents(amount)),
    refundable: true,
    shift_id: shiftId,
    payment_id: paymentId,
    method,
    reference: reference || null,
    reason: notes || null,
    created_by_employee_id: actorId,
  });
  await syncVarianceAccount(trx, employeeId);
  return trx('credit_payments').where({ id: paymentId }).first();
}

// Reverses a repayment's cash record and its variance entry. A repayment made
// before variances started has no entry of its own (it is inside the carried-
// over balances), so undoing it is charged back as a new entry.
export async function reverseVarianceRepayment(
  trx: Trx,
  paymentId: number,
  input: { reason: string; actorId: number | null; correctionId?: number | null },
) {
  const payment = await trx('credit_payments').where({ id: paymentId, payment_type: 'staff_debt' }).first();
  if (!payment || (payment.status || 'posted') !== 'posted') {
    throw settlementError('Repayment is missing or already reversed.');
  }
  const account = await trx('credit_accounts').where({ id: payment.account_id }).first();
  const employeeId = Number(account?.employee_id);
  if (!employeeId) throw settlementError('This repayment has no employee.', 409);
  const now = new Date().toISOString();
  await trx('credit_payments').where({ id: paymentId }).update({
    status: 'reversed',
    reversed_at: now,
    reversal_reason: input.reason,
    reversed_by_employee_id: input.actorId,
    ...(input.correctionId ? { reversed_by_correction_id: input.correctionId } : {}),
  });
  const entry = await trx('employee_variance_entries')
    .where({ payment_id: paymentId, entry_type: 'repayment', status: 'posted' })
    .first();
  if (entry) {
    await trx('employee_variance_entries').where({ id: entry.id }).update({
      status: 'reversed',
      reversed_at: now,
      reversed_by_employee_id: input.actorId,
      reversal_reason: input.reason,
      reversed_by_correction_id: input.correctionId ?? null,
    });
  } else {
    await trx('employee_variance_entries').insert({
      employee_id: employeeId,
      entry_type: 'legacy_reversal',
      entry_date: getKenyaDate(),
      amount: Number(payment.amount),
      payment_id: paymentId,
      shift_id: payment.shift_id || null,
      correction_id: input.correctionId ?? null,
      reason: `Repayment of ${kes(Number(payment.amount))} on ${String(payment.date).slice(0, 10)} reversed: ${input.reason}`,
      created_by_employee_id: input.actorId,
    });
  }
  await syncVarianceAccount(trx, employeeId);
  return { employee_id: employeeId };
}

// Old-system recoveries undone after variances started (a voided payroll
// deduction, a cancelled shift's wage recovery): owed again, as a new entry.
export async function chargeLegacyReversal(
  trx: Trx,
  input: { employeeId: number; amount: number; reason: string; shiftId?: number | null; actorId?: number | null; source: string },
) {
  if (toCents(input.amount) <= 0) return null;
  const [id] = await trx('employee_variance_entries').insert({
    employee_id: input.employeeId,
    entry_type: 'legacy_reversal',
    entry_date: getKenyaDate(),
    amount: toMoney(toCents(input.amount)),
    shift_id: input.shiftId ?? null,
    reason: input.reason,
    legacy_source: input.source,
    created_by_employee_id: input.actorId ?? null,
  });
  await syncVarianceAccount(trx, input.employeeId);
  return Number(id);
}

export async function waiveVariance(
  trx: Trx,
  employeeId: number,
  input: { amount: unknown; shift_id?: unknown; reason: unknown },
  approver: Approver,
  actorId: number | null,
) {
  const amount = positiveMoney(input.amount);
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) throw settlementError('Say why this is written off.', 400);
  const shiftId = input.shift_id ? Number(input.shift_id) : null;
  const statement = await getVarianceStatement(trx, employeeId);
  if (shiftId) {
    const row = statement.rows.find((r) => r.shift_id === shiftId);
    if (!row || toCents(row.owed) === 0) throw settlementError(`Nothing is owed on shift #${shiftId}.`, 409);
    if (toCents(amount) > toCents(row.owed)) {
      throw settlementError(`Shift #${shiftId} has ${kes(row.owed)} left to recover.`, 409);
    }
  } else if (toCents(amount) > toCents(statement.totals.owes)) {
    throw settlementError(`${statement.employee.name} owes ${kes(statement.totals.owes)}.`, 409);
  }
  const [id] = await trx('employee_variance_entries').insert({
    employee_id: employeeId,
    entry_type: 'waiver',
    entry_date: getKenyaDate(),
    amount: toMoney(-toCents(amount)),
    shift_id: shiftId,
    reason: reason.slice(0, 500),
    approved_by_employee_id: approver.id,
    approved_by_name: approver.name,
    created_by_employee_id: actorId,
  });
  await syncVarianceAccount(trx, employeeId);
  return Number(id);
}

export async function refundVariance(
  trx: Trx,
  employeeId: number,
  input: { amount: unknown; method: unknown; date: unknown; reference?: unknown },
  approver: Approver,
  actorId: number | null,
) {
  const amount = positiveMoney(input.amount);
  const method = String(input.method || '');
  if (!(VARIANCE_REFUND_METHODS as readonly string[]).includes(method)) {
    throw settlementError('Choose cash or M-Pesa.', 400);
  }
  const date = validDate(input.date);
  const reference = String(input.reference || '').trim().slice(0, 100);
  const statement = await getVarianceStatement(trx, employeeId);
  if (toCents(amount) > toCents(statement.totals.refundable)) {
    throw settlementError(
      statement.totals.refundable > 0
        ? `${statement.employee.name} can be paid back up to ${kes(statement.totals.refundable)}.`
        : `${statement.employee.name} has nothing to be paid back.`,
      409,
    );
  }
  const [id] = await trx('employee_variance_entries').insert({
    employee_id: employeeId,
    entry_type: 'refund',
    entry_date: date,
    amount: toMoney(toCents(amount)),
    method,
    reference: reference || null,
    approved_by_employee_id: approver.id,
    approved_by_name: approver.name,
    created_by_employee_id: actorId,
  });
  await syncVarianceAccount(trx, employeeId);
  return Number(id);
}
