import db from '../database';
import { Knex } from 'knex';

/**
 * Computed book stock for a tank as of a given date.
 * Formula: SUM(deliveries up to date) - SUM(closed shift sales up to date)
 *
 * This replaces the old running counter approach. The `current_stock_litres`
 * column in `tanks` is now just a cache of this computation for "today".
 */
export async function computeBookStock(
  tankId: number,
  asOfDate: string,
  conn?: Knex
): Promise<number> {
  const qb = conn || db;

  // Sum all deliveries to this tank on or before asOfDate
  const deliveryResult = await qb('fuel_deliveries')
    .where('tank_id', tankId)
    .where('date', '<=', asOfDate)
    .whereNull('deleted_at')
    .sum('litres as total')
    .first();
  const totalDelivered = parseFloat(deliveryResult?.total) || 0;

  // Sum all litres sold from this tank in closed shifts on or before asOfDate
  const salesResult = await qb('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .join('shifts', 'pump_readings.shift_id', 'shifts.id')
    .where('pumps.tank_id', tankId)
    .where('shifts.status', 'closed')
    .where('shifts.shift_date', '<=', asOfDate)
    .sum('pump_readings.litres_sold as total')
    .first();
  const totalSold = parseFloat(salesResult?.total) || 0;

  return totalDelivered - totalSold;
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
): Promise<{ totalCost: number; details: Array<{ batchId: number; litres: number; costPerLitre: number }> }> {
  const qb = conn || db;
  if (litres <= 0) return { totalCost: 0, details: [] };

  // Find batches with remaining fuel, oldest first
  const batches = await qb('delivery_batches')
    .where('tank_id', tankId)
    .where('remaining_litres', '>', 0)
    .orderBy('date', 'asc')
    .orderBy('id', 'asc');

  let remaining = litres;
  let totalCost = 0;
  const details: Array<{ batchId: number; litres: number; costPerLitre: number }> = [];

  for (const batch of batches) {
    if (remaining <= 0) break;

    const available = parseFloat(batch.remaining_litres);
    const consumed = Math.min(available, remaining);
    const cost = consumed * parseFloat(batch.cost_per_litre);

    // Deduct from batch
    await qb('delivery_batches')
      .where({ id: batch.id })
      .update({ remaining_litres: available - consumed });

    // Record consumption
    await qb('batch_consumption').insert({
      batch_id: batch.id,
      shift_id: shiftId,
      tank_id: tankId,
      litres_consumed: consumed,
      cost_per_litre: parseFloat(batch.cost_per_litre),
      total_cost: cost,
    });

    totalCost += cost;
    remaining -= consumed;
    details.push({
      batchId: batch.id,
      litres: consumed,
      costPerLitre: parseFloat(batch.cost_per_litre),
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
    details.push({ batchId: 0, litres: remaining, costPerLitre: 0 });
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
  }

  // Delete the consumption records
  let deleteQuery = qb('batch_consumption').where({ shift_id: shiftId });
  if (tankId !== null) deleteQuery = deleteQuery.where({ tank_id: tankId });
  await deleteQuery.delete();
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
