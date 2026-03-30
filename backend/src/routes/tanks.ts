import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

// Helper: check if any shift is currently open
async function hasOpenShift(): Promise<boolean> {
  const open = await db('shifts').where({ status: 'open' }).first();
  return !!open;
}

router.get('/', async (_req, res) => {
  try {
    const tanks = await db('tanks').orderBy('label');
    res.json({ success: true, data: tanks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id/stock-summary', async (req, res) => {
  try {
    const tank = await db('tanks').where({ id: req.params.id }).first();
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });

    // Last dip reading
    const lastDip = await db('tank_dips')
      .where({ tank_id: req.params.id })
      .orderByRaw('dip_date DESC, timestamp DESC')
      .first();

    // Total deliveries (all time)
    const deliveriesResult = await db('fuel_deliveries')
      .where({ tank_id: req.params.id })
      .sum('litres as total')
      .first();
    const totalDeliveries = parseFloat((deliveriesResult as any)?.total || 0);

    // Total pump sales from closed shifts
    const salesResult = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .join('shifts', 'pump_readings.shift_id', 'shifts.id')
      .where('pumps.tank_id', req.params.id)
      .where('shifts.status', 'closed')
      .sum('pump_readings.litres_sold as total')
      .first();
    const totalSales = parseFloat((salesResult as any)?.total || 0);

    // Recent deliveries (last 10)
    const deliveries = await db('fuel_deliveries')
      .where({ tank_id: req.params.id })
      .orderBy('date', 'desc')
      .limit(10);

    // Recent dips (last 10)
    const dips = await db('tank_dips')
      .where({ tank_id: req.params.id })
      .orderByRaw('dip_date DESC, timestamp DESC')
      .limit(10);

    const currentStock = parseFloat(tank.current_stock_litres || 0);
    const lastDipLitres = lastDip ? parseFloat(lastDip.measured_litres) : null;
    const dipVariance = lastDipLitres !== null ? currentStock - lastDipLitres : null;

    res.json({
      success: true,
      data: {
        tank_id: tank.id,
        tank_label: tank.label,
        fuel_type: tank.fuel_type,
        capacity_litres: tank.capacity_litres,
        current_stock_litres: currentStock,
        last_dip: lastDip ? {
          id: lastDip.id,
          dip_date: lastDip.dip_date,
          measured_litres: parseFloat(lastDip.measured_litres),
          timestamp: lastDip.timestamp,
        } : null,
        dip_variance: dipVariance,
        total_deliveries_in: totalDeliveries,
        total_pump_sales_out: totalSales,
        deliveries,
        dips,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const tank = await db('tanks').where({ id: req.params.id }).first();
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });
    res.json({ success: true, data: tank });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { label, fuel_type, capacity_litres } = req.body;
    const [id] = await db('tanks').insert({ label, fuel_type, capacity_litres });
    const tank = await db('tanks').where({ id }).first();
    res.status(201).json({ success: true, data: tank });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    if (await hasOpenShift()) {
      return res.status(400).json({ success: false, error: 'Cannot edit tanks while a shift is open. Close the shift first.' });
    }
    const { label, fuel_type, capacity_litres } = req.body;
    await db('tanks').where({ id: req.params.id }).update({ label, fuel_type, capacity_litres });
    const tank = await db('tanks').where({ id: req.params.id }).first();
    res.json({ success: true, data: tank });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    if (await hasOpenShift()) {
      return res.status(400).json({ success: false, error: 'Cannot delete tanks while a shift is open. Close the shift first.' });
    }
    // Check if any active pumps are linked to this tank
    const linkedPump = await db('pumps')
      .where({ tank_id: req.params.id, active: true })
      .first();
    if (linkedPump) {
      return res.status(409).json({
        success: false,
        error: `Cannot delete: pump "${linkedPump.label}" is linked to this tank. Reassign or deactivate it first.`,
      });
    }
    await db('tanks').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
