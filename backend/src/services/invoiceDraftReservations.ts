import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { recomputeInvoiceTotals, roundMoney } from './receivablePayments';

type DbConnection = Knex | Knex.Transaction;

export type DraftReservationInput = {
  accountId: number;
  fromDate: string;
  toDate: string;
  agreedPrices?: Record<string, number>;
  notes?: string | null;
};

function httpError(message: string, http: number, code?: string): Error {
  return Object.assign(new Error(message), { http, code });
}

function normalizeDateRange(fromDate: string, toDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw httpError('from_date and to_date must use YYYY-MM-DD format', 400, 'INVALID_DATE_RANGE');
  }
  if (fromDate > toDate) {
    throw httpError('from_date cannot be after to_date', 400, 'INVALID_DATE_RANGE');
  }
}

function normalizeAgreedPrice(value: unknown, fallback: number): number {
  const price = value === undefined ? roundMoney(fallback) : roundMoney(Number(value));
  if (!Number.isFinite(price) || price <= 0) {
    throw httpError('Agreed invoice prices must be greater than zero', 400, 'INVALID_AGREED_PRICE');
  }
  return price;
}

async function getAccount(trx: DbConnection, accountId: number) {
  const account = await trx('credit_accounts')
    .where({ id: accountId })
    .whereNull('deleted_at')
    .first();
  if (!account) throw httpError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
  if (account.type !== 'customer' || account.billing_mode !== 'invoice') {
    throw httpError('Account is not an invoice customer', 400, 'WRONG_BILLING_MODE');
  }
  return account;
}

export async function getReservableConsumption(
  trx: DbConnection,
  accountId: number,
  fromDate: string,
  toDate: string,
) {
  normalizeDateRange(fromDate, toDate);
  return trx('invoice_consumption as ic')
    .join('shifts as s', 'ic.shift_id', 's.id')
    .where('ic.account_id', accountId)
    .where('s.status', 'closed')
    .whereNull('ic.deleted_at')
    .whereNull('ic.invoice_line_id')
    .where(function (this: any) {
      this.whereNull('ic.entry_status').orWhere('ic.entry_status', 'active');
    })
    .where('s.shift_date', '>=', fromDate)
    .where('s.shift_date', '<=', toDate)
    .select(
      'ic.id',
      'ic.account_id',
      'ic.shift_id',
      'ic.fuel_type',
      'ic.litres',
      'ic.retail_price_at_time',
      'ic.retail_amount',
      's.shift_date',
    )
    .orderBy('s.shift_date', 'asc')
    .orderBy('ic.id', 'asc');
}

function groupConsumption(rows: any[]) {
  const grouped: Record<string, { ids: number[]; litres: number; retail: number }> = {};
  for (const row of rows) {
    const fuelType = String(row.fuel_type);
    const group = grouped[fuelType] ||= { ids: [], litres: 0, retail: 0 };
    group.ids.push(Number(row.id));
    group.litres += Number(row.litres || 0);
    group.retail += Number(row.retail_amount || 0);
  }
  return grouped;
}

async function reserveIds(
  trx: Knex.Transaction,
  lineId: number,
  ids: number[],
) {
  if (ids.length === 0) return;
  const affected = await trx('invoice_consumption')
    .whereIn('id', ids)
    .whereNull('invoice_line_id')
    .whereNull('deleted_at')
    .where(function (this: any) {
      this.whereNull('entry_status').orWhere('entry_status', 'active');
    })
    .update({ invoice_line_id: lineId });

  if (Number(affected) !== ids.length) {
    throw httpError(
      'Some consumption was reserved by another draft. Refresh and try again.',
      409,
      'CONSUMPTION_RESERVATION_CONFLICT',
    );
  }
}

async function rebuildLineTotals(trx: Knex.Transaction, invoiceId: number) {
  const lines = await trx('invoice_lines').where({ invoice_id: invoiceId }).orderBy('id');
  let linkedEntries = 0;

  for (const line of lines) {
    const aggregate = await trx('invoice_consumption')
      .where({ invoice_line_id: line.id })
      .whereNull('deleted_at')
      .where(function (this: any) {
        this.whereNull('entry_status').orWhere('entry_status', 'active');
      })
      .sum({ litres: 'litres' })
      .count({ entries: 'id' })
      .first();
    const litres = roundMoney(Number((aggregate as any)?.litres || 0));
    const entries = Number((aggregate as any)?.entries || 0);
    linkedEntries += entries;
    await trx('invoice_lines').where({ id: line.id }).update({
      total_litres: litres,
      line_total: roundMoney(litres * Number(line.agreed_price)),
    });
  }

  await recomputeInvoiceTotals(invoiceId, trx);
  return linkedEntries;
}

async function addRowsToDraft(
  trx: Knex.Transaction,
  invoice: any,
  rows: any[],
  agreedPrices: Record<string, number> = {},
) {
  const groups = groupConsumption(rows);
  const existingLines = await trx('invoice_lines').where({ invoice_id: invoice.id });
  const lineByFuel = new Map(existingLines.map((line: any) => [String(line.fuel_type), line]));

  for (const [fuelType, group] of Object.entries(groups)) {
    let line: any = lineByFuel.get(fuelType);
    if (!line) {
      const averageRetail = group.litres > 0 ? group.retail / group.litres : 0;
      const agreedPrice = normalizeAgreedPrice(agreedPrices[fuelType], averageRetail);
      const [lineId] = await trx('invoice_lines').insert({
        invoice_id: invoice.id,
        fuel_type: fuelType,
        total_litres: 0,
        agreed_price: agreedPrice,
        line_total: 0,
      });
      line = { id: Number(lineId), fuel_type: fuelType, agreed_price: agreedPrice };
      lineByFuel.set(fuelType, line);
    }
    await reserveIds(trx, Number(line.id), group.ids);
  }

  const linkedEntries = await rebuildLineTotals(trx, Number(invoice.id));
  const now = trx.fn.now();
  await trx('customer_invoices').where({ id: invoice.id }).update({
    reservation_status: 'reserved',
    reserved_at: invoice.reserved_at || now,
    reservation_updated_at: now,
  });
  return { added_entries: rows.length, reserved_entries: linkedEntries };
}

export async function createReservedInvoiceDraft(
  conn: Knex,
  input: DraftReservationInput,
) {
  normalizeDateRange(input.fromDate, input.toDate);
  return conn.transaction(async (trx) => {
    await getAccount(trx, input.accountId);
    const rows = await getReservableConsumption(
      trx,
      input.accountId,
      input.fromDate,
      input.toDate,
    );
    if (rows.length === 0) {
      throw httpError(
        'No unbilled consumption from closed shifts exists in this date range',
        400,
        'NO_RESERVABLE_CONSUMPTION',
      );
    }

    const [invoiceId] = await trx('customer_invoices').insert({
      account_id: input.accountId,
      invoice_number: `DRAFT-${input.accountId}-${randomUUID()}`,
      from_date: input.fromDate,
      to_date: input.toDate,
      issue_date: null,
      status: 'draft',
      reservation_status: 'legacy_unreserved',
      total_amount: 0,
      balance: 0,
      notes: input.notes || null,
    });
    const invoice = await trx('customer_invoices').where({ id: invoiceId }).first();
    const reservation = await addRowsToDraft(trx, invoice, rows, input.agreedPrices);
    const created = await trx('customer_invoices').where({ id: invoiceId }).first();
    return { invoice: created, ...reservation };
  });
}

export async function refreshInvoiceDraftReservation(conn: Knex, invoiceId: number) {
  return conn.transaction(async (trx) => {
    const invoice = await trx('customer_invoices')
      .where({ id: invoiceId })
      .whereNull('deleted_at')
      .first();
    if (!invoice) throw httpError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
    if (invoice.status !== 'draft') {
      throw httpError('Only draft invoices can be refreshed', 400, 'NOT_DRAFT');
    }
    await getAccount(trx, Number(invoice.account_id));

    if (invoice.reservation_status === 'legacy_unreserved') {
      const lineIds = await trx('invoice_lines').where({ invoice_id: invoiceId }).pluck('id');
      const linked = lineIds.length
        ? await trx('invoice_consumption').whereIn('invoice_line_id', lineIds).count({ count: 'id' }).first()
        : { count: 0 };
      if (Number((linked as any)?.count || 0) > 0) {
        throw httpError(
          'This legacy draft has inconsistent linked consumption and requires an integrity review.',
          409,
          'LEGACY_DRAFT_INCONSISTENT',
        );
      }
      const prices = Object.fromEntries(
        (await trx('invoice_lines').where({ invoice_id: invoiceId })).map((line: any) => [
          String(line.fuel_type),
          Number(line.agreed_price),
        ]),
      );
      await trx('invoice_lines').where({ invoice_id: invoiceId }).delete();
      const rows = await getReservableConsumption(
        trx,
        Number(invoice.account_id),
        invoice.from_date,
        invoice.to_date,
      );
      if (rows.length === 0) {
        throw httpError(
          'No unbilled closed-shift consumption remains for this legacy draft.',
          409,
          'LEGACY_DRAFT_EMPTY',
        );
      }
      const reservation = await addRowsToDraft(trx, invoice, rows, prices);
      const updated = await trx('customer_invoices').where({ id: invoiceId }).first();
      return { invoice: updated, legacy_upgraded: true, ...reservation };
    }

    if (invoice.reservation_status !== 'reserved') {
      throw httpError('Draft reservation state is invalid', 409, 'INVALID_RESERVATION_STATE');
    }
    const rows = await getReservableConsumption(
      trx,
      Number(invoice.account_id),
      invoice.from_date,
      invoice.to_date,
    );
    const reservation = rows.length
      ? await addRowsToDraft(trx, invoice, rows)
      : {
          added_entries: 0,
          reserved_entries: await rebuildLineTotals(trx, invoiceId),
        };
    if (rows.length === 0) {
      await trx('customer_invoices').where({ id: invoiceId }).update({
        reservation_updated_at: trx.fn.now(),
      });
    }
    const updated = await trx('customer_invoices').where({ id: invoiceId }).first();
    return { invoice: updated, legacy_upgraded: false, ...reservation };
  });
}

export async function validateDraftReservationForIssue(
  trx: Knex.Transaction,
  invoice: any,
) {
  if (invoice.reservation_status !== 'reserved') {
    throw httpError(
      'This draft predates consumption reservations. Refresh the draft before issuing it.',
      409,
      'DRAFT_REFRESH_REQUIRED',
    );
  }

  const lines = await trx('invoice_lines').where({ invoice_id: invoice.id });
  if (lines.length === 0) {
    throw httpError('Draft has no invoice lines', 409, 'EMPTY_DRAFT');
  }
  for (const line of lines) {
    if (!Number.isFinite(Number(line.agreed_price)) || Number(line.agreed_price) <= 0) {
      throw httpError('Every invoice line must have an agreed price greater than zero', 400, 'INVALID_AGREED_PRICE');
    }
  }

  const lineIds = lines.map((line: any) => Number(line.id));
  const invalid = await trx('invoice_consumption as ic')
    .join('invoice_lines as il', 'ic.invoice_line_id', 'il.id')
    .leftJoin('shifts as s', 'ic.shift_id', 's.id')
    .whereIn('ic.invoice_line_id', lineIds)
    .where(function (this: any) {
      this.whereNot('ic.account_id', invoice.account_id)
        .orWhereNot('il.invoice_id', invoice.id)
        .orWhereRaw('ic.fuel_type <> il.fuel_type')
        .orWhereNull('s.id')
        .orWhereNot('s.status', 'closed')
        .orWhere('s.shift_date', '<', invoice.from_date)
        .orWhere('s.shift_date', '>', invoice.to_date)
        .orWhereNotNull('ic.deleted_at')
        .orWhere(function (this: any) {
          this.whereNotNull('ic.entry_status').andWhereNot('ic.entry_status', 'active');
        });
    })
    .count({ count: 'ic.id' })
    .first();
  if (Number((invalid as any)?.count || 0) > 0) {
    throw httpError(
      'Reserved consumption changed or is no longer billable. Review this draft before issuing.',
      409,
      'RESERVED_CONSUMPTION_INVALID',
    );
  }

  const linkedEntries = await rebuildLineTotals(trx, Number(invoice.id));
  if (linkedEntries === 0) {
    throw httpError('Draft has no reserved consumption to issue', 409, 'EMPTY_DRAFT');
  }
  const emptyLines = await trx('invoice_lines')
    .where({ invoice_id: invoice.id })
    .where('total_litres', '<=', 0)
    .count({ count: 'id' })
    .first();
  if (Number((emptyLines as any)?.count || 0) > 0) {
    throw httpError(
      'Every invoice line must contain reserved consumption',
      409,
      'EMPTY_INVOICE_LINE',
    );
  }
  return { lines, linkedEntries };
}

export async function releaseInvoiceReservation(
  trx: Knex.Transaction,
  invoiceId: number,
) {
  const lineIds = await trx('invoice_lines').where({ invoice_id: invoiceId }).pluck('id');
  if (lineIds.length === 0) return 0;
  return trx('invoice_consumption')
    .whereIn('invoice_line_id', lineIds)
    .update({ invoice_line_id: null });
}
