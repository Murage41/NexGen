import { Router } from 'express';
import db from '../database';
import { getFIFOCostByFuelType } from '../services/stockCalculator';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const today = getKenyaDate();
    const monthStart = today.slice(0, 7) + '-01';

    // ── Today's shifts ──
    const todayShifts = await db('shifts')
      .where('shift_date', today);
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
    let todayCash = 0, todayMpesa = 0, todayCreditsOnAccount = 0, todayMpesaFee = 0, todayMpesaNet = 0;
    if (shiftIds.length > 0) {
      const collections = await db('shift_collections').whereIn('shift_id', shiftIds);
      for (const c of collections) {
        todayCash += Number(c.cash_amount) || 0;
        todayMpesa += Number(c.mpesa_amount) || 0;
        todayCreditsOnAccount += Number(c.credits_amount) || 0;
        todayMpesaFee += Number(c.mpesa_fee) || 0;
        todayMpesaNet += Number(c.mpesa_net) || 0;
      }
    }

    // Today's COGS from FIFO batch consumption
    const todayFifoCosts = await getFIFOCostByFuelType(today, today);
    const todayCogs = (todayFifoCosts['petrol'] || 0) + (todayFifoCosts['diesel'] || 0);

    // Cost per litre from FIFO (for margin calculation)
    const avgCosts: Record<string, number> = {};
    if (todayLitresPetrol > 0) avgCosts['petrol'] = (todayFifoCosts['petrol'] || 0) / todayLitresPetrol;
    if (todayLitresDiesel > 0) avgCosts['diesel'] = (todayFifoCosts['diesel'] || 0) / todayLitresDiesel;

    // Today's wages — use stored wage_paid for closed shifts, daily_wage preview for open
    let todayWages = 0;
    if (shiftIds.length > 0) {
      const wageShifts = await db('shifts')
        .join('employees', 'shifts.employee_id', 'employees.id')
        .whereIn('shifts.id', shiftIds)
        .select('shifts.id', 'shifts.status', 'shifts.wage_paid', 'employees.daily_wage');

      for (const s of wageShifts) {
        todayWages += s.status === 'closed'
          ? (Number(s.wage_paid) || 0)
          : (Number(s.daily_wage) || 0);
      }
    }

    // Today's expenses (shift + general)
    let todayShiftExpenses = 0;
    if (shiftIds.length > 0) {
      const seResult = await db('shift_expenses')
        .whereIn('shift_id', shiftIds)
        .whereNull('deleted_at')
        .sum('amount as total')
        .first();
      todayShiftExpenses = Number((seResult as any)?.total) || 0;
    }
    const geResult = await db('expenses')
      .where('date', today)
      .whereNull('deleted_at')
      .sum('amount as total')
      .first();
    const todayGeneralExpenses = Number((geResult as any)?.total) || 0;
    const todayExpenses = todayShiftExpenses + todayGeneralExpenses;

    const todayGrossProfit = todaySales - todayCogs;
    const todayNetProfit = todayGrossProfit - todayWages - todayExpenses;
    const todayGrossMargin = todaySales > 0 ? (todayGrossProfit / todaySales) * 100 : 0;

    // Today's variance — must match shift detail formula:
    // variance = (cash + mpesa + credits + expenses + wages) − expected_sales
    // Phase 2 fix: was missing todayExpenses + todayWages, causing
    // dashboard variance to disagree with individual shift variances.
    const todayTotalCollected = todayCash + todayMpesa + todayCreditsOnAccount + todayShiftExpenses + todayWages;
    const todayVariance = todayTotalCollected - todaySales;

    // ── Month-to-date figures ──
    const mtdShifts = await db('shifts')
      .where('shift_date', '>=', monthStart)
      .where('shift_date', '<=', today)
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

    // MTD wages — use stored wage_paid for closed shifts, daily_wage preview for open
    let mtdWages = 0;
    if (mtdShiftIds.length > 0) {
      const mtdWageShifts = await db('shifts')
        .join('employees', 'shifts.employee_id', 'employees.id')
        .whereIn('shifts.id', mtdShiftIds)
        .select('shifts.id', 'shifts.status', 'shifts.wage_paid', 'employees.daily_wage');
      for (const s of mtdWageShifts) {
        mtdWages += s.status === 'closed'
          ? (Number(s.wage_paid) || 0)
          : (Number(s.daily_wage) || 0);
      }
    }

    // MTD expenses
    let mtdShiftExp = 0;
    if (mtdShiftIds.length > 0) {
      const r = await db('shift_expenses').whereIn('shift_id', mtdShiftIds).whereNull('deleted_at').sum('amount as total').first();
      mtdShiftExp = Number((r as any)?.total) || 0;
    }
    const mtdGenExp = await db('expenses')
      .whereNull('deleted_at')
      .where('date', '>=', monthStart)
      .where('date', '<=', today)
      .sum('amount as total')
      .first();
    const mtdExpenses = mtdShiftExp + (Number((mtdGenExp as any)?.total) || 0);

    // MTD COGS from FIFO batch consumption
    const mtdFifoCosts = await getFIFOCostByFuelType(monthStart, today);
    const mtdCogs = (mtdFifoCosts['petrol'] || 0) + (mtdFifoCosts['diesel'] || 0);
    const mtdNetProfit = mtdSales - mtdCogs - mtdWages - mtdExpenses;

    // ── Phase 1A: MTD M-Pesa fees ──
    let mtdMpesaFees = 0;
    let mtdMpesaGross = 0;
    if (mtdShiftIds.length > 0) {
      const mpesaResult = await db('shift_collections')
        .whereIn('shift_id', mtdShiftIds)
        .select(db.raw('SUM(mpesa_fee) as fees'), db.raw('SUM(mpesa_amount) as gross'))
        .first();
      mtdMpesaFees = Number((mpesaResult as any)?.fees) || 0;
      mtdMpesaGross = Number((mpesaResult as any)?.gross) || 0;
    }

    // ── Supplier payables (AP) ──
    let totalSupplierPayables = 0;
    const hasSupplierInvoices = await db.schema.hasTable('supplier_invoices');
    if (hasSupplierInvoices) {
      const apResult = await db('supplier_invoices')
        .whereNull('deleted_at')
        .whereNot('status', 'paid')
        .sum('balance as total')
        .first();
      totalSupplierPayables = Number((apResult as any)?.total || 0);
    }

    // ── Outstanding credits (receivables) ──
    const creditsResult = await db('credits')
      .whereNull('deleted_at')
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

    // ── Phase 1B: EPRA compliance ──
    const epraAlerts: any[] = [];
    for (const fuelType of ['petrol', 'diesel']) {
      const latestPrice = await db('fuel_prices')
        .where('fuel_type', fuelType)
        .where('effective_date', '<=', today)
        .orderBy('effective_date', 'desc')
        .orderBy('id', 'desc')
        .first();
      const latestCeiling = await db('fuel_prices')
        .where('fuel_type', fuelType)
        .whereNotNull('epra_max_price')
        .where(function () {
          this.whereNull('epra_effective_date').orWhere('epra_effective_date', '<=', today);
        })
        .orderBy('effective_date', 'desc')
        .orderBy('id', 'desc')
        .first();
      if (latestPrice && latestCeiling && latestCeiling.epra_max_price) {
        const ppl = Number(latestPrice.price_per_litre);
        const max = Number(latestCeiling.epra_max_price);
        let status: 'ok' | 'near_ceiling' | 'over_ceiling' = 'ok';
        if (ppl > max) status = 'over_ceiling';
        else if (ppl >= max * 0.95) status = 'near_ceiling';
        epraAlerts.push({
          fuel_type: fuelType,
          price_per_litre: ppl,
          epra_max_price: max,
          headroom: Math.round((max - ppl) * 100) / 100,
          status,
        });
      }
    }

    // ── Phase 1C: Stock health (cumulative variance % per tank for current month) ──
    const monthKey = today.slice(0, 7);
    const stockHealth: any[] = [];

    // ── Tank stock levels ──
    const tanks = await db('tanks').select('id', 'label', 'fuel_type', 'current_stock_litres', 'capacity_litres');

    for (const tank of tanks) {
      // Reuse the same arithmetic as the tankDips trends endpoint:
      //   (sum |variance| this month) / (sum litres sold this month)
      const dipResult = await db('tank_dips')
        .where('tank_id', tank.id)
        .whereNull('deleted_at')
        .where('dip_date', '>=', monthStart)
        .where('dip_date', '<=', today)
        .select(db.raw('SUM(ABS(variance_litres)) as total'))
        .first();
      const totalVariance = Number((dipResult as any)?.total || 0);

      const salesResult = await db('pump_readings')
        .join('pumps', 'pump_readings.pump_id', 'pumps.id')
        .join('shifts', 'pump_readings.shift_id', 'shifts.id')
        .where('pumps.tank_id', tank.id)
        .where('shifts.shift_date', '>=', monthStart)
        .where('shifts.shift_date', '<=', today)
        .sum('pump_readings.litres_sold as total')
        .first();
      const totalSales = Number((salesResult as any)?.total || 0);
      const pct = totalSales > 0 ? (totalVariance / totalSales) * 100 : 0;
      stockHealth.push({
        tank_id: tank.id,
        tank_label: tank.label,
        fuel_type: tank.fuel_type,
        cumulative_variance_pct: Number(pct.toFixed(4)),
        status: pct > 0.1 ? 'over_threshold' : 'ok',
      });
    }
    const tankStockSummary = tanks.map((t: any) => ({
      id: t.id,
      label: t.label,
      fuel_type: t.fuel_type,
      current_stock: Number(t.current_stock_litres),
      capacity: Number(t.capacity_litres),
      pct_full: Number(t.capacity_litres) > 0
        ? (Number(t.current_stock_litres) / Number(t.capacity_litres)) * 100
        : 0,
      negative_stock: Number(t.current_stock_litres) < 0,
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
    // Phase 2/8 fix: use Kenya date arithmetic (was UTC — wrong after 9 PM EAT)
    const weeklySales = [];
    const todayMs = new Date(today + 'T00:00:00+03:00').getTime();
    for (let i = 6; i >= 0; i--) {
      const dateStr = new Date(todayMs - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
      const dayShifts = await db('shifts')
        .where('shift_date', dateStr)
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
          mpesa_fee: todayMpesaFee,
          mpesa_net: todayMpesaNet,
          credits: todayCreditsOnAccount,
        },
        // Month-to-date
        mtd_sales: mtdSales,
        mtd_litres: mtdLitres,
        mtd_expenses: mtdExpenses,
        mtd_net_profit: mtdNetProfit,
        mtd_mpesa_fees: mtdMpesaFees,
        mtd_mpesa_gross: mtdMpesaGross,
        // Business health
        total_outstanding_credits: totalOutstandingCredits,
        total_outstanding_staff_debts: totalOutstandingStaffDebts,
        tank_stock_summary: tankStockSummary,
        margin_per_litre: marginPerLitre,
        // Supplier payables (AP)
        total_supplier_payables: totalSupplierPayables,
        // Phase 1 quick wins
        epra_alerts: epraAlerts,
        stock_health: stockHealth,
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
