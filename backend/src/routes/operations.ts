import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { runOperationalIntegrityCheck } from '../services/operationalIntegrity';
import {
  getStaleShiftHours,
  listStaleOpenShifts,
  updateStaleShiftHours,
} from '../services/shiftOperations';

const router = Router();

router.get('/settings', requireAdmin, async (_req, res) => {
  try {
    const staleShiftHours = await getStaleShiftHours(db);
    res.json({ success: true, data: { stale_shift_hours: staleShiftHours } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const data = await updateStaleShiftHours(db, req.body.stale_shift_hours);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(err.httpStatus || 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.get('/stale-shifts', requireAdmin, async (_req, res) => {
  try {
    const data = await listStaleOpenShifts(db);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/integrity', requireAdmin, async (_req, res) => {
  try {
    const data = await runOperationalIntegrityCheck(db);
    res.status(data.ok ? 200 : 409).json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
