import { Router } from 'express';
import db from '../database';
import {
  APPROVAL_TOKEN_TTL_MS,
  generateApprovalToken,
  generateDeviceToken,
  generateToken,
  getSessionTtlMs,
  requireAuth,
  verifyDeviceToken,
} from '../middleware/requireAdmin';
import { hashPin, isHashedPin, verifyPin } from '../services/pinSecurity';
import {
  ATTENDANT_APPROVAL_PURPOSES,
  approvalBindings,
  approvalSubjectError,
  isApprovalPurpose,
} from '../services/approval';

const router = Router();

// Wrong-PIN limits. A 4-digit PIN has only 10,000 possibilities and the API is
// reachable from the internet through ngrok, so guessing must be bounded per
// account, never per client address. Through ngrok every request arrives from
// the station PC itself; the only sign of the real client is X-Forwarded-For,
// which the client can write. A limit keyed on it could be dodged by changing
// that header on each guess - which is how this was broken before.
//
// Login:
//  - A device that has signed in to this account before holds a device token
//    (requireAdmin.ts). It may make LOGIN_MAX_ATTEMPTS wrong guesses in a row;
//    after that its token is not trusted until it signs in again.
//  - Every other device shares one allowance per account:
//    LOGIN_UNTRUSTED_DAILY_MAX wrong guesses per rolling 24 hours, however many
//    addresses they come from. Because it is separate from the known devices'
//    allowances, using it up cannot lock anyone out of the phone they normally
//    use.
// Approvals (verify-pin): the caller is already signed in, so limits are kept
// per approver and per caller (the desktop, or one signed-in employee):
// LOGIN_MAX_ATTEMPTS within LOGIN_WINDOW_MINUTES locks for LOGIN_LOCK_MINUTES,
// and APPROVAL_DAILY_MAX in 24 hours stops that caller. One attendant's
// guessing then cannot block the owner's approvals at the desktop, and no
// caller can keep guessing indefinitely.
//
// Counts live in memory and reset when the backend restarts.
const positiveNumber = (value: unknown, fallback: number) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const LOGIN_MAX_ATTEMPTS = positiveNumber(process.env.LOGIN_MAX_ATTEMPTS, 5);
const LOGIN_LOCK_MS = positiveNumber(process.env.LOGIN_LOCK_MINUTES, 15) * 60 * 1000;
const LOGIN_WINDOW_MS = positiveNumber(process.env.LOGIN_WINDOW_MINUTES, 15) * 60 * 1000;
const LOGIN_UNTRUSTED_DAILY_MAX = positiveNumber(process.env.LOGIN_UNTRUSTED_DAILY_MAX, 5);
const APPROVAL_DAILY_MAX = positiveNumber(process.env.APPROVAL_DAILY_MAX, 20);
const DAY_MS = 24 * 60 * 60 * 1000;
const loginAttempts = new Map<string, { failures: number; firstFailureAt: number; lockedUntil: number }>();
// Rolling 24-hour failure times, per account or per approver and caller.
const dailyFailures = new Map<string, number[]>();
// Wrong guesses in a row from each known device since it last signed in.
const deviceFailures = new Map<string, number>();

function dailyLockSeconds(key: string, max: number): number {
  const now = Date.now();
  const recent = (dailyFailures.get(key) || []).filter((at) => now - at < DAY_MS);
  if (recent.length === 0) {
    dailyFailures.delete(key);
    return 0;
  }
  dailyFailures.set(key, recent);
  if (recent.length < max) return 0;
  // Open again once enough of the oldest failures are a day old.
  return Math.max(1, Math.ceil((recent[recent.length - max] + DAY_MS - now) / 1000));
}

function recordDailyFailure(key: string) {
  const recent = dailyFailures.get(key) || [];
  recent.push(Date.now());
  dailyFailures.set(key, recent);
}

function waitMessage(seconds: number) {
  return seconds >= 2 * 60 * 60
    ? `${Math.ceil(seconds / 3600)} hours`
    : `${Math.ceil(seconds / 60)} minute(s)`;
}

// Where a wrong guess came from, for the station log only; never used to decide
// anything (see above). The forwarded header is the client's own text.
function logPinFailure(kind: string, employeeId: number, detail: string, req: any) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').slice(0, 100);
  console.warn(
    `[auth:${kind}] incorrect PIN for employee ${employeeId} (${detail}); peer ${req.socket?.remoteAddress || 'unknown'}, forwarded ${JSON.stringify(forwarded)}`,
  );
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
  loginAttempts.set(key, {
    failures,
    firstFailureAt: withinWindow ? current.firstFailureAt : now,
    lockedUntil: failures >= LOGIN_MAX_ATTEMPTS ? Date.now() + LOGIN_LOCK_MS : 0,
  });
}

function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { employee_id, pin, device_token } = req.body || {};
    const employeeId = Number(employee_id);
    const submittedPin = typeof pin === 'string' ? pin : '';
    if (!Number.isInteger(employeeId) || employeeId <= 0 || !submittedPin) {
      return res.status(400).json({ success: false, error: 'Employee ID and PIN are required' });
    }

    // Which allowance this guess uses (see the top of this file).
    const claim = verifyDeviceToken(device_token);
    const trustedDevice = claim && claim.employee === employeeId
      && (deviceFailures.get(claim.device) || 0) < LOGIN_MAX_ATTEMPTS
      ? claim.device
      : null;
    const accountKey = `login:${employeeId}`;
    if (!trustedDevice) {
      // Refused before the PIN is checked, so a right guess cannot slip through.
      const lockSeconds = dailyLockSeconds(accountKey, LOGIN_UNTRUSTED_DAILY_MAX);
      if (lockSeconds > 0) {
        return res.status(429).json({
          success: false,
          error: `Too many wrong PINs for this account from new devices. Sign in on a phone you have used before, or try again in ${waitMessage(lockSeconds)}.`,
          retry_after_seconds: lockSeconds,
        });
      }
    }

    const employee = await db('employees')
      .where({ id: employeeId, active: true })
      .first();

    // No account, nothing to guess. Counting only real accounts' failures also
    // keeps the counters from growing with made-up IDs.
    if (!employee) {
      return res.status(401).json({ success: false, error: 'Invalid employee or PIN' });
    }

    if (!verifyPin(submittedPin, employee.pin)) {
      if (trustedDevice) deviceFailures.set(trustedDevice, (deviceFailures.get(trustedDevice) || 0) + 1);
      else recordDailyFailure(accountKey);
      logPinFailure('login', employeeId, trustedDevice ? 'known device' : 'new device', req);
      return res.status(401).json({ success: false, error: 'Invalid employee or PIN' });
    }

    if (!isHashedPin(employee.pin)) {
      await db('employees').where({ id: employee.id }).update({ pin: hashPin(submittedPin) });
    }

    // Return employee data without pin, plus a session token. The new-device
    // allowance is deliberately not reset by a sign-in: it only recovers with
    // time, so a success anywhere never hands a guesser a fresh set.
    if (trustedDevice) deviceFailures.delete(trustedDevice);
    const { pin: _pin, ...employeeData } = employee;
    const issuedAt = new Date();
    const ttlMs = getSessionTtlMs();
    const token = generateToken(employee.id, employee.role);
    res.json({
      success: true,
      data: employeeData,
      token,
      // Marks this device as known for this employee from now on.
      device_token: generateDeviceToken(employee.id),
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
// Wrong PINs are limited per approver and per caller (see the top of this
// file), never per client address: every desktop request comes from the same
// terminal, and the limit must hold however the request is sent.
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

    const sessionId = Number((req as any).employee?.id);
    const caller = sessionId > 0 ? `employee:${sessionId}` : 'desktop';
    const attemptKey = `approval:${approverId}:${caller}`;
    const lockSeconds = Math.max(
      getLoginLockSeconds(attemptKey),
      dailyLockSeconds(attemptKey, APPROVAL_DAILY_MAX),
    );
    if (lockSeconds > 0) {
      return res.status(429).json({
        success: false,
        error: `Too many incorrect PINs for this approver on this device. Try again in ${waitMessage(lockSeconds)}.`,
        retry_after_seconds: lockSeconds,
      });
    }

    const approver = await db('employees')
      .where({ id: approverId, active: true, role: 'admin' })
      .first();
    if (!approver) {
      // Not an active administrator: nothing to guess, nothing counted.
      return res.status(403).json({ success: false, error: 'Incorrect PIN for the selected approver.' });
    }
    if (!verifyPin(submittedPin, approver.pin)) {
      recordLoginFailure(attemptKey);
      recordDailyFailure(attemptKey);
      logPinFailure('approval', approverId, `asked by ${caller}`, req);
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
