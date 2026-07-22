import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createDeliverySchema, updateDeliverySchema } from '../schemas';
import { recomputeCache, recomputeDipsForTankFromDate, replayTankCogsFrom } from '../services/stockCalculator';
import {
  DELIVERY_STATUS_PENDING_PRICE,
  DELIVERY_STATUS_PRICED,
  effectiveDeliveryTimestamp,
  isDeliveryPriced,
  normalizeDeliveryPricing,
} from '../services/deliveryPolicy';

const router = Router();

function kenyaDueDate(date: string, paymentTermsDays: number): string {
  const dueDate = new Date(`${date}T00:00:00+03:00`);
  dueDate.setDate(dueDate.getDate() + paymentTermsDays);
  return dueDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

function invoiceHasSettlement(invoice: any): boolean {
  return Number(invoice.balance) < Number(invoice.amount) || invoice.status === 'partial' || invoice.status === 'paid';
}

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const INVOICE_STORAGE_DIR = path.join(BACKEND_ROOT, 'data', 'invoice-documents', 'fuel-deliveries');
const MAX_INVOICE_PDF_BYTES = 8 * 1024 * 1024;

function routeError(message: string, status = 400): Error & { status?: number } {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

async function requireSupplierAccount(trx: any, supplierId: number): Promise<any> {
  const supplier = await trx('suppliers')
    .where({ id: supplierId })
    .whereNull('deleted_at')
    .first();
  if (!supplier) {
    throw routeError('Supplier account is required. Create the supplier account first, then select it on the delivery.');
  }
  return supplier;
}

function sanitizeInvoiceFileName(fileName: string): string {
  const clean = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return clean || 'supplier-invoice.pdf';
}

function resolveStoredInvoicePath(storedPath: string | null | undefined): string | null {
  if (!storedPath) return null;
  const fullPath = path.resolve(BACKEND_ROOT, storedPath.replace(/\//g, path.sep));
  const basePath = path.resolve(INVOICE_STORAGE_DIR);
  const lowerFull = fullPath.toLowerCase();
  const lowerBase = basePath.toLowerCase();
  if (!lowerFull.startsWith(`${lowerBase}${path.sep}`)) return null;
  return fullPath;
}

async function supplierDueDate(trx: any, supplierId: number, date: string): Promise<string> {
  const supplierRow = await trx('suppliers').where({ id: supplierId }).first();
  return kenyaDueDate(date, Number(supplierRow?.payment_terms_days || 0));
}

async function ensureUniqueInvoiceNumber(
  trx: any,
  supplierId: number,
  invoiceNumber: string | null | undefined,
  ignoreDeliveryId?: number,
) {
  const normalized = String(invoiceNumber || '').trim();
  if (!normalized) return;

  const deliveryQuery = trx('fuel_deliveries')
    .where({ supplier_id: supplierId, invoice_number: normalized })
    .whereNull('deleted_at');
  if (ignoreDeliveryId) deliveryQuery.whereNot({ id: ignoreDeliveryId });
  const duplicateDelivery = await deliveryQuery.first('id');
  if (duplicateDelivery) {
    throw routeError(`Supplier invoice number "${normalized}" is already used on delivery #${duplicateDelivery.id}.`);
  }

  const invoiceQuery = trx('supplier_invoices')
    .where({ supplier_id: supplierId, invoice_number: normalized })
    .whereNull('deleted_at');
  if (ignoreDeliveryId) {
    invoiceQuery.where(function (this: any) {
      this.whereNull('delivery_id').orWhereNot('delivery_id', ignoreDeliveryId);
    });
  }
  const duplicateInvoice = await invoiceQuery.first('id');
  if (duplicateInvoice) {
    throw routeError(`Supplier invoice number "${normalized}" is already used on supplier invoice #${duplicateInvoice.id}.`);
  }
}

async function deliveryCapacityWarning(trx: any, tankId: number, stock: number): Promise<string | null> {
  const tank = await trx('tanks').where({ id: tankId }).select('label', 'capacity_litres').first();
  if (!tank) return null;
  const capacity = Number(tank.capacity_litres || 0);
  if (capacity > 0 && stock > capacity + 0.01) {
    return `Tank ${tank.label || tankId} book stock is ${stock.toFixed(1)} L, above capacity ${capacity.toFixed(1)} L. Check the delivery date/litres and take a dip.`;
  }
  return null;
}

function appendCogsReplayWarnings(warnings: string[], replayResults: any[]) {
  if (replayResults.length === 0) return;
  warnings.push(`FIFO costing replayed for ${replayResults.length} closed shift(s) affected by this delivery.`);
  const missingLitres = replayResults.reduce((sum, r) => sum + Number(r.missing_litres || 0), 0);
  if (missingLitres > 0) {
    warnings.push(`${missingLitres.toFixed(1)} L still have no matching delivery batch after replay. Check older missing deliveries.`);
  }
}

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

router.get('/:id/invoice-document', requireAdmin, async (req, res) => {
  try {
    const delivery = await db('fuel_deliveries')
      .where({ id: req.params.id })
      .whereNull('deleted_at')
      .first();
    if (!delivery) return res.status(404).json({ success: false, error: 'Delivery not found' });

    const fullPath = resolveStoredInvoicePath(delivery.invoice_file_path);
    if (!fullPath) return res.status(404).json({ success: false, error: 'Invoice PDF not found for this delivery' });

    try {
      await fs.access(fullPath);
    } catch {
      return res.status(404).json({ success: false, error: 'Invoice PDF file is missing on disk' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${delivery.invoice_file_name || 'supplier-invoice.pdf'}"`);
    return res.sendFile(fullPath);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/invoice-document', requireAdmin, async (req, res) => {
  try {
    const delivery = await db('fuel_deliveries')
      .where({ id: req.params.id })
      .whereNull('deleted_at')
      .first();
    if (!delivery) return res.status(404).json({ success: false, error: 'Delivery not found' });

    const { file_name, mime_type, data_base64 } = req.body || {};
    if (typeof file_name !== 'string' || !file_name.trim()) {
      return res.status(400).json({ success: false, error: 'PDF file_name is required' });
    }
    if (!file_name.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ success: false, error: 'Only PDF invoice files are allowed' });
    }
    if (mime_type && mime_type !== 'application/pdf') {
      return res.status(400).json({ success: false, error: 'Only application/pdf invoice files are allowed' });
    }
    if (typeof data_base64 !== 'string' || !data_base64.trim()) {
      return res.status(400).json({ success: false, error: 'PDF data_base64 is required' });
    }

    const rawBase64 = data_base64.includes(',') ? data_base64.split(',').pop() || '' : data_base64;
    const fileBuffer = Buffer.from(rawBase64, 'base64');
    if (fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: 'Invoice PDF is empty' });
    }
    if (fileBuffer.length > MAX_INVOICE_PDF_BYTES) {
      return res.status(400).json({ success: false, error: 'Invoice PDF is too large. Maximum size is 8 MB.' });
    }
    if (fileBuffer.subarray(0, 4).toString() !== '%PDF') {
      return res.status(400).json({ success: false, error: 'Uploaded file is not a valid PDF' });
    }

    await fs.mkdir(INVOICE_STORAGE_DIR, { recursive: true });
    const safeName = sanitizeInvoiceFileName(file_name);
    const storedName = `delivery-${delivery.id}-${Date.now()}-${safeName}`;
    const fullPath = path.join(INVOICE_STORAGE_DIR, storedName);
    await fs.writeFile(fullPath, fileBuffer, { flag: 'wx' });

    const relativePath = path.relative(BACKEND_ROOT, fullPath).replace(/\\/g, '/');
    const uploadedAt = new Date().toISOString();
    const previousPath = resolveStoredInvoicePath(delivery.invoice_file_path);

    const updated = await db.transaction(async (trx) => {
      await trx('fuel_deliveries').where({ id: delivery.id }).update({
        invoice_file_name: safeName,
        invoice_file_path: relativePath,
        invoice_uploaded_at: uploadedAt,
      });

      await trx('supplier_invoices')
        .where({ delivery_id: delivery.id })
        .whereNull('deleted_at')
        .update({
          invoice_file_name: safeName,
          invoice_file_path: relativePath,
          invoice_uploaded_at: uploadedAt,
        });

      return trx('fuel_deliveries')
        .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
        .leftJoin('suppliers', 'fuel_deliveries.supplier_id', 'suppliers.id')
        .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type', 'suppliers.name as supplier_name')
        .where('fuel_deliveries.id', delivery.id)
        .first();
    });

    if (previousPath && previousPath !== fullPath) {
      await fs.unlink(previousPath).catch(() => undefined);
    }

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', requireAdmin, validate(createDeliverySchema), async (req, res) => {
  try {
    const { tank_id, supplier_id, litres, cost_per_litre, date, invoice_number } = req.body;
    const { costPerLitre, totalCost, pricingStatus } = normalizeDeliveryPricing(litres, cost_per_litre);
    const delivery_timestamp = effectiveDeliveryTimestamp(date);
    const invoiceNumber = invoice_number || null;
    const pricedAt = isDeliveryPriced(pricingStatus) ? new Date().toISOString() : null;
    const warnings: string[] = [];

    const delivery = await db.transaction(async (trx) => {
      const supplier = await requireSupplierAccount(trx, supplier_id);
      const tank = await trx('tanks').where({ id: tank_id }).select('fuel_type').first();
      if (!tank) throw routeError('Tank not found', 404);
      await ensureUniqueInvoiceNumber(trx, supplier_id, invoiceNumber);

      const [id] = await trx('fuel_deliveries').insert({
        tank_id,
        supplier: supplier.name,
        supplier_id,
        litres,
        cost_per_litre: costPerLitre,
        total_cost: totalCost,
        date,
        delivery_timestamp,
        invoice_number: invoiceNumber,
        pricing_status: pricingStatus,
        priced_at: pricedAt,
      });

      // Create FIFO batch
      await trx('delivery_batches').insert({
        delivery_id: id,
        tank_id,
        fuel_type: tank.fuel_type,
        original_litres: parseFloat(litres),
        remaining_litres: parseFloat(litres),
        cost_per_litre: costPerLitre,
        date,
      });

      // Recompute cached stock (replaces old tanks.increment)
      const newStock = await recomputeCache(tank_id, trx);
      const capacityWarning = await deliveryCapacityWarning(trx, tank_id, newStock);
      if (capacityWarning) warnings.push(capacityWarning);

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
        notes: `Delivery from ${supplier.name}: ${parseFloat(litres).toFixed(1)} L (effective: ${delivery_timestamp})`,
      });

      if (isDeliveryPriced(pricingStatus)) {
        await trx('supplier_invoices').insert({
          supplier_id,
          delivery_id: id,
          invoice_number: invoiceNumber,
          amount: totalCost,
          balance: totalCost,
          status: 'unpaid',
          due_date: await supplierDueDate(trx, supplier_id, date),
        });
      } else {
        warnings.push('Delivery recorded as pending price/invoice. Litres are in stock; COGS remains provisional until price is entered.');
      }

      const replayResults = await replayTankCogsFrom(
        tank_id,
        delivery_timestamp,
        `Delivery #${id} recorded or repriced`,
        0,
        trx,
      );
      appendCogsReplayWarnings(warnings, replayResults);

      return trx('fuel_deliveries')
        .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
        .leftJoin('suppliers', 'fuel_deliveries.supplier_id', 'suppliers.id')
        .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type', 'suppliers.name as supplier_name')
        .where('fuel_deliveries.id', id)
        .first();
    });

    res.status(201).json({ success: true, data: delivery, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (err: any) {
    console.error('[deliveries:create] ERROR', err.message, err.stack);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.put('/:id', requireAdmin, validate(updateDeliverySchema), async (req, res) => {
  try {
    const deliveryId = parseInt(req.params.id as string);
    const existing = await db('fuel_deliveries').where({ id: deliveryId }).whereNull('deleted_at').first();
    if (!existing) return res.status(404).json({ success: false, error: 'Delivery not found' });

    const { tank_id, supplier_id: reqSupplierId, litres, cost_per_litre, date, invoice_number } = req.body;
    const newLitres = Number(litres);
    const oldLitres = Number(existing.litres);
    const oldTankId = Number(existing.tank_id);
    const newTankId = Number(tank_id);
    const resolvedSupplierId = Number(reqSupplierId);
    const invoiceNumber = invoice_number || null;
    const { costPerLitre, totalCost, pricingStatus } = normalizeDeliveryPricing(newLitres, cost_per_litre);
    const newDeliveryTs = effectiveDeliveryTimestamp(date);
    const oldDeliveryTs = existing.delivery_timestamp || existing.created_at || effectiveDeliveryTimestamp(existing.date);
    const replayFromTs = String(oldDeliveryTs) < newDeliveryTs ? String(oldDeliveryTs) : newDeliveryTs;
    const supplier = await requireSupplierAccount(db, resolvedSupplierId);
    const linkedInvoice = await db('supplier_invoices')
      .where({ delivery_id: deliveryId })
      .whereNull('deleted_at')
      .first();
    const oldCostPerLitre = Number(existing.cost_per_litre || 0);
    const oldPricingStatus = existing.pricing_status || (oldCostPerLitre > 0 ? DELIVERY_STATUS_PRICED : DELIVERY_STATUS_PENDING_PRICE);
    const wasPendingPrice = oldPricingStatus === DELIVERY_STATUS_PENDING_PRICE || oldCostPerLitre <= 0;
    const warnings: string[] = [];

    if (linkedInvoice) {
      if (!isDeliveryPriced(pricingStatus)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot clear the price because a supplier invoice already exists. Void/reverse the AP invoice instead.',
        });
      }
      const amountChanged = Math.round(Number(linkedInvoice.amount) * 100) !== Math.round(totalCost * 100);
      const supplierChanged = Number(resolvedSupplierId) !== Number(linkedInvoice.supplier_id);
      if ((amountChanged || supplierChanged) && invoiceHasSettlement(linkedInvoice)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot change delivery amount or supplier after the linked supplier invoice has payments. Void/reverse the AP payment first or enter a correcting document.',
        });
      }
    }
    await ensureUniqueInvoiceNumber(db, resolvedSupplierId, invoiceNumber, deliveryId);

    // ── Guard: block litres/cost/tank changes if fuel from this batch has been sold ──
    const batch = await db('delivery_batches').where({ delivery_id: deliveryId }).first();
    if (batch) {
      const consumed = Number(batch.original_litres) - Number(batch.remaining_litres);
      if (consumed > 0) {
        const litresChanged = newLitres !== oldLitres;
        const costChanged = costPerLitre !== oldCostPerLitre;
        const tankChanged = newTankId !== oldTankId;
        const allowedPendingPricing = costChanged && wasPendingPrice && costPerLitre > 0 && !litresChanged && !tankChanged;
        if (litresChanged || tankChanged || (costChanged && !allowedPendingPricing)) {
          return res.status(400).json({
            success: false,
            error: `Cannot change litres, tank, or a finalized cost because ${consumed.toFixed(1)} L from this delivery have already been sold through closed shifts.`,
          });
        }
        if (allowedPendingPricing) {
          warnings.push(`${consumed.toFixed(1)} L from this pending-price delivery were already sold. FIFO costing will be replayed for affected closed shifts.`);
        }
      }
    }

    const delivery = await db.transaction(async (trx) => {
      await trx('fuel_deliveries').where({ id: deliveryId }).update({
        tank_id: newTankId,
        supplier: supplier.name,
        supplier_id: resolvedSupplierId,
        litres: newLitres,
        cost_per_litre: costPerLitre,
        total_cost: totalCost,
        date,
        invoice_number: invoiceNumber,
        delivery_timestamp: newDeliveryTs,
        pricing_status: pricingStatus,
        priced_at: isDeliveryPriced(pricingStatus)
          ? (existing.priced_at || new Date().toISOString())
          : null,
      });

      if (linkedInvoice) {
        const invoiceUpdate: any = { invoice_number: invoiceNumber };
        if (!invoiceHasSettlement(linkedInvoice)) {
          Object.assign(invoiceUpdate, {
            supplier_id: resolvedSupplierId,
            amount: totalCost,
            balance: totalCost,
            status: 'unpaid',
            due_date: await supplierDueDate(trx, resolvedSupplierId, date),
          });
        }
        await trx('supplier_invoices').where({ id: linkedInvoice.id }).update(invoiceUpdate);
      } else if (isDeliveryPriced(pricingStatus)) {
        await trx('supplier_invoices').insert({
          supplier_id: resolvedSupplierId,
          delivery_id: deliveryId,
          invoice_number: invoiceNumber,
          invoice_file_name: existing.invoice_file_name || null,
          invoice_file_path: existing.invoice_file_path || null,
          invoice_uploaded_at: existing.invoice_uploaded_at || null,
          amount: totalCost,
          balance: totalCost,
          status: 'unpaid',
          due_date: await supplierDueDate(trx, resolvedSupplierId, date),
        });
      }

      const existingBatch = await trx('delivery_batches').where({ delivery_id: deliveryId }).first();

      if (existingBatch) {
        const oldRemaining = Number(existingBatch.remaining_litres);
        const consumed = Number(existingBatch.original_litres) - oldRemaining;

        if (oldTankId !== newTankId) {
          const newTank = await trx('tanks').where({ id: newTankId }).select('fuel_type').first();
          const newRemaining = Math.max(0, newLitres - consumed);
          await trx('delivery_batches').where({ id: existingBatch.id }).update({
            tank_id: newTankId,
            fuel_type: newTank.fuel_type,
            original_litres: newLitres,
            remaining_litres: newRemaining,
            cost_per_litre: costPerLitre,
            date,
          });
          const oldStock = await recomputeCache(oldTankId, trx);
          const newStock = await recomputeCache(newTankId, trx);
          const capacityWarning = await deliveryCapacityWarning(trx, newTankId, newStock);
          if (capacityWarning) warnings.push(capacityWarning);

          const earliestDate = existing.date < date ? existing.date : date;
          await recomputeDipsForTankFromDate(oldTankId, earliestDate, trx);
          await recomputeDipsForTankFromDate(newTankId, earliestDate, trx);

          await trx('tank_stock_ledger').insert({
            tank_id: oldTankId,
            event_type: 'delivery',
            reference_id: deliveryId,
            litres_change: -oldLitres,
            balance_after: oldStock,
            notes: `Delivery #${req.params.id} moved to different tank: -${oldLitres.toFixed(1)} L`,
          });
          await trx('tank_stock_ledger').insert({
            tank_id: newTankId,
            event_type: 'delivery',
            reference_id: deliveryId,
            litres_change: newLitres,
            balance_after: newStock,
            notes: `Delivery #${req.params.id} moved from different tank: +${newLitres.toFixed(1)} L`,
          });
        } else {
          const litreDelta = newLitres - Number(existingBatch.original_litres);
          const newRemaining = Math.max(0, oldRemaining + litreDelta);
          await trx('delivery_batches').where({ id: existingBatch.id }).update({
            original_litres: newLitres,
            remaining_litres: newRemaining,
            cost_per_litre: costPerLitre,
            date,
          });

          const newStock = await recomputeCache(newTankId, trx);
          const capacityWarning = await deliveryCapacityWarning(trx, newTankId, newStock);
          if (capacityWarning) warnings.push(capacityWarning);

          if (litreDelta !== 0) {
            await trx('tank_stock_ledger').insert({
              tank_id: newTankId,
              event_type: 'delivery',
              reference_id: deliveryId,
              litres_change: litreDelta,
              balance_after: newStock,
              notes: `Delivery #${req.params.id} edited: ${litreDelta > 0 ? '+' : ''}${litreDelta.toFixed(1)} L`,
            });
          }

          const earliestDate = existing.date < date ? existing.date : date;
          await recomputeDipsForTankFromDate(newTankId, earliestDate, trx);
        }
      } else {
        const newTank = await trx('tanks').where({ id: newTankId }).select('fuel_type').first();
        await trx('delivery_batches').insert({
          delivery_id: deliveryId,
          tank_id: newTankId,
          fuel_type: newTank.fuel_type,
          original_litres: newLitres,
          remaining_litres: newLitres,
          cost_per_litre: costPerLitre,
          date,
        });
        const newStock = await recomputeCache(newTankId, trx);
        const capacityWarning = await deliveryCapacityWarning(trx, newTankId, newStock);
        if (capacityWarning) warnings.push(capacityWarning);
        await recomputeDipsForTankFromDate(newTankId, date, trx);
      }

      const replayTankIds = new Set<number>([newTankId]);
      if (oldTankId !== newTankId) replayTankIds.add(oldTankId);
      for (const replayTankId of replayTankIds) {
        const replayResults = await replayTankCogsFrom(
          replayTankId,
          replayFromTs,
          `Delivery #${deliveryId} edited or repriced`,
          0,
          trx,
        );
        appendCogsReplayWarnings(warnings, replayResults);
      }

      return trx('fuel_deliveries')
        .join('tanks', 'fuel_deliveries.tank_id', 'tanks.id')
        .leftJoin('suppliers', 'fuel_deliveries.supplier_id', 'suppliers.id')
        .select('fuel_deliveries.*', 'tanks.label as tank_label', 'tanks.fuel_type', 'suppliers.name as supplier_name')
        .where('fuel_deliveries.id', deliveryId)
        .first();
    });

    res.json({ success: true, data: delivery, ...(warnings.length > 0 ? { warnings } : {}) });
  } catch (err: any) {
    console.error('[deliveries:update] ERROR', err.message, err.stack);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const delivery = await db('fuel_deliveries').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!delivery) return res.status(404).json({ success: false, error: 'Delivery not found' });
    const linkedInvoice = await db('supplier_invoices')
      .where({ delivery_id: req.params.id })
      .whereNull('deleted_at')
      .first();
    if (linkedInvoice && invoiceHasSettlement(linkedInvoice)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete this delivery because its supplier invoice has payments. Void/reverse the AP payment first.',
      });
    }

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
      if (linkedInvoice) {
        await trx('supplier_invoices')
          .where({ id: linkedInvoice.id })
          .update({
            deleted_at: new Date().toISOString(),
            status: 'void',
            balance: 0,
            notes: linkedInvoice.notes
              ? `${linkedInvoice.notes}\nVoided because linked delivery #${req.params.id} was deleted.`
              : `Voided because linked delivery #${req.params.id} was deleted.`,
          });
      }

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
