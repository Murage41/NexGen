import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { addMissingCode, PAYMENT_TABLES, type PaymentTable } from '../services/paymentReference';

// POST /api/payment-codes { kind, id, reference }: an administrator adds the
// M-Pesa or bank code to an older payment recorded without one. Only the code
// is written, once (services/paymentReference.ts).
const router = Router();
router.use(requireAdmin);

const KINDS: Record<string, PaymentTable> = {
  debt_payment: 'credit_payments',
  invoice_payment: 'invoice_payments',
  supplier_payment: 'supplier_payments',
  payroll_payment: 'payroll_payments',
  refund: 'customer_refunds',
};

router.post('/', async (req, res) => {
  try {
    const table = KINDS[String(req.body?.kind || '')];
    if (!table || !PAYMENT_TABLES[table]) return res.status(400).json({ success: false, error: 'Unknown payment.' });
    const result = await addMissingCode(db, table, Number(req.body?.id), req.body?.reference);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.http || 500).json({ success: false, error: err.message, code: err.code });
  }
});

export default router;
