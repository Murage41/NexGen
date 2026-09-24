import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { approvalBindings, resolveApprover } from '../services/approval';
import { normalizeIdempotencyKey, runIdempotent } from '../services/idempotency';
import { listBalanceMoves, listMoveParties, postBalanceMove } from '../services/balanceMoves';

// Balance moves (services/balanceMoves.ts): fixing a mistake found on a closed
// shift by moving an amount between customers, employees and the station. The
// shift itself never changes. Administrators only.
const router = Router();
router.use(requireAdmin);

// GET /balance-moves?from=&to=&shift_id=
router.get('/', async (req, res) => {
  try {
    const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);
    const shiftId = Number(req.query.shift_id) > 0 ? Number(req.query.shift_id) : undefined;
    res.json({ success: true, data: await listBalanceMoves(db, { from: date(req.query.from), to: date(req.query.to), shiftId }) });
  } catch (err: any) {
    console.error('[balanceMoves:list] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /balance-moves/parties - customers (with what they owe) and employees.
router.get('/parties', async (_req, res) => {
  try {
    res.json({ success: true, data: await listMoveParties(db) });
  } catch (err: any) {
    console.error('[balanceMoves:parties] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /balance-moves
// Body: { from_kind, from_id?, to_kind, to_id?, amount, reason, shift_id?, approval_token? }
// kinds: 'customer' | 'employee' | 'station'. An administrator approves: their
// own session, or a PIN token on the desktop (purpose 'balance_move').
router.post('/', async (req: any, res) => {
  console.log('[balanceMoves:post]', { ...req.body, approval_token: undefined });
  try {
    const body = req.body || {};
    const sessionEmployeeId = Number(req.employee?.id) > 0 ? Number(req.employee.id) : null;
    const result = await runIdempotent(
      db,
      { scope: 'balance-move', key: normalizeIdempotencyKey(req.get('Idempotency-Key')), payload: { ...body, approval_token: undefined } },
      async (trx) => {
        const approver = await resolveApprover(sessionEmployeeId, body.approval_token, approvalBindings.balance_move(body), trx);
        const move = await postBalanceMove(trx, body, approver, sessionEmployeeId);
        return { status: 201, body: { success: true, data: move } };
      },
    );
    res.status(result.status).json(result.body);
  } catch (err: any) {
    console.error('[balanceMoves:post] ERROR', err.message);
    res.status(err.http || err.httpStatus || 500).json({ success: false, error: err.message, code: err.code });
  }
});

export default router;
