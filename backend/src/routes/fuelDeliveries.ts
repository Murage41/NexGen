import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createDeliverySchema, updateDeliverySchema } from '../schemas';
import { recomputeCache, recomputeDipsForTankFromDate } from '../services/stockCalculator';

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
    const { tank_id, supplier_id, litres, cost_per_litre, date, delivery_time, invoice_number } = req.body;
    const total_cost = litres * cost_per_litre;

    // Effective real-world delivery time. If caller provided HH:MM, build
    // `${date} ${HH:MM}:00`. Otherwise default to now (SQLite local format).
    const nowSqlite = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const delivery_timestamp = delivery_time
      ? `${date} ${delivery_time}:00`
      : nowSqlite;

    const delivery = await db.transaction(async (trx) => {
      const supplier = await requireSupplierAccount(trx, supplier_id);
      const tank = await trx('tanks').where({ id: tank_id }).select('fuel_type').first();
      if (!tank) throw routeError('Tank not found', 404);

      const [id] = await trx('fuel_deliveries').insert({
        tank_id,
        supplier: supplier.name,
        supplier_id,
        litres,
        cost_per_litre,
        total_cost,
        date,
        delivery_timestamp,
        invoice_number: invoice_number || null,
      });

      // Create FIFO batch
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
        notes: `Delivery from ${supplier.name}: ${parseFloat(litres).toFixed(1)} L (date: ${date})`,
      });

      await trx('supplier_invoices').insert({
        supplier_id,
        delivery_id: id,
        invoice_number: invoice_number || null,
        amount: total_cost,
        balance: total_cost,
        status: 'unpaid',
        due_date: await supplierDueDate(trx, supplier_id, date),
      });

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
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

router.put('/:id', requireAdmin, validate(updateDeliverySchema), async (req, res) => {
  try {
    const existing = await db('fuel_deliveries').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!existing) return res.status(404).json({ success: false, error: 'Delivery not found' });

    const { tank_id, supplier_id: reqSupplierId, litres, cost_per_litre, date, delivery_time, invoice_number } = req.body;
    const newLitres = parseFloat(litres);
    const oldLitres = parseFloat(existing.litres);
    const oldTankId = existing.tank_id;
    const newTankId = parseInt(tank_id);
    const total_cost = newLitres * parseFloat(cost_per_litre);
    const resolvedSupplierId = reqSupplierId;
    const supplier = await requireSupplierAccount(db, resolvedSupplierId);
    const linkedInvoice = await db('supplier_invoices')
      .where({ delivery_id: req.params.id })
      .whereNull('deleted_at')
      .first();

    if (linkedInvoice) {
      const amountChanged = Math.round(Number(linkedInvoice.amount) * 100) !== Math.round(total_cost * 100);
      const supplierChanged = Number(resolvedSupplierId) !== Number(linkedInvoice.supplier_id);
      if ((amountChanged || supplierChanged) && invoiceHasSettlement(linkedInvoice)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot change delivery amount or supplier after the linked supplier invoice has payments. Void/reverse the AP payment first or enter a correcting document.',
        });
      }
    }

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
      // If user supplied a new HH:MM, rebuild delivery_timestamp; otherwise
      // preserve whatever was stored (date change alone also rolls forward).
      const newDeliveryTs = delivery_time
        ? `${date} ${delivery_time}:00`
        : (existing.delivery_timestamp
            ? `${date} ${existing.delivery_timestamp.slice(11)}`  // keep HH:MM:SS, swap date
            : null);

      await trx('fuel_deliveries').where({ id: req.params.id }).update({
        tank_id: newTankId,
        supplier: supplier.name,
        supplier_id: resolvedSupplierId,
        litres: newLitres,
        cost_per_litre,
        total_cost,
        date,
        invoice_number: invoice_number || null,
        ...(newDeliveryTs !== null ? { delivery_timestamp: newDeliveryTs } : {}),
      });

      if (linkedInvoice) {
        const invoiceUpdate: any = { invoice_number: invoice_number || null };
        if (!invoiceHasSettlement(linkedInvoice)) {
          Object.assign(invoiceUpdate, {
            supplier_id: resolvedSupplierId,
            amount: total_cost,
            balance: total_cost,
            status: 'unpaid',
            due_date: await supplierDueDate(trx, resolvedSupplierId, date),
          });
        }
        await trx('supplier_invoices').where({ id: linkedInvoice.id }).update(invoiceUpdate);
      } else {
        await trx('supplier_invoices').insert({
          supplier_id: resolvedSupplierId,
          delivery_id: parseInt(req.params.id as string),
          invoice_number: invoice_number || null,
          invoice_file_name: existing.invoice_file_name || null,
          invoice_file_path: existing.invoice_file_path || null,
          invoice_uploaded_at: existing.invoice_uploaded_at || null,
          amount: total_cost,
          balance: total_cost,
          status: 'unpaid',
          due_date: await supplierDueDate(trx, resolvedSupplierId, date),
        });
      }

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
