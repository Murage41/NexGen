import type { Knex } from 'knex';
import { auditReceivableIntegrity } from './receivableIntegrity';
import { listStaleOpenShifts } from './shiftOperations';

function rowsFromRaw(value: any): any[] {
  if (Array.isArray(value?.[0])) return value[0];
  if (Array.isArray(value)) return value;
  return [];
}

export async function runOperationalIntegrityCheck(conn: Knex) {
  const checkedAt = new Date().toISOString();
  const quickRows = rowsFromRaw(await conn.raw('PRAGMA quick_check'));
  const sqliteMessage = String(quickRows[0]?.quick_check || 'unknown');
  const foreignKeyIssues = rowsFromRaw(await conn.raw('PRAGMA foreign_key_check'));
  const receivables = await auditReceivableIntegrity(conn);
  const staleShifts = await listStaleOpenShifts(conn, new Date(checkedAt));

  const negativeRevisionRow = await conn('shifts')
    .where('readings_revision', '<', 0)
    .orWhere('collections_revision', '<', 0)
    .count({ count: 'id' })
    .first();
  const missingCloseSnapshotRow = await conn('shifts as s')
    .leftJoin('shift_close_reconciliations as r', 's.id', 'r.shift_id')
    .where('s.status', 'closed')
    .whereNull('r.id')
    .count({ count: 's.id' })
    .first();
  const incompleteOperationRow = await conn('idempotency_records')
    .whereNull('response_status')
    .orWhereNull('response_body')
    .count({ count: 'id' })
    .first();

  const counts = {
    foreign_key_issues: foreignKeyIssues.length,
    receivable_issues: receivables.issues.length,
    negative_shift_revisions: Number(negativeRevisionRow?.count || 0),
    incomplete_operations: Number(incompleteOperationRow?.count || 0),
    legacy_closed_shifts_without_snapshot: Number(missingCloseSnapshotRow?.count || 0),
    stale_open_shifts: staleShifts.count,
  };
  const ok = sqliteMessage === 'ok'
    && counts.foreign_key_issues === 0
    && receivables.ok
    && counts.negative_shift_revisions === 0
    && counts.incomplete_operations === 0;

  return {
    ok,
    checked_at: checkedAt,
    checks: {
      sqlite: { ok: sqliteMessage === 'ok', message: sqliteMessage },
      foreign_keys: {
        ok: foreignKeyIssues.length === 0,
        count: foreignKeyIssues.length,
        issues: foreignKeyIssues.slice(0, 100),
      },
      receivables,
      shift_revisions: { ok: counts.negative_shift_revisions === 0, count: counts.negative_shift_revisions },
      idempotency: { ok: counts.incomplete_operations === 0, count: counts.incomplete_operations },
    },
    warnings: {
      stale_open_shifts: staleShifts,
      legacy_closed_shifts_without_snapshot: counts.legacy_closed_shifts_without_snapshot,
    },
    counts,
  };
}
