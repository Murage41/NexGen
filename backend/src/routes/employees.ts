import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { hashPin, validatePin } from '../services/pinSecurity';

const router = Router();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Columns safe to expose in list/detail responses (never leak PIN)
const SAFE_COLUMNS = ['id', 'name', 'daily_wage', 'phone', 'active', 'role', 'created_at'];

// GET all employees
router.get('/', async (_req, res) => {
  try {
    const employees = await db('employees').select(SAFE_COLUMNS).orderBy('name');
    res.json({ success: true, data: employees });
  } catch (err: any) {
    console.error('[employees:list] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET active employees
router.get('/active', async (_req, res) => {
  try {
    const employees = await db('employees').select(SAFE_COLUMNS).where({ active: true }).orderBy('name');
    res.json({ success: true, data: employees });
  } catch (err: any) {
    console.error('[employees:list-active] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single employee
router.get('/:id', async (req, res) => {
  try {
    const employee = await db('employees').select(SAFE_COLUMNS).where({ id: req.params.id }).first();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });
    res.json({ success: true, data: employee });
  } catch (err: any) {
    console.error('[employees:get] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create employee
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, daily_wage, phone, pin, role } = req.body;
    const submittedPin = pin === undefined && !IS_PRODUCTION ? '0000' : pin;
    const pinError = validatePin(submittedPin);
    if (pinError) {
      return res.status(400).json({
        success: false,
        error: IS_PRODUCTION && pin === undefined ? 'PIN is required in production.' : pinError,
      });
    }

    const [id] = await db('employees').insert({
      name,
      daily_wage,
      phone,
      pin: hashPin(submittedPin),
      role: role || 'attendant',
    });
    const employee = await db('employees').select(SAFE_COLUMNS).where({ id }).first();
    res.status(201).json({ success: true, data: employee });
  } catch (err: any) {
    console.error('[employees:create] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update employee
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, daily_wage, phone, active, pin, role } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (daily_wage !== undefined) updates.daily_wage = daily_wage;
    if (phone !== undefined) updates.phone = phone;
    if (active !== undefined) updates.active = active;
    if (pin !== undefined) {
      const pinError = validatePin(pin);
      if (pinError) return res.status(400).json({ success: false, error: pinError });
      updates.pin = hashPin(pin);
    }
    if (role !== undefined) updates.role = role;
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
    await db('employees').where({ id: req.params.id }).update({ active: false });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[employees:delete] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
