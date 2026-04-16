import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createDeliverySchema, updateDeliverySchema } from '../schemas';
import { recomputeCache, recomputeDipsForTankFromDate } from '../services/stockCalculator';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { from, to, tank_id } = req.query;
    let query = db('fuel_deliveries')
      .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
      .leftJoin('suppliers', 'fuel_deliveries.supplier_id', 'suppliers.id')
      .whereNull('fuel_deliveries.deleted_at')
      .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type', 'suppliers.name as supplier_name')
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

router.post('/', requireAdmin, validate(createDeliverySchema), async (req, res) => {
  try {
    const { tank_id, supplier, supplier_id, litres, cost_per_litre, date } = req.body;
    const total_cost = litres * cost_per_litre;

    const delivery = await db.transaction(async (trx) => {
      const [id] = await trx('fuel_deliveries').insert({
        tank_id, supplier, supplier_id: supplier_id || null,
        litres, cost_per_litre, total_cost, date,
      });

      // Create FIFO batch
      const tank = await trx('tanks').where({ id: tank_id }).select('fuel_type').first();
      await trx('delivery_batches').insert({
        delivery_id: id,
        tank_id,
        fuel_type: tank.fuel_type,
        original_litres: parseFloat(litres),
        remaining_litres: parseFloat(litres),
        cost_per_litre: parseFloat(cost_per_litre),
        date,
      });

      // Recompute cached stock (replaces old tanks.increment)
      const newStock = await recomputeCache(tank_id, trx);

      // Phase 1 stale-cache fix: any dip on/after this delivery's date is now
      // stale because its book_stock_at_dip didn't include this delivery.
      await recomputeDipsForTankFromDate(tank_id, date, trx);

      // Ledger entry
      await trx('tank_stock_ledger').insert({
        tank_id,
        event_type: 'delivery',
        reference_id: id,
        litres_change: parseFloat(litres),
        balance_after: newStock,
        notes: `Delivery from ${supplier || 'supplier'}: ${parseFloat(litres).toFixed(1)} L (date: ${date})`,
      });

      // Auto-create supplier invoice if supplier_id provided
      if (supplier_id) {
        const supplierRow = await trx('suppliers').where({ id: supplier_id }).first();
        const dueDays = supplierRow?.payment_terms_days || 0;
        const dueDate = new Date(date);
        dueDate.setDate(dueDate.getDate() + dueDays);

        await trx('supplier_invoices').insert({
          supplier_id,
          delivery_id: id,
          amount: total_cost,
          balance: total_cost,
          status: 'unpaid',
          // Phase 8 fix: use Kenya timezone (was UTC)
          due_date: dueDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }),
        });
      }

      return trx('fuel_deliveries')
        .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
        .leftJoin('suppliers', 'fuel_deliveries.supplier_id', 'suppliers.id')
        .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type', 'suppliers.name as supplier_name')
        .where('fuel_deliveries.id', id)
        .first();
    });

    res.status(201).json({ success: true, data: delivery });
  } catch (err: any) {
    console.error('[deliveries:create] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', requireAdmin, validate(updateDeliverySchema), async (req, res) => {
  try {
    const existing = await db('fuel_deliveries').where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ success: false, error: 'Delivery not found' });

    const { tank_id, supplier, supplier_id: reqSupplierId, litres, cost_per_litre, date } = req.body;
    const newLitres = parseFloat(litres);
    const oldLitres = parseFloat(existing.litres);
    const oldTankId = existing.tank_id;
    const newTankId = parseInt(tank_id);
    const total_cost = newLitres * parseFloat(cost_per_litre);

    // ── Guard: block litres/cost/tank changes if fuel from this batch has been sold ──
    const batch = await db('delivery_batches').where({ delivery_id: parseInt(req.params.id as string) }).first();
    if (batch) {
      const consumed = parseFloat(batch.original_litres) - parseFloat(batch.remaining_litres);
      if (consumed > 0) {
        const litresChanged = newLitres !== oldLitres;
        const costChanged = parseFloat(cost_per_litre) !== parseFloat(existing.cost_per_litre);
        const tankChanged = newTankId !== oldTankId;
        if (litresChanged || costChanged || tankChanged) {
          return res.status(400).json({
            success: false,
            error: `Cannot change litres, cost, or tank — ${consumed.toFixed(1)} L from this delivery have already been sold through closed shifts. You can still edit the supplier, date, and notes. For cost corrections, use the COGS recalculation endpoint.`,
          });
        }
      }
    }

    const delivery = await db.transaction(async (trx) => {
      await trx('fuel_deliveries').where({ id: req.params.id }).update({
        tank_id: newTankId, supplier, supplier_id: reqSupplierId || existing.supplier_id,
        litres: newLitres, cost_per_litre, total_cost, date,
      });

      // Update FIFO batch — handle tank change and/or litres change independently (fixes Issue 4)
      const existingBatch = await trx('delivery_batches').where({ delivery_id: parseInt(req.params.id as string) }).first();

      if (existingBatch) {
        const oldRemaining = parseFloat(existingBatch.remaining_litres);
        const consumed = parseFloat(existingBatch.original_litres) - oldRemaining;

        if (oldTankId !== newTankId) {
          const newTank = await trx('tanks').where({ id: newTankId }).select('fuel_type').first();
          const newRemaining = Math.max(0, newLitres - consumed);
          await trx('delivery_batches').where({ id: existingBatch.id }).update({
            tank_id: newTankId, fuel_type: newTank.fuel_type,
            original_litres: newLitres, remaining_litres: newRemaining,
            cost_per_litre: parseFloat(cost_per_litre), date,
          });
          const oldStock = await recomputeCache(oldTankId, trx);
          const newStock = await recomputeCache(newTankId, trx);

          // Phase 1 stale-cache fix: dips on both tanks from earlier of old/new date
          const earliestDate = existing.date < date ? existing.date : date;
          await recomputeDipsForTankFromDate(oldTankId, earliestDate, trx);
          await recomputeDipsForTankFromDate(newTankId, earliestDate, trx);

          await trx('tank_stock_ledger').insert({
            tank_id: oldTankId, event_type: 'delivery', reference_id: parseInt(req.params.id as string),
            litres_change: -oldLitres, balance_after: oldStock,
            notes: `Delivery #${req.params.id} moved to different tank: -${oldLitres.toFixed(1)} L`,
          });
          await trx('tank_stock_ledger').insert({
            tank_id: newTankId, event_type: 'delivery', reference_id: parseInt(req.params.id as string),
            litres_change: newLitres, balance_after: newStock,
            notes: `Delivery #${req.params.id} moved from different tank: +${newLitres.toFixed(1)} L`,
          });
        } else {
          const litreDelta = newLitres - parseFloat(existingBatch.original_litres);
          const newRemaining = Math.max(0, oldRemaining + litreDelta);
          await trx('delivery_batches').where({ id: existingBatch.id }).update({
            original_litres: newLitres, remaining_litres: newRemaining,
            cost_per_litre: parseFloat(cost_per_litre), date,
          });

          if (litreDelta !== 0) {
            const newStock = await recomputeCache(newTankId, trx);
            await trx('tank_stock_ledger').insert({
              tank_id: newTankId, event_type: 'delivery', reference_id: parseInt(req.params.id as string),
              litres_change: litreDelta, balance_after: newStock,
              notes: `Delivery #${req.params.id} edited: ${litreDelta > 0 ? '+' : ''}${litreDelta.toFixed(1)} L`,
            });
          } else {
            await recomputeCache(newTankId, trx);
          }

          // Phase 1 stale-cache fix: dips for this tank from earlier of old/new date
          const earliestDate = existing.date < date ? existing.date : date;
          await recomputeDipsForTankFromDate(newTankId, earliestDate, trx);
        }
      }

      return trx('fuel_deliveries')
        .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
        .leftJoin('suppliers', 'fuel_deliveries.supplier_id', 'suppliers.id')
        .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type', 'suppliers.name as supplier_name')
        .where('fuel_deliveries.id', req.params.id)
        .first();
    });

    res.json({ success: true, data: delivery });
  } catch (err: any) {
    console.error('[deliveries:update] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const delivery = await db('fuel_deliveries').where({ id: req.params.id }).first();
    if (!delivery) return res.status(404).json({ success: false, error: 'Delivery not found' });

    // Check if batch has been consumed (fuel already sold from this delivery)
    const batch = await db('delivery_batches').where({ delivery_id: parseInt(req.params.id as string) }).first();
    if (batch) {
      const consumed = parseFloat(batch.original_litres) - parseFloat(batch.remaining_litres);
      if (consumed > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete: ${consumed.toFixed(1)} L from this delivery have already been sold. Edit the delivery instead.`,
        });
      }
    }

    await db.transaction(async (trx) => {
      if (batch) await trx('delivery_batches').where({ id: batch.id }).delete();
      await trx('fuel_deliveries').where({ id: req.params.id }).update({ deleted_at: new Date().toISOString() });

      const newStock = await recomputeCache(delivery.tank_id, trx);

      // Phase 1 stale-cache fix: dips on/after delivery date are stale
      await recomputeDipsForTankFromDate(delivery.tank_id, delivery.date, trx);

      await trx('tank_stock_ledger').insert({
        tank_id: delivery.tank_id,
        event_type: 'delivery',
        reference_id: parseInt(req.params.id as string),
        litres_change: -parseFloat(delivery.litres),
        balance_after: newStock,
        notes: `Delivery #${req.params.id} deleted: -${parseFloat(delivery.litres).toFixed(1)} L`,
      });
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[deliveries:delete] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
