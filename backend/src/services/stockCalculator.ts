import db from '../database';
import { Knex } from 'knex';

/**
 * Computed book stock for a tank as of a given point in time.
 * Formula: SUM(deliveries received before asOf) - SUM(closed-shift sales closed before asOf)
 *
 * `asOf` may be either a full ISO datetime (e.g. '2026-04-23T11:41:45.000Z' or
 * '2026-04-23 11:41:45') or a bare date 'YYYY-MM-DD'. A bare date is treated
 * as end-of-day (23:59:59) — which preserves the previous date-level semantics
 * for callers that only have a date (reports, "live" cache).
 *
 * New deliveries store the selected date at midnight in delivery_timestamp.
 * COALESCE(delivery_timestamp, created_at) is kept as a legacy fallback only.
 * Sales use shifts.end_time (the close moment) as the effective time.
 *
 * This replaces the old date-only approach. Fixes the pre-delivery-dip phantom
 * variance bug (see migration 022).
 */
export async function computeBookStock(
  tankId: number,
  asOf: string,
  conn?: Knex
): Promise<number> {
  const qb = conn || db;

  // Normalize: bare 'YYYY-MM-DD' → end-of-day so date-only callers still work.
  const asOfTs = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? `${asOf} 23:59:59` : asOf;

  // Sum deliveries whose effective timestamp <= asOfTs
  const deliveryResult = await qb('fuel_deliveries')
    .where('tank_id', tankId)
    .whereNull('deleted_at')
    .whereRaw('datetime(COALESCE(delivery_timestamp, created_at)) <= datetime(?)', [asOfTs])
    .sum('litres as total')
    .first();
  const totalDelivered = parseFloat(deliveryResult?.total) || 0;

  const hasAdjustments = await qb.schema.hasTable('tank_stock_adjustments');
  let totalAdjusted = 0;
  if (hasAdjustments) {
    const adjustmentResult = await qb('tank_stock_adjustments')
      .where('tank_id', tankId)
      .whereRaw('datetime(adjustment_timestamp) <= datetime(?)', [asOfTs])
      .sum('litres_change as total')
      .first();
    totalAdjusted = parseFloat(adjustmentResult?.total) || 0;
  }

  // Sum litres sold from closed shifts that ended <= asOfTs.
  // Fallback: if end_time is null (legacy data), use shift_date end-of-day.
  const salesResult = await qb('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .join('shifts', 'pump_readings.shift_id', 'shifts.id')
    .where('pumps.tank_id', tankId)
    .where('shifts.status', 'closed')
    .whereRaw(
      "datetime(COALESCE(shifts.end_time, shifts.shift_date || ' 23:59:59')) <= datetime(?)",
      [asOfTs],
    )
    .sum('pump_readings.litres_sold as total')
    .first();
  const totalSold = parseFloat(salesResult?.total) || 0;

  return totalDelivered + totalAdjusted - totalSold;
}

/**
 * Compute book stock for ALL tanks as of a given date.
 * Returns a map of tankId → bookStock.
 */
export async function computeAllTankStocks(
  asOfDate: string,
  conn?: Knex
): Promise<Record<number, number>> {
  const qb = conn || db;
  const tanks = await qb('tanks').select('id');
  const result: Record<number, number> = {};
  for (const t of tanks) {
    result[t.id] = await computeBookStock(t.id, asOfDate, conn);
  }
  return result;
}

/**
 * Recompute the cached `current_stock_litres` for a tank.
 * Uses today's date to compute the "live" book stock.
 */
export async function recomputeCache(
  tankId: number,
  conn?: Knex
): Promise<number> {
  const qb = conn || db;
  // Use a far-future date to capture everything (all deliveries and all closed shifts)
  const stock = await computeBookStock(tankId, '9999-12-31', conn);
  await qb('tanks').where({ id: tankId }).update({ current_stock_litres: stock });
  return stock;
}

/**
 * Consume fuel from delivery batches using FIFO (First In, First Out).
 * Deducts litres from the oldest batches first, records consumption rows.
 * Returns the total FIFO cost for the fuel consumed.
 */
export async function consumeBatchesFIFO(
  tankId: number,
  litres: number,
  shiftId: number,
  conn?: Knex
): Promise<{ totalCost: number; details: Array<{ batchId: number; litres: number; costPerLitre: number; source: 'delivery' | 'adjustment' | 'missing' }> }> {
  const qb = conn || db;
  if (litres <= 0) return { totalCost: 0, details: [] };

  type BatchSource = {
    source: 'delivery' | 'adjustment';
    id: number;
    tank_id: number;
    remaining_litres: number;
    cost_per_litre: number;
    date: string;
  };

  const deliveryBatches: BatchSource[] = (await qb('delivery_batches')
    .where('tank_id', tankId)
    .where('remaining_litres', '>', 0)
    .select('id', 'tank_id', 'remaining_litres', 'cost_per_litre', 'date'))
    .map((b: any) => ({
      source: 'delivery' as const,
      id: b.id,
      tank_id: b.tank_id,
      remaining_litres: parseFloat(b.remaining_litres),
      cost_per_litre: parseFloat(b.cost_per_litre),
      date: b.date,
    }));

  let adjustmentBatches: BatchSource[] = [];
  if (await qb.schema.hasTable('tank_adjustment_batches')) {
    adjustmentBatches = (await qb('tank_adjustment_batches')
      .where('tank_id', tankId)
      .where('remaining_litres', '>', 0)
      .select('id', 'tank_id', 'remaining_litres', 'cost_per_litre', 'date'))
      .map((b: any) => ({
        source: 'adjustment' as const,
        id: b.id,
        tank_id: b.tank_id,
        remaining_litres: parseFloat(b.remaining_litres),
        cost_per_litre: parseFloat(b.cost_per_litre),
        date: b.date,
      }));
  }

  const batches = [...deliveryBatches, ...adjustmentBatches].sort((a, b) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate !== 0) return byDate;
    if (a.source !== b.source) return a.source === 'delivery' ? -1 : 1;
    return a.id - b.id;
  });

  let remaining = litres;
  let totalCost = 0;
  const details: Array<{ batchId: number; litres: number; costPerLitre: number; source: 'delivery' | 'adjustment' | 'missing' }> = [];

  for (const batch of batches) {
    if (remaining <= 0) break;

    const available = batch.remaining_litres;
    const consumed = Math.min(available, remaining);
    const cost = consumed * batch.cost_per_litre;

    if (batch.source === 'delivery') {
      await qb('delivery_batches')
        .where({ id: batch.id })
        .update({ remaining_litres: available - consumed });
    } else {
      await qb('tank_adjustment_batches')
        .where({ id: batch.id })
        .update({ remaining_litres: available - consumed });
    }

    const consumption: any = {
      batch_id: batch.id,
      shift_id: shiftId,
      tank_id: tankId,
      litres_consumed: consumed,
      cost_per_litre: batch.cost_per_litre,
      total_cost: cost,
    };
    if (batch.source === 'adjustment') {
      consumption.batch_id = null;
      consumption.adjustment_batch_id = batch.id;
    }
    await qb('batch_consumption').insert(consumption);

    totalCost += cost;
    remaining -= consumed;
    details.push({
      batchId: batch.id,
      litres: consumed,
      costPerLitre: batch.cost_per_litre,
      source: batch.source,
    });
  }

  // If remaining > 0, we sold more than we have batches for (missing deliveries).
  // Record at zero cost — the data gap will show in reports as a warning.
  if (remaining > 0) {
    await qb('batch_consumption').insert({
      batch_id: null,
      shift_id: shiftId,
      tank_id: tankId,
      litres_consumed: remaining,
      cost_per_litre: 0,
      total_cost: 0,
    });
    details.push({ batchId: 0, litres: remaining, costPerLitre: 0, source: 'missing' });
  }

  return { totalCost, details };
}

/**
 * Reverse all batch consumption for a given shift and tank.
 * Adds litres back to delivery_batches.remaining_litres.
 */
export async function reverseBatchConsumption(
  shiftId: number,
  tankId: number | null,
  conn?: Knex
): Promise<void> {
  const qb = conn || db;
  let query = qb('batch_consumption').where({ shift_id: shiftId });
  if (tankId !== null) query = query.where({ tank_id: tankId });

  const rows = await query.select('*');
  for (const row of rows) {
    if (row.batch_id) {
      await qb('delivery_batches')
        .where({ id: row.batch_id })
        .increment('remaining_litres', parseFloat(row.litres_consumed));
    }
    if (row.adjustment_batch_id) {
      await qb('tank_adjustment_batches')
        .where({ id: row.adjustment_batch_id })
        .increment('remaining_litres', parseFloat(row.litres_consumed));
    }
  }

  // Delete the consumption records
  let deleteQuery = qb('batch_consumption').where({ shift_id: shiftId });
  if (tankId !== null) deleteQuery = deleteQuery.where({ tank_id: tankId });
  await deleteQuery.delete();
}

export type TankCogsReplayResult = {
  shift_id: number;
  tank_id: number;
  litres_sold: number;
  old_cogs: number;
  new_cogs: number;
  delta_kes: number;
  missing_litres: number;
};

/**
 * Replays FIFO batch consumption for one tank from a historical point forward.
 * Use after a backdated delivery or pending-price delivery is completed.
 */
export async function replayTankCogsFrom(
  tankId: number,
  fromTimestamp: string,
  reason: string,
  correctedBy = 0,
  conn?: Knex
): Promise<TankCogsReplayResult[]> {
  const qb = conn || db;

  const shifts = await qb('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .join('shifts', 'pump_readings.shift_id', 'shifts.id')
    .where('pumps.tank_id', tankId)
    .where('shifts.status', 'closed')
    .whereRaw(
      "datetime(COALESCE(shifts.end_time, shifts.shift_date || ' 23:59:59')) >= datetime(?)",
      [fromTimestamp],
    )
    .select('shifts.id as shift_id')
    .sum('pump_readings.litres_sold as litres_sold')
    .groupBy('shifts.id')
    .orderByRaw("datetime(COALESCE(shifts.end_time, shifts.shift_date || ' 23:59:59')) asc")
    .orderBy('shifts.id', 'asc');

  if (shifts.length === 0) return [];

  const oldCosts = new Map<number, number>();
  for (const shift of shifts) {
    const oldCostResult = await qb('batch_consumption')
      .where({ shift_id: shift.shift_id, tank_id: tankId })
      .sum('total_cost as total')
      .first();
    oldCosts.set(shift.shift_id, Number((oldCostResult as any)?.total || 0));
  }

  for (const shift of shifts) {
    await reverseBatchConsumption(shift.shift_id, tankId, qb);
  }

  const hasCorrections = await qb.schema.hasTable('cogs_corrections');
  const results: TankCogsReplayResult[] = [];

  for (const shift of shifts) {
    const litresSold = Number(shift.litres_sold || 0);
    if (litresSold <= 0) continue;

    const oldCost = oldCosts.get(shift.shift_id) || 0;
    const fifoResult = await consumeBatchesFIFO(tankId, litresSold, shift.shift_id, qb);
    const newCost = Math.round(fifoResult.totalCost * 100) / 100;
    const delta = Math.round((newCost - oldCost) * 100) / 100;
    const missingLitres = fifoResult.details
      .filter((d) => d.source === 'missing')
      .reduce((sum, d) => sum + d.litres, 0);

    await qb('shift_tank_snapshots')
      .where({ shift_id: shift.shift_id, tank_id: tankId })
      .update({ cogs: newCost });

    if (hasCorrections && Math.abs(delta) >= 0.01) {
      await qb('cogs_corrections').insert({
        shift_id: shift.shift_id,
        tank_id: tankId,
        litres_sold: litresSold,
        old_cogs: oldCost,
        new_cogs: newCost,
        delta_kes: delta,
        corrected_by: correctedBy,
        reason,
      });
    }

    results.push({
      shift_id: shift.shift_id,
      tank_id: tankId,
      litres_sold: litresSold,
      old_cogs: oldCost,
      new_cogs: newCost,
      delta_kes: delta,
      missing_litres: missingLitres,
    });
  }

  await recomputeCache(tankId, qb);
  return results;
}

/**
 * Get total FIFO cost by fuel type for a date range.
 * Used by reports and dashboard to replace the old weighted-average approach.
 */
export async function getFIFOCostByFuelType(
  fromDate: string,
  toDate: string,
  conn?: Knex
): Promise<Record<string, number>> {
  const qb = conn || db;

  const results = await qb('batch_consumption')
    .join('shifts', 'batch_consumption.shift_id', 'shifts.id')
    .join('tanks', 'batch_consumption.tank_id', 'tanks.id')
    .where('shifts.shift_date', '>=', fromDate)
    .where('shifts.shift_date', '<=', toDate)
    .where('shifts.status', 'closed')
    .select('tanks.fuel_type')
    .sum('batch_consumption.total_cost as total_cost')
    .groupBy('tanks.fuel_type');

  const costs: Record<string, number> = {};
  for (const r of results) {
    costs[r.fuel_type] = parseFloat(r.total_cost) || 0;
  }
  return costs;
}

/**
 * Recompute `book_stock_at_dip` and `variance_litres` for every active dip
 * with `tank_id = tankId AND dip_date >= fromDate`.
 *
 * **Why**: `tank_dips.book_stock_at_dip` is a Category C cache (see
 * data-immutability policy). It is computed once at dip insert time. When a
 * backdated delivery or a new closed shift lands on/before an existing dip,
 * the cache becomes stale. Every mutation that can affect a past dip MUST
 * call this helper.
 *
 * Triggers (callers):
 *  - fuelDeliveries POST/PUT/DELETE: pass tank_id + delivery.date
 *  - shifts close/open: for each tank touched by the shift, pass tank_id +
 *    shift.shift_date
 *  - tank_dips POST/PUT itself uses computeBookStock directly (no recompute
 *    needed — the new dip writes its own truth).
 */
export async function recomputeDipsForTankFromDate(
  tankId: number,
  fromDate: string,
  conn?: Knex
): Promise<{ updated: number; details: Array<{ id: number; oldBook: number; newBook: number }> }> {
  const qb = conn || db;
  const dips = await qb('tank_dips')
    .where('tank_id', tankId)
    .where('dip_date', '>=', fromDate)
    .whereNull('deleted_at')
    .select('id', 'dip_date', 'timestamp', 'measured_litres', 'book_stock_at_dip');

  const details: Array<{ id: number; oldBook: number; newBook: number }> = [];
  for (const d of dips) {
    // Pass each dip's own timestamp, not its date — this is the sub-day
    // fix: a pre-delivery dip at 11:41 won't see a delivery at 11:42.
    const asOf = d.timestamp || `${d.dip_date} 23:59:59`;
    const newBook = await computeBookStock(tankId, asOf, conn);
    const newVariance = parseFloat(d.measured_litres) - newBook;
    const oldBook = parseFloat(d.book_stock_at_dip) || 0;
    if (Math.abs(oldBook - newBook) > 0.001) {
      console.log(
        `[stockCalc:recomputeDips] dip=${d.id} tank=${tankId} date=${d.dip_date} ` +
          `book ${oldBook.toFixed(2)}→${newBook.toFixed(2)} (Δ${(newBook - oldBook).toFixed(2)})`
      );
    }
    await qb('tank_dips')
      .where({ id: d.id })
      .update({ book_stock_at_dip: newBook, variance_litres: newVariance });
    details.push({ id: d.id, oldBook, newBook });
  }
  return { updated: details.length, details };
}

/**
 * Recompute dips for ALL tanks from `fromDate` onwards. Used during the
 * one-time backfill and when a multi-tank operation occurs.
 */
export async function recomputeAllDipsFromDate(
  fromDate: string,
  conn?: Knex
): Promise<number> {
  const qb = conn || db;
  const tanks = await qb('tanks').select('id');
  let total = 0;
  for (const t of tanks) {
    const r = await recomputeDipsForTankFromDate(t.id, fromDate, conn);
    total += r.updated;
  }
  return total;
}

/**
 * Get FIFO cost for a specific shift (all tanks combined).
 */
export async function getShiftFIFOCost(
  shiftId: number,
  conn?: Knex
): Promise<number> {
  const qb = conn || db;
  const result = await qb('batch_consumption')
    .where({ shift_id: shiftId })
    .sum('total_cost as total')
    .first();
  return parseFloat(result?.total) || 0;
}
