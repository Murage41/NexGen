import type { HistoryGroup } from './shiftEdits';

export interface ShiftTimelineInput {
  shift: any;
  history?: HistoryGroup[];
  closeReconciliation?: any;
  shiftCredits?: any[];
  invoiceConsumption?: any[];
  creditReceipts?: any[];
  expenses?: any[];
  payrollPayments?: any[];
  reviewEvents?: any[];
  corrections?: any[];
}

export interface ShiftTimelineEvent {
  id: string;
  type: string;
  title: string;
  description: string | null;
  occurred_at: string;
  precision: 'time' | 'date';
  amount?: number;
  litres?: number;
  // add: something recorded; change: a figure changed (lines say old -> new);
  // remove: taken off the shift. Who did it when the record says.
  tone?: 'add' | 'change' | 'remove' | 'event';
  actor?: string | null;
  lines?: string[];
}

const figure = (value: number | null) => (value === null || value === undefined
  ? '-' : Number(value).toLocaleString('en-KE', { maximumFractionDigits: 3 }));

// One History line for each group of edits (services/shiftEdits.ts).
function historyEvent(group: HistoryGroup): ShiftTimelineEvent {
  const base = { id: group.id, occurred_at: group.occurred_at, precision: 'time' as const, actor: group.actor };
  const changeLines = group.changes.map((c) => `${c.label}: ${figure(c.from)} → ${figure(c.to)}`);
  if (group.kind === 'removed') {
    const [what, ...rest] = group.changes[0].label.split(' · ');
    return { ...base, type: 'entry_removed', tone: 'remove', title: `${what} removed`, description: rest.join(' · ') || null, amount: Number(group.changes[0].from || 0) };
  }
  if (group.kind === 'readings') {
    const pumps = new Set(group.changes.map((c) => c.key.split(':')[0])).size;
    return group.first
      ? { ...base, type: 'readings_recorded', tone: 'add', title: 'Closing readings recorded', description: `${pumps} pump${pumps === 1 ? '' : 's'}` }
      : { ...base, type: 'readings_changed', tone: 'change', title: 'Closing readings changed', description: null, lines: changeLines };
  }
  if (group.kind === 'money') {
    return group.first
      ? { ...base, type: 'money_counted', tone: 'add', title: 'Cash and M-Pesa counted', description: group.changes.map((c) => `${c.label} ${figure(c.to)}`).join(' · ') }
      : { ...base, type: 'money_changed', tone: 'change', title: 'Cash and M-Pesa count changed', description: null, lines: changeLines };
  }
  if (group.kind === 'opening_readings') {
    return { ...base, type: 'opening_changed', tone: 'change', title: 'Opening readings changed', description: null, lines: changeLines };
  }
  return { ...base, type: 'entry_changed', tone: 'change', title: 'Invoice fuel changed', description: null, lines: changeLines };
}

function amount(value: unknown): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function eventTime(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

export function buildShiftTimeline(input: ShiftTimelineInput): ShiftTimelineEvent[] {
  const events: ShiftTimelineEvent[] = [];
  const openedAt = eventTime(input.shift.start_time || input.shift.created_at);
  if (openedAt) {
    events.push({
      id: `shift-opened-${input.shift.id}`,
      type: 'shift_opened',
      title: 'Shift opened',
      description: [
        input.shift.employee_name,
        input.shift.opening_cash_amount !== null && input.shift.opening_cash_amount !== undefined
          ? `Opening cash ${figure(Number(input.shift.opening_cash_amount))} · M-Pesa ${figure(Number(input.shift.opening_mpesa_amount || 0))}`
          : null,
      ].filter(Boolean).join(' · ') || null,
      occurred_at: openedAt,
      precision: 'time',
      tone: 'event',
    });
  }

  for (const group of input.history || []) events.push(historyEvent(group));

  for (const expense of input.expenses || []) {
    const occurredAt = eventTime(expense.created_at);
    if (!occurredAt) continue;
    events.push({
      id: `expense-${expense.id}`,
      type: 'expense',
      title: 'Expense',
      description: [expense.category, expense.description].filter(Boolean).join(' · ') || null,
      occurred_at: occurredAt,
      precision: 'time',
      amount: amount(expense.amount),
      tone: 'add',
      actor: expense.created_by_name || 'Station PC',
    });
  }

  for (const credit of input.shiftCredits || []) {
    const occurredAt = eventTime(credit.created_at);
    if (!occurredAt) continue;
    events.push({
      id: `credit-${credit.id}`,
      type: 'credit_issued',
      title: 'Credit sale',
      tone: 'add',
      description: credit.customer_name || credit.description || null,
      occurred_at: occurredAt,
      precision: 'time',
      amount: amount(credit.amount),
    });
  }

  for (const entry of input.invoiceConsumption || []) {
    const occurredAt = eventTime(entry.created_at);
    if (!occurredAt) continue;
    events.push({
      id: `invoice-consumption-${entry.id}`,
      type: 'invoice_consumption',
      title: 'Invoice fuel',
      tone: 'add',
      description: entry.account_name || entry.fuel_type || null,
      occurred_at: occurredAt,
      precision: 'time',
      amount: amount(entry.retail_amount),
      litres: Number(entry.litres || 0),
    });
  }

  for (const receipt of input.creditReceipts || []) {
    const timestamp = eventTime(receipt.created_at);
    const date = eventTime(receipt.date);
    if (!timestamp && !date) continue;
    events.push({
      id: `debt-receipt-${receipt.id}`,
      type: 'debt_receipt',
      title: 'Debt payment',
      tone: 'add',
      description: receipt.account_name || receipt.payment_method || null,
      occurred_at: timestamp || `${date}T12:00:00`,
      precision: timestamp ? 'time' : 'date',
      amount: amount(receipt.amount),
    });
  }

  for (const payment of input.payrollPayments || []) {
    const occurredAt = eventTime(payment.created_at);
    if (!occurredAt) continue;
    events.push({
      id: `payroll-payment-${payment.id}`,
      type: 'payroll_payment',
      title: 'Wage paid from the till',
      tone: 'add',
      description: payment.payment_method || null,
      occurred_at: occurredAt,
      precision: 'time',
      amount: amount(payment.amount),
    });
  }

  if (input.closeReconciliation) {
    const occurredAt = eventTime(input.closeReconciliation.approved_at || input.shift.end_time);
    if (occurredAt) {
      events.push({
        id: `shift-closed-${input.shift.id}`,
        type: 'shift_closed',
        title: 'Shift closed',
        tone: 'event',
        description: null,
        occurred_at: occurredAt,
        precision: 'time',
        amount: amount(input.closeReconciliation.variance),
      });
    }
  } else if (input.shift.status === 'closed') {
    const occurredAt = eventTime(input.shift.end_time);
    if (occurredAt) {
      events.push({
        id: `shift-closed-${input.shift.id}`,
        type: 'shift_closed',
        title: 'Shift closed',
        tone: 'event',
        description: null,
        occurred_at: occurredAt,
        precision: 'time',
      });
    }
  }

  if (input.shift.status === 'cancelled') {
    const occurredAt = eventTime(input.shift.cancelled_at || input.shift.end_time);
    if (occurredAt) {
      events.push({
        id: `shift-cancelled-${input.shift.id}`,
        type: 'shift_cancelled',
        title: 'Shift cancelled',
        description: input.shift.cancellation_reason || null,
        occurred_at: occurredAt,
        precision: 'time',
      });
    }
  }

  for (const review of input.reviewEvents || []) {
    const occurredAt = eventTime(review.created_at);
    if (!occurredAt) continue;
    const actor = review.actor_name || review.actor_role || 'Admin';
    events.push({
      id: `shift-review-${review.id}`,
      type: review.to_status === 'flagged' ? 'shift_flagged' : 'shift_reviewed',
      title: review.to_status === 'flagged' ? 'Shift flagged for follow-up' : 'Shift review completed',
      description: review.notes ? `${actor}: ${review.notes}` : actor,
      occurred_at: occurredAt,
      precision: 'time',
    });
  }

  for (const correction of input.corrections || []) {
    const occurredAt = eventTime(correction.created_at);
    if (!occurredAt) continue;
    const by = correction.approved_by_name ? `Approved by ${correction.approved_by_name}` : null;
    events.push({
      id: `shift-correction-${correction.id}`,
      type: 'shift_correction',
      title: 'Correction posted after close',
      description: [correction.reason, by].filter(Boolean).join('. ') || null,
      occurred_at: occurredAt,
      precision: 'time',
      amount: amount(Number(correction.variance_after || 0) - Number(correction.variance_before || 0)),
    });
  }

  // Latest first (owner, 2026-11-04).
  return events.sort((left, right) => {
    const timeDifference = new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime();
    return timeDifference || right.id.localeCompare(left.id);
  });
}
