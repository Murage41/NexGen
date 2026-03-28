import { Router } from 'express';
import db from '../database';

const router = Router();

// Daily report
router.get('/daily', async (req, res) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    const shifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name', 'employees.daily_wage')
      .where('shifts.start_time', '>=', date + 'T00:00:00')
      .where('shifts.start_time', '<=', date + 'T23:59:59')
      .orderBy('shifts.start_time');

    const shiftDetails = [];
    let totalSales = 0, totalCash = 0, totalMpesa = 0, totalCredits = 0, totalWages = 0, totalExpenses = 0;

    for (const shift of shifts) {
      const readings = await db('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.fuel_type')
        .where('shift_id', shift.id);
      const collections = await db('shift_collections').where({ shift_id: shift.id }).first();
      const expenses = await db('shift_expenses').where({ shift_id: shift.id });

      const shiftSales = readings.reduce((s: number, r: any) => s + r.amount_sold, 0);
      const shiftExpenses = expenses.reduce((s: number, e: any) => s + e.amount, 0);

      totalSales += shiftSales;
      totalCash += collections?.cash_amount || 0;
      totalMpesa += collections?.mpesa_amount || 0;
      totalCredits += collections?.credits_amount || 0;
      totalWages += shift.daily_wage;
      totalExpenses += shiftExpenses;

      shiftDetails.push({
        ...shift,
        readings,
        collections,
        expenses,
        shift_sales: shiftSales,
        shift_expenses: shiftExpenses,
        variance: (collections?.cash_amount || 0) + (collections?.mpesa_amount || 0) + (collections?.credits_amount || 0) - shiftSales,
      });
    }

    // General expenses for the day
    const dayExpenses = await db('expenses').where({ date });

    // Deficit recovered: wage deductions from shifts in this period (deficit deducted from wage + debt repayments)
    const shiftIds = shifts.map((s: any) => s.id);
    let deficitRecovered = 0;
    if (shiftIds.length > 0) {
      const wdResult = await db('wage_deductions')
        .whereIn('shift_id', shiftIds)
        .sum('deduction_amount as total')
        .first();
      deficitRecovered = (wdResult as any)?.total || 0;
    }

    const totalDayExpenses = dayExpenses.reduce((s: number, e: any) => s + e.amount, 0);

    res.json({
      success: true,
      data: {
        date,
        shifts: shiftDetails,
        day_expenses: dayExpenses,
        summary: {
          total_sales: totalSales,
          total_cash: totalCash,
          total_mpesa: totalMpesa,
          total_credits: totalCredits,
          total_wages: totalWages,
          total_shift_expenses: totalExpenses,
          total_day_expenses: totalDayExpenses,
          deficit_recovered: deficitRecovered,
          net: totalCash + totalMpesa - totalWages - totalExpenses - totalDayExpenses + deficitRecovered,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Monthly report
router.get('/monthly', async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7); // YYYY-MM
    const startDate = month + '-01';
    const endDate = month + '-31';

    const readings = await db('pump_readings')
      .join('shifts', 'pump_readings.shift_id', 'shifts.id')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .where('shifts.start_time', '>=', startDate + 'T00:00:00')
      .where('shifts.start_time', '<=', endDate + 'T23:59:59')
      .select('pumps.fuel_type')
      .sum('pump_readings.litres_sold as total_litres')
      .sum('pump_readings.amount_sold as total_sales')
      .groupBy('pumps.fuel_type');

    const collections = await db('shift_collections')
      .join('shifts', 'shift_collections.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', startDate + 'T00:00:00')
      .where('shifts.start_time', '<=', endDate + 'T23:59:59')
      .sum('cash_amount as total_cash')
      .sum('mpesa_amount as total_mpesa')
      .sum('credits_amount as total_credits')
      .first();

    const wages = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .where('shifts.start_time', '>=', startDate + 'T00:00:00')
      .where('shifts.start_time', '<=', endDate + 'T23:59:59')
      .sum('employees.daily_wage as total_wages')
      .first();

    const expenses = await db('expenses')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .sum('amount as total')
      .first();

    const shiftExpenses = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', startDate + 'T00:00:00')
      .where('shifts.start_time', '<=', endDate + 'T23:59:59')
      .sum('shift_expenses.amount as total')
      .first();

    const fuelCost = await db('fuel_deliveries')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .sum('total_cost as total')
      .first();

    // Deficit recovered: wage deductions from shifts in this period
    const wageDeductions = await db('wage_deductions')
      .join('shifts', 'wage_deductions.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', startDate + 'T00:00:00')
      .where('shifts.start_time', '<=', endDate + 'T23:59:59')
      .sum('wage_deductions.deduction_amount as total')
      .first();
    const deficitRecovered = (wageDeductions as any)?.total || 0;

    const totalRevenue = readings.reduce((s: number, r: any) => s + (r.total_sales || 0), 0);
    const totalExpenses = ((expenses as any)?.total || 0) + ((shiftExpenses as any)?.total || 0) + ((wages as any)?.total_wages || 0);

    res.json({
      success: true,
      data: {
        month,
        fuel_sales: readings,
        collections: collections || { total_cash: 0, total_mpesa: 0, total_credits: 0 },
        total_wages: (wages as any)?.total_wages || 0,
        total_expenses: (expenses as any)?.total || 0,
        total_shift_expenses: (shiftExpenses as any)?.total || 0,
        fuel_purchase_cost: (fuelCost as any)?.total || 0,
        deficit_recovered: deficitRecovered,
        total_revenue: totalRevenue,
        total_all_expenses: totalExpenses,
        gross_profit: totalRevenue - ((fuelCost as any)?.total || 0),
        net_profit: totalRevenue - ((fuelCost as any)?.total || 0) - totalExpenses + deficitRecovered,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
