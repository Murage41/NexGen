import { Router } from 'express';
import db from '../database';
import { generateToken, getSessionTtlMs } from '../middleware/requireAdmin';
import { hashPin, isHashedPin, verifyPin } from '../services/pinSecurity';

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

export default router;
