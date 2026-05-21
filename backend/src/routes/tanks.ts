import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createTankStockAdjustmentSchema } from '../schemas';
import { computeBookStock, recomputeCache, recomputeDipsForTankFromDate } from '../services/stockCalculator';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  stock_take: 'Stock taking / dip reconciliation',
  evaporation_loss: 'Evaporation or temperature loss',
  spillage_loss: 'Spillage loss',
  leakage_loss: 'Leakage loss',
  theft_loss: 'Theft / unexplained loss',
  contamination_loss: 'Contamination write-down',
  calibration_loss: 'Calibration or meter test loss',
  write_off: 'Inventory write-off',
  other_loss: 'Other approved stock loss',
};

// Helper: check if any shift is currently open
async function hasOpenShift(): Promise<boolean> {
  const open = await db('shifts').where({ status: 'open' }).first();
  return !!open;
}

function nowSqlite(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function latestCostPerLitre(tankId: number, trx: any): Promise<number | null> {
  const deliveryBatch = await trx('delivery_batches')
    .where({ tank_id: tankId })
    .where('cost_per_litre', '>', 0)
    .orderBy('date', 'desc')
    .orderBy('id', 'desc')
    .select('cost_per_litre')
    .first();
  if (deliveryBatch) return Number(deliveryBatch.cost_per_litre);

  if (await trx.schema.hasTable('tank_adjustment_batches')) {
    const adjustmentBatch = await trx('tank_adjustment_batches')
      .where({ tank_id: tankId })
      .where('cost_per_litre', '>', 0)
      .orderBy('date', 'desc')
      .orderBy('id', 'desc')
      .select('cost_per_litre')
      .first();
    if (adjustmentBatch) return Number(adjustmentBatch.cost_per_litre);
  }

  return null;
}

async function applyNegativeAdjustmentToBatches(
  tankId: number,
  adjustmentId: number,
  litresToRemove: number,
  trx: any,
): Promise<{ totalCost: number; missingBatchLitres: number }> {
  const deliveryBatches = (await trx('delivery_batches')
    .where({ tank_id: tankId })
    .where('remaining_litres', '>', 0)
    .select('id', 'remaining_litres', 'cost_per_litre', 'date'))
    .map((b: any) => ({ ...b, source: 'delivery' as const }));

  const adjustmentBatches = (await trx('tank_adjustment_batches')
    .where({ tank_id: tankId })
    .where('remaining_litres', '>', 0)
    .select('id', 'remaining_litres', 'cost_per_litre', 'date'))
    .map((b: any) => ({ ...b, source: 'adjustment' as const }));

  const batches = [...deliveryBatches, ...adjustmentBatches].sort((a: any, b: any) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate !== 0) return byDate;
    if (a.source !== b.source) return a.source === 'delivery' ? -1 : 1;
    return Number(a.id) - Number(b.id);
  });

  let remaining = litresToRemove;
  let totalCost = 0;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const available = Number(batch.remaining_litres) || 0;
    const litres = Math.min(available, remaining);
    const costPerLitre = Number(batch.cost_per_litre) || 0;
    const total = litres * costPerLitre;

    if (batch.source === 'delivery') {
      await trx('delivery_batches').where({ id: batch.id }).update({ remaining_litres: available - litres });
      await trx('tank_adjustment_batch_effects').insert({
        adjustment_id: adjustmentId,
        delivery_batch_id: batch.id,
        litres,
        cost_per_litre: costPerLitre,
        total_cost: total,
      });
    } else {
      await trx('tank_adjustment_batches').where({ id: batch.id }).update({ remaining_litres: available - litres });
      await trx('tank_adjustment_batch_effects').insert({
        adjustment_id: adjustmentId,
        adjustment_batch_id: batch.id,
        litres,
        cost_per_litre: costPerLitre,
        total_cost: total,
      });
    }

    totalCost += total;
    remaining = Math.round((remaining - litres) * 100) / 100;
  }

  if (remaining > 0) {
    await trx('tank_adjustment_batch_effects').insert({
      adjustment_id: adjustmentId,
      litres: remaining,
      cost_per_litre: 0,
      total_cost: 0,
    });
  }

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    missingBatchLitres: Math.max(0, remaining),
  };
}

router.get('/', async (_req, res) => {
  try {
    const tanks = await db('tanks').orderBy('label');
    res.json({ success: true, data: tanks });
  } catch (err: any) {
    console.error('[tanks:list] ERROR', err.message, err.stack);
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
      .whereNull('deleted_at')
      .orderByRaw('dip_date DESC, timestamp DESC')
      .first();

    // Total deliveries (all time)
    const deliveriesResult = await db('fuel_deliveries')
      .where({ tank_id: req.params.id })
      .whereNull('deleted_at')
      .sum('litres as total')
      .first();
    const totalDeliveries = parseFloat((deliveriesResult as any)?.total || 0);

    const adjustmentsResult = await db('tank_stock_adjustments')
      .where({ tank_id: req.params.id })
      .sum('litres_change as total')
      .first();
    const totalAdjustments = parseFloat((adjustmentsResult as any)?.total || 0);

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
      .whereNull('deleted_at')
      .orderBy('date', 'desc')
      .limit(10);

    // Recent dips (last 10)
    const dips = await db('tank_dips')
      .where({ tank_id: req.params.id })
      .whereNull('deleted_at')
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
        total_adjustments: totalAdjustments,
        total_pump_sales_out: totalSales,
        deliveries,
        dips,
      },
    });
  } catch (err: any) {
    console.error('[tanks:stock-summary] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET stock adjustments for a tank
router.get('/:id/adjustments', async (req, res) => {
  try {
    const tank = await db('tanks').where({ id: req.params.id }).first();
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });

    const rows = await db('tank_stock_adjustments')
      .leftJoin('employees', 'tank_stock_adjustments.created_by_employee_id', 'employees.id')
      .leftJoin('tank_dips', 'tank_stock_adjustments.reference_dip_id', 'tank_dips.id')
      .where('tank_stock_adjustments.tank_id', req.params.id)
      .select(
        'tank_stock_adjustments.*',
        'employees.name as created_by_name',
        'tank_dips.measured_litres as reference_dip_litres',
      )
      .orderBy('tank_stock_adjustments.adjustment_timestamp', 'desc');

    res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('[tanks:adjustments:list] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST immutable stock adjustment for a tank
router.post('/:id/adjustments', requireAdmin, validate(createTankStockAdjustmentSchema), async (req: any, res) => {
  try {
    if (await hasOpenShift()) {
      return res.status(400).json({
        success: false,
        error: 'Cannot adjust tank stock while a shift is open. Close the shift, take the dip, then post the adjustment.',
      });
    }

    const tank = await db('tanks').where({ id: req.params.id }).first();
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });

    const today = getKenyaDate();
    const adjustmentDate = req.body.adjustment_date || today;
    if (adjustmentDate > today) {
      return res.status(400).json({ success: false, error: 'Adjustment date cannot be in the future.' });
    }

    const litresChange = Math.round(Number(req.body.litres_change) * 100) / 100;
    const reason = req.body.reason;
    const notes = String(req.body.notes || '').trim();

    if (litresChange > 0 && reason !== 'stock_take') {
      return res.status(400).json({
        success: false,
        error: 'Positive stock adjustments are only allowed for stock-taking/dip reconciliation.',
      });
    }
    if (litresChange >= 0 && reason !== 'stock_take') {
      return res.status(400).json({
        success: false,
        error: `${ADJUSTMENT_REASON_LABELS[reason] || reason} can only reduce stock.`,
      });
    }

    const adjustmentTimestamp = adjustmentDate === today ? nowSqlite() : `${adjustmentDate} 23:59:59`;
    const warnings: string[] = [];

    const adjustment = await db.transaction(async (trx) => {
      if (req.body.reference_dip_id) {
        const dip = await trx('tank_dips')
          .where({ id: req.body.reference_dip_id, tank_id: tank.id })
          .whereNull('deleted_at')
          .first();
        if (!dip) {
          const err: any = new Error('Referenced dip reading was not found for this tank.');
          err.httpStatus = 400;
          throw err;
        }
      }

      const currentBook = await computeBookStock(tank.id, adjustmentTimestamp, trx);
      const projected = Math.round((currentBook + litresChange) * 100) / 100;
      if (projected < -0.01) {
        const err: any = new Error(`Adjustment would make book stock negative (${projected.toFixed(2)} L).`);
        err.httpStatus = 400;
        throw err;
      }
      if (litresChange > 0 && projected > Number(tank.capacity_litres) + 0.01) {
        const err: any = new Error(`Adjustment would exceed tank capacity (${projected.toFixed(2)} L > ${Number(tank.capacity_litres).toFixed(2)} L).`);
        err.httpStatus = 400;
        throw err;
      }

      let costPerLitre: number | null = req.body.cost_per_litre != null ? Number(req.body.cost_per_litre) : null;
      let totalCost: number | null = null;

      if (litresChange > 0) {
        if (costPerLitre == null) costPerLitre = await latestCostPerLitre(tank.id, trx);
        if (costPerLitre == null) {
          const err: any = new Error('Positive stock adjustment needs cost_per_litre because no previous batch cost exists for this tank.');
          err.httpStatus = 400;
          throw err;
        }
        totalCost = Math.round(litresChange * costPerLitre * 100) / 100;
      }

      const [adjustmentId] = await trx('tank_stock_adjustments').insert({
        tank_id: tank.id,
        litres_change: litresChange,
        reason,
        notes,
        adjustment_date: adjustmentDate,
        adjustment_timestamp: adjustmentTimestamp,
        cost_per_litre: costPerLitre,
        total_cost: totalCost,
        reference_dip_id: req.body.reference_dip_id || null,
        created_by_employee_id: req.employee?.id || null,
      });

      if (litresChange > 0) {
        await trx('tank_adjustment_batches').insert({
          adjustment_id: adjustmentId,
          tank_id: tank.id,
          fuel_type: tank.fuel_type,
          original_litres: litresChange,
          remaining_litres: litresChange,
          cost_per_litre: costPerLitre,
          date: adjustmentDate,
        });
      } else {
        const result = await applyNegativeAdjustmentToBatches(tank.id, adjustmentId, Math.abs(litresChange), trx);
        totalCost = result.totalCost;
        if (result.missingBatchLitres > 0) {
          warnings.push(`${result.missingBatchLitres.toFixed(2)} L had no remaining FIFO batch, so its adjustment cost was recorded as KES 0.`);
        }
        await trx('tank_stock_adjustments').where({ id: adjustmentId }).update({
          total_cost: totalCost,
          cost_per_litre: Math.abs(litresChange) > 0 ? Math.round((totalCost / Math.abs(litresChange)) * 100) / 100 : null,
        });
      }

      const newStock = await recomputeCache(tank.id, trx);
      await recomputeDipsForTankFromDate(tank.id, adjustmentDate, trx);

      await trx('tank_stock_ledger').insert({
        tank_id: tank.id,
        event_type: 'stock_adjustment',
        reference_id: adjustmentId,
        litres_change: litresChange,
        balance_after: newStock,
        notes: `${ADJUSTMENT_REASON_LABELS[reason] || reason}: ${notes}`,
      });

      return trx('tank_stock_adjustments')
        .where({ id: adjustmentId })
        .first();
    });

    res.status(201).json({ success: true, data: adjustment, ...(warnings.length ? { warnings } : {}) });
  } catch (err: any) {
    console.error('[tanks:adjustments:create] ERROR', err.message, err.stack);
    res.status(err.httpStatus || 500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const tank = await db('tanks').where({ id: req.params.id }).first();
    if (!tank) return res.status(404).json({ success: false, error: 'Tank not found' });
    res.json({ success: true, data: tank });
  } catch (err: any) {
    console.error('[tanks:get] ERROR', err.message, err.stack);
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
    console.error('[tanks:create] ERROR', err.message, err.stack);
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
    console.error('[tanks:update] ERROR', err.message, err.stack);
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
    console.error('[tanks:delete] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET tank stock ledger (audit trail)
router.get('/:id/ledger', async (req, res) => {
  try {
    const { from, to, limit } = req.query;
    let query = db('tank_stock_ledger')
      .where({ tank_id: req.params.id })
      .orderBy('created_at', 'desc');
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to + 'T23:59:59');
    const rows = await query.limit(parseInt(limit as string) || 50);
    res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('[tanks:ledger] ERROR', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
