import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createSupplierInvoiceSchema } from '../schemas';

const router = Router();

// List invoices (filterable by supplier_id, status, date range)
router.get('/', async (req, res) => {
  try {
    const { supplier_id, status, from, to } = req.query;
    let query = db('supplier_invoices')
      .join('suppliers', 'supplier_invoices.supplier_id', 'suppliers.id')
      .whereNull('supplier_invoices.deleted_at')
      .select(
        'supplier_invoices.*',
        'suppliers.name as supplier_name'
      )
      .orderBy('supplier_invoices.created_at', 'desc');

    if (supplier_id) query = query.where('supplier_invoices.supplier_id', supplier_id);
    if (status) query = query.where('supplier_invoices.status', status);
    if (from) query = query.where('supplier_invoices.due_date', '>=', from);
    if (to) query = query.where('supplier_invoices.due_date', '<=', to);

    const invoices = await query;
    res.json({ success: true, data: invoices });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single invoice with payment history
router.get('/:id', async (req, res) => {
  try {
    const invoice = await db('supplier_invoices')
      .join('suppliers', 'supplier_invoices.supplier_id', 'suppliers.id')
      .whereNull('supplier_invoices.deleted_at')
      .where('supplier_invoices.id', req.params.id)
      .select('supplier_invoices.*', 'suppliers.name as supplier_name')
      .first();
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const payments = await db('supplier_payments')
      .where('invoice_id', invoice.id)
      .whereNull('deleted_at')
      .orderBy('payment_date', 'desc');

    res.json({ success: true, data: { ...invoice, payments } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create invoice (standalone — not linked to a delivery)
router.post('/', requireAdmin, validate(createSupplierInvoiceSchema), async (req, res) => {
  try {
    const { supplier_id, invoice_number, delivery_id, amount, due_date, notes } = req.body;

    // Verify supplier exists
    const supplier = await db('suppliers').where({ id: supplier_id }).whereNull('deleted_at').first();
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found' });

    const [id] = await db('supplier_invoices').insert({
      supplier_id,
      invoice_number: invoice_number || null,
      delivery_id: delivery_id || null,
      amount,
      balance: amount,
      status: 'unpaid',
      due_date: due_date || null,
      notes: notes || null,
    });

    const invoice = await db('supplier_invoices')
      .join('suppliers', 'supplier_invoices.supplier_id', 'suppliers.id')
      .where('supplier_invoices.id', id)
      .select('supplier_invoices.*', 'suppliers.name as supplier_name')
      .first();

    res.status(201).json({ success: true, data: invoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update invoice (only non-paid)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await db('supplier_invoices').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!existing) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const { invoice_number, due_date, notes } = req.body;
    await db('supplier_invoices').where({ id: req.params.id }).update({
      ...(invoice_number !== undefined && { invoice_number }),
      ...(due_date !== undefined && { due_date }),
      ...(notes !== undefined && { notes }),
    });

    const invoice = await db('supplier_invoices').where({ id: req.params.id }).first();
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Soft-delete invoice (only if no payments)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await db('supplier_invoices').where({ id: req.params.id }).whereNull('deleted_at').first();
    if (!existing) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const paymentCount = await db('supplier_payments')
      .where('invoice_id', req.params.id)
      .whereNull('deleted_at')
      .count('id as count')
      .first();
    if (Number((paymentCount as any)?.count) > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete an invoice that has payments. Void the payments first.',
      });
    }

    await db('supplier_invoices').where({ id: req.params.id }).update({ deleted_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
