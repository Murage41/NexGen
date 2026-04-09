import { Knex } from 'knex';

/**
 * Backfill migration: creates delivery_batches from existing fuel_deliveries,
 * then replays FIFO consumption for all closed shifts in chronological order.
 * Finally recomputes tanks.current_stock_litres from the computed book stock.
 */
export async function up(knex: Knex): Promise<void> {
  // Step 1: Create delivery_batches from all existing fuel_deliveries
  const deliveries = await knex('fuel_deliveries')
    .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
    .select(
      'fuel_deliveries.id as delivery_id',
      'fuel_deliveries.tank_id',
      'tanks.fuel_type',
      'fuel_deliveries.litres as original_litres',
      'fuel_deliveries.cost_per_litre',
      'fuel_deliveries.date'
    )
    .orderBy('fuel_deliveries.date', 'asc')
    .orderBy('fuel_deliveries.id', 'asc');

  for (const d of deliveries) {
    await knex('delivery_batches').insert({
      delivery_id: d.delivery_id,
      tank_id: d.tank_id,
      fuel_type: d.fuel_type,
      original_litres: d.original_litres,
      remaining_litres: d.original_litres, // Start full; consumption will deduct below
      cost_per_litre: d.cost_per_litre,
      date: d.date,
    });
  }

  // Step 2: Replay FIFO consumption for all closed shifts, chronologically
  const closedShifts = await knex('shifts')
    .where('status', 'closed')
    .orderBy('shift_date', 'asc')
    .orderBy('id', 'asc')
    .select('id', 'shift_date');

  for (const shift of closedShifts) {
    // Get litres sold per tank for this shift
    const salesByTank = await knex('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .where('pump_readings.shift_id', shift.id)
      .whereNotNull('pumps.tank_id')
      .select('pumps.tank_id')
      .sum('pump_readings.litres_sold as total_litres')
      .groupBy('pumps.tank_id');

    let shiftTotalCogs = 0;

    for (const sale of salesByTank) {
      const tankId = sale.tank_id;
      let litresRemaining = parseFloat(sale.total_litres) || 0;
      if (litresRemaining <= 0) continue;

      // FIFO: consume from oldest batches first
      const batches = await knex('delivery_batches')
        .where('tank_id', tankId)
        .where('remaining_litres', '>', 0)
        .orderBy('date', 'asc')
        .orderBy('id', 'asc');

      for (const batch of batches) {
        if (litresRemaining <= 0) break;

        const available = parseFloat(batch.remaining_litres);
        const consumed = Math.min(available, litresRemaining);
        const cost = consumed * parseFloat(batch.cost_per_litre);

        await knex('delivery_batches')
          .where({ id: batch.id })
          .update({ remaining_litres: available - consumed });

        await knex('batch_consumption').insert({
          batch_id: batch.id,
          shift_id: shift.id,
          tank_id: tankId,
          litres_consumed: consumed,
          cost_per_litre: parseFloat(batch.cost_per_litre),
          total_cost: cost,
        });

        shiftTotalCogs += cost;
        litresRemaining -= consumed;
      }

      // If litresRemaining > 0, sales exceed known deliveries (data gap)
      if (litresRemaining > 0) {
        await knex('batch_consumption').insert({
          batch_id: null,
          shift_id: shift.id,
          tank_id: tankId,
          litres_consumed: litresRemaining,
          cost_per_litre: 0,
          total_cost: 0,
        });
      }
    }

    // Update shift_tank_snapshots with COGS if the row exists
    if (shiftTotalCogs > 0) {
      // Distribute COGS per tank
      const cogsPerTank = await knex('batch_consumption')
        .where({ shift_id: shift.id })
        .select('tank_id')
        .sum('total_cost as cogs')
        .groupBy('tank_id');

      for (const ct of cogsPerTank) {
        await knex('shift_tank_snapshots')
          .where({ shift_id: shift.id, tank_id: ct.tank_id })
          .update({ cogs: parseFloat(ct.cogs) || 0 });
      }
    }
  }

  // Step 3: Recompute current_stock_litres for each tank
  const tanks = await knex('tanks').select('id');
  for (const tank of tanks) {
    const deliverySum = await knex('fuel_deliveries')
      .where('tank_id', tank.id)
      .sum('litres as total')
      .first();
    const totalDelivered = parseFloat(deliverySum?.total) || 0;

    const salesSum = await knex('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .join('shifts', 'pump_readings.shift_id', 'shifts.id')
      .where('pumps.tank_id', tank.id)
      .where('shifts.status', 'closed')
      .sum('pump_readings.litres_sold as total')
      .first();
    const totalSold = parseFloat(salesSum?.total) || 0;

    const computedStock = totalDelivered - totalSold;
    await knex('tanks').where({ id: tank.id }).update({
      current_stock_litres: computedStock,
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Clear backfilled data (tables themselves are dropped by migration 011 down)
  await knex('batch_consumption').delete();
  await knex('delivery_batches').delete();
}
