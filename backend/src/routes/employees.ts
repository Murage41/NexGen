import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createCompensationPlanSchema, createEmployeeSchema, updateEmployeeSchema } from '../schemas';
import { hashPin } from '../services/pinSecurity';
import {
  describeCompensationPlan,
  getCompensationPlan,
  listCompensationPlans,
  previousCalendarDate,
} from '../services/compensation';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

// Columns safe to expose in list/detail responses (never leak PIN)
const SAFE_COLUMNS = [
  'id',
  'name',
  'daily_wage',
  'phone',
  'active',
  'role',
  'job_title',
  'employment_type',
  'employment_start_date',
  'employment_end_date',
  'created_at',
];

async function attachCompensation<T extends { id: number }>(employees: T[]): Promise<Array<T & {
  compensation_plan: any;
  compensation_summary: string;
}>> {
  const today = getKenyaDate();
  return Promise.all(employees.map(async (employee) => {
    const plan = await getCompensationPlan(employee.id, today);
    return {
      ...employee,
      compensation_plan: plan,
      compensation_summary: describeCompensationPlan(plan),
    };
  }));
}

// GET all employees
router.get('/', async (_req, res) => {
  try {
    const employees = await db('employees').select(SAFE_COLUMNS).orderBy('name');
    res.json({ success: true, data: await attachCompensation(employees) });
  } catch (err: any) {
    console.error('[employees:list] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET active employees
router.get('/active', async (_req, res) => {
  try {
    const employees = await db('employees').select(SAFE_COLUMNS).where({ active: true }).orderBy('name');
    res.json({ success: true, data: await attachCompensation(employees) });
  } catch (err: any) {
    console.error('[employees:list-active] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET compensation history for one employee
router.get('/:id/compensation-plans', requireAdmin, async (req, res) => {
  try {
    const employee = await db('employees').select(SAFE_COLUMNS).where({ id: req.params.id }).first();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });
    const plans = await listCompensationPlans(Number(req.params.id));
    const activePlan = await getCompensationPlan(Number(req.params.id), getKenyaDate());
    res.json({ success: true, data: { employee, active_plan: activePlan, plans } });
  } catch (err: any) {
    console.error('[employees:compensation-list] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST a new immutable compensation plan version
router.post(
  '/:id/compensation-plans',
  requireAdmin,
  validate(createCompensationPlanSchema),
  async (req: any, res) => {
    try {
      const employeeId = Number(req.params.id);
      const employee = await db('employees').where({ id: employeeId }).first();
      if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

      const openShift = await db('shifts')
        .where({ employee_id: employeeId, status: 'open' })
        .select('id')
        .first();
      if (openShift) {
        return res.status(409).json({
          success: false,
          error: `Close shift #${openShift.id} before changing this employee's compensation.`,
        });
      }

      const latestPlan = await db('employee_compensation_plans')
        .where({ employee_id: employeeId })
        .orderBy('effective_from', 'desc')
        .orderBy('version', 'desc')
        .first();
      if (latestPlan && req.body.effective_from <= String(latestPlan.effective_from).slice(0, 10)) {
        return res.status(409).json({
          success: false,
          error: `The new plan must start after ${String(latestPlan.effective_from).slice(0, 10)}.`,
        });
      }

      const latestClosedShift = await db('shifts')
        .where({ employee_id: employeeId, status: 'closed' })
        .orderByRaw('COALESCE(shift_date, DATE(start_time)) DESC')
        .select(db.raw('COALESCE(shift_date, DATE(start_time)) as work_date'))
        .first();
      if (latestClosedShift?.work_date && req.body.effective_from <= latestClosedShift.work_date) {
        return res.status(409).json({
          success: false,
          error: `The new plan must start after the last closed shift on ${latestClosedShift.work_date}.`,
        });
      }

      const plan = await db.transaction(async (trx) => {
        if (latestPlan) {
          await trx('employee_compensation_plans').where({ id: latestPlan.id }).update({
            effective_to: previousCalendarDate(req.body.effective_from),
            status: 'ended',
            updated_at: trx.fn.now(),
          });
        }

        const [planId] = await trx('employee_compensation_plans').insert({
          employee_id: employeeId,
          name: req.body.name,
          pay_schedule: req.body.pay_schedule,
          effective_from: req.body.effective_from,
          status: 'active',
          version: Number(latestPlan?.version || 0) + 1,
          currency: 'KES',
          notes: req.body.notes || null,
          created_by_employee_id: req.employee?.id > 0 ? req.employee.id : null,
        });

        await trx('employee_compensation_components').insert(
          req.body.components.map((component: any) => ({
            plan_id: planId,
            component_type: component.component_type,
            amount: component.amount ?? null,
            rate: component.rate ?? null,
            fuel_type: component.fuel_type ?? null,
            minimum_amount: component.minimum_amount ?? null,
            maximum_amount: component.maximum_amount ?? null,
          })),
        );

        const fixedPerShift = req.body.components.find(
          (component: any) => component.component_type === 'fixed_per_shift',
        );
        await trx('employees').where({ id: employeeId }).update({
          daily_wage: Number(fixedPerShift?.amount || 0),
        });

        return getCompensationPlan(employeeId, req.body.effective_from, trx);
      });

      res.status(201).json({ success: true, data: plan });
    } catch (err: any) {
      console.error('[employees:compensation-create] ERROR', err.message, err.stack);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// GET single employee
router.get('/:id', async (req, res) => {
  try {
    const employee = await db('employees').select(SAFE_COLUMNS).where({ id: req.params.id }).first();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });
    const [withCompensation] = await attachCompensation([employee]);
    res.json({ success: true, data: withCompensation });
  } catch (err: any) {
    console.error('[employees:get] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create employee
router.post('/', requireAdmin, validate(createEmployeeSchema), async (req, res) => {
  try {
    const {
      name,
      daily_wage,
      phone,
      pin,
      role,
      job_title,
      employment_type,
      employment_start_date,
      employment_end_date,
    } = req.body;

    const [id] = await db('employees').insert({
      name,
      daily_wage,
      phone: phone || '',
      pin: hashPin(pin),
      role: role || 'attendant',
      job_title: job_title || null,
      employment_type: employment_type || null,
      employment_start_date: employment_start_date || null,
      employment_end_date: employment_end_date || null,
    });
    const employee = await db('employees').select(SAFE_COLUMNS).where({ id }).first();
    res.status(201).json({ success: true, data: employee });
  } catch (err: any) {
    console.error('[employees:create] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update employee
router.put('/:id', requireAdmin, validate(updateEmployeeSchema), async (req, res) => {
  try {
    const existing = await db('employees').where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Employee not found' });

    const {
      name,
      daily_wage,
      phone,
      active,
      pin,
      role,
      job_title,
      employment_type,
      employment_start_date,
      employment_end_date,
    } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (daily_wage !== undefined) updates.daily_wage = daily_wage;
    if (phone !== undefined) updates.phone = phone;
    if (active !== undefined) updates.active = active;
    if (pin !== undefined) updates.pin = hashPin(pin);
    if (role !== undefined) updates.role = role;
    if (job_title !== undefined) updates.job_title = job_title || null;
    if (employment_type !== undefined) updates.employment_type = employment_type || null;
    if (employment_start_date !== undefined) updates.employment_start_date = employment_start_date || null;
    if (employment_end_date !== undefined) updates.employment_end_date = employment_end_date || null;
    await db('employees').where({ id: req.params.id }).update(updates);
    const employee = await db('employees').select(SAFE_COLUMNS).where({ id: req.params.id }).first();
    res.json({ success: true, data: employee });
  } catch (err: any) {
    console.error('[employees:update] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE (soft delete - deactivate)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const employee = await db('employees').where({ id: req.params.id }).first();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

    const openShift = await db('shifts')
      .where({ employee_id: req.params.id, status: 'open' })
      .select('id')
      .first();
    if (openShift) {
      return res.status(409).json({
        success: false,
        error: `Employee has open shift #${openShift.id}. Close the shift before deactivating the employee.`,
      });
    }

    await db('employees').where({ id: req.params.id }).update({ active: false });
    res.json({ success: true, message: 'Employee deactivated' });
  } catch (err: any) {
    console.error('[employees:delete] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
