import db from '../database';

type AuditDetails = Record<string, unknown>;

interface AuditEntry {
  action: string;
  target_type?: string | null;
  target_id?: string | number | null;
  user_id?: number | null;
  employee_id?: number | null;
  role?: string | null;
  details?: AuditDetails | null;
}

function getIpAddress(req: any): string {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || '';
}

export async function writeAuditLog(req: any, entry: AuditEntry): Promise<void> {
  try {
    const actor = req?.employee || {};
    await db('audit_logs').insert({
      action: entry.action,
      target_type: entry.target_type || null,
      target_id: entry.target_id == null ? null : String(entry.target_id),
      user_id: entry.user_id ?? actor.user_id ?? null,
      employee_id: entry.employee_id ?? actor.employee_id ?? actor.id ?? null,
      role: entry.role ?? actor.role ?? null,
      ip_address: getIpAddress(req),
      user_agent: req?.headers?.['user-agent'] || null,
      details_json: entry.details ? JSON.stringify(entry.details) : null,
    });
  } catch (err: any) {
    console.error('[audit-log] ERROR', err.message);
  }
}
