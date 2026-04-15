import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createSupplierSchema, updateSupplierSchema } from '../schemas';

const router = Router();

// List suppliers with outstanding AP balance
router.get('/', async (_req, res) => {
  try {
    const suppliers = await db('suppliers')
      .whereNull('deleted_at')
      .orderBy('name', 'asc');

    // Compute outstanding balance per supplier
    const result = [];
    for (const s of suppliers) {
      const invResult = await db('supplier_invoices')
        .where('supplier_id', s.id)
        .whereNull('deleted_at')
        .whereNot('status', 'paid')
        .sum('balance as total')
        .first();
      result.push({
        ...s,
        outstanding_balance: Number((invResult as any)?.total || 0),
      });
    }
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Supplier detail with invoices + payments + delivery count
router.get('/:id', async (req, res) => {
  try {
    const supplier = await db('suppliers')
      .where({ id: req.params.id })
      .whereNull('deleted_at')
      .first();
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found' });

    const invoices = await db('supplier_invoices')
      .where('supplier_id', supplier.id)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');

    const payments = await db('supplier_payments')
      .where('supplier_id', supplier.id)
      .whereNull('deleted_at')
      .orderBy('payment_date', 'desc');

    const deliveryCount = await db('fuel_deliveries')
      .where('supplier_id', supplier.id)
      .whereNull('deleted_at')
      .count('id as count')
      .first();

    const invResult = await db('supplier_invoices')
      .where('supplier_id', supplier.id)
      .whereNull('deleted_at')
      .whereNot('status', 'paid')
      .sum('balance as total')
      .first();

    res.json({
      success: true,
      data: {
        ...supplier,
        outstanding_balance: Number((invResult as any)?.total || 0),
        total_deliveries: Number((deliveryCount as any)?.count || 0),
        invoices,
        payments,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create supplier
router.post('/', requireAdmin, validate(createSupplierSchema), async (req, res) => {
  try {
    const { name, phone, email, address, bank_name, bank_account, payment_terms_days, notes } = req.body;
    const [id] = await db('suppliers').insert({
      name, phone: phone || null, email: email || null,
      address: address || null, bank_name: bank_name || null,
      bank_account: bank_account || null,
      payment_terms_days: payment_terms_days ?? 0,
      notes: notes || null,
    });
    const supplier = await db('suppliers').where({ id }).first();
    res.status(201).json({ success: true, data: supplier });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update supplier
router.put('/:id', requireAdmin, validate(updateSupplierSchema), async (req, res) => {
  try {
    const existing = await db('suppliers').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!existing) return res.status(404).json({ success: false, error: 'Supplier not found' });

    await db('suppliers').where({ id: req.params.id }).update(req.body);
    const supplier = await db('suppliers').where({ id: req.params.id }).first();
    res.json({ success: true, data: supplier });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Soft-delete supplier
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await db('suppliers').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!existing) return res.status(404).json({ success: false, error: 'Supplier not found' });

    // Check for unpaid invoices
    const unpaid = await db('supplier_invoices')
      .where('supplier_id', req.params.id)
      .whereNull('deleted_at')
      .whereNot('status', 'paid')
      .count('id as count')
      .first();
    if (Number((unpaid as any)?.count) > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete supplier with unpaid invoices. Settle outstanding invoices first.',
      });
    }

    await db('suppliers').where({ id: req.params.id }).update({
      deleted_at: new Date().toISOString(),
      active: 0,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
