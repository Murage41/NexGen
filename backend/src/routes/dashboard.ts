import { Router } from 'express';
import db from '../database';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Today's shifts
    const todayShifts = await db('shifts')
      .where('start_time', '>=', today + 'T00:00:00')
      .where('start_time', '<=', today + 'T23:59:59');

    const shiftIds = todayShifts.map((s: any) => s.id);

    // Today's readings
    let todayLitresPetrol = 0;
    let todayLitresDiesel = 0;
    let todaySales = 0;

    if (shiftIds.length > 0) {
      const readings = await db('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .whereIn('pump_readings.shift_id', shiftIds)
        .select('pump_readings.litres_sold', 'pump_readings.amount_sold', 'pumps.fuel_type');

      for (const r of readings) {
        if (r.fuel_type === 'petrol') todayLitresPetrol += r.litres_sold;
        else todayLitresDiesel += r.litres_sold;
        todaySales += r.amount_sold;
      }
    }

    // Today's variance (accounted = collections + expenses + wages)
    let todayVariance = 0;
    if (shiftIds.length > 0) {
      const collections = await db('shift_collections').whereIn('shift_id', shiftIds);
      const totalCollected = collections.reduce((sum: number, c: any) =>
        sum + c.cash_amount + c.mpesa_amount + c.credits_amount, 0);
      const shiftExpenses = await db('shift_expenses').whereIn('shift_id', shiftIds);
      const totalExpenses = shiftExpenses.reduce((sum: number, e: any) => sum + e.amount, 0);
      const wages = await db('shifts')
        .join('employees', 'shifts.employee_id', 'employees.id')
        .whereIn('shifts.id', shiftIds)
        .sum('employees.daily_wage as total_wages')
        .first();
      const totalWages = (wages as any)?.total_wages || 0;
      todayVariance = (totalCollected + totalExpenses + totalWages) - todaySales;
    }

    // Current open shift
    const currentShift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name')
      .where('shifts.status', 'open')
      .first();

    // Weekly sales (last 7 days)
    const weeklySales = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayShifts = await db('shifts')
        .where('start_time', '>=', dateStr + 'T00:00:00')
        .where('start_time', '<=', dateStr + 'T23:59:59')
        .select('id');
      const dayShiftIds = dayShifts.map((s: any) => s.id);

      let amount = 0;
      if (dayShiftIds.length > 0) {
        const result = await db('pump_readings')
          .whereIn('shift_id', dayShiftIds)
          .sum('amount_sold as total')
          .first();
        amount = (result as any)?.total || 0;
      }
      weeklySales.push({ date: dateStr, amount });
    }

    res.json({
      success: true,
      data: {
        today_litres_petrol: todayLitresPetrol,
        today_litres_diesel: todayLitresDiesel,
        today_sales: todaySales,
        today_variance: todayVariance,
        current_shift: currentShift || null,
        weekly_sales: weeklySales,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
