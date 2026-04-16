import { Router } from 'express';
import db from '../database';
import { computeBookStock, computeAllTankStocks, getFIFOCostByFuelType, reverseBatchConsumption, consumeBatchesFIFO, recomputeCache } from '../services/stockCalculator';
import { getKenyaDate, getKenyaMonth } from '../utils/timezone';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

// ─── Daily Report ─────────────────────────────────────────────────────────────
router.get('/daily', async (req, res) => {
  try {
    const date = (req.query.date as string) || getKenyaDate();

    const shifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name', 'employees.daily_wage')
      .where('shifts.shift_date', date)
      .orderBy('shifts.start_time');

    // FIFO cost for COGS
    const fifoCosts = await getFIFOCostByFuelType(date, date);

    const shiftDetails = [];
    let totalSales = 0;
    let totalPetrolLitres = 0;
    let totalDieselLitres = 0;
    let totalCash = 0;
    let totalMpesa = 0;
    let totalCredits = 0;
    let totalWagesPaid = 0;
    let totalShiftExpenses = 0;
    let totalMpesaFee = 0;
    let totalMpesaNet = 0;

    for (const shift of shifts) {
      const readings = await db('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.fuel_type')
        .where('pump_readings.shift_id', shift.id);

      const collections = await db('shift_collections').where({ shift_id: shift.id }).first();
      const expenses = await db('shift_expenses').where({ shift_id: shift.id }).whereNull('deleted_at');

      const wageDeduction = await db('wage_deductions').where({ shift_id: shift.id }).whereNull('deleted_at').first();
      const actualWagePaid = shift.status === 'closed'
        ? (Number(shift.wage_paid) || 0)
        : (Number(shift.daily_wage) || 0);

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
      const mpesaFee = Number(collections?.mpesa_fee) || 0;
      const mpesaNet = Number(collections?.mpesa_net) || 0;
      const totalCollections = cash + mpesa + credits;

      totalSales += shiftSales;
      totalPetrolLitres += petrolLitres;
      totalDieselLitres += dieselLitres;
      totalCash += cash;
      totalMpesa += mpesa;
      totalCredits += credits;
      totalWagesPaid += actualWagePaid;
      totalShiftExpenses += shiftExpensesTotal;
      totalMpesaFee += mpesaFee;
      totalMpesaNet += mpesaNet;

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
        variance: (cash + mpesa + credits + shiftExpensesTotal + actualWagePaid) - shiftSales,
      });
    }

    // General business expenses for the day
    const dayExpenses = await db('expenses').where({ date }).whereNull('deleted_at');
    const totalDayExpenses = dayExpenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

    // COGS from FIFO batch consumption
    const cogs = (fifoCosts['petrol'] || 0) + (fifoCosts['diesel'] || 0);

    // Cost per litre from FIFO (for margin calculation)
    const avgCosts: Record<string, number> = {};
    if (totalPetrolLitres > 0) avgCosts['petrol'] = (fifoCosts['petrol'] || 0) / totalPetrolLitres;
    if (totalDieselLitres > 0) avgCosts['diesel'] = (fifoCosts['diesel'] || 0) / totalDieselLitres;

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

    // Tank stock snapshot for the day — computed as-of report date (fixes Issue 3)
    const tanks = await db('tanks').select('id', 'label', 'fuel_type', 'capacity_litres');
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
        .whereNull('deleted_at')
        .sum('litres as total')
        .first();
      const tankDeliveries = Number((delResult as any)?.total) || 0;

      // Latest dip for this date
      const dip = await db('tank_dips')
        .where({ tank_id: tank.id, dip_date: date })
        .whereNull('deleted_at')
        .orderBy('timestamp', 'desc')
        .first();

      // Computed book stock as-of this report date
      const bookStock = await computeBookStock(tank.id, date);
      const dipReading = dip ? Number(dip.measured_litres) : null;
      // Phase 2 fix: sign convention = measured − book (matches tank_dips.variance_litres).
      // Positive = surplus (more fuel than expected), negative = loss/shrinkage.
      const dipVariance = dipReading !== null ? dipReading - bookStock : null;
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

    // Debt collected during today's shifts (credit_payments with shift_id)
    let totalCreditReceipts = 0;
    if (shiftIds.length > 0 && await db.schema.hasTable('credit_payments')) {
      const hasShiftId = await db.schema.hasColumn('credit_payments', 'shift_id');
      if (hasShiftId) {
        const receiptsResult = await db('credit_payments')
          .whereIn('shift_id', shiftIds)
          .whereNull('deleted_at')
          .sum('amount as total')
          .first();
        totalCreditReceipts = Number((receiptsResult as any)?.total) || 0;
      }
    }

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
        total_mpesa_fee: totalMpesaFee,
        total_mpesa_net: totalMpesaNet,
        total_credits: totalCredits,
        total_credit_receipts: totalCreditReceipts,
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
    const month = (req.query.month as string) || getKenyaMonth();
    const startDate = month + '-01';
    const endDate = month + '-31';

    // Previous month for opening stock
    const [year, mon] = month.split('-').map(Number);
    const prevMonth = mon === 1
      ? `${year - 1}-12`
      : `${year}-${String(mon - 1).padStart(2, '0')}`;
    const prevEndDate = prevMonth + '-31';

    // FIFO cost for the month
    const fifoCosts = await getFIFOCostByFuelType(startDate, endDate);

    // Fuel sales grouped by type
    const fuelSales = await db('pump_readings')
      .join('shifts', 'pump_readings.shift_id', 'shifts.id')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .where('shifts.shift_date', '>=', startDate)
      .where('shifts.shift_date', '<=', endDate)
      .select('pumps.fuel_type')
      .sum('pump_readings.litres_sold as total_litres')
      .sum('pump_readings.amount_sold as total_sales')
      .groupBy('pumps.fuel_type');

    const totalSales = fuelSales.reduce((s: number, r: any) => s + (Number(r.total_sales) || 0), 0);
    const totalLitres = fuelSales.reduce((s: number, r: any) => s + (Number(r.total_litres) || 0), 0);

    // Cost per litre from FIFO
    const avgCosts: Record<string, number> = {};
    for (const fs of fuelSales) {
      const litres = Number(fs.total_litres) || 0;
      if (litres > 0) avgCosts[fs.fuel_type] = (fifoCosts[fs.fuel_type] || 0) / litres;
    }

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
      .where('shifts.shift_date', '>=', startDate)
      .where('shifts.shift_date', '<=', endDate)
      .sum('cash_amount as total_cash')
      .sum('mpesa_amount as total_mpesa')
      .sum('credits_amount as total_credits')
      .first();

    // Wages: use stored wage_paid for closed shifts, daily_wage for open
    const allShifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .where('shifts.shift_date', '>=', startDate)
      .where('shifts.shift_date', '<=', endDate)
      .select('shifts.id', 'shifts.status', 'shifts.wage_paid', 'employees.daily_wage');

    let totalWagesPaid = 0;
    for (const shift of allShifts) {
      totalWagesPaid += shift.status === 'closed'
        ? (Number(shift.wage_paid) || 0)
        : (Number(shift.daily_wage) || 0);
    }

    // General expenses
    const generalExpenses = await db('expenses')
      .whereNull('deleted_at')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .sum('amount as total')
      .first();

    // Shift expenses
    const shiftExpenses = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .whereNull('shift_expenses.deleted_at')
      .where('shifts.shift_date', '>=', startDate)
      .where('shifts.shift_date', '<=', endDate)
      .sum('shift_expenses.amount as total')
      .first();

    // Expense categories (merged from both general and shift expenses)
    const generalCats = await db('expenses')
      .whereNull('deleted_at')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .select('category')
      .sum('amount as total')
      .groupBy('category');

    const shiftCats = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .whereNull('shift_expenses.deleted_at')
      .where('shifts.shift_date', '>=', startDate)
      .where('shifts.shift_date', '<=', endDate)
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

    // ── COGS: Use FIFO batch consumption for accurate costing ──
    const tanksData = await db('tanks').select('id', 'fuel_type');

    // Computed book stock for opening (end of prev month) and closing (end of this month)
    const openingStocks = await computeAllTankStocks(prevEndDate);
    const closingStocks = await computeAllTankStocks(endDate);

    const openingLitresMap: Record<string, number> = {};
    const closingLitresMap: Record<string, number> = {};
    for (const tank of tanksData) {
      openingLitresMap[tank.fuel_type] = (openingLitresMap[tank.fuel_type] || 0) + (openingStocks[tank.id] || 0);
      closingLitresMap[tank.fuel_type] = (closingLitresMap[tank.fuel_type] || 0) + (closingStocks[tank.id] || 0);
    }

    // Value stocks using FIFO cost per litre
    function stockValue(litresMap: Record<string, number>, costs: Record<string, number>): number {
      let total = 0;
      for (const [fuelType, litres] of Object.entries(litresMap)) {
        total += litres * (costs[fuelType] || 0);
      }
      return total;
    }

    const openingStockValue = stockValue(openingLitresMap, avgCosts);
    const closingStockValue = stockValue(closingLitresMap, avgCosts);

    // Purchases this month
    const purchasesResult = await db('fuel_deliveries')
      .whereNull('deleted_at')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .sum('total_cost as total')
      .first();
    const purchases = Number((purchasesResult as any)?.total) || 0;

    // Primary COGS from FIFO consumption; stock-based as secondary verification
    const cogs = (fifoCosts['petrol'] || 0) + (fifoCosts['diesel'] || 0);

    // Receivables movement
    const openingReceivables = await db('credits')
      .where('created_at', '<', startDate + 'T00:00:00')
      .whereNot('status', 'paid')
      .sum('balance as total')
      .first();
    const closingReceivables = await db('credits')
      .where('created_at', '<=', endDate + 'T23:59:59')
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
      .where('shifts.shift_date', '>=', startDate)
      .where('shifts.shift_date', '<=', endDate)
      .where('staff_debts.status', 'outstanding')
      .sum('staff_debts.balance as total')
      .first();
    const unrecoveredLosses = Number((staffDebtResult as any)?.total) || 0;

    // Daily breakdown
    const closedShifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .where('shifts.shift_date', '>=', startDate)
      .where('shifts.shift_date', '<=', endDate)
      .where('shifts.status', 'closed')
      .select('shifts.id', 'shifts.shift_date', 'shifts.start_time', 'shifts.wage_paid', 'employees.daily_wage');

    const dailyMap: Record<string, { sales: number; petrol_litres: number; diesel_litres: number; expenses: number; wages: number }> = {};

    for (const shift of closedShifts) {
      const dayKey = shift.shift_date || (shift.start_time as string).split('T')[0];
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

      const shiftExpResult = await db('shift_expenses').where({ shift_id: shift.id }).whereNull('deleted_at').sum('amount as total').first();
      dailyMap[dayKey].expenses += Number((shiftExpResult as any)?.total) || 0;

      dailyMap[dayKey].wages += Number(shift.wage_paid) || 0;
    }

    // Add general expenses into daily map
    const allGeneralExpenses = await db('expenses')
      .whereNull('deleted_at')
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

    // Get FIFO cost per day for daily breakdown
    const dailyDates = Object.keys(dailyMap).sort();
    const dailyFifoCosts: Record<string, number> = {};
    for (const d of dailyDates) {
      const dayCosts = await getFIFOCostByFuelType(d, d);
      dailyFifoCosts[d] = (dayCosts['petrol'] || 0) + (dayCosts['diesel'] || 0);
    }

    const dailyBreakdown = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => {
        const dayCogs = dailyFifoCosts[date] || 0;
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
    const date = (req.query.date as string) || getKenyaDate();

    // Previous date for opening stock
    const prevDate = new Date(date + 'T12:00:00');
    prevDate.setDate(prevDate.getDate() - 1);
    // Phase 8 fix: use Kenya timezone (was UTC — wrong after 9 PM EAT)
    const prevDateStr = prevDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

    const tanks = await db('tanks').select('id', 'label', 'fuel_type', 'capacity_litres');

    // Get shifts for the date
    const dayShifts = await db('shifts')
      .where('shift_date', date)
      .select('id');
    const shiftIds = dayShifts.map((s: any) => s.id);

    const reconciliation = [];

    for (const tank of tanks) {
      // Computed opening stock (as of previous day)
      const openingStock = await computeBookStock(tank.id, prevDateStr);

      // Deliveries on this date
      const delResult = await db('fuel_deliveries')
        .where({ tank_id: tank.id, date })
        .whereNull('deleted_at')
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

      // Closing book stock = opening + deliveries - sales
      const closingBookStock = openingStock + deliveries - sales;

      // Dip reading for this date
      const dip = await db('tank_dips')
        .where({ tank_id: tank.id, dip_date: date })
        .whereNull('deleted_at')
        .orderBy('timestamp', 'desc')
        .first();
      const dipReading = dip ? Number(dip.measured_litres) : null;

      // Phase 2 fix: sign = measured − book (positive = surplus, negative = loss)
      const variance = dipReading !== null ? dipReading - closingBookStock : null;
      const variancePct = dipReading !== null && closingBookStock > 0
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
    const from = (req.query.from as string) || getKenyaMonth() + '-01';
    const to = (req.query.to as string) || getKenyaDate();

    // Cash Inflows
    const collResult = await db('shift_collections')
      .join('shifts', 'shift_collections.shift_id', 'shifts.id')
      .where('shifts.shift_date', '>=', from)
      .where('shifts.shift_date', '<=', to)
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
      .whereNull('deleted_at')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .sum('total_cost as total')
      .first();
    const totalFuelPurchases = Number((fuelPurchases as any)?.total) || 0;

    // Wages paid: use stored wage_paid for closed shifts, daily_wage for open
    const periodShifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .where('shifts.shift_date', '>=', from)
      .where('shifts.shift_date', '<=', to)
      .select('shifts.id', 'shifts.status', 'shifts.wage_paid', 'employees.daily_wage');

    let totalWagesPaid = 0;
    for (const shift of periodShifts) {
      totalWagesPaid += shift.status === 'closed'
        ? (Number(shift.wage_paid) || 0)
        : (Number(shift.daily_wage) || 0);
    }

    // Shift expenses
    const shiftExpResult = await db('shift_expenses')
      .join('shifts', 'shift_expenses.shift_id', 'shifts.id')
      .whereNull('shift_expenses.deleted_at')
      .where('shifts.shift_date', '>=', from)
      .where('shifts.shift_date', '<=', to)
      .sum('shift_expenses.amount as total')
      .first();
    const totalShiftExpenses = Number((shiftExpResult as any)?.total) || 0;

    // General expenses
    const genExpResult = await db('expenses')
      .whereNull('deleted_at')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .sum('amount as total')
      .first();
    const totalGeneralExpenses = Number((genExpResult as any)?.total) || 0;

    const totalOutflows = totalFuelPurchases + totalWagesPaid + totalShiftExpenses + totalGeneralExpenses;

    // Outstanding receivables
    const outstandingReceivables = await db('credits')
      .whereNull('deleted_at')
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

// GET stock reconciliation broken down by shift
router.get('/stock-reconciliation-by-shift', async (req, res) => {
  try {
    const date = (req.query.date as string) || getKenyaDate();

    const tanks = await db('tanks').orderBy('label');

    // Get all shifts for this date
    const shifts = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .where('shifts.shift_date', date)
      .select('shifts.id', 'shifts.status', 'shifts.start_time', 'shifts.end_time', 'employees.name as employee_name')
      .orderBy('shifts.start_time');

    const shiftIds = shifts.map((s: any) => s.id);

    // Get all snapshots for these shifts
    const snapshots = shiftIds.length > 0
      ? await db('shift_tank_snapshots').whereIn('shift_id', shiftIds)
      : [];

    // Get dip readings for this date
    const dips = await db('tank_dips')
      .where('dip_date', date)
      .whereNull('deleted_at')
      .orderByRaw('timestamp DESC');

    const result = tanks.map((tank: any) => {
      const tankSnaps = snapshots.filter((s: any) => s.tank_id === tank.id);
      const tankDip = dips.find((d: any) => d.tank_id === tank.id);

      const shiftBreakdown = shifts.map((s: any) => {
        const snap = tankSnaps.find((sn: any) => sn.shift_id === s.id);
        return {
          shift_id: s.id,
          employee_name: s.employee_name,
          status: s.status,
          start_time: s.start_time,
          end_time: s.end_time,
          opening_stock: snap ? parseFloat(snap.opening_stock_litres) : null,
          deliveries: snap ? parseFloat(snap.deliveries_litres) : null,
          sales: snap ? parseFloat(snap.sales_litres) : null,
          closing_stock: snap ? parseFloat(snap.closing_stock_litres) : null,
        };
      });

      // Day totals from snapshots
      const dayDeliveries = tankSnaps.reduce((s: number, sn: any) => s + (parseFloat(sn.deliveries_litres) || 0), 0);
      const daySales = tankSnaps.reduce((s: number, sn: any) => s + (parseFloat(sn.sales_litres) || 0), 0);
      const dayOpening = tankSnaps.length > 0 ? parseFloat(tankSnaps[0].opening_stock_litres) : null;
      const dayClosingBook = dayOpening !== null ? dayOpening + dayDeliveries - daySales : null;
      const dipReading = tankDip ? parseFloat(tankDip.measured_litres) : null;
      const variance = dayClosingBook !== null && dipReading !== null ? dipReading - dayClosingBook : null;

      return {
        tank_id: tank.id,
        label: tank.label,
        fuel_type: tank.fuel_type,
        shifts: shiftBreakdown,
        day_opening: dayOpening,
        day_deliveries: dayDeliveries,
        day_sales: daySales,
        day_closing_book: dayClosingBook,
        dip_reading: dipReading,
        variance,
      };
    });

    res.json({ success: true, data: { date, tanks: result } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Admin: Recalculate COGS for a shift ──────────────────────────────────────
// Reverses batch consumption for the given shift, then re-consumes using
// current delivery_batches.cost_per_litre values. Use after correcting a
// delivery price or when batch_consumption has drifted.
router.post('/recalculate-cogs', requireAdmin, async (req: any, res) => {
  try {
    const { shift_id, reason } = req.body;
    if (!shift_id) return res.status(400).json({ success: false, error: 'shift_id is required' });

    const shift = await db('shifts').where({ id: shift_id }).first();
    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });
    if (shift.status !== 'closed') {
      return res.status(400).json({ success: false, error: 'Only closed shifts can be recalculated' });
    }

    // Get pump readings per tank for this shift
    const readings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .where('pump_readings.shift_id', shift_id)
      .select('pumps.tank_id', db.raw('SUM(pump_readings.litres_sold) as litres'))
      .groupBy('pumps.tank_id');

    const correctedBy = Number(req.employee?.id ?? 0);
    const results: any[] = [];

    await db.transaction(async (trx) => {
      for (const reading of readings) {
        const tankId = reading.tank_id;
        const litresSold = Number(reading.litres) || 0;
        if (litresSold <= 0) continue;

        // Get old cost
        const oldCostResult = await trx('batch_consumption')
          .where({ shift_id, tank_id: tankId })
          .sum('total_cost as total')
          .first();
        const oldCost = Number((oldCostResult as any)?.total || 0);

        // Reverse existing consumption
        await reverseBatchConsumption(shift_id, tankId, trx);

        // Re-consume with current batch prices
        const { totalCost: newCost } = await consumeBatchesFIFO(tankId, litresSold, shift_id, trx);

        // Update shift_tank_snapshots.cogs
        await trx('shift_tank_snapshots')
          .where({ shift_id, tank_id: tankId })
          .update({ cogs: newCost });

        // Recompute cache
        await recomputeCache(tankId, trx);

        const delta = Math.round((newCost - oldCost) * 100) / 100;

        // Phase 10: append-only audit row for this correction
        await trx('cogs_corrections').insert({
          shift_id,
          tank_id: tankId,
          litres_sold: litresSold,
          old_cogs: oldCost,
          new_cogs: newCost,
          delta_kes: delta,
          corrected_by: correctedBy,
          reason: reason || null,
        });

        results.push({
          tank_id: tankId,
          litres_sold: litresSold,
          old_cogs: oldCost,
          new_cogs: newCost,
          delta,
        });
      }
    });

    const totalOld = results.reduce((s, r) => s + r.old_cogs, 0);
    const totalNew = results.reduce((s, r) => s + r.new_cogs, 0);

    res.json({
      success: true,
      data: {
        shift_id,
        tanks: results,
        total_old_cogs: totalOld,
        total_new_cogs: totalNew,
        total_delta: Math.round((totalNew - totalOld) * 100) / 100,
      },
    });
  } catch (err: any) {
    console.error('[reports:recalculate-cogs] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Admin: List COGS corrections (audit trail) ───────────────────────────────
router.get('/cogs-corrections', requireAdmin, async (req, res) => {
  try {
    const { shift_id, from, to } = req.query;
    let query = db('cogs_corrections as c')
      .join('tanks', 'c.tank_id', 'tanks.id')
      .leftJoin('employees', 'c.corrected_by', 'employees.id')
      .select(
        'c.id', 'c.shift_id', 'c.tank_id', 'tanks.label as tank_label', 'tanks.fuel_type',
        'c.litres_sold', 'c.old_cogs', 'c.new_cogs', 'c.delta_kes',
        'c.corrected_by', 'employees.name as corrected_by_name',
        'c.reason', 'c.created_at',
      )
      .orderBy('c.created_at', 'desc');
    if (shift_id) query = query.where('c.shift_id', shift_id);
    if (from) query = query.where('c.created_at', '>=', from);
    if (to) query = query.where('c.created_at', '<=', to);
    const rows = await query;
    res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('[reports:cogs-corrections] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
