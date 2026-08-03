import type { Knex } from 'knex';
import { roundMoney } from './receivablePayments';

export type ReceivableIntegrityIssue = {
  kind:
    | 'invoice_payment_unallocated'
    | 'invoice_overallocated'
    | 'invoice_balance_mismatch'
    | 'money_account_overpaid'
    | 'account_cache_mismatch'
    | 'accounting_event_missing'
    | 'accounting_balance_mismatch';
  account_id: number;
  record_id?: number;
  expected?: number;
  actual?: number;
  difference?: number;
  message: string;
};

export type ReceivableIntegrityReport = {
  ok: boolean;
  checked_at: string;
  counts: Record<ReceivableIntegrityIssue['kind'], number>;
  issues: ReceivableIntegrityIssue[];
};

function difference(actual: number, expected: number): number {
  return roundMoney(actual - expected);
}

export async function auditReceivableIntegrity(db: Knex): Promise<ReceivableIntegrityReport> {
  const issues: ReceivableIntegrityIssue[] = [];

  const invoicePayments = await db('invoice_payments as p')
    .whereNull('p.deleted_at')
    .where('p.status', 'posted')
    .leftJoin('invoice_payment_allocations as a', 'a.payment_id', 'p.id')
    .select('p.id', 'p.account_id', 'p.amount')
    .sum('a.amount_applied as allocated')
    .groupBy('p.id', 'p.account_id', 'p.amount');
  for (const payment of invoicePayments as any[]) {
    const paid = roundMoney(Number(payment.amount || 0));
    const allocated = roundMoney(Number(payment.allocated || 0));
    if (Math.abs(paid - allocated) >= 0.01) {
      issues.push({
        kind: 'invoice_payment_unallocated',
        account_id: Number(payment.account_id),
        record_id: Number(payment.id),
        expected: paid,
        actual: allocated,
        difference: difference(allocated, paid),
        message: `Invoice payment ${payment.id} is KES ${paid.toFixed(2)}, but KES ${allocated.toFixed(2)} is allocated.`,
      });
    }
  }

  const invoices = await db('customer_invoices as i')
    .whereNull('i.deleted_at')
    .select('i.id', 'i.account_id', 'i.status', 'i.total_amount', 'i.balance');
  for (const invoice of invoices as any[]) {
    if (invoice.status === 'draft' || invoice.status === 'void') continue;
    const total = roundMoney(Number(invoice.total_amount || 0));
    const paidRow = await db('invoice_payment_allocations as allocation')
      .join('invoice_payments as payment', 'allocation.payment_id', 'payment.id')
      .where('allocation.invoice_id', invoice.id)
      .where('payment.status', 'posted')
      .whereNull('payment.deleted_at')
      .sum('allocation.amount_applied as total')
      .first();
    const adjustmentRow = await db('invoice_adjustment_notes')
      .where({ invoice_id: invoice.id, status: 'posted' })
      .sum('signed_amount as total')
      .first();
    const adjustedTotal = roundMoney(
      total + Number((adjustmentRow as any)?.total || 0),
    );
    const allocated = roundMoney(Number((paidRow as any)?.total || 0));
    const storedBalance = roundMoney(Number(invoice.balance || 0));
    if (allocated > adjustedTotal) {
      issues.push({
        kind: 'invoice_overallocated',
        account_id: Number(invoice.account_id),
        record_id: Number(invoice.id),
        expected: adjustedTotal,
        actual: allocated,
        difference: difference(allocated, adjustedTotal),
        message: `Invoice ${invoice.id} has KES ${allocated.toFixed(2)} allocated against a KES ${adjustedTotal.toFixed(2)} adjusted total.`,
      });
    }
    const expectedBalance = Math.max(0, roundMoney(adjustedTotal - allocated));
    if (Math.abs(storedBalance - expectedBalance) >= 0.01) {
      issues.push({
        kind: 'invoice_balance_mismatch',
        account_id: Number(invoice.account_id),
        record_id: Number(invoice.id),
        expected: expectedBalance,
        actual: storedBalance,
        difference: difference(storedBalance, expectedBalance),
        message: `Invoice ${invoice.id} balance is KES ${storedBalance.toFixed(2)}; allocations imply KES ${expectedBalance.toFixed(2)}.`,
      });
    }
  }

  const accounts = await db('credit_accounts')
    .whereNull('deleted_at')
    .where({ type: 'customer' })
    .select('id', 'billing_mode', 'balance');
  for (const account of accounts as any[]) {
    let expectedBalance = 0;
    if ((account.billing_mode || 'money') === 'invoice') {
      const row = await db('customer_invoices')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .whereIn('status', ['issued', 'partial'])
        .sum('balance as total')
        .first();
      expectedBalance = roundMoney(Number((row as any)?.total || 0));
      const eventRow = await db('invoice_accounting_events')
        .where({ account_id: account.id })
        .sum('receivable_delta as total')
        .first();
      const eventBalance = roundMoney(Number((eventRow as any)?.total || 0));
      if (Math.abs(eventBalance - expectedBalance) >= 0.01) {
        issues.push({
          kind: 'accounting_balance_mismatch',
          account_id: Number(account.id),
          expected: expectedBalance,
          actual: eventBalance,
          difference: difference(eventBalance, expectedBalance),
          message: `Invoice accounting events for account ${account.id} net to KES ${eventBalance.toFixed(2)}; open documents total KES ${expectedBalance.toFixed(2)}.`,
        });
      }
    } else {
      const creditRow = await db('credits')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .sum('balance as total')
        .first();
      expectedBalance = roundMoney(Number((creditRow as any)?.total || 0));

      const originalRow = await db('credits')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .sum('amount as total')
        .first();
      const creditIds: number[] = await db('credits')
        .where({ account_id: account.id })
        .whereNull('deleted_at')
        .pluck('id');
      const paymentRow = await db('credit_payments')
        .whereNull('deleted_at')
        .where({ status: 'posted' })
        .where(function (this: any) {
          this.where('account_id', account.id);
          if (creditIds.length) this.orWhereIn('credit_id', creditIds);
        })
        .sum('amount as total')
        .first();
      const original = roundMoney(Number((originalRow as any)?.total || 0));
      const paid = roundMoney(Number((paymentRow as any)?.total || 0));
      if (paid > original) {
        issues.push({
          kind: 'money_account_overpaid',
          account_id: Number(account.id),
          expected: original,
          actual: paid,
          difference: difference(paid, original),
          message: `Money account ${account.id} has KES ${paid.toFixed(2)} of payments against KES ${original.toFixed(2)} of credit.`,
        });
      }
    }

    const cached = roundMoney(Number(account.balance || 0));
    if (Math.abs(cached - expectedBalance) >= 0.01) {
      issues.push({
        kind: 'account_cache_mismatch',
        account_id: Number(account.id),
        expected: expectedBalance,
        actual: cached,
        difference: difference(cached, expectedBalance),
        message: `Account ${account.id} cache is KES ${cached.toFixed(2)}; open documents total KES ${expectedBalance.toFixed(2)}.`,
      });
    }
  }

  const requiredEventKeys: Array<{ account_id: number; record_id: number; source_key: string }> = [];
  const issuedInvoices = await db('customer_invoices')
    .whereNull('deleted_at')
    .whereIn('status', ['issued', 'partial', 'paid', 'void'])
    .select('id', 'account_id', 'status');
  for (const invoice of issuedInvoices as any[]) {
    requiredEventKeys.push({
      account_id: Number(invoice.account_id),
      record_id: Number(invoice.id),
      source_key: `invoice:${invoice.id}:issue`,
    });
    if (invoice.status === 'void') {
      requiredEventKeys.push({
        account_id: Number(invoice.account_id),
        record_id: Number(invoice.id),
        source_key: `invoice:${invoice.id}:void`,
      });
    }
  }
  const payments = await db('invoice_payments').select('id', 'account_id', 'status');
  for (const payment of payments as any[]) {
    requiredEventKeys.push({
      account_id: Number(payment.account_id),
      record_id: Number(payment.id),
      source_key: `payment:${payment.id}:posted`,
    });
    if (payment.status === 'reversed') {
      requiredEventKeys.push({
        account_id: Number(payment.account_id),
        record_id: Number(payment.id),
        source_key: `payment:${payment.id}:reversal`,
      });
    }
  }
  const notes = await db('invoice_adjustment_notes').select('id', 'account_id', 'status');
  for (const note of notes as any[]) {
    requiredEventKeys.push({
      account_id: Number(note.account_id),
      record_id: Number(note.id),
      source_key: `adjustment-note:${note.id}:posted`,
    });
    if (note.status === 'reversed') {
      requiredEventKeys.push({
        account_id: Number(note.account_id),
        record_id: Number(note.id),
        source_key: `adjustment-note:${note.id}:reversal`,
      });
    }
  }
  if (requiredEventKeys.length > 0) {
    const existingKeys = new Set(
      (await db('invoice_accounting_events')
        .whereIn('source_key', requiredEventKeys.map((item) => item.source_key))
        .pluck('source_key'))
        .map(String),
    );
    for (const required of requiredEventKeys) {
      if (!existingKeys.has(required.source_key)) {
        issues.push({
          kind: 'accounting_event_missing',
          account_id: required.account_id,
          record_id: required.record_id,
          message: `Required accounting event ${required.source_key} is missing.`,
        });
      }
    }
  }

  const counts: ReceivableIntegrityReport['counts'] = {
    invoice_payment_unallocated: 0,
    invoice_overallocated: 0,
    invoice_balance_mismatch: 0,
    money_account_overpaid: 0,
    account_cache_mismatch: 0,
    accounting_event_missing: 0,
    accounting_balance_mismatch: 0,
  };
  for (const issue of issues) counts[issue.kind] += 1;

  return {
    ok: issues.length === 0,
    checked_at: new Date().toISOString(),
    counts,
    issues,
  };
}
