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
  // Credit past a customer's limit: this customer, this shift, this amount.
  credit_override: (fields: any) =>
    `credit_override:${Number(fields?.account_id)}:${Number(fields?.shift_id)}:${Number(fields?.amount).toFixed(2)}`,
  // Fuel on account past a limit; the retail value is priced by the server.
  consumption_override: (fields: any) =>
    `consumption_override:${Number(fields?.account_id)}:${Number(fields?.shift_id)}:${String(fields?.fuel_type ?? '')}:${Number(fields?.litres).toFixed(3)}`,
};

export type ApprovalPurpose = keyof typeof approvalBindings;

// Approvals an attendant may ask an administrator for on the attendant's own
// device. Everything else only arises on admin-only screens.
export const ATTENDANT_APPROVAL_PURPOSES: ReadonlySet<ApprovalPurpose> = new Set([
  'credit_override',
  'consumption_override',
]);

const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

// Rejects a verify-pin request that doesn't fully describe its decision, so a
// malformed client fails at the PIN prompt instead of later with "no longer
// matches".
export function approvalSubjectError(purpose: ApprovalPurpose, fields: any): string | null {
  if (purpose === 'consumption_override') {
    if (!positive(fields?.account_id) || !positive(fields?.shift_id)) return 'The customer or shift being approved is missing.';
    if (fields?.fuel_type !== 'petrol' && fields?.fuel_type !== 'diesel') return 'The fuel type being approved is missing.';
    if (!positive(fields?.litres)) return 'The litres being approved are missing.';
    return null;
  }
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
  if (purpose === 'credit_override' && (!positive(fields?.account_id) || !positive(fields?.shift_id) || amount <= 0)) {
    return 'The customer, shift or amount being approved is missing.';
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
// Anyone else must present a token from POST /auth/verify-pin for exactly this
// decision: the shared desktop terminal, which carries no person, and an
// attendant whose credit needs an administrator to confirm on their phone.
// When desktop gains named sessions, resolve them here as well.
//
// The approver is re-checked against the employees table at the moment of use,
// so an admin deactivated or demoted after signing in cannot still approve.
export async function resolveApprover(
  sessionEmployeeId: number | null | undefined,
  approvalToken: unknown,
  binding: string,
  db: Knex | Knex.Transaction,
): Promise<Approver> {
  const signedIn = Number(sessionEmployeeId) > 0;
  if (signedIn) {
    const self = await activeAdmin(Number(sessionEmployeeId), db);
    if (self) return self;
  }
  if (!approvalToken) {
    throw signedIn
      ? settlementError('An administrator must approve this with their PIN.', 403)
      : settlementError('Select the approving administrator and enter their PIN.', 400);
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
