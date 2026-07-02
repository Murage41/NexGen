import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import db from '../database';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_SESSION_SECRET = 'dev-only-nexgen-station-secret-2026';
const DEV_DESKTOP_KEY = 'nexgen-desktop-2026';
const DEFAULT_SESSION_TTL_HOURS = 12;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (!IS_PRODUCTION) return DEV_SESSION_SECRET;
  throw new Error('SESSION_SECRET must be configured in production.');
}

function getDesktopKey(): string | null {
  const desktopKey = process.env.DESKTOP_KEY;
  if (desktopKey) return desktopKey;
  if (!IS_PRODUCTION) return DEV_DESKTOP_KEY;
  return null;
}

export function getSessionTtlMs(): number {
  const ttlHours = Number(process.env.SESSION_TTL_HOURS || DEFAULT_SESSION_TTL_HOURS);
  const safeTtlHours = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : DEFAULT_SESSION_TTL_HOURS;
  return safeTtlHours * 60 * 60 * 1000;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function isValidDesktopKey(headerValue: string | string[] | undefined): boolean {
  if (typeof headerValue !== 'string') return false;
  const configuredKey = getDesktopKey();
  return !!configuredKey && timingSafeStringEqual(headerValue, configuredKey);
}

export function assertAuthConfiguration() {
  if (!IS_PRODUCTION) return;

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  }

  const desktopKey = process.env.DESKTOP_KEY;
  if (desktopKey && desktopKey.length < 24) {
    throw new Error('DESKTOP_KEY must be at least 24 characters when configured in production.');
  }
}

export function generateToken(employeeId: number, role: string, userId?: number | null): string {
  const payload = Buffer.from(JSON.stringify({
    id: employeeId,
    employee_id: employeeId,
    user_id: userId ?? null,
    role,
    ts: Date.now(),
  })).toString('base64');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): {
  id: number;
  employee_id?: number;
  user_id?: number | null;
  role: string;
  ts: number;
} | null {
  try {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const payload = token.slice(0, dotIndex);
    const sig = token.slice(dotIndex + 1);
    const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('hex');
    if (!timingSafeStringEqual(sig, expectedSig)) return null;

    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (
      typeof decoded.id !== 'number' ||
      typeof decoded.role !== 'string' ||
      typeof decoded.ts !== 'number'
    ) {
      return null;
    }

    if (decoded.employee_id !== undefined && typeof decoded.employee_id !== 'number') return null;
    if (decoded.user_id !== undefined && decoded.user_id !== null && typeof decoded.user_id !== 'number') return null;
    if (decoded.ts > Date.now() + 5 * 60 * 1000) return null;
    if (Date.now() - decoded.ts > getSessionTtlMs()) return null;

    return decoded;
  } catch {
    return null;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (isValidDesktopKey(req.headers['x-desktop-key'])) {
    (req as any).employee = { id: 0, role: 'admin' };
    return next();
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const token = auth.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session. Please log in again.' });
  }

  if (decoded.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  (req as any).employee = decoded;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isValidDesktopKey(req.headers['x-desktop-key'])) {
    (req as any).employee = { id: 0, role: 'admin' };
    return next();
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const token = auth.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session. Please log in again.' });
  }

  (req as any).employee = decoded;
  next();
}

// Shift-scope guard: admins unrestricted; attendants can only touch their own shift.
// Expects req.params.id = shift_id and req.employee set by a prior auth middleware.
export async function requireOwnShiftOrAdmin(req: Request, res: Response, next: NextFunction) {
  const employee = (req as any).employee;
  if (!employee) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (employee.role === 'admin') return next();

  try {
    const shift = await db('shifts').where({ id: req.params.id }).select('employee_id').first();
    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });
    if (shift.employee_id !== employee.id) {
      return res.status(403).json({ success: false, error: 'You can only modify your own shift' });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
