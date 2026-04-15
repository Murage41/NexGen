import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createSupplierPaymentSchema } from '../schemas';

const router = Router();

// List payments (filterable by supplier_id, date range)
router.get('/', async (req, res) => {
  try {
    const { supplier_id, from, to } = req.query;
    let query = db('supplier_payments')
      .join('suppliers', 'supplier_payments.supplier_id', 'suppliers.id')
      .leftJoin('supplier_invoices', 'supplier_payments.invoice_id', 'supplier_invoices.id')
      .whereNull('supplier_payments.deleted_at')
      .select(
        'supplier_payments.*',
        'suppliers.name as supplier_name',
        'supplier_invoices.invoice_number'
      )
      .orderBy('supplier_payments.payment_date', 'desc');

    if (supplier_id) query = query.where('supplier_payments.supplier_id', supplier_id);
    if (from) query = query.where('supplier_payments.payment_date', '>=', from);
    if (to) query = query.where('supplier_payments.payment_date', '<=', to);

    const payments = await query;
    res.json({ success: true, data: payments });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Record payment against an invoice (or general account)
router.post('/', requireAdmin, validate(createSupplierPaymentSchema), async (req, res) => {
  try {
    const { supplier_id, invoice_id, amount, payment_method, payment_date, reference, notes } = req.body;

    // Verify supplier
    const supplier = await db('suppliers').where({ id: supplier_id }).whereNull('deleted_at').first();
    if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found' });

    const payment = await db.transaction(async (trx) => {
      if (invoice_id) {
        // Payment against specific invoice
        const invoice = await trx('supplier_invoices')
          .where({ id: invoice_id, supplier_id })
          .whereNull('deleted_at')
          .first();
        if (!invoice) throw new Error('Invoice not found');

        const invoiceBalance = Number(invoice.balance);
        if (amount > invoiceBalance) {
          throw new Error(`Payment KES ${amount} exceeds invoice balance KES ${invoiceBalance}`);
        }

        const newBalance = Math.round((invoiceBalance - amount) * 100) / 100;
        const newStatus = newBalance <= 0 ? 'paid' : 'partial';

        await trx('supplier_invoices').where({ id: invoice_id }).update({
          balance: newBalance,
          status: newStatus,
        });
      } else {
        // General payment — apply FIFO to oldest unpaid invoices
        const openInvoices = await trx('supplier_invoices')
          .where('supplier_id', supplier_id)
          .whereNull('deleted_at')
          .whereNot('status', 'paid')
          .where('balance', '>', 0)
          .orderBy('created_at', 'asc');

        let remaining = amount;
        for (const inv of openInvoices) {
          if (remaining <= 0) break;
          const invBalance = Number(inv.balance);
          const apply = Math.min(remaining, invBalance);
          const newBalance = Math.round((invBalance - apply) * 100) / 100;
          await trx('supplier_invoices').where({ id: inv.id }).update({
            balance: newBalance,
            status: newBalance <= 0 ? 'paid' : 'partial',
          });
          remaining = Math.round((remaining - apply) * 100) / 100;
        }
      }

      const [paymentId] = await trx('supplier_payments').insert({
        supplier_id,
        invoice_id: invoice_id || null,
        amount,
        payment_method: payment_method || 'bank_transfer',
        payment_date,
        reference: reference || null,
        notes: notes || null,
      });

      return trx('supplier_payments')
        .join('suppliers', 'supplier_payments.supplier_id', 'suppliers.id')
        .where('supplier_payments.id', paymentId)
        .select('supplier_payments.*', 'suppliers.name as supplier_name')
        .first();
    });

    res.status(201).json({ success: true, data: payment });
  } catch (err: any) {
    const status = err.message?.includes('exceeds') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Void (soft-delete) a payment — reverses the balance on the invoice
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const payment = await db('supplier_payments')
      .where({ id: req.params.id })
      .whereNull('deleted_at')
      .first();
    if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

    await db.transaction(async (trx) => {
      // Reverse balance on the invoice if applicable
      if (payment.invoice_id) {
        const invoice = await trx('supplier_invoices').where({ id: payment.invoice_id }).first();
        if (invoice) {
          const newBalance = Number(invoice.balance) + Number(payment.amount);
          await trx('supplier_invoices').where({ id: payment.invoice_id }).update({
            balance: newBalance,
            status: newBalance >= Number(invoice.amount) ? 'unpaid' : 'partial',
          });
        }
      }

      await trx('supplier_payments').where({ id: req.params.id }).update({
        deleted_at: new Date().toISOString(),
      });
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
