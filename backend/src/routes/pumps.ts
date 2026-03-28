import { Router } from 'express';
import db from '../database';

const router = Router();

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
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/active', async (_req, res) => {
  try {
    const pumps = await db('pumps').where({ active: true }).orderBy('label');
    res.json({ success: true, data: pumps });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pump = await db('pumps').where({ id: req.params.id }).first();
    if (!pump) return res.status(404).json({ success: false, error: 'Pump not found' });
    res.json({ success: true, data: pump });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { label, nozzle_label, fuel_type, tank_id, initial_litres, initial_amount } = req.body;
    const [id] = await db('pumps').insert({
      label, nozzle_label, fuel_type, tank_id,
      initial_litres: initial_litres || 0,
      initial_amount: initial_amount || 0,
    });
    const pump = await db('pumps').where({ id }).first();
    res.status(201).json({ success: true, data: pump });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { label, nozzle_label, fuel_type, tank_id, active, initial_litres, initial_amount } = req.body;
    const updateData: any = { label, nozzle_label, fuel_type, tank_id, active };
    if (initial_litres !== undefined) updateData.initial_litres = initial_litres;
    if (initial_amount !== undefined) updateData.initial_amount = initial_amount;
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
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db('pumps').where({ id: req.params.id }).update({ active: false });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
