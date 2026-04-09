import { Router } from 'express';
import db from '../database';
import { validate } from '../middleware/validate';
import { createExpenseSchema, updateExpenseSchema } from '../schemas';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

// Predefined expense categories for consistency
const EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Wages', 'Maintenance', 'Transport', 'Licenses',
  'Security', 'Bank Charges', 'Stationery', 'Communication', 'Generator Fuel',
  'Cleaning', 'Insurance', 'Accounting', 'Other',
];

router.get('/', async (req, res) => {
  try {
    const { from, to, date_from, date_to, category } = req.query;
    let query = db('expenses').whereNull('deleted_at').orderBy('date', 'desc');
    // Support both param naming conventions
    const startDate = (from || date_from) as string | undefined;
    const endDate = (to || date_to) as string | undefined;
    if (startDate) query = query.where('date', '>=', startDate);
    if (endDate) query = query.where('date', '<=', endDate);
    if (category) query = query.where('category', category);
    const expenses = await query;
    res.json({ success: true, data: expenses });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', validate(createExpenseSchema), async (req, res) => {
  try {
    const { category, description, amount, date } = req.body;
    const [id] = await db('expenses').insert({ category, description, amount, date });
    const expense = await db('expenses').where({ id }).first();
    res.status(201).json({ success: true, data: expense });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', validate(updateExpenseSchema), async (req, res) => {
  try {
    const { category, description, amount, date } = req.body;
    await db('expenses').where({ id: req.params.id }).update({ category, description, amount, date });
    const expense = await db('expenses').where({ id: req.params.id }).first();
    res.json({ success: true, data: expense });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db('expenses').where({ id: req.params.id }).update({ deleted_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET categories (distinct used + predefined)
router.get('/categories', async (_req, res) => {
  try {
    const rows = await db('expenses').whereNull('deleted_at').distinct('category').orderBy('category');
    const used = rows.map((r: any) => r.category).filter(Boolean);
    // Merge predefined with any user-created categories
    const all = [...new Set([...EXPENSE_CATEGORIES, ...used])].sort();
    res.json({ success: true, data: all });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /summary - Expense analytics for a period (combined shift + general)
router.get('/summary', async (req, res) => {
  try {
    const { from, to, date_from, date_to } = req.query;
    const today = getKenyaDate();
    const monthStart = today.slice(0, 7) + '-01';
    const startDate = (from || date_from || monthStart) as string;
    const endDate = (to || date_to || today) as string;
    const startTs = startDate + 'T00:00:00';
    const endTs = endDate + 'T23:59:59';

    // General expenses in period
    const generalExpenses = await db('expenses')
      .whereNull('deleted_at')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .select('id', 'category', 'description', 'amount', 'date', 'created_at');

    // Shift expenses in period
    const shiftExpenses = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .whereNull('shift_expenses.deleted_at')
      .where('shifts.start_time', '>=', startTs)
      .where('shifts.start_time', '<=', endTs)
      .select(
        'shift_expenses.id',
        'shift_expenses.category',
        'shift_expenses.description',
        'shift_expenses.amount',
        'shifts.start_time as date',
        'employees.name as employee_name',
        'shift_expenses.shift_id',
      );

    // Combine into unified list
    const combined = [
      ...generalExpenses.map((e: any) => ({
        ...e,
        source: 'general' as const,
        amount: Number(e.amount),
      })),
      ...shiftExpenses.map((e: any) => ({
        ...e,
        date: (e.date as string).split('T')[0],
        source: 'shift' as const,
        amount: Number(e.amount),
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    // Total
    const totalExpenses = combined.reduce((s, e) => s + e.amount, 0);

    // By category
    const catMap: Record<string, number> = {};
    for (const e of combined) {
      catMap[e.category] = (catMap[e.category] || 0) + e.amount;
    }
    const byCategory = Object.entries(catMap)
      .map(([category, total]) => ({
        category,
        total,
        pct: totalExpenses > 0 ? (total / totalExpenses) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // Previous period comparison (same duration before startDate)
    const periodMs = new Date(endDate).getTime() - new Date(startDate).getTime();
    const prevEnd = new Date(new Date(startDate).getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);
    const prevStartDate = prevStart.toISOString().split('T')[0];
    const prevEndDate = prevEnd.toISOString().split('T')[0];
    const prevStartTs = prevStartDate + 'T00:00:00';
    const prevEndTs = prevEndDate + 'T23:59:59';

    const prevGenResult = await db('expenses')
      .whereNull('deleted_at')
      .where('date', '>=', prevStartDate)
      .where('date', '<=', prevEndDate)
      .sum('amount as total')
      .first();
    const prevShiftResult = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .whereNull('shift_expenses.deleted_at')
      .where('shifts.start_time', '>=', prevStartTs)
      .where('shifts.start_time', '<=', prevEndTs)
      .sum('shift_expenses.amount as total')
      .first();
    const prevTotal = (Number((prevGenResult as any)?.total) || 0) + (Number((prevShiftResult as any)?.total) || 0);

    const changePercent = prevTotal > 0
      ? ((totalExpenses - prevTotal) / prevTotal) * 100
      : null;

    res.json({
      success: true,
      data: {
        period: { from: startDate, to: endDate },
        total_expenses: totalExpenses,
        by_category: byCategory,
        top_category: byCategory.length > 0 ? byCategory[0].category : null,
        previous_period_total: prevTotal,
        change_percent: changePercent,
        expenses: combined,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
