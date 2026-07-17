import type { Knex } from 'knex';

const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

function rawRows(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

export type InvoiceCustomerMonitorOptions = {
  recentLimit?: number;
};

export async function getInvoiceCustomerMonitor(qb: Knex, opts: InvoiceCustomerMonitorOptions = {}) {
  const recentLimit = Math.max(1, Math.min(10, Number(opts.recentLimit || 5)));

  const accounts = await qb('credit_accounts as ca')
    .whereNull('ca.deleted_at')
    .where('ca.type', 'customer')
    .where('ca.billing_mode', 'invoice')
    .select(
      'ca.id',
      'ca.name',
      'ca.phone',
      'ca.balance as cached_outstanding_balance',
      'ca.created_at',
    )
    .orderBy('ca.name', 'asc');

  const openInvoices = await qb('customer_invoices')
    .whereNull('deleted_at')
    .whereIn('status', ['issued', 'partial'])
    .select('account_id')
    .count({ open_invoice_count: 'id' })
    .sum({ issued_balance: 'balance' })
    .min({ oldest_open_invoice_date: 'issue_date' })
    .groupBy('account_id');

  const drafts = await qb('customer_invoices')
    .whereNull('deleted_at')
    .where('status', 'draft')
    .select('account_id')
    .count({ draft_count: 'id' })
    .sum({ draft_total: 'total_amount' })
    .groupBy('account_id');

  const unbilledByFuel = await qb('invoice_consumption as ic')
    .leftJoin('shifts as s', 'ic.shift_id', 's.id')
    .whereNull('ic.deleted_at')
    .whereNull('ic.invoice_line_id')
    .select('ic.account_id', 'ic.fuel_type')
    .sum({ litres: 'ic.litres' })
    .sum({ retail_amount: 'ic.retail_amount' })
    .count({ entries: 'ic.id' })
    .min({ first_unbilled_date: 's.shift_date' })
    .max({ last_unbilled_date: 's.shift_date' })
    .groupBy('ic.account_id', 'ic.fuel_type');

  const lastConsumption = await qb('invoice_consumption as ic')
    .leftJoin('shifts as s', 'ic.shift_id', 's.id')
    .whereNull('ic.deleted_at')
    .select('ic.account_id')
    .max({ last_consumption_date: 's.shift_date' })
    .groupBy('ic.account_id');

  const recentConsumption = rawRows(await qb.raw(`
    SELECT *
    FROM (
      SELECT
        ic.id,
        ic.account_id,
        ic.shift_id,
        s.shift_date,
        ic.fuel_type,
        ic.litres,
        ic.retail_price_at_time,
        ic.retail_amount,
        ROW_NUMBER() OVER (
          PARTITION BY ic.account_id
          ORDER BY s.shift_date DESC, ic.id DESC
        ) AS rn
      FROM invoice_consumption ic
      LEFT JOIN shifts s ON ic.shift_id = s.id
      WHERE ic.deleted_at IS NULL
        AND ic.invoice_line_id IS NULL
    )
    WHERE rn <= ?
    ORDER BY account_id ASC, shift_date DESC, id DESC
  `, [recentLimit]));

  const latestOpenInvoices = rawRows(await qb.raw(`
    SELECT *
    FROM (
      SELECT
        id,
        account_id,
        invoice_number,
        from_date,
        to_date,
        issue_date,
        status,
        total_amount,
        balance,
        ROW_NUMBER() OVER (
          PARTITION BY account_id
          ORDER BY COALESCE(issue_date, created_at) DESC, id DESC
        ) AS rn
      FROM customer_invoices
      WHERE deleted_at IS NULL
        AND status IN ('issued', 'partial')
    )
    WHERE rn <= ?
    ORDER BY account_id ASC, issue_date DESC, id DESC
  `, [recentLimit]));

  const openByAccount: Record<number, any> = {};
  for (const row of openInvoices as any[]) openByAccount[Number(row.account_id)] = row;

  const draftByAccount: Record<number, any> = {};
  for (const row of drafts as any[]) draftByAccount[Number(row.account_id)] = row;

  const lastByAccount: Record<number, string | null> = {};
  for (const row of lastConsumption as any[]) lastByAccount[Number(row.account_id)] = row.last_consumption_date || null;

  const recentByAccount: Record<number, any[]> = {};
  for (const row of recentConsumption) {
    const accountId = Number(row.account_id);
    (recentByAccount[accountId] ||= []).push({
      id: Number(row.id),
      shift_id: Number(row.shift_id),
      shift_date: row.shift_date,
      fuel_type: row.fuel_type,
      litres: round2(row.litres),
      retail_price_at_time: round2(row.retail_price_at_time),
      retail_amount: round2(row.retail_amount),
    });
  }

  const invoicesByAccount: Record<number, any[]> = {};
  for (const row of latestOpenInvoices) {
    const accountId = Number(row.account_id);
    (invoicesByAccount[accountId] ||= []).push({
      id: Number(row.id),
      invoice_number: row.invoice_number,
      from_date: row.from_date,
      to_date: row.to_date,
      issue_date: row.issue_date,
      status: row.status,
      total_amount: round2(row.total_amount),
      balance: round2(row.balance),
    });
  }

  const customerMap: Record<number, any> = {};
  for (const account of accounts) {
    const accountId = Number(account.id);
    const open = openByAccount[accountId] || {};
    const draft = draftByAccount[accountId] || {};
    customerMap[accountId] = {
      id: accountId,
      name: account.name,
      phone: account.phone,
      cached_outstanding_balance: round2(account.cached_outstanding_balance),
      issued_balance: round2(open.issued_balance),
      open_invoice_count: Number(open.open_invoice_count || 0),
      oldest_open_invoice_date: open.oldest_open_invoice_date || null,
      draft_count: Number(draft.draft_count || 0),
      draft_total: round2(draft.draft_total),
      unbilled_litres: 0,
      unbilled_retail_amount: 0,
      unbilled_entries: 0,
      first_unbilled_date: null as string | null,
      last_unbilled_date: null as string | null,
      last_consumption_date: lastByAccount[accountId] || null,
      fuels: {} as Record<string, any>,
      latest_open_invoices: invoicesByAccount[accountId] || [],
      recent_unbilled_consumption: recentByAccount[accountId] || [],
    };
  }

  for (const row of unbilledByFuel as any[]) {
    const accountId = Number(row.account_id);
    if (!customerMap[accountId]) continue;
    const fuel = row.fuel_type;
    const litres = round2(row.litres);
    const retailAmount = round2(row.retail_amount);
    const entries = Number(row.entries || 0);
    customerMap[accountId].fuels[fuel] = {
      litres,
      retail_amount: retailAmount,
      entries,
      first_unbilled_date: row.first_unbilled_date || null,
      last_unbilled_date: row.last_unbilled_date || null,
    };
    customerMap[accountId].unbilled_litres = round2(customerMap[accountId].unbilled_litres + litres);
    customerMap[accountId].unbilled_retail_amount = round2(customerMap[accountId].unbilled_retail_amount + retailAmount);
    customerMap[accountId].unbilled_entries += entries;
    if (!customerMap[accountId].first_unbilled_date || row.first_unbilled_date < customerMap[accountId].first_unbilled_date) {
      customerMap[accountId].first_unbilled_date = row.first_unbilled_date || customerMap[accountId].first_unbilled_date;
    }
    if (!customerMap[accountId].last_unbilled_date || row.last_unbilled_date > customerMap[accountId].last_unbilled_date) {
      customerMap[accountId].last_unbilled_date = row.last_unbilled_date || customerMap[accountId].last_unbilled_date;
    }
  }

  const customers = Object.values(customerMap)
    .map((customer: any) => ({
      ...customer,
      total_exposure: round2(customer.issued_balance + customer.unbilled_retail_amount),
    }))
    .sort((a: any, b: any) =>
      b.total_exposure - a.total_exposure ||
      b.unbilled_litres - a.unbilled_litres ||
      a.name.localeCompare(b.name),
    );

  const summary = customers.reduce(
    (acc: any, customer: any) => {
      acc.customer_count += 1;
      acc.issued_balance = round2(acc.issued_balance + customer.issued_balance);
      acc.unbilled_litres = round2(acc.unbilled_litres + customer.unbilled_litres);
      acc.unbilled_retail_amount = round2(acc.unbilled_retail_amount + customer.unbilled_retail_amount);
      acc.unbilled_entries += customer.unbilled_entries;
      acc.total_exposure = round2(acc.total_exposure + customer.total_exposure);
      acc.open_invoice_count += customer.open_invoice_count;
      acc.draft_count += customer.draft_count;
      return acc;
    },
    {
      customer_count: 0,
      issued_balance: 0,
      unbilled_litres: 0,
      unbilled_retail_amount: 0,
      unbilled_entries: 0,
      total_exposure: 0,
      open_invoice_count: 0,
      draft_count: 0,
    },
  );

  return { summary, customers };
}
