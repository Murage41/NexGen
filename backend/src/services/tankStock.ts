import type { Knex } from 'knex';
import { computeBookStock } from './stockCalculator';

// The fuel in the tanks (M7), worked out one way for every screen.
//
// Book stock (tanks.current_stock_litres, stockCalculator.ts) takes a shift's
// sales only when the shift closes, and a shift here can run for more than a
// day. So "fuel in the tank now" is book stock less what the open shift has
// sold so far, from its readings. It is only as good as those readings and
// the book stock itself: losses the dips have not recorded are not in it.

type Conn = Knex | Knex.Transaction;

const litres = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// Litres the open shift has sold so far, by tank.
export async function openShiftSalesByTank(conn: Conn): Promise<Record<number, number>> {
  const rows = await conn('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .join('shifts', 'pump_readings.shift_id', 'shifts.id')
    .where('shifts.status', 'open')
    .where('pumps.active', true)
    .whereNotNull('pumps.tank_id')
    .groupBy('pumps.tank_id')
    .select('pumps.tank_id')
    .sum({ sold: 'pump_readings.litres_sold' });
  return Object.fromEntries(rows.map((row: any) => [Number(row.tank_id), Number(row.sold || 0)]));
}

// Every tank, with the fuel in it now.
export async function tanksWithStockNow(conn: Conn): Promise<any[]> {
  const [tanks, openSales] = await Promise.all([conn('tanks').orderBy('label'), openShiftSalesByTank(conn)]);
  return tanks.map((tank: any) => ({
    ...tank,
    stock_now_litres: litres(Number(tank.current_stock_litres || 0) - (openSales[Number(tank.id)] || 0)),
  }));
}

// Tanks below their "order more at" level. A tank without one never warns.
export function lowStockTanks(tanks: any[]) {
  return tanks
    .filter((tank) => tank.reorder_level_litres != null && Number(tank.stock_now_litres) < Number(tank.reorder_level_litres))
    .map((tank) => ({
      tank_id: tank.id,
      label: tank.label,
      fuel_type: tank.fuel_type,
      stock_now_litres: Number(tank.stock_now_litres),
      reorder_level_litres: Number(tank.reorder_level_litres),
      capacity_litres: Number(tank.capacity_litres),
    }));
}

// Average litres sold per day by each tank over the last `days` full days:
// the administrator's guide for setting an order level. A shift's sales count
// on the day it closed, as in book stock (shifts here can run for days).
export async function averageDailySalesByTank(conn: Conn, today: string, days = 14): Promise<Record<number, number>> {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days);
  const closedAt = "datetime(COALESCE(shifts.end_time, shifts.shift_date || ' 23:59:59'))";
  const rows = await conn('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .join('shifts', 'pump_readings.shift_id', 'shifts.id')
    .where('shifts.status', 'closed')
    .whereRaw(`${closedAt} >= datetime(?)`, [`${from.toISOString().slice(0, 10)} 00:00:00`])
    .whereRaw(`${closedAt} < datetime(?)`, [`${today} 00:00:00`])
    .whereNotNull('pumps.tank_id')
    .groupBy('pumps.tank_id')
    .select('pumps.tank_id')
    .sum({ sold: 'pump_readings.litres_sold' });
  return Object.fromEntries(rows.map((row: any) => [Number(row.tank_id), litres(Number(row.sold || 0) / days)]));
}

export type TankMovement = { opening: number; deliveries: number; sales: number; closing: number };

// One shift's movement per tank, as its close records it: book stock at the
// shift's start, deliveries after the start up to `untilTs`, and the shift's
// own sales. The shift close saves this; an open shift shows it live.
export async function shiftTankMovement(
  conn: Conn,
  shiftId: number,
  startTs: string,
  untilTs: string,
): Promise<Record<number, TankMovement>> {
  const tanks = await conn('tanks').select('id');
  const readings = await conn('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .where('pump_readings.shift_id', shiftId)
    .where('pumps.active', true)
    .whereNotNull('pumps.tank_id')
    .select('pumps.tank_id', 'pump_readings.litres_sold');
  const deliveries = await conn('fuel_deliveries')
    .whereNull('deleted_at')
    .whereRaw('datetime(COALESCE(delivery_timestamp, created_at)) > datetime(?)', [startTs])
    .whereRaw('datetime(COALESCE(delivery_timestamp, created_at)) <= datetime(?)', [untilTs])
    .groupBy('tank_id')
    .select('tank_id')
    .sum({ delivered: 'litres' });

  const sold: Record<number, number> = {};
  for (const reading of readings as any[]) {
    sold[reading.tank_id] = (sold[reading.tank_id] || 0) + (parseFloat(reading.litres_sold) || 0);
  }
  const delivered: Record<number, number> = {};
  for (const row of deliveries as any[]) delivered[row.tank_id] = parseFloat(row.delivered) || 0;

  const movement: Record<number, TankMovement> = {};
  for (const tank of tanks as any[]) {
    const opening = await computeBookStock(tank.id, startTs, conn as Knex);
    const sales = sold[tank.id] || 0;
    const deliveriesIn = delivered[tank.id] || 0;
    movement[tank.id] = { opening, deliveries: deliveriesIn, sales, closing: opening + deliveriesIn - sales };
  }
  return movement;
}

// A closed shift's tank figures (shift_tank_snapshots) are counted again when
// a delivery or stock adjustment lands on or before it: a late delivery
// changes the opening stock of every later shift and the deliveries of the
// shift it fell in. Same formula as the close (shiftTankMovement); the shift's
// own sales litres and its FIFO cost stay as recorded.
export async function recountShiftTankSnapshotsFrom(conn: Conn, tankId: number, fromDate: string): Promise<number> {
  const sqliteTs = (value: string) => String(value).slice(0, 19).replace('T', ' ');
  const rows = await conn('shift_tank_snapshots as snap')
    .join('shifts', 'snap.shift_id', 'shifts.id')
    .where('snap.tank_id', tankId)
    .where('shifts.status', 'closed')
    .whereNotNull('shifts.start_time')
    .whereNotNull('shifts.end_time')
    // A day early: a Kenya date starts three hours before midnight UTC.
    .whereRaw("datetime(shifts.end_time) >= datetime(?, '-1 day')", [`${String(fromDate).slice(0, 10)} 00:00:00`])
    .select('snap.id', 'snap.opening_stock_litres', 'snap.deliveries_litres', 'snap.sales_litres', 'snap.closing_stock_litres',
      'shifts.start_time', 'shifts.end_time');
  let changed = 0;
  for (const row of rows as any[]) {
    const startTs = sqliteTs(row.start_time);
    const untilTs = sqliteTs(row.end_time);
    const opening = await computeBookStock(tankId, startTs, conn as Knex);
    const delivered: any = await conn('fuel_deliveries')
      .where({ tank_id: tankId })
      .whereNull('deleted_at')
      .whereRaw('datetime(COALESCE(delivery_timestamp, created_at)) > datetime(?)', [startTs])
      .whereRaw('datetime(COALESCE(delivery_timestamp, created_at)) <= datetime(?)', [untilTs])
      .sum({ total: 'litres' })
      .first();
    const deliveries = parseFloat(delivered?.total) || 0;
    const closing = opening + deliveries - (parseFloat(row.sales_litres) || 0);
    const same = (a: unknown, b: number) => Math.abs((parseFloat(String(a)) || 0) - b) < 0.005;
    if (same(row.opening_stock_litres, opening) && same(row.deliveries_litres, deliveries) && same(row.closing_stock_litres, closing)) continue;
    await conn('shift_tank_snapshots').where({ id: row.id }).update({
      opening_stock_litres: opening,
      deliveries_litres: deliveries,
      closing_stock_litres: closing,
    });
    changed += 1;
  }
  return changed;
}
