import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

// Helper: check if any shift is currently open
async function hasOpenShift(): Promise<boolean> {
  const open = await db('shifts').where({ status: 'open' }).first();
  return !!open;
}

router.get('/', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    let query = db('pumps')
      .leftJoin('tanks', 'pumps.tank_id', 'tanks.id')
      .select('pumps.*', 'tanks.label as tank_label')
      .orderBy('pumps.label');
    if (!showAll) query = query.where('pumps.active', true);
    const pumps = await query;
    res.json({ success: true, data: pumps });
  } catch (err: any) {
    console.error('[pumps:list] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/active', async (_req, res) => {
  try {
    const pumps = await db('pumps').where({ active: true }).orderBy('label');
    res.json({ success: true, data: pumps });
  } catch (err: any) {
    console.error('[pumps:list-active] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pump = await db('pumps').where({ id: req.params.id }).first();
    if (!pump) return res.status(404).json({ success: false, error: 'Pump not found' });
    res.json({ success: true, data: pump });
  } catch (err: any) {
    console.error('[pumps:get] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      label, nozzle_label, fuel_type, tank_id, initial_litres, initial_amount,
      meter_capacity_litres, meter_capacity_amount,
    } = req.body;
    if (meter_capacity_litres !== undefined && Number(meter_capacity_litres) <= 0) {
      return res.status(400).json({ success: false, error: 'meter_capacity_litres must be greater than 0.' });
    }
    if (meter_capacity_amount !== undefined && Number(meter_capacity_amount) <= 0) {
      return res.status(400).json({ success: false, error: 'meter_capacity_amount must be greater than 0.' });
    }

    // Validate pump fuel type matches tank fuel type
    if (tank_id) {
      const tank = await db('tanks').where({ id: tank_id }).select('fuel_type').first();
      if (tank && tank.fuel_type !== fuel_type) {
        return res.status(400).json({
          success: false,
          error: `Fuel type mismatch: pump is ${fuel_type} but tank is ${tank.fuel_type}`,
        });
      }
    }

    const [id] = await db('pumps').insert({
      label, nozzle_label, fuel_type, tank_id,
      initial_litres: initial_litres || 0,
      initial_amount: initial_amount || 0,
      meter_capacity_litres: meter_capacity_litres || 1000000,
      meter_capacity_amount: meter_capacity_amount || 1000000,
    });
    const pump = await db('pumps').where({ id }).first();
    res.status(201).json({ success: true, data: pump });
  } catch (err: any) {
    console.error('[pumps:create] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    if (await hasOpenShift()) {
      return res.status(400).json({ success: false, error: 'Cannot edit pumps while a shift is open. Close the shift first.' });
    }
    const {
      label, nozzle_label, fuel_type, tank_id, active, initial_litres, initial_amount,
      meter_capacity_litres, meter_capacity_amount,
    } = req.body;

    const existingPump = await db('pumps').where({ id: req.params.id }).first();
    if (!existingPump) return res.status(404).json({ success: false, error: 'Pump not found' });

    const readingCount = await db('pump_readings')
      .where({ pump_id: req.params.id })
      .count('id as count')
      .first();
    const hasReadingHistory = Number((readingCount as any)?.count || 0) > 0;
    const fuelChanged = fuel_type !== undefined && fuel_type !== existingPump.fuel_type;
    const tankChanged = tank_id !== undefined && Number(tank_id) !== Number(existingPump.tank_id);
    const initialLitresChanged = initial_litres !== undefined && Number(initial_litres) !== Number(existingPump.initial_litres || 0);
    const initialAmountChanged = initial_amount !== undefined && Number(initial_amount) !== Number(existingPump.initial_amount || 0);

    if (hasReadingHistory && (fuelChanged || tankChanged || initialLitresChanged || initialAmountChanged)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot change fuel type, tank assignment, or initial readings after a pump has shift readings. Deactivate this pump and create a replacement pump instead.',
      });
    }

    // Validate pump fuel type matches tank fuel type
    const effectiveTankId = tank_id !== undefined ? tank_id : existingPump.tank_id;
    const effectiveFuelType = fuel_type !== undefined ? fuel_type : existingPump.fuel_type;
    if (effectiveTankId && effectiveFuelType) {
      const tank = await db('tanks').where({ id: effectiveTankId }).select('fuel_type').first();
      if (tank && tank.fuel_type !== effectiveFuelType) {
        return res.status(400).json({
          success: false,
          error: `Fuel type mismatch: pump is ${effectiveFuelType} but tank is ${tank.fuel_type}`,
        });
      }
    }

    const updateData: any = {};
    if (label !== undefined) updateData.label = label;
    if (nozzle_label !== undefined) updateData.nozzle_label = nozzle_label;
    if (fuel_type !== undefined) updateData.fuel_type = fuel_type;
    if (tank_id !== undefined) updateData.tank_id = tank_id;
    if (active !== undefined) updateData.active = active;
    if (initial_litres !== undefined) updateData.initial_litres = initial_litres;
    if (initial_amount !== undefined) updateData.initial_amount = initial_amount;
    if (meter_capacity_litres !== undefined) {
      if (Number(meter_capacity_litres) <= 0) {
        return res.status(400).json({ success: false, error: 'meter_capacity_litres must be greater than 0.' });
      }
      updateData.meter_capacity_litres = meter_capacity_litres;
    }
    if (meter_capacity_amount !== undefined) {
      if (Number(meter_capacity_amount) <= 0) {
        return res.status(400).json({ success: false, error: 'meter_capacity_amount must be greater than 0.' });
      }
      updateData.meter_capacity_amount = meter_capacity_amount;
    }
    await db('pumps').where({ id: req.params.id }).update(updateData);

    // Sync with open shift if initial readings changed
    if (initial_litres !== undefined || initial_amount !== undefined) {
      const openShift = await db('shifts').where({ status: 'open' }).first();
      if (openShift) {
        // Check if this pump's readings are based on initial values (no prior closed shift)
        const lastClosedReading = await db('pump_readings')
          .join('shifts', 'pump_readings.shift_id', 'shifts.id')
          .where('pump_readings.pump_id', req.params.id)
          .where('shifts.status', 'closed')
          .first();

        if (!lastClosedReading) {
          // This pump has no closed shift history — its opening comes from initial readings
          const pumpReading = await db('pump_readings')
            .where({ shift_id: openShift.id, pump_id: req.params.id })
            .first();

          if (pumpReading) {
            const newOpenLitres = initial_litres ?? pumpReading.opening_litres;
            const newOpenAmount = initial_amount ?? pumpReading.opening_amount;
            const litresSold = pumpReading.closing_litres - newOpenLitres;
            const amountSold = pumpReading.closing_amount - newOpenAmount;
            await db('pump_readings')
              .where({ shift_id: openShift.id, pump_id: req.params.id })
              .update({
                opening_litres: newOpenLitres,
                opening_amount: newOpenAmount,
                litres_sold: Math.max(0, litresSold),
                amount_sold: Math.max(0, amountSold),
              });
          }
        }
      }
    }

    const pump = await db('pumps').where({ id: req.params.id }).first();
    res.json({ success: true, data: pump });
  } catch (err: any) {
    console.error('[pumps:update] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    if (await hasOpenShift()) {
      return res.status(400).json({ success: false, error: 'Cannot deactivate pumps while a shift is open. Close the shift first.' });
    }
    await db('pumps').where({ id: req.params.id }).update({ active: false });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[pumps:delete] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
