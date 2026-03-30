import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { from, to, tank_id } = req.query;
    let query = db('fuel_deliveries')
      .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
      .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .orderBy('fuel_deliveries.date', 'desc');
    if (from) query = query.where('fuel_deliveries.date', '>=', from);
    if (to) query = query.where('fuel_deliveries.date', '<=', to);
    if (tank_id) query = query.where('fuel_deliveries.tank_id', tank_id);
    const deliveries = await query;
    res.json({ success: true, data: deliveries });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { tank_id, supplier, litres, cost_per_litre, date } = req.body;
    const total_cost = litres * cost_per_litre;
    const [id] = await db('fuel_deliveries').insert({ tank_id, supplier, litres, cost_per_litre, total_cost, date });

    // Update tank stock: add delivered litres
    await db('tanks')
      .where({ id: tank_id })
      .increment('current_stock_litres', parseFloat(litres));

    const delivery = await db('fuel_deliveries')
      .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
      .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .where('fuel_deliveries.id', id)
      .first();
    res.status(201).json({ success: true, data: delivery });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await db('fuel_deliveries').where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Delivery not found' });

    const { tank_id, supplier, litres, cost_per_litre, date } = req.body;
    const newLitres = parseFloat(litres);
    const oldLitres = parseFloat(existing.litres);
    const litreDelta = newLitres - oldLitres;
    const total_cost = newLitres * parseFloat(cost_per_litre);

    await db('fuel_deliveries').where({ id: req.params.id }).update({
      tank_id, supplier, litres: newLitres, cost_per_litre, total_cost, date,
    });

    // Adjust tank stock by the difference
    if (litreDelta !== 0) {
      // If tank changed, reverse from old tank and apply to new tank
      const oldTankId = existing.tank_id;
      const newTankId = parseInt(tank_id);
      if (oldTankId !== newTankId) {
        await db('tanks').where({ id: oldTankId }).decrement('current_stock_litres', oldLitres);
        await db('tanks').where({ id: newTankId }).increment('current_stock_litres', newLitres);
      } else {
        if (litreDelta > 0) {
          await db('tanks').where({ id: tank_id }).increment('current_stock_litres', litreDelta);
        } else {
          await db('tanks').where({ id: tank_id }).decrement('current_stock_litres', Math.abs(litreDelta));
        }
      }
    }

    const delivery = await db('fuel_deliveries')
      .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
      .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type')
      .where('fuel_deliveries.id', req.params.id)
      .first();
    res.json({ success: true, data: delivery });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const delivery = await db('fuel_deliveries').where({ id: req.params.id }).first();
    if (!delivery) return res.status(404).json({ success: false, error: 'Delivery not found' });

    // Reverse the stock addition
    await db('tanks')
      .where({ id: delivery.tank_id })
      .decrement('current_stock_litres', parseFloat(delivery.litres));

    await db('fuel_deliveries').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
