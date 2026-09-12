import type { Knex } from 'knex';
import { verifyApprovalToken } from '../middleware/requireAdmin';
import { settlementError } from './employeeDebt';

export type Approver = { id: number; name: string };

// What an approval token is bound to. POST /auth/verify-pin signs the binding
// computed here from the decision the admin is looking at; the operation then
// recomputes it from what it is actually about to commit. They match only if
// the admin approved exactly this decision — a token for "recover KES 0" cannot
// be replayed to recover KES 400, or against another shift or payroll line.
// Both sides must use these functions; never build a binding string elsewhere.
export const approvalBindings = {
  // version already hashes the debts snapshot and the shift/payroll-line context.
  recovery: (fields: any) =>
    `recovery:${String(fields?.version ?? '')}:${Number(fields?.amount).toFixed(2)}`,
  deduction: (fields: any) =>
    `deduction:${Number(fields?.payroll_line_id)}:${String(fields?.deduction_type ?? '')}:${Number(fields?.amount).toFixed(2)}`,
};

export type ApprovalPurpose = keyof typeof approvalBindings;

// Rejects a verify-pin request that doesn't fully describe its decision, so a
// malformed client fails at the PIN prompt instead of later with "no longer
// matches".
export function approvalSubjectError(purpose: ApprovalPurpose, fields: any): string | null {
  const amount = Number(fields?.amount);
  if (fields?.amount === undefined || fields?.amount === null || !Number.isFinite(amount) || amount < 0) {
    return 'The amount being approved is missing.';
  }
  if (purpose === 'recovery' && !/^[0-9a-f]{64}$/.test(String(fields?.version ?? ''))) {
    return 'The recovery being approved is missing. Refresh and review it again.';
  }
  if (purpose === 'deduction' && (!(Number(fields?.payroll_line_id) > 0) || !fields?.deduction_type)) {
    return 'The deduction being approved is missing its payroll line or type.';
  }
  return null;
}

export function isApprovalPurpose(value: unknown): value is ApprovalPurpose {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(approvalBindings, value);
}

export async function activeAdmin(id: number, db: Knex | Knex.Transaction): Promise<Approver | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db('employees')
    .where({ id, active: true, role: 'admin' })
    .first('id', 'name');
}

// The single place that decides who approved a decision.
//
// A signed-in admin session (mobile) is itself the approver: nothing to prompt.
// The shared desktop terminal authenticates with the desktop key and carries no
// person, so it must present a token from POST /auth/verify-pin for exactly this
// decision. When desktop gains named sessions, resolve them here as well.
//
// The approver is re-checked against the employees table at the moment of use,
// so an admin deactivated or demoted after signing in cannot still approve.
export async function resolveApprover(
  sessionEmployeeId: number | null | undefined,
  approvalToken: unknown,
  binding: string,
  db: Knex | Knex.Transaction,
): Promise<Approver> {
  if (Number(sessionEmployeeId) > 0) {
    const self = await activeAdmin(Number(sessionEmployeeId), db);
    if (!self) throw settlementError('Only an active administrator can approve this.', 403);
    return self;
  }
  if (!approvalToken) {
    throw settlementError('Select the approving administrator and enter their PIN.', 400);
  }
  const claim = verifyApprovalToken(approvalToken);
  if (!claim || claim.binding !== binding) {
    throw settlementError(
      'This approval has expired or no longer matches the decision. Enter the PIN again.',
      403,
    );
  }
  const approver = await activeAdmin(claim.approver, db);
  if (!approver) throw settlementError('The approver is no longer an active administrator.', 403);
  return approver;
}
