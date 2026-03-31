import { Router } from 'express';
import db from '../database';

const router = Router();

// ─── Helper: Weighted average cost per litre by fuel type ────────────────────
async function getWeightedAvgCost(): Promise<Record<string, number>> {
  const deliveries = await db('fuel_deliveries')
    .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
    .select('tanks.fuel_type')
    .sum('fuel_deliveries.total_cost as total_cost')
    .sum('fuel_deliveries.litres as total_litres')
    .groupBy('tanks.fuel_type');

  const costs: Record<string, number> = {};
  for (const d of deliveries) {
    const litres = Number(d.total_litres) || 0;
    const cost = Number(d.total_cost) || 0;
    costs[d.fuel_type] = litres > 0 ? cost / litres : 0;
  }
  return costs;
}

// ─── Helper: Get tank stock value using weighted avg cost ────────────────────
function stockValue(litresMap: Record<string, number>, avgCosts: Record<string, number>): number {
  let total = 0;
  for (const [fuelType, litres] of Object.entries(litresMap)) {
    total += litres * (avgCosts[fuelType] || 0);
  }
  return total;
}

// ─── Daily Report ─────────────────────────────────────────────────────────────
router.get('/daily', async (req, res) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    const shifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name', 'employees.daily_wage')
      .where('shifts.start_time', '>=', date + 'T00:00:00')
      .where('shifts.start_time', '<=', date + 'T23:59:59')
      .orderBy('shifts.start_time');

    // Weighted avg cost for COGS
    const avgCosts = await getWeightedAvgCost();

    const shiftDetails = [];
    let totalSales = 0;
    let totalPetrolLitres = 0;
    let totalDieselLitres = 0;
    let totalCash = 0;
    let totalMpesa = 0;
    let totalCredits = 0;
    let totalWagesPaid = 0;
    let totalShiftExpenses = 0;

    for (const shift of shifts) {
      const readings = await db('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.fuel_type')
        .where('pump_readings.shift_id', shift.id);

      const collections = await db('shift_collections').where({ shift_id: shift.id }).first();
      const expenses = await db('shift_expenses').where({ shift_id: shift.id });

      const wageDeduction = await db('wage_deductions').where({ shift_id: shift.id }).first();
      const actualWagePaid = wageDeduction ? Number(wageDeduction.final_wage) : Number(shift.daily_wage);

      const shiftSales = readings.reduce((s: number, r: any) => s + (Number(r.amount_sold) || 0), 0);
      const shiftExpensesTotal = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
      const petrolLitres = readings
        .filter((r: any) => r.fuel_type === 'petrol')
        .reduce((s: number, r: any) => s + (Number(r.litres_sold) || 0), 0);
      const dieselLitres = readings
        .filter((r: any) => r.fuel_type === 'diesel')
        .reduce((s: number, r: any) => s + (Number(r.litres_sold) || 0), 0);

      const cash = Number(collections?.cash_amount) || 0;
      const mpesa = Number(collections?.mpesa_amount) || 0;
      const credits = Number(collections?.credits_amount) || 0;
      const totalCollections = cash + mpesa + credits;

      totalSales += shiftSales;
      totalPetrolLitres += petrolLitres;
      totalDieselLitres += dieselLitres;
      totalCash += cash;
      totalMpesa += mpesa;
      totalCredits += credits;
      totalWagesPaid += actualWagePaid;
      totalShiftExpenses += shiftExpensesTotal;

      shiftDetails.push({
        id: shift.id,
        employee_name: shift.employee_name,
        start_time: shift.start_time,
        end_time: shift.end_time,
        status: shift.status,
        notes: shift.notes,
        readings,
        collections,
        expenses,
        petrol_litres: petrolLitres,
        diesel_litres: dieselLitres,
        total_sales: shiftSales,
        total_collections: totalCollections,
        standard_wage: Number(shift.daily_wage),
        wage_deduction: wageDeduction ? Number(wageDeduction.deduction_amount) : 0,
        actual_wage_paid: actualWagePaid,
        variance: totalCollections - shiftSales,
      });
    }

    // General business expenses for the day
    const dayExpenses = await db('expenses').where({ date });
    const totalDayExpenses = dayExpenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

    // COGS: litres sold x weighted average cost per litre
    const cogs =
      totalPetrolLitres * (avgCosts['petrol'] || 0) +
      totalDieselLitres * (avgCosts['diesel'] || 0);

    // Margin per litre
    const marginPerLitre: Record<string, number> = {};
    if (totalPetrolLitres > 0) {
      const petrolRevPerLitre = readings_revenue_per_litre(shiftDetails, 'petrol');
      marginPerLitre['petrol'] = petrolRevPerLitre - (avgCosts['petrol'] || 0);
    }
    if (totalDieselLitres > 0) {
      const dieselRevPerLitre = readings_revenue_per_litre(shiftDetails, 'diesel');
      marginPerLitre['diesel'] = dieselRevPerLitre - (avgCosts['diesel'] || 0);
    }

    // Unrecovered losses: outstanding staff debts from today's shifts
    const shiftIds = shifts.map((s: any) => s.id);
    let unrecoveredLosses = 0;
    if (shiftIds.length > 0) {
      const debtResult = await db('staff_debts')
        .whereIn('shift_id', shiftIds)
        .where('status', 'outstanding')
        .sum('balance as total')
        .first();
      unrecoveredLosses = Number((debtResult as any)?.total) || 0;
    }

    // Collection rate
    const totalCollected = totalCash + totalMpesa + totalCredits;
    const collectionRate = totalSales > 0 ? (totalCollected / totalSales) * 100 : 0;

    // Tank stock snapshot for the day
    const tanks = await db('tanks').select('id', 'label', 'fuel_type', 'current_stock_litres', 'capacity_litres');
    const tankSnapshot = [];
    for (const tank of tanks) {
      // Sales from pumps linked to this tank today
      let tankSales = 0;
      if (shiftIds.length > 0) {
        const salesResult = await db('pump_readings')
          .join('pumps', 'pump_readings.pump_id', 'pumps.id')
          .whereIn('pump_readings.shift_id', shiftIds)
          .where('pumps.tank_id', tank.id)
          .sum('pump_readings.litres_sold as total')
          .first();
        tankSales = Number((salesResult as any)?.total) || 0;
      }

      // Deliveries to this tank today
      const delResult = await db('fuel_deliveries')
        .where({ tank_id: tank.id, date })
        .sum('litres as total')
        .first();
      const tankDeliveries = Number((delResult as any)?.total) || 0;

      // Latest dip for this date
      const dip = await db('tank_dips')
        .where({ tank_id: tank.id, dip_date: date })
        .orderBy('timestamp', 'desc')
        .first();

      const currentStock = Number(tank.current_stock_litres) || 0;
      const bookStock = currentStock; // current_stock_litres is the running book stock
      const dipReading = dip ? Number(dip.measured_litres) : null;
      const dipVariance = dipReading !== null ? bookStock - dipReading : null;
      const variancePct = dipReading !== null && bookStock > 0 ? (dipVariance! / bookStock) * 100 : null;

      tankSnapshot.push({
        tank_id: tank.id,
        label: tank.label,
        fuel_type: tank.fuel_type,
        capacity: Number(tank.capacity_litres),
        sales_litres: tankSales,
        deliveries_litres: tankDeliveries,
        book_stock: bookStock,
        dip_reading: dipReading,
        dip_variance: dipVariance,
        variance_pct: variancePct,
        variance_alert: variancePct !== null && Math.abs(variancePct) > 0.5,
      });
    }

    const totalExpenses = totalShiftExpenses + totalDayExpenses;
    const grossProfit = totalSales - cogs;
    const netProfit = grossProfit - totalWagesPaid - totalExpenses;

    res.json({
      success: true,
      data: {
        date,
        shifts: shiftDetails,
        expenses: dayExpenses,
        // Sales
        total_sales: totalSales,
        total_litres: totalPetrolLitres + totalDieselLitres,
        petrol_litres: totalPetrolLitres,
        diesel_litres: totalDieselLitres,
        // Collections
        total_cash: totalCash,
        total_mpesa: totalMpesa,
        total_credits: totalCredits,
        collection_rate: collectionRate,
        // Costs
        total_wages_paid: totalWagesPaid,
        total_shift_expenses: totalShiftExpenses,
        total_day_expenses: totalDayExpenses,
        total_expenses: totalExpenses,
        cogs,
        avg_cost_per_litre: avgCosts,
        margin_per_litre: marginPerLitre,
        // P&L
        gross_profit: grossProfit,
        net_profit: netProfit,
        // Accountability
        unrecovered_losses: unrecoveredLosses,
        // Tank stock
        tank_snapshot: tankSnapshot,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to compute revenue per litre from shift details
function readings_revenue_per_litre(shiftDetails: any[], fuelType: string): number {
  let totalRev = 0;
  let totalLitres = 0;
  for (const shift of shiftDetails) {
    for (const r of shift.readings) {
      if (r.fuel_type === fuelType) {
        totalRev += Number(r.amount_sold) || 0;
        totalLitres += Number(r.litres_sold) || 0;
      }
    }
  }
  return totalLitres > 0 ? totalRev / totalLitres : 0;
}

// ─── Monthly Report ────────────────────────────────────────────────────────────
router.get('/monthly', async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const startDate = month + '-01';
    const endDate = month + '-31';
    const startTs = startDate + 'T00:00:00';
    const endTs = endDate + 'T23:59:59';

    // Previous month for opening stock
    const [year, mon] = month.split('-').map(Number);
    const prevMonth = mon === 1
      ? `${year - 1}-12`
      : `${year}-${String(mon - 1).padStart(2, '0')}`;
    const prevEndDate = prevMonth + '-31';

    // Weighted avg cost
    const avgCosts = await getWeightedAvgCost();

    // Fuel sales grouped by type
    const fuelSales = await db('pump_readings')
      .join('shifts', 'pump_readings.shift_id', 'shifts.id')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .where('shifts.start_time', '>=', startTs)
      .where('shifts.start_time', '<=', endTs)
      .select('pumps.fuel_type')
      .sum('pump_readings.litres_sold as total_litres')
      .sum('pump_readings.amount_sold as total_sales')
      .groupBy('pumps.fuel_type');

    const totalSales = fuelSales.reduce((s: number, r: any) => s + (Number(r.total_sales) || 0), 0);
    const totalLitres = fuelSales.reduce((s: number, r: any) => s + (Number(r.total_litres) || 0), 0);

    // Margin per litre
    const marginPerLitre: Record<string, number> = {};
    for (const fs of fuelSales) {
      const litres = Number(fs.total_litres) || 0;
      const sales = Number(fs.total_sales) || 0;
      if (litres > 0) {
        marginPerLitre[fs.fuel_type] = (sales / litres) - (avgCosts[fs.fuel_type] || 0);
      }
    }

    // Collections breakdown
    const collections = await db('shift_collections')
      .join('shifts', 'shift_collections.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', startTs)
      .where('shifts.start_time', '<=', endTs)
      .sum('cash_amount as total_cash')
      .sum('mpesa_amount as total_mpesa')
      .sum('credits_amount as total_credits')
      .first();

    // Wages: actual paid per shift
    const allShifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .where('shifts.start_time', '>=', startTs)
      .where('shifts.start_time', '<=', endTs)
      .select('shifts.id', 'employees.daily_wage');

    let totalWagesPaid = 0;
    for (const shift of allShifts) {
      const wd = await db('wage_deductions').where({ shift_id: shift.id }).first();
      totalWagesPaid += wd ? Number(wd.final_wage) : Number(shift.daily_wage);
    }

    // General expenses
    const generalExpenses = await db('expenses')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .sum('amount as total')
      .first();

    // Shift expenses
    const shiftExpenses = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', startTs)
      .where('shifts.start_time', '<=', endTs)
      .sum('shift_expenses.amount as total')
      .first();

    // Expense categories (merged from both general and shift expenses)
    const generalCats = await db('expenses')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .select('category')
      .sum('amount as total')
      .groupBy('category');

    const shiftCats = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', startTs)
      .where('shifts.start_time', '<=', endTs)
      .select('shift_expenses.category')
      .sum('shift_expenses.amount as total')
      .groupBy('shift_expenses.category');

    const categoryMap: Record<string, number> = {};
    for (const c of [...generalCats, ...shiftCats]) {
      categoryMap[c.category] = (categoryMap[c.category] || 0) + (Number(c.total) || 0);
    }
    const expenseCategories = Object.entries(categoryMap)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    // ── COGS: Opening Stock + Purchases - Closing Stock ──
    // Opening stock: last dip of previous month per tank, or earliest dip this month
    const tanksData = await db('tanks').select('id', 'fuel_type', 'current_stock_litres');
    const openingLitresMap: Record<string, number> = {};
    const closingLitresMap: Record<string, number> = {};

    for (const tank of tanksData) {
      // Opening: last dip before this month, or earliest dip this month
      const prevDip = await db('tank_dips')
        .where('tank_id', tank.id)
        .where('dip_date', '<=', prevEndDate)
        .orderBy('dip_date', 'desc')
        .first();

      if (prevDip) {
        openingLitresMap[tank.fuel_type] = (openingLitresMap[tank.fuel_type] || 0) + Number(prevDip.measured_litres);
      } else {
        // Fallback: use earliest dip in this month or 0
        const firstDip = await db('tank_dips')
          .where('tank_id', tank.id)
          .where('dip_date', '>=', startDate)
          .where('dip_date', '<=', endDate)
          .orderBy('dip_date', 'asc')
          .first();
        openingLitresMap[tank.fuel_type] = (openingLitresMap[tank.fuel_type] || 0) + (firstDip ? Number(firstDip.measured_litres) : 0);
      }

      // Closing: last dip this month, or current book stock
      const lastDip = await db('tank_dips')
        .where('tank_id', tank.id)
        .where('dip_date', '>=', startDate)
        .where('dip_date', '<=', endDate)
        .orderBy('dip_date', 'desc')
        .first();

      if (lastDip) {
        closingLitresMap[tank.fuel_type] = (closingLitresMap[tank.fuel_type] || 0) + Number(lastDip.measured_litres);
      } else {
        closingLitresMap[tank.fuel_type] = (closingLitresMap[tank.fuel_type] || 0) + Number(tank.current_stock_litres);
      }
    }

    const openingStockValue = stockValue(openingLitresMap, avgCosts);
    const closingStockValue = stockValue(closingLitresMap, avgCosts);

    // Purchases this month
    const purchasesResult = await db('fuel_deliveries')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .sum('total_cost as total')
      .first();
    const purchases = Number((purchasesResult as any)?.total) || 0;

    const cogs = openingStockValue + purchases - closingStockValue;

    // Receivables movement
    const openingReceivables = await db('credits')
      .where('created_at', '<', startTs)
      .whereNot('status', 'paid')
      .sum('balance as total')
      .first();
    const closingReceivables = await db('credits')
      .where('created_at', '<=', endTs)
      .whereNot('status', 'paid')
      .sum('balance as total')
      .first();
    const creditPaymentsReceived = await db('credit_payments')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .sum('amount as total')
      .first();

    // Outstanding staff debts for the period
    const staffDebtResult = await db('staff_debts')
      .join('shifts', 'staff_debts.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', startTs)
      .where('shifts.start_time', '<=', endTs)
      .where('staff_debts.status', 'outstanding')
      .sum('staff_debts.balance as total')
      .first();
    const unrecoveredLosses = Number((staffDebtResult as any)?.total) || 0;

    // Daily breakdown
    const closedShifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .where('shifts.start_time', '>=', startTs)
      .where('shifts.start_time', '<=', endTs)
      .where('shifts.status', 'closed')
      .select('shifts.id', 'shifts.start_time', 'employees.daily_wage');

    const dailyMap: Record<string, { sales: number; petrol_litres: number; diesel_litres: number; expenses: number; wages: number }> = {};

    for (const shift of closedShifts) {
      const dayKey = (shift.start_time as string).split('T')[0];
      if (!dailyMap[dayKey]) {
        dailyMap[dayKey] = { sales: 0, petrol_litres: 0, diesel_litres: 0, expenses: 0, wages: 0 };
      }

      const readings = await db('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .where('pump_readings.shift_id', shift.id)
        .select('pump_readings.amount_sold', 'pump_readings.litres_sold', 'pumps.fuel_type');

      for (const r of readings) {
        dailyMap[dayKey].sales += Number(r.amount_sold) || 0;
        if (r.fuel_type === 'petrol') dailyMap[dayKey].petrol_litres += Number(r.litres_sold) || 0;
        if (r.fuel_type === 'diesel') dailyMap[dayKey].diesel_litres += Number(r.litres_sold) || 0;
      }

      const shiftExpResult = await db('shift_expenses').where({ shift_id: shift.id }).sum('amount as total').first();
      dailyMap[dayKey].expenses += Number((shiftExpResult as any)?.total) || 0;

      const wd = await db('wage_deductions').where({ shift_id: shift.id }).first();
      dailyMap[dayKey].wages += wd ? Number(wd.final_wage) : Number(shift.daily_wage);
    }

    // Add general expenses into daily map
    const allGeneralExpenses = await db('expenses')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .select('date', 'amount');

    for (const e of allGeneralExpenses) {
      const key = e.date as string;
      if (!dailyMap[key]) {
        dailyMap[key] = { sales: 0, petrol_litres: 0, diesel_litres: 0, expenses: 0, wages: 0 };
      }
      dailyMap[key].expenses += Number(e.amount) || 0;
    }

    const dailyBreakdown = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => {
        const dayCogs =
          d.petrol_litres * (avgCosts['petrol'] || 0) +
          d.diesel_litres * (avgCosts['diesel'] || 0);
        return {
          date,
          sales: d.sales,
          petrol_litres: d.petrol_litres,
          diesel_litres: d.diesel_litres,
          cogs: dayCogs,
          expenses: d.expenses,
          wages: d.wages,
          gross_profit: d.sales - dayCogs,
          net: d.sales - dayCogs - d.expenses - d.wages,
        };
      });

    const totalExpenses = (Number((generalExpenses as any)?.total) || 0) + (Number((shiftExpenses as any)?.total) || 0);
    const grossProfit = totalSales - cogs;
    const netProfit = grossProfit - totalWagesPaid - totalExpenses;

    res.json({
      success: true,
      data: {
        month,
        // Fuel breakdown
        fuel_sales: fuelSales,
        total_sales: totalSales,
        total_litres: totalLitres,
        margin_per_litre: marginPerLitre,
        // Collections
        total_cash: Number((collections as any)?.total_cash) || 0,
        total_mpesa: Number((collections as any)?.total_mpesa) || 0,
        total_credits: Number((collections as any)?.total_credits) || 0,
        // Costs
        total_wages_paid: totalWagesPaid,
        total_expenses: totalExpenses,
        expense_categories: expenseCategories,
        // COGS breakdown
        cogs,
        opening_stock_value: openingStockValue,
        purchases,
        closing_stock_value: closingStockValue,
        avg_cost_per_litre: avgCosts,
        // P&L
        gross_profit: grossProfit,
        net_profit: netProfit,
        // Receivables
        opening_receivables: Number((openingReceivables as any)?.total) || 0,
        closing_receivables: Number((closingReceivables as any)?.total) || 0,
        credit_payments_received: Number((creditPaymentsReceived as any)?.total) || 0,
        unrecovered_losses: unrecoveredLosses,
        // Breakdown
        daily_breakdown: dailyBreakdown,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Stock Reconciliation Report ──────────────────────────────────────────────
router.get('/stock-reconciliation', async (req, res) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    // Previous date for opening stock
    const prevDate = new Date(date + 'T12:00:00');
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    const tanks = await db('tanks').select('id', 'label', 'fuel_type', 'current_stock_litres', 'capacity_litres');

    // Get shifts for the date
    const dayShifts = await db('shifts')
      .where('start_time', '>=', date + 'T00:00:00')
      .where('start_time', '<=', date + 'T23:59:59')
      .select('id');
    const shiftIds = dayShifts.map((s: any) => s.id);

    const reconciliation = [];

    for (const tank of tanks) {
      // Opening stock: previous day's dip, or fallback to book stock calculation
      const prevDip = await db('tank_dips')
        .where('tank_id', tank.id)
        .where('dip_date', '<=', prevDateStr)
        .orderBy('dip_date', 'desc')
        .first();
      const openingStock = prevDip ? Number(prevDip.measured_litres) : null;

      // Deliveries on this date
      const delResult = await db('fuel_deliveries')
        .where({ tank_id: tank.id, date })
        .sum('litres as total')
        .first();
      const deliveries = Number((delResult as any)?.total) || 0;

      // Sales from pumps linked to this tank
      let sales = 0;
      if (shiftIds.length > 0) {
        const salesResult = await db('pump_readings')
          .join('pumps', 'pump_readings.pump_id', 'pumps.id')
          .whereIn('pump_readings.shift_id', shiftIds)
          .where('pumps.tank_id', tank.id)
          .sum('pump_readings.litres_sold as total')
          .first();
        sales = Number((salesResult as any)?.total) || 0;
      }

      // Closing book stock
      const closingBookStock = openingStock !== null
        ? openingStock + deliveries - sales
        : null;

      // Dip reading for this date
      const dip = await db('tank_dips')
        .where({ tank_id: tank.id, dip_date: date })
        .orderBy('timestamp', 'desc')
        .first();
      const dipReading = dip ? Number(dip.measured_litres) : null;

      // Variance
      const variance = closingBookStock !== null && dipReading !== null
        ? closingBookStock - dipReading : null;
      const variancePct = closingBookStock !== null && dipReading !== null && closingBookStock > 0
        ? (variance! / closingBookStock) * 100 : null;

      reconciliation.push({
        tank_id: tank.id,
        label: tank.label,
        fuel_type: tank.fuel_type,
        capacity: Number(tank.capacity_litres),
        opening_stock: openingStock,
        deliveries,
        sales,
        closing_book_stock: closingBookStock,
        dip_reading: dipReading,
        variance,
        variance_pct: variancePct,
        variance_alert: variancePct !== null && Math.abs(variancePct) > 0.5,
      });
    }

    res.json({ success: true, data: { date, tanks: reconciliation } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Debtor Aging Report ──────────────────────────────────────────────────────
router.get('/debtor-aging', async (_req, res) => {
  try {
    const now = new Date();
    const accounts = await db('credit_accounts').where('type', 'customer');

    const aging = [];
    let totalCurrent = 0, total31_60 = 0, total61_90 = 0, total90Plus = 0;

    for (const account of accounts) {
      const credits = await db('credits')
        .where({ account_id: account.id })
        .whereNot('status', 'paid')
        .where('balance', '>', 0)
        .select('balance', 'created_at');

      if (credits.length === 0) continue;

      let current = 0, d31_60 = 0, d61_90 = 0, d90plus = 0;

      for (const credit of credits) {
        const daysOld = Math.floor((now.getTime() - new Date(credit.created_at).getTime()) / (1000 * 60 * 60 * 24));
        const balance = Number(credit.balance);

        if (daysOld <= 30) current += balance;
        else if (daysOld <= 60) d31_60 += balance;
        else if (daysOld <= 90) d61_90 += balance;
        else d90plus += balance;
      }

      const total = current + d31_60 + d61_90 + d90plus;
      totalCurrent += current;
      total31_60 += d31_60;
      total61_90 += d61_90;
      total90Plus += d90plus;

      aging.push({
        account_id: account.id,
        name: account.name,
        phone: account.phone,
        total_outstanding: total,
        current_0_30: current,
        days_31_60: d31_60,
        days_61_90: d61_90,
        days_90_plus: d90plus,
      });
    }

    // Sort by total outstanding descending
    aging.sort((a, b) => b.total_outstanding - a.total_outstanding);

    res.json({
      success: true,
      data: {
        accounts: aging,
        summary: {
          total_outstanding: totalCurrent + total31_60 + total61_90 + total90Plus,
          current_0_30: totalCurrent,
          days_31_60: total31_60,
          days_61_90: total61_90,
          days_90_plus: total90Plus,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Cash Flow Summary ────────────────────────────────────────────────────────
router.get('/cash-flow', async (req, res) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 7) + '-01';
    const to = (req.query.to as string) || new Date().toISOString().split('T')[0];
    const fromTs = from + 'T00:00:00';
    const toTs = to + 'T23:59:59';

    // Cash Inflows
    const collResult = await db('shift_collections')
      .join('shifts', 'shift_collections.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', fromTs)
      .where('shifts.start_time', '<=', toTs)
      .sum('cash_amount as cash')
      .sum('mpesa_amount as mpesa')
      .sum('credits_amount as credits_on_account')
      .first();
    const cashSales = Number((collResult as any)?.cash) || 0;
    const mpesaSales = Number((collResult as any)?.mpesa) || 0;

    const creditPayments = await db('credit_payments')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .sum('amount as total')
      .first();
    const creditPaymentsReceived = Number((creditPayments as any)?.total) || 0;

    const totalInflows = cashSales + mpesaSales + creditPaymentsReceived;

    // Cash Outflows
    const fuelPurchases = await db('fuel_deliveries')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .sum('total_cost as total')
      .first();
    const totalFuelPurchases = Number((fuelPurchases as any)?.total) || 0;

    // Wages paid (actual: accounting for deductions)
    const periodShifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .where('shifts.start_time', '>=', fromTs)
      .where('shifts.start_time', '<=', toTs)
      .select('shifts.id', 'employees.daily_wage');

    let totalWagesPaid = 0;
    for (const shift of periodShifts) {
      const wd = await db('wage_deductions').where({ shift_id: shift.id }).first();
      totalWagesPaid += wd ? Number(wd.final_wage) : Number(shift.daily_wage);
    }

    // Shift expenses
    const shiftExpResult = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .where('shifts.start_time', '>=', fromTs)
      .where('shifts.start_time', '<=', toTs)
      .sum('shift_expenses.amount as total')
      .first();
    const totalShiftExpenses = Number((shiftExpResult as any)?.total) || 0;

    // General expenses
    const genExpResult = await db('expenses')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .sum('amount as total')
      .first();
    const totalGeneralExpenses = Number((genExpResult as any)?.total) || 0;

    const totalOutflows = totalFuelPurchases + totalWagesPaid + totalShiftExpenses + totalGeneralExpenses;

    // Outstanding receivables
    const outstandingReceivables = await db('credits')
      .whereNot('status', 'paid')
      .where('balance', '>', 0)
      .sum('balance as total')
      .first();

    res.json({
      success: true,
      data: {
        period: { from, to },
        inflows: {
          cash_sales: cashSales,
          mpesa_sales: mpesaSales,
          credit_payments_received: creditPaymentsReceived,
          total: totalInflows,
        },
        outflows: {
          fuel_purchases: totalFuelPurchases,
          wages_paid: totalWagesPaid,
          shift_expenses: totalShiftExpenses,
          general_expenses: totalGeneralExpenses,
          total: totalOutflows,
        },
        net_cash_flow: totalInflows - totalOutflows,
        outstanding_receivables: Number((outstandingReceivables as any)?.total) || 0,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
