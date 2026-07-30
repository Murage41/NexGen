import type { Knex } from 'knex';

export type ConsumptionHistoryStatus =
  | 'active'
  | 'unbilled'
  | 'reserved'
  | 'invoiced'
  | 'released'
  | 'reversed'
  | 'deleted'
  | 'all';

export type ConsumptionHistoryFilters = {
  from?: string;
  to?: string;
  fuelType?: string;
  status?: ConsumptionHistoryStatus;
  shiftId?: number;
  page?: number;
  pageSize?: number;
};

const billingStatusSql = `
  CASE
    WHEN COALESCE(ic.entry_status, 'active') = 'reversed' THEN 'reversed'
    WHEN COALESCE(ic.entry_status, 'active') = 'deleted' OR ic.deleted_at IS NOT NULL THEN 'deleted'
    WHEN il.id IS NULL THEN 'unbilled'
    WHEN ci.status = 'draft' THEN 'reserved'
    WHEN ci.status = 'void' THEN 'released'
    ELSE 'invoiced'
  END
`;

function round2(value: unknown) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function positiveInteger(value: unknown, fallback: number, maximum?: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return maximum ? Math.min(parsed, maximum) : parsed;
}

function applyStatusFilter(query: Knex.QueryBuilder, status: ConsumptionHistoryStatus) {
  if (status === 'all') return;
  if (status === 'active') {
    query
      .whereNull('ic.deleted_at')
      .where(function (this: Knex.QueryBuilder) {
        this.whereNull('ic.entry_status').orWhere('ic.entry_status', 'active');
      });
    return;
  }
  query.whereRaw(`(${billingStatusSql}) = ?`, [status]);
}

export async function getInvoiceConsumptionHistory(
  db: Knex,
  accountId: number,
  filters: ConsumptionHistoryFilters = {},
) {
  const account = await db('credit_accounts')
    .where({ id: accountId, type: 'customer', billing_mode: 'invoice' })
    .whereNull('deleted_at')
    .select('id', 'name', 'phone', 'payment_terms_days')
    .first();
  if (!account) {
    throw Object.assign(new Error('Invoice customer not found.'), { http: 404 });
  }

  const status = filters.status || 'active';
  const allowedStatuses: ConsumptionHistoryStatus[] = [
    'active',
    'unbilled',
    'reserved',
    'invoiced',
    'released',
    'reversed',
    'deleted',
    'all',
  ];
  if (!allowedStatuses.includes(status)) {
    throw Object.assign(new Error('Invalid consumption history status.'), { http: 400 });
  }

  const page = positiveInteger(filters.page, 1);
  const pageSize = positiveInteger(filters.pageSize, 50, 100);
  const query = db('invoice_consumption as ic')
    .join('shifts as shift', 'ic.shift_id', 'shift.id')
    .leftJoin('employees as employee', 'shift.employee_id', 'employee.id')
    .leftJoin('pumps as pump', 'ic.pump_id', 'pump.id')
    .leftJoin('tanks as tank', 'ic.tank_id', 'tank.id')
    .leftJoin('invoice_lines as il', 'ic.invoice_line_id', 'il.id')
    .leftJoin('customer_invoices as ci', 'il.invoice_id', 'ci.id')
    .where('ic.account_id', accountId);

  if (filters.from) query.where('shift.shift_date', '>=', filters.from);
  if (filters.to) query.where('shift.shift_date', '<=', filters.to);
  if (filters.fuelType) query.where('ic.fuel_type', filters.fuelType);
  if (filters.shiftId) query.where('ic.shift_id', filters.shiftId);
  applyStatusFilter(query, status);

  const countRow = await query
    .clone()
    .clearSelect()
    .clearOrder()
    .countDistinct({ total: 'ic.id' })
    .first();
  const aggregateRows = await query
    .clone()
    .clearSelect()
    .clearOrder()
    .select(db.raw(`${billingStatusSql} as billing_status`), 'ic.fuel_type')
    .count({ rows: 'ic.id' })
    .sum({ litres: 'ic.litres', retail_amount: 'ic.retail_amount' })
    .groupByRaw(`${billingStatusSql}, ic.fuel_type`);

  const rows = await query
    .clone()
    .select(
      'ic.*',
      'shift.shift_date',
      'shift.status as shift_status',
      'employee.name as employee_name',
      'pump.label as pump_label',
      'pump.nozzle_label',
      'tank.label as tank_label',
      'ci.id as invoice_id',
      'ci.invoice_number',
      'ci.status as invoice_status',
      db.raw(`${billingStatusSql} as billing_status`),
      db.raw(
        '(SELECT MIN(replacement.id) FROM invoice_consumption replacement WHERE replacement.correction_of_id = ic.id) as replacement_id',
      ),
    )
    .orderBy('shift.shift_date', 'desc')
    .orderBy('ic.created_at', 'desc')
    .orderBy('ic.id', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totals = {
    rows: 0,
    active_litres: 0,
    active_retail_amount: 0,
    reversed_litres: 0,
    reversed_retail_amount: 0,
    by_fuel: {} as Record<string, {
      rows: number;
      active_litres: number;
      active_retail_amount: number;
      reversed_litres: number;
      reversed_retail_amount: number;
    }>,
  };
  for (const aggregate of aggregateRows as any[]) {
    const fuel = String(aggregate.fuel_type);
    const aggregateStatus = String(aggregate.billing_status);
    const rowCount = Number(aggregate.rows || 0);
    const litres = round2(aggregate.litres);
    const retailAmount = round2(aggregate.retail_amount);
    const isInactive = aggregateStatus === 'reversed' || aggregateStatus === 'deleted';
    const fuelTotals = totals.by_fuel[fuel] ||= {
      rows: 0,
      active_litres: 0,
      active_retail_amount: 0,
      reversed_litres: 0,
      reversed_retail_amount: 0,
    };
    totals.rows += rowCount;
    fuelTotals.rows += rowCount;
    if (isInactive) {
      totals.reversed_litres = round2(totals.reversed_litres + litres);
      totals.reversed_retail_amount = round2(totals.reversed_retail_amount + retailAmount);
      fuelTotals.reversed_litres = round2(fuelTotals.reversed_litres + litres);
      fuelTotals.reversed_retail_amount = round2(fuelTotals.reversed_retail_amount + retailAmount);
    } else {
      totals.active_litres = round2(totals.active_litres + litres);
      totals.active_retail_amount = round2(totals.active_retail_amount + retailAmount);
      fuelTotals.active_litres = round2(fuelTotals.active_litres + litres);
      fuelTotals.active_retail_amount = round2(fuelTotals.active_retail_amount + retailAmount);
    }
  }

  const total = Number((countRow as any)?.total || 0);
  return {
    account: {
      ...account,
      payment_terms_days: Number(account.payment_terms_days || 0),
    },
    filters: {
      from: filters.from || null,
      to: filters.to || null,
      fuel_type: filters.fuelType || null,
      status,
      shift_id: filters.shiftId || null,
    },
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    },
    totals,
    rows: (rows as any[]).map((row) => ({
      ...row,
      litres: round2(row.litres),
      retail_price_at_time: round2(row.retail_price_at_time),
      retail_amount: round2(row.retail_amount),
    })),
  };
}
