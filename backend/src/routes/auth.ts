import { Router } from 'express';
import db from '../database';
import {
  APPROVAL_TOKEN_TTL_MS,
  generateApprovalToken,
  generateToken,
  getSessionTtlMs,
  requireAuth,
} from '../middleware/requireAdmin';
import { hashPin, isHashedPin, verifyPin } from '../services/pinSecurity';
import {
  ATTENDANT_APPROVAL_PURPOSES,
  approvalBindings,
  approvalSubjectError,
  isApprovalPurpose,
} from '../services/approval';

const router = Router();
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
const LOGIN_WINDOW_MINUTES = Number(process.env.LOGIN_WINDOW_MINUTES || 15);
const LOGIN_LOCK_MS = (Number.isFinite(LOGIN_LOCK_MINUTES) && LOGIN_LOCK_MINUTES > 0 ? LOGIN_LOCK_MINUTES : 15) * 60 * 1000;
const LOGIN_WINDOW_MS = (Number.isFinite(LOGIN_WINDOW_MINUTES) && LOGIN_WINDOW_MINUTES > 0 ? LOGIN_WINDOW_MINUTES : 15) * 60 * 1000;
const loginAttempts = new Map<string, { failures: number; firstFailureAt: number; lockedUntil: number }>();

function getLoginKey(req: any, employeeId: unknown): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
  return `${ip}:${employeeId || 'unknown'}`;
}

function getLoginLockSeconds(key: string): number {
  const attempt = loginAttempts.get(key);
  if (!attempt) return 0;
  if (!attempt.lockedUntil) return 0;
  if (attempt.lockedUntil && attempt.lockedUntil <= Date.now()) {
    loginAttempts.delete(key);
    return 0;
  }
  return Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
}

function recordLoginFailure(key: string) {
  const current = loginAttempts.get(key);
  const now = Date.now();
  const withinWindow = current && now - current.firstFailureAt <= LOGIN_WINDOW_MS;
  const failures = (withinWindow ? current.failures : 0) + 1;
  const maxAttempts = Number.isFinite(LOGIN_MAX_ATTEMPTS) && LOGIN_MAX_ATTEMPTS > 0 ? LOGIN_MAX_ATTEMPTS : 5;
  loginAttempts.set(key, {
    failures,
    firstFailureAt: withinWindow ? current.firstFailureAt : now,
    lockedUntil: failures >= maxAttempts ? Date.now() + LOGIN_LOCK_MS : 0,
  });
}

function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { employee_id, pin } = req.body;
    const loginKey = getLoginKey(req, employee_id);
    const lockSeconds = getLoginLockSeconds(loginKey);
    if (lockSeconds > 0) {
      return res.status(429).json({
        success: false,
        error: `Too many failed PIN attempts. Try again in ${Math.ceil(lockSeconds / 60)} minute(s).`,
        retry_after_seconds: lockSeconds,
      });
    }

    const submittedPin = typeof pin === 'string' ? pin : '';
    if (!employee_id || !submittedPin) {
      return res.status(400).json({ success: false, error: 'Employee ID and PIN are required' });
    }

    const employee = await db('employees')
      .where({ id: employee_id, active: true })
      .first();

    if (!employee) {
      recordLoginFailure(loginKey);
      return res.status(401).json({ success: false, error: 'Invalid employee or PIN' });
    }

    if (!verifyPin(submittedPin, employee.pin)) {
      recordLoginFailure(loginKey);
      return res.status(401).json({ success: false, error: 'Invalid employee or PIN' });
    }

    if (!isHashedPin(employee.pin)) {
      await db('employees').where({ id: employee.id }).update({ pin: hashPin(submittedPin) });
    }

    // Return employee data without pin, plus a session token
    clearLoginFailures(loginKey);
    const { pin: _pin, ...employeeData } = employee;
    const issuedAt = new Date();
    const ttlMs = getSessionTtlMs();
    const token = generateToken(employee.id, employee.role);
    res.json({
      success: true,
      data: employeeData,
      token,
      session: {
        issued_at: issuedAt.toISOString(),
        expires_at: new Date(issuedAt.getTime() + ttlMs).toISOString(),
        ttl_ms: ttlMs,
      },
    });
  } catch (err: any) {
    console.error('[auth:login] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET all employees (for login selection - minimal data)
router.get('/employees', async (_req, res) => {
  try {
    const employees = await db('employees')
      .where({ active: true })
      .select('id', 'name')
      .orderBy('name');
    res.json({ success: true, data: employees });
  } catch (err: any) {
    console.error('[auth:list-employees] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/auth/approvers - administrators who can approve a decision on the
// shared desktop terminal, or on an attendant's phone when a credit needs an
// override. Signed-in callers only: the public /employees list above omits
// roles so it doesn't advertise which accounts' PINs are worth guessing.
router.get('/approvers', requireAuth, async (_req, res) => {
  try {
    const approvers = await db('employees')
      .where({ active: true, role: 'admin' })
      .select('id', 'name')
      .orderBy('name');
    res.json({ success: true, data: approvers });
  } catch (err: any) {
    console.error('[auth:approvers] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/verify-pin - step-up confirmation for one decision. Unlike
// /login it starts no session: it returns a short-lived token bound to exactly
// the decision described in the body, and that operation's own route verifies
// it (services/approval.ts). Checking the PIN here and trusting a client-side
// "PIN ok" would be decoration.
//
// Failures lock the approver out like login does, but counted per approver
// rather than per client address: every desktop request comes from the same
// terminal, and the lock must hold however the request is sent.
// Wrong PINs answer 403, not 401, so a signed-in mobile client never mistakes a
// mistyped approval PIN for an expired session and logs out.
router.post('/verify-pin', requireAuth, async (req, res) => {
  try {
    const { employee_id, pin, purpose } = req.body || {};
    if (!isApprovalPurpose(purpose)) {
      return res.status(400).json({ success: false, error: 'Unknown approval type.' });
    }
    // Attendants can only ask for the approvals that arise on their own screens.
    if ((req as any).employee?.role !== 'admin' && !ATTENDANT_APPROVAL_PURPOSES.has(purpose)) {
      return res.status(403).json({ success: false, error: 'Only an administrator can request this approval.' });
    }
    const subjectError = approvalSubjectError(purpose, req.body);
    if (subjectError) {
      return res.status(400).json({ success: false, error: subjectError });
    }
    const approverId = Number(employee_id);
    const submittedPin = typeof pin === 'string' ? pin : '';
    if (!Number.isInteger(approverId) || approverId <= 0 || !submittedPin) {
      return res.status(400).json({ success: false, error: 'Select the approving administrator and enter their PIN.' });
    }

    const attemptKey = `approval:${approverId}`;
    const lockSeconds = getLoginLockSeconds(attemptKey);
    if (lockSeconds > 0) {
      return res.status(429).json({
        success: false,
        error: `Too many incorrect PINs for this approver. Try again in ${Math.ceil(lockSeconds / 60)} minute(s).`,
        retry_after_seconds: lockSeconds,
      });
    }

    const approver = await db('employees')
      .where({ id: approverId, active: true, role: 'admin' })
      .first();
    if (!approver || !verifyPin(submittedPin, approver.pin)) {
      recordLoginFailure(attemptKey);
      return res.status(403).json({ success: false, error: 'Incorrect PIN for the selected approver.' });
    }
    clearLoginFailures(attemptKey);

    res.json({
      success: true,
      data: {
        approval_token: generateApprovalToken(approver.id, approvalBindings[purpose](req.body)),
        approver: { id: approver.id, name: approver.name },
        expires_at: new Date(Date.now() + APPROVAL_TOKEN_TTL_MS).toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[auth:verify-pin] ERROR', err.message);
    res.status(500).json({ success: false, error: 'The PIN could not be verified. Try again.' });
  }
});

export default router;
