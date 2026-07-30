import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
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

const router = Router();
router.use(requireAdmin);

router.get('/runs', async (req, res) => {
  try {
    const query = db('payroll_runs')
      .join('payroll_periods', 'payroll_runs.period_id', 'payroll_periods.id')
      .select(
        'payroll_runs.*',
        'payroll_periods.name',
        'payroll_periods.pay_schedule',
        'payroll_periods.period_start',
        'payroll_periods.period_end',
      )
      .orderBy('payroll_periods.period_end', 'desc')
      .orderBy('payroll_runs.id', 'desc');
    if (req.query.status) query.where('payroll_runs.status', String(req.query.status));
    res.json({ success: true, data: await query });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/runs/preview', async (req, res) => {
  const parsed = payrollPeriodSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid payroll period.',
    });
  }
  try {
    res.json({ success: true, data: await previewPayrollRun(parsed.data) });
  } catch (err: any) {
    res.status(err.httpStatus || 500).json({
      success: false,
      code: err.code,
      error: err.message,
    });
  }
});

router.get('/runs/:id', async (req, res) => {
  try {
    const run = await getPayrollRun(Number(req.params.id));
    if (!run) return res.status(404).json({ success: false, error: 'Payroll run not found' });
    res.json({ success: true, data: run });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/runs/calculate', validate(calculatePayrollRunSchema), async (req: any, res) => {
  try {
    const runId = await calculatePayrollRun({
      ...req.body,
      created_by_employee_id: req.employee?.id > 0 ? req.employee.id : null,
    });
    res.status(201).json({ success: true, data: await getPayrollRun(runId) });
  } catch (err: any) {
    const duplicate = String(err.message).includes('UNIQUE constraint failed');
    res.status(err.httpStatus || (duplicate ? 409 : 500)).json({
      success: false,
      code: err.code,
      error: duplicate ? 'A payroll run already exists for this schedule and period.' : err.message,
    });
  }
});

router.post(
  '/runs/:runId/lines/:lineId/deductions',
  validate(createPayrollDeductionSchema),
  async (req: any, res) => {
    try {
      const line = await db('payroll_lines')
        .join('payroll_runs', 'payroll_lines.run_id', 'payroll_runs.id')
        .where({
          'payroll_lines.id': req.params.lineId,
          'payroll_lines.run_id': req.params.runId,
        })
        .select('payroll_lines.*', 'payroll_runs.status as run_status')
        .first();
      if (!line) return res.status(404).json({ success: false, error: 'Payroll line not found' });
      if (line.run_status !== 'calculated') {
        return res.status(409).json({ success: false, error: 'Deductions can only be changed before approval.' });
      }
      const available = Number(line.gross_earnings || 0) - Number(line.total_deductions || 0);
      if (req.body.amount > available) {
        return res.status(400).json({
          success: false,
          error: `Deduction cannot exceed available gross earnings of KES ${available.toFixed(2)}`,
        });
      }
      if (req.body.deduction_type === 'staff_debt') {
        const debtRow = await db('staff_debts')
          .where({ employee_id: line.employee_id, status: 'outstanding' })
          .sum('balance as total')
          .first();
        const outstanding = Number(debtRow?.total || 0);
        if (req.body.amount > outstanding) {
          return res.status(400).json({
            success: false,
            error: `Deduction exceeds outstanding staff debt of KES ${outstanding.toFixed(2)}`,
          });
        }
      }

      const [deductionId] = await db('payroll_deductions').insert({
        payroll_line_id: line.id,
        employee_id: line.employee_id,
        deduction_type: req.body.deduction_type,
        amount: req.body.amount,
        authorization_reference: req.body.authorization_reference || null,
        notes: req.body.notes || null,
        status: 'draft',
        created_by_employee_id: req.employee?.id > 0 ? req.employee.id : null,
      });
      await db.transaction(async (trx) => {
        await refreshPayrollLine(line.id, trx);
        await refreshPayrollRun(line.run_id, trx);
      });
      res.status(201).json({
        success: true,
        data: await db('payroll_deductions').where({ id: deductionId }).first(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

router.delete('/runs/:runId/deductions/:deductionId', async (req, res) => {
  try {
    const deduction = await db('payroll_deductions')
      .join('payroll_lines', 'payroll_deductions.payroll_line_id', 'payroll_lines.id')
      .join('payroll_runs', 'payroll_lines.run_id', 'payroll_runs.id')
      .where({
        'payroll_deductions.id': req.params.deductionId,
        'payroll_runs.id': req.params.runId,
      })
      .select(
        'payroll_deductions.*',
        'payroll_lines.run_id',
        'payroll_runs.status as run_status',
      )
      .first();
    if (!deduction) return res.status(404).json({ success: false, error: 'Deduction not found' });
    if (deduction.run_status !== 'calculated' || deduction.status !== 'draft') {
      return res.status(409).json({ success: false, error: 'Only draft deductions can be removed.' });
    }
    await db('payroll_deductions').where({ id: deduction.id }).delete();
    await db.transaction(async (trx) => {
      await refreshPayrollLine(deduction.payroll_line_id, trx);
      await refreshPayrollRun(deduction.run_id, trx);
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/runs/:id/approve', async (req: any, res) => {
  try {
    await approvePayrollRun(
      Number(req.params.id),
      req.employee?.id > 0 ? req.employee.id : null,
    );
    res.json({ success: true, data: await getPayrollRun(Number(req.params.id)) });
  } catch (err: any) {
    res.status(409).json({ success: false, error: err.message });
  }
});

router.post('/lines/:lineId/payments', validate(createPayrollPaymentSchema), async (req: any, res) => {
  try {
    const line = await db('payroll_lines')
      .join('payroll_runs', 'payroll_lines.run_id', 'payroll_runs.id')
      .where('payroll_lines.id', req.params.lineId)
      .select('payroll_lines.*', 'payroll_runs.status as run_status')
      .first();
    if (!line) return res.status(404).json({ success: false, error: 'Payroll line not found' });
    if (!['approved', 'partially_paid'].includes(line.run_status)) {
      return res.status(409).json({ success: false, error: 'Approve the payroll run before recording payment.' });
    }
    if (req.body.amount > Number(line.balance_due || 0)) {
      return res.status(400).json({
        success: false,
        error: `Payment cannot exceed balance due of KES ${Number(line.balance_due || 0).toFixed(2)}`,
      });
    }
    if (req.body.shift_id) {
      if (!['cash', 'mpesa'].includes(req.body.payment_method)) {
        return res.status(400).json({
          success: false,
          error: 'Only cash or M-Pesa payroll payments can be linked to a shift.',
        });
      }
      const shift = await db('shifts').where({ id: req.body.shift_id }).first();
      if (!shift || shift.status !== 'open') {
        return res.status(409).json({
          success: false,
          error: 'A drawer payment can only be linked to an open shift.',
        });
      }
    }

    const [paymentId] = await db('payroll_payments').insert({
      payroll_line_id: line.id,
      employee_id: line.employee_id,
      shift_id: req.body.shift_id || null,
      amount: req.body.amount,
      payment_method: req.body.payment_method,
      payment_date: req.body.payment_date,
      reference: req.body.reference || null,
      notes: req.body.notes || null,
      status: 'posted',
      created_by_employee_id: req.employee?.id > 0 ? req.employee.id : null,
    });
    await db.transaction(async (trx) => {
      await refreshPayrollLine(line.id, trx);
      await refreshPayrollRun(line.run_id, trx);
    });
    res.status(201).json({
      success: true,
      data: await db('payroll_payments').where({ id: paymentId }).first(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/payments/:id/reverse', validate(payrollReasonSchema), async (req, res) => {
  try {
    const payment = await db('payroll_payments')
      .join('payroll_lines', 'payroll_payments.payroll_line_id', 'payroll_lines.id')
      .where('payroll_payments.id', req.params.id)
      .select('payroll_payments.*', 'payroll_lines.run_id')
      .first();
    if (!payment) return res.status(404).json({ success: false, error: 'Payroll payment not found' });
    if (payment.status !== 'posted') {
      return res.status(409).json({ success: false, error: 'Payment is already reversed.' });
    }
    if (isShiftWageMirror(payment)) {
      return res.status(409).json({
        success: false,
        error: 'This payment was recorded when its shift closed and cannot be reversed from Payroll.',
      });
    }
    await db('payroll_payments').where({ id: payment.id }).update({
      status: 'reversed',
      reversed_at: db.fn.now(),
      reversal_reason: req.body.reason,
    });
    await db.transaction(async (trx) => {
      await refreshPayrollLine(payment.payroll_line_id, trx);
      await refreshPayrollRun(payment.run_id, trx);
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/runs/:id/void', validate(payrollReasonSchema), async (req, res) => {
  try {
    await voidPayrollRun(Number(req.params.id), req.body.reason);
    res.json({ success: true, data: await getPayrollRun(Number(req.params.id)) });
  } catch (err: any) {
    res.status(409).json({ success: false, error: err.message });
  }
});

export default router;
