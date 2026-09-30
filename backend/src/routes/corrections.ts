import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { approvalBindings, resolveApprover } from '../services/approval';
import { normalizeIdempotencyKey, runIdempotent } from '../services/idempotency';
import {
  correctionDetail,
  correctionReasons,
  listCorrections,
  postCorrection,
  previewCorrection,
  tidyDrafts,
  undoCorrection,
} from '../services/corrections';
import { getKenyaDate } from '../utils/timezone';

// Corrections (services/corrections.ts, docs/CORRECTIONS.md): the one way to
// fix a mistake in a closed record. Administrators only.
const router = Router();
router.use(requireAdmin);

const fail = (res: any, where: string, err: any) => {
  if (!err.http) console.error(`[corrections:${where}] ERROR`, err.message, err.stack);
  res.status(err.http || err.httpStatus || 500).json({ success: false, error: err.message, code: err.code });
};
const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);
const actor = (req: any) => (Number(req.employee?.id) > 0 ? Number(req.employee.id) : null);

// GET /corrections?from=&to=&shift_id=&account_id=
router.get('/', async (req, res) => {
  try {
    res.json({
      success: true,
      data: await listCorrections(db, {
        from: date(req.query.from),
        to: date(req.query.to),
        shiftId: Number(req.query.shift_id) > 0 ? Number(req.query.shift_id) : undefined,
        accountId: Number(req.query.account_id) > 0 ? Number(req.query.account_id) : undefined,
      }),
    });
  } catch (err: any) {
    fail(res, 'list', err);
  }
});

router.get('/reasons', async (_req, res) => {
  try {
    res.json({ success: true, data: await correctionReasons(db) });
  } catch (err: any) {
    fail(res, 'reasons', err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    res.json({ success: true, data: await correctionDetail(db, Number(req.params.id)) });
  } catch (err: any) {
    fail(res, 'detail', err);
  }
});

// POST /corrections/preview  Body: the correction request (services/corrections.ts CorrectionRequest).
// Returns the plan: lines, notes, shift results, effects in words, plan_hash.
router.post('/preview', async (req, res) => {
  try {
    res.json({ success: true, data: await previewCorrection(db, req.body || {}, getKenyaDate()) });
  } catch (err: any) {
    fail(res, 'preview', err);
  }
});

// POST /corrections  Body: the request + plan_hash + approval_token (desktop).
router.post('/', async (req: any, res) => {
  console.log('[corrections:post]', { ...req.body, approval_token: undefined });
  try {
    const body = req.body || {};
    const result = await runIdempotent(
      db,
      { scope: 'correction', key: normalizeIdempotencyKey(req.get('Idempotency-Key')), payload: { ...body, approval_token: undefined } },
      async (trx) => {
        const approver = await resolveApprover(actor(req), body.approval_token, approvalBindings.correction(body), trx);
        const posted = await postCorrection(trx, body, { planHash: String(body.plan_hash || ''), approver, actorId: actor(req), date: getKenyaDate() });
        return { status: 201, body: { success: true, data: posted } };
      },
    );
    const posted = (result.body as any).data;
    await tidyDrafts(db, posted.drafts || []);
    res.status(result.status).json({ success: true, data: await correctionDetail(db, posted.id) });
  } catch (err: any) {
    fail(res, 'post', err);
  }
});

// POST /corrections/:id/undo  Body: { reason_note, approval_token? }
router.post('/:id/undo', async (req: any, res) => {
  try {
    const body = req.body || {};
    const correctionId = Number(req.params.id);
    const result = await runIdempotent(
      db,
      { scope: 'correction-undo', key: normalizeIdempotencyKey(req.get('Idempotency-Key')), payload: { ...body, correctionId, approval_token: undefined } },
      async (trx) => {
        const approver = await resolveApprover(actor(req), body.approval_token, approvalBindings.correction_undo({ correction_id: correctionId }), trx);
        const done = await undoCorrection(trx, { correctionId, reasonNote: body.reason_note, approver, actorId: actor(req), date: getKenyaDate() });
        return { status: 201, body: { success: true, data: done } };
      },
    );
    const done = (result.body as any).data;
    await tidyDrafts(db, done.drafts || []);
    res.status(result.status).json({ success: true, data: await correctionDetail(db, done.id) });
  } catch (err: any) {
    fail(res, 'undo', err);
  }
});

export default router;
