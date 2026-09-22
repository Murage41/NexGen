import { Router } from 'express';
import type { Knex } from 'knex';
import db from '../database';
import { requireAdmin, requireAuth } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import {
  calculatePayrollRunSchema,
  createPayrollDeductionSchema,
  createPayrollPaymentSchema,
  payrollPeriodSchema,
  payrollReasonSchema,
} from '../schemas';
import {
  approvePayrollRun,
  calculatePayrollRun,
  getPayrollRun,
  previewPayrollRun,
  refreshPayrollLine,
  refreshPayrollRun,
  voidPayrollRun,
} from '../services/payroll';
import { isShiftWageMirror } from '../services/payrollAccounting';
import {
  runIdempotent,
  normalizeIdempotencyKey,
} from '../services/idempotency';
import {
  addPayrollDeduction,
  recordPayrollPayment,
  editablePayrollLine,
} from '../services/payrollMutations';
import {
  employeePayStatement,
  employeeDebtHistory,
  recordEmployeeDebtReceipt,
  reverseEmployeeDebtReceipt,
} from '../services/employeePay';
import { settlementError, positiveMoney } from '../services/employeeDebt';
import { getVarianceStatement, refundVariance, waiveVariance } from '../services/employeeVariances';
import { approvalBindings, resolveApprover } from '../services/approval';

const router = Router();
const fail = (res: any, e: any) =>
  res
    .status(e.httpStatus || e.http || 409)
    .json({ success: false, error: e.message });
const actor = (req: any) =>
  Number(req.employee?.id) > 0 ? Number(req.employee.id) : null;
async function mutate(
  req: any,
  res: any,
  scope: string,
  operation: (trx: Knex.Transaction) => Promise<any>,
) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key)
      throw settlementError(
        'A payment operation key is required. Refresh the application and retry.',
        400,
      );
    const result = await runIdempotent(
      db,
      { scope: `${scope}:${actor(req) || 'desktop'}`, key, payload: req.body },
      async (trx) => ({
        status: 200,
        body: { success: true, data: await operation(trx) },
      }),
    );
    res.status(result.status).json(result.body);
  } catch (e) {
    fail(res, e);
  }
}

// Never accept an employee id from the client on the self-service endpoint.
router.get('/me', requireAuth, async (req: any, res) => {
  try {
    if (!actor(req))
      throw settlementError('Sign in as an employee to view My Pay.', 403);
    res.json({
      success: true,
      data: await employeePayStatement(actor(req)!, db),
    });
  } catch (e) {
    fail(res, e);
  }
});
router.use(requireAdmin);
router.get('/employees/:id', async (req, res) => {
  try {
    res.json({
      success: true,
      data: await employeePayStatement(Number(req.params.id), db),
    });
  } catch (e) {
    fail(res, e);
  }
});
router.post('/employees/:id/receipts', (req, res) =>
  mutate(req, res, `debt-receipt:${req.params.id}`, (trx) =>
    recordEmployeeDebtReceipt(Number(req.params.id), req.body, actor(req), trx),
  ),
);
router.post(
  '/receipts/:id/reverse',
  validate(payrollReasonSchema),
  (req, res) =>
    mutate(req, res, `debt-receipt-reverse:${req.params.id}`, (trx) =>
      reverseEmployeeDebtReceipt(
        Number(req.params.id),
        req.body.reason,
        trx,
        actor(req),
      ),
    ),
);
// Attendant variances (services/employeeVariances.ts): the statement, and
// writing off or paying back. Repayments use /employees/:id/receipts above.
router.get('/employees/:id/variances', async (req, res) => {
  try {
    const asOf = typeof req.query.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.as_of)
      ? req.query.as_of
      : undefined;
    const statement = await getVarianceStatement(db, Number(req.params.id), { asOf });
    // The staff-debt records from before variances started, shown as history.
    res.json({ success: true, data: { ...statement, earlier: await employeeDebtHistory(Number(req.params.id), db) } });
  } catch (e) {
    fail(res, e);
  }
});
// { amount, shift_id?, reason, approval_token? }
router.post('/employees/:id/variances/waivers', (req: any, res) =>
  mutate(req, res, `variance-waiver:${req.params.id}`, async (trx) => {
    const approver = await resolveApprover(
      actor(req),
      req.body?.approval_token,
      approvalBindings.variance_waiver({ for_employee_id: Number(req.params.id), shift_id: req.body?.shift_id, amount: req.body?.amount }),
      trx,
    );
    await waiveVariance(trx, Number(req.params.id), req.body || {}, approver, actor(req));
    return getVarianceStatement(trx, Number(req.params.id));
  }),
);
// { amount, method: 'cash'|'mpesa', date, reference?, approval_token? }
router.post('/employees/:id/variances/refunds', (req: any, res) =>
  mutate(req, res, `variance-refund:${req.params.id}`, async (trx) => {
    const approver = await resolveApprover(
      actor(req),
      req.body?.approval_token,
      approvalBindings.variance_refund({ for_employee_id: Number(req.params.id), method: req.body?.method, amount: req.body?.amount }),
      trx,
    );
    await refundVariance(trx, Number(req.params.id), req.body || {}, approver, actor(req));
    return getVarianceStatement(trx, Number(req.params.id));
  }),
);
// Retired with debt recovery: variances are repaid separately and never taken
// from pay.
const retired = (_req: any, res: any) =>
  res.status(410).json({ success: false, error: 'Debt recovery has been replaced by Employees, Variances.' });
router.post('/refunds/:id/settle', retired);
router.put('/employees/:id/recovery-limit', retired);
router.put('/debts/:id/review', retired);
router.get('/runs', async (req, res) => {
  try {
    const query = db('payroll_runs as r')
      .join('payroll_periods as p', 'r.period_id', 'p.id')
      .select(
        'r.*',
        'p.name',
        'p.pay_schedule',
        'p.period_start',
        'p.period_end',
      )
      .orderBy('p.period_end', 'desc')
      .orderBy('r.id', 'desc');
    if (req.query.status) query.where('r.status', String(req.query.status));
    res.json({ success: true, data: await query });
  } catch (e) {
    fail(res, e);
  }
});
router.get('/runs/preview', async (req, res) => {
  const parsed = payrollPeriodSchema.safeParse(req.query);
  if (!parsed.success)
    return res
      .status(400)
      .json({ success: false, error: parsed.error.issues[0]?.message });
  try {
    res.json({ success: true, data: await previewPayrollRun(parsed.data) });
  } catch (e) {
    fail(res, e);
  }
});
router.get('/runs/:id', async (req, res) => {
  try {
    const run = await getPayrollRun(Number(req.params.id));
    if (!run) throw settlementError('Payroll not found.', 404);
    res.json({ success: true, data: run });
  } catch (e) {
    fail(res, e);
  }
});
router.post(
  '/runs/calculate',
  validate(calculatePayrollRunSchema),
  async (req, res) => {
    try {
      const id = await calculatePayrollRun({
        ...req.body,
        created_by_employee_id: actor(req),
      });
      res.status(201).json({ success: true, data: await getPayrollRun(id) });
    } catch (e) {
      fail(res, e);
    }
  },
);
router.put('/runs/:runId/lines/:lineId/recovery', retired);
router.post(
  '/runs/:runId/lines/:lineId/deductions',
  validate(createPayrollDeductionSchema),
  (req, res) =>
    mutate(
      req,
      res,
      `deduction:${req.params.runId}:${req.params.lineId}`,
      (trx) =>
        addPayrollDeduction(
          Number(req.params.runId),
          Number(req.params.lineId),
          req.body,
          actor(req),
          trx,
        ),
    ),
);
router.delete('/runs/:runId/deductions/:deductionId', async (req, res) => {
  try {
    await db.transaction(async (trx) => {
      const deduction = await trx('payroll_deductions')
        .where({ id: req.params.deductionId })
        .first();
      if (!deduction) throw settlementError('Deduction not found.', 404);
      await editablePayrollLine(
        Number(req.params.runId),
        deduction.payroll_line_id,
        trx,
      );
      if (deduction.status !== 'draft')
        throw settlementError('Only draft deductions can be removed.');
      await trx('payroll_deductions').where({ id: deduction.id }).delete();
      await trx('payroll_lines')
        .where({ id: deduction.payroll_line_id })
        .update({ recovery_review: null });
      await refreshPayrollLine(deduction.payroll_line_id, trx);
      await refreshPayrollRun(Number(req.params.runId), trx);
    });
    res.json({ success: true });
  } catch (e) {
    fail(res, e);
  }
});
router.post('/runs/:id/supplement', async (req, res) => {
  try {
    const original = await getPayrollRun(Number(req.params.id));
    if (!original) throw settlementError('Original payroll not found.', 404);
    const id = await calculatePayrollRun({
      name: original.name + ' — supplemental shifts',
      supplement_of: original.id,
      pay_schedule: original.pay_schedule,
      period_start: original.period_start,
      period_end: original.period_end,
      created_by_employee_id: actor(req),
    });
    res.json({ success: true, data: await getPayrollRun(id) });
  } catch (e) {
    fail(res, e);
  }
});
router.post('/runs/:id/approve', async (req, res) => {
  try {
    await approvePayrollRun(Number(req.params.id), actor(req));
    res.json({
      success: true,
      data: await getPayrollRun(Number(req.params.id)),
    });
  } catch (e) {
    fail(res, e);
  }
});
router.post(
  '/lines/:lineId/payments',
  validate(createPayrollPaymentSchema),
  (req, res) =>
    mutate(req, res, `payroll-payment:${req.params.lineId}`, (trx) =>
      recordPayrollPayment(
        Number(req.params.lineId),
        req.body,
        actor(req),
        trx,
      ),
    ),
);
router.post(
  '/payments/:id/reverse',
  validate(payrollReasonSchema),
  (req, res) =>
    mutate(req, res, `payroll-reverse:${req.params.id}`, async (trx) => {
      const p = await trx('payroll_payments')
        .where({ id: req.params.id })
        .first();
      if (!p || p.status !== 'posted')
        throw settlementError('Payment is missing or already reversed.');
      if (isShiftWageMirror(p))
        throw settlementError(
          'Reconcile the source shift before correcting its imported payment.',
        );
      if (p.shift_id) {
        const shift = await trx('shifts').where({ id: p.shift_id }).first();
        if (shift?.status !== 'open')
          throw settlementError(
            'A payment in a closed shift requires a shift accounting correction.',
          );
      }
      const line = await trx('payroll_lines')
        .where({ id: p.payroll_line_id })
        .first();
      await trx('payroll_payments')
        .where({ id: p.id })
        .update({
          status: 'reversed',
          reversed_at: trx.fn.now(),
          reversal_reason: `${req.body.reason} (recorded by ${actor(req) || 'desktop admin'})`,
        });
      await refreshPayrollLine(p.payroll_line_id, trx);
      await refreshPayrollRun(line.run_id, trx);
    }),
);
router.post(
  '/runs/:id/void',
  validate(payrollReasonSchema),
  async (req, res) => {
    try {
      await voidPayrollRun(
        Number(req.params.id),
        `${req.body.reason} (recorded by ${actor(req) || 'desktop admin'})`,
      );
      res.json({
        success: true,
        data: await getPayrollRun(Number(req.params.id)),
      });
    } catch (e) {
      fail(res, e);
    }
  },
);
export default router;
