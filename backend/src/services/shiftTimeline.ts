export interface ShiftTimelineInput {
  shift: any;
  closeReconciliation?: any;
  shiftCredits?: any[];
  invoiceConsumption?: any[];
  creditReceipts?: any[];
  expenses?: any[];
  payrollPayments?: any[];
  reviewEvents?: any[];
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
      description: input.shift.employee_name || null,
      occurred_at: openedAt,
      precision: 'time',
    });
  }

  for (const credit of input.shiftCredits || []) {
    const occurredAt = eventTime(credit.created_at);
    if (!occurredAt) continue;
    events.push({
      id: `credit-${credit.id}`,
      type: 'credit_issued',
      title: 'Customer credit recorded',
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
      title: 'Invoice consumption recorded',
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
      title: 'Debt payment received',
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
      title: 'Payroll payment made from shift',
      description: payment.payment_method || null,
      occurred_at: occurredAt,
      precision: 'time',
      amount: amount(payment.amount),
    });
  }

  if (input.closeReconciliation) {
    const occurredAt = eventTime(input.closeReconciliation.approved_at || input.shift.end_time);
    if (occurredAt) {
      const expenseCount = (input.expenses || []).length;
      events.push({
        id: `shift-closed-${input.shift.id}`,
        type: 'shift_closed',
        title: 'Shift reconciled and closed',
        description: expenseCount > 0
          ? `${expenseCount} expense entr${expenseCount === 1 ? 'y' : 'ies'} included in the close review`
          : 'Readings, collections, and shift entries reviewed',
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
        description: 'Legacy close record; no reconciliation snapshot was stored',
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

  return events.sort((left, right) => {
    const timeDifference = new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
}
