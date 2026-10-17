import crypto from 'crypto';
import type { PlanLine } from '../corrections';
import { readShiftFinancials } from '../shiftFinancials';
import type { Conn } from './common';

// Bind a customer correction to the facts used for its preview, including
// allocations/history whose net totals may return to the same amounts after
// undo. Read only the involved accounts and shifts; no station-wide replay.
export async function customerCorrectionState(conn: Conn, lines: PlanLine[]) {
  const accountIds = [...new Set(lines.filter(line => line.party_type === 'customer' && line.party_id)
    .map(line => Number(line.party_id)))].sort((a, b) => a - b);
  const shiftIds = [...new Set(lines.map(line => line.shift_id))].sort((a, b) => a - b);
  const accountCredits = () => conn('credits').whereIn('account_id', accountIds).select('id');
  const accountPayments = () => conn('credit_payments').whereIn('account_id', accountIds).select('id');
  const accounts = await conn('credit_accounts').whereIn('id', accountIds).orderBy('id');
  const credits = await conn('credits').whereIn('account_id', accountIds).orderBy('id');
  const payments = await conn('credit_payments').whereIn('account_id', accountIds).orderBy('id');
  const allocations = await conn('credit_payment_allocations')
    .whereIn('credit_id', accountCredits()).orWhereIn('payment_id', accountPayments()).orderBy('id');
  const refunds = await conn('customer_refunds').whereIn('account_id', accountIds).orderBy('id');
  const refundAllocations = await conn('customer_refund_allocations')
    .whereIn('payment_id', accountPayments()).orderBy('id');
  // Other debts' shift dates/status decide age and settlement eligibility.
  const shifts = await conn('shifts').whereIn('id', shiftIds)
    .orWhereIn('id', conn('credits').whereIn('account_id', accountIds).whereNotNull('shift_id').select('shift_id'))
    .orderBy('id');
  const financials = await readShiftFinancials(conn, shiftIds);
  const history = await conn('correction_lines as l').join('corrections as c', 'l.correction_id', 'c.id')
    .where(builder => builder.whereIn('l.shift_id', shiftIds)
      .orWhere(inner => inner.where('l.party_type', 'customer').whereIn('l.party_id', accountIds)))
    .orderBy('l.id')
    .select('l.*', 'c.kind as correction_kind', 'c.status as correction_status', 'c.plan_hash as correction_plan_hash',
      'c.undoes_correction_id', 'c.undone_by_correction_id');
  const varianceEntries = await conn('employee_variance_entries').whereIn('shift_id', shiftIds).orderBy('id');
  return crypto.createHash('sha256').update(JSON.stringify({
    accounts, credits, payments, allocations, refunds, refundAllocations, shifts,
    financials: [...financials], history, varianceEntries,
  })).digest('hex');
}
