import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

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
