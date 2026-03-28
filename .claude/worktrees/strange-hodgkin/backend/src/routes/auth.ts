import { Router } from 'express';
import db from '../database';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { employee_id, pin } = req.body;
    if (!employee_id || !pin) {
      return res.status(400).json({ success: false, error: 'Employee ID and PIN are required' });
    }

    const employee = await db('employees')
      .where({ id: employee_id, active: true })
      .first();

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    if (employee.pin !== pin) {
      return res.status(401).json({ success: false, error: 'Invalid PIN' });
    }

    // Return employee data without pin
    const { pin: _pin, ...employeeData } = employee;
    res.json({ success: true, data: employeeData });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET all employees (for login selection - minimal data)
router.get('/employees', async (_req, res) => {
  try {
    const employees = await db('employees')
      .where({ active: true })
      .select('id', 'name', 'role')
      .orderBy('name');
    res.json({ success: true, data: employees });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
