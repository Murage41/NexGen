import { Router } from 'express';
import db from '../database';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

    // ── Today's shifts ──
    const todayShifts = await db('shifts')
      .where('start_time', '>=', today + 'T00:00:00')
      .where('start_time', '<=', today + 'T23:59:59');
    const shiftIds = todayShifts.map((s: any) => s.id);

    // Today's sales from pump readings
    let todayLitresPetrol = 0;
    let todayLitresDiesel = 0;
    let todaySales = 0;

    if (shiftIds.length > 0) {
      const readings = await db('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .whereIn('pump_readings.shift_id', shiftIds)
        .select('pump_readings.litres_sold', 'pump_readings.amount_sold', 'pumps.fuel_type');

      for (const r of readings) {
        if (r.fuel_type === 'petrol') todayLitresPetrol += Number(r.litres_sold) || 0;
        else todayLitresDiesel += Number(r.litres_sold) || 0;
        todaySales += Number(r.amount_sold) || 0;
      }
    }

    // Today's collections
    let todayCash = 0, todayMpesa = 0, todayCreditsOnAccount = 0;
    if (shiftIds.length > 0) {
      const collections = await db('shift_collections').whereIn('shift_id', shiftIds);
      for (const c of collections) {
        todayCash += Number(c.cash_amount) || 0;
        todayMpesa += Number(c.mpesa_amount) || 0;
        todayCreditsOnAccount += Number(c.credits_amount) || 0;
      }
    }

    // Today's COGS (weighted avg cost)
    const deliveries = await db('fuel_deliveries')
      .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
      .select('tanks.fuel_type')
      .sum('fuel_deliveries.total_cost as total_cost')
      .sum('fuel_deliveries.litres as total_litres')
      .groupBy('tanks.fuel_type');

    const avgCosts: Record<string, number> = {};
    for (const d of deliveries) {
      const litres = Number(d.total_litres) || 0;
      const cost = Number(d.total_cost) || 0;
      avgCosts[d.fuel_type] = litres > 0 ? cost / litres : 0;
    }

    const todayCogs =
      todayLitresPetrol * (avgCosts['petrol'] || 0) +
      todayLitresDiesel * (avgCosts['diesel'] || 0);

    // Today's wages
    let todayWages = 0;
    if (shiftIds.length > 0) {
      const wageShifts = await db('shifts')
        .join('employees', 'shifts.employee_id', 'employees.id')
        .whereIn('shifts.id', shiftIds)
        .select('shifts.id', 'employees.daily_wage');

      for (const s of wageShifts) {
        const wd = await db('wage_deductions').where({ shift_id: s.id }).first();
        todayWages += wd ? Number(wd.final_wage) : Number(s.daily_wage);
      }
    }

    // Today's expenses (shift + general)
    let todayShiftExpenses = 0;
    if (shiftIds.length > 0) {
      const seResult = await db('shift_expenses')
        .whereIn('shift_id', shiftIds)
        .sum('amount as total')
        .first();
      todayShiftExpenses = Number((seResult as any)?.total) || 0;
    }
    const geResult = await db('expenses')
      .where('date', today)
      .sum('amount as total')
      .first();
    const todayGeneralExpenses = Number((geResult as any)?.total) || 0;
    const todayExpenses = todayShiftExpenses + todayGeneralExpenses;

    const todayGrossProfit = todaySales - todayCogs;
    const todayNetProfit = todayGrossProfit - todayWages - todayExpenses;
    const todayGrossMargin = todaySales > 0 ? (todayGrossProfit / todaySales) * 100 : 0;

    // Today's variance
    const todayTotalCollected = todayCash + todayMpesa + todayCreditsOnAccount;
    const todayVariance = todayTotalCollected - todaySales;

    // ── Month-to-date figures ──
    const mtdShifts = await db('shifts')
      .where('start_time', '>=', monthStart + 'T00:00:00')
      .where('start_time', '<=', today + 'T23:59:59')
      .select('id');
    const mtdShiftIds = mtdShifts.map((s: any) => s.id);

    let mtdSales = 0;
    let mtdLitres = 0;
    if (mtdShiftIds.length > 0) {
      const mtdResult = await db('pump_readings')
        .whereIn('shift_id', mtdShiftIds)
        .sum('amount_sold as sales')
        .sum('litres_sold as litres')
        .first();
      mtdSales = Number((mtdResult as any)?.sales) || 0;
      mtdLitres = Number((mtdResult as any)?.litres) || 0;
    }

    // MTD wages
    let mtdWages = 0;
    if (mtdShiftIds.length > 0) {
      const mtdWageShifts = await db('shifts')
        .join('employees', 'shifts.employee_id', 'employees.id')
        .whereIn('shifts.id', mtdShiftIds)
        .select('shifts.id', 'employees.daily_wage');
      for (const s of mtdWageShifts) {
        const wd = await db('wage_deductions').where({ shift_id: s.id }).first();
        mtdWages += wd ? Number(wd.final_wage) : Number(s.daily_wage);
      }
    }

    // MTD expenses
    let mtdShiftExp = 0;
    if (mtdShiftIds.length > 0) {
      const r = await db('shift_expenses').whereIn('shift_id', mtdShiftIds).sum('amount as total').first();
      mtdShiftExp = Number((r as any)?.total) || 0;
    }
    const mtdGenExp = await db('expenses')
      .where('date', '>=', monthStart)
      .where('date', '<=', today)
      .sum('amount as total')
      .first();
    const mtdExpenses = mtdShiftExp + (Number((mtdGenExp as any)?.total) || 0);

    // MTD COGS (litres sold x avg cost)
    let mtdPetrolL = 0, mtdDieselL = 0;
    if (mtdShiftIds.length > 0) {
      const fuelResult = await db('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .whereIn('pump_readings.shift_id', mtdShiftIds)
        .select('pumps.fuel_type')
        .sum('pump_readings.litres_sold as litres')
        .groupBy('pumps.fuel_type');
      for (const f of fuelResult) {
        if (f.fuel_type === 'petrol') mtdPetrolL = Number(f.litres) || 0;
        else if (f.fuel_type === 'diesel') mtdDieselL = Number(f.litres) || 0;
      }
    }
    const mtdCogs = mtdPetrolL * (avgCosts['petrol'] || 0) + mtdDieselL * (avgCosts['diesel'] || 0);
    const mtdNetProfit = mtdSales - mtdCogs - mtdWages - mtdExpenses;

    // ── Outstanding credits (receivables) ──
    const creditsResult = await db('credits')
      .whereNot('status', 'paid')
      .where('balance', '>', 0)
      .sum('balance as total')
      .first();
    const totalOutstandingCredits = Number((creditsResult as any)?.total) || 0;

    // ── Outstanding staff debts (unrecovered losses) ──
    const staffDebtResult = await db('staff_debts')
      .where('status', 'outstanding')
      .where('balance', '>', 0)
      .sum('balance as total')
      .first();
    const totalOutstandingStaffDebts = Number((staffDebtResult as any)?.total) || 0;

    // ── Tank stock levels ──
    const tanks = await db('tanks').select('id', 'label', 'fuel_type', 'current_stock_litres', 'capacity_litres');
    const tankStockSummary = tanks.map((t: any) => ({
      id: t.id,
      label: t.label,
      fuel_type: t.fuel_type,
      current_stock: Number(t.current_stock_litres),
      capacity: Number(t.capacity_litres),
      pct_full: Number(t.capacity_litres) > 0
        ? (Number(t.current_stock_litres) / Number(t.capacity_litres)) * 100
        : 0,
    }));

    // Margin per litre
    const marginPerLitre: Record<string, number> = {};
    if (todayLitresPetrol > 0 && todaySales > 0) {
      // Get petrol revenue per litre from today's readings
      let petrolRev = 0;
      if (shiftIds.length > 0) {
        const pr = await db('pump_readings')
          .join('pumps', 'pump_readings.pump_id', 'pumps.id')
          .whereIn('pump_readings.shift_id', shiftIds)
          .where('pumps.fuel_type', 'petrol')
          .sum('pump_readings.amount_sold as rev')
          .first();
        petrolRev = Number((pr as any)?.rev) || 0;
      }
      marginPerLitre['petrol'] = todayLitresPetrol > 0
        ? (petrolRev / todayLitresPetrol) - (avgCosts['petrol'] || 0) : 0;
    }
    if (todayLitresDiesel > 0 && todaySales > 0) {
      let dieselRev = 0;
      if (shiftIds.length > 0) {
        const dr = await db('pump_readings')
          .join('pumps', 'pump_readings.pump_id', 'pumps.id')
          .whereIn('pump_readings.shift_id', shiftIds)
          .where('pumps.fuel_type', 'diesel')
          .sum('pump_readings.amount_sold as rev')
          .first();
        dieselRev = Number((dr as any)?.rev) || 0;
      }
      marginPerLitre['diesel'] = todayLitresDiesel > 0
        ? (dieselRev / todayLitresDiesel) - (avgCosts['diesel'] || 0) : 0;
    }

    // ── Current open shift ──
    const currentShift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name')
      .where('shifts.status', 'open')
      .first();

    // ── Weekly sales (last 7 days) ──
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
        amount = Number((result as any)?.total) || 0;
      }
      weeklySales.push({ date: dateStr, amount });
    }

    res.json({
      success: true,
      data: {
        // Today
        today_sales: todaySales,
        today_litres_petrol: todayLitresPetrol,
        today_litres_diesel: todayLitresDiesel,
        today_variance: todayVariance,
        today_cogs: todayCogs,
        today_gross_profit: todayGrossProfit,
        today_gross_margin: todayGrossMargin,
        today_net_profit: todayNetProfit,
        today_expenses: todayExpenses,
        today_wages: todayWages,
        today_collections: {
          cash: todayCash,
          mpesa: todayMpesa,
          credits: todayCreditsOnAccount,
        },
        // Month-to-date
        mtd_sales: mtdSales,
        mtd_litres: mtdLitres,
        mtd_expenses: mtdExpenses,
        mtd_net_profit: mtdNetProfit,
        // Business health
        total_outstanding_credits: totalOutstandingCredits,
        total_outstanding_staff_debts: totalOutstandingStaffDebts,
        tank_stock_summary: tankStockSummary,
        margin_per_litre: marginPerLitre,
        // Existing
        current_shift: currentShift || null,
        weekly_sales: weeklySales,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
