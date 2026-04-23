import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import db from '../database';

const SECRET = process.env.SESSION_SECRET || 'nexgen-station-secret-2026';

export function generateToken(employeeId: number, role: string): string {
  const payload = Buffer.from(JSON.stringify({ id: employeeId, role, ts: Date.now() })).toString('base64');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { id: number; role: string; ts: number } | null {
  try {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex === -1) return null;
    const payload = token.slice(0, dotIndex);
    const sig = token.slice(dotIndex + 1);
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    if (sig !== expectedSig) return null;
    return JSON.parse(Buffer.from(payload, 'base64').toString());
  } catch {
    return null;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Allow desktop app (Electron) using shared desktop key — desktop is admin-only by design
  const desktopKey = req.headers['x-desktop-key'];
  if (desktopKey && desktopKey === (process.env.DESKTOP_KEY || 'nexgen-desktop-2026')) {
    (req as any).employee = { id: 0, role: 'admin' };
    return next();
  }

  // Mobile: require Bearer token
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
  // Desktop app uses shared key — grant admin-level access (desktop is admin-only by design)
  const desktopKey = req.headers['x-desktop-key'];
  if (desktopKey && desktopKey === (process.env.DESKTOP_KEY || 'nexgen-desktop-2026')) {
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
// Expects `req.params.id` = shift_id and `req.employee` set by a prior auth middleware.
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
