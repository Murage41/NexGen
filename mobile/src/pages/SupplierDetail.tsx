import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CreditCard, Pencil, AlertTriangle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getSupplier, createSupplierPayment } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getKenyaDate } from '../utils/timezone';

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
];

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const [supplier, setSupplier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showPay, setShowPay] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: '', payment_method: 'bank_transfer',
    payment_date: getKenyaDate(),
    reference: '', notes: '', invoice_id: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, [id]);

  async function loadData() {
    try {
      const res = await getSupplier(parseInt(id!));
      setSupplier(res.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handlePayment() {
    if (!payForm.amount || !supplier) return;
    setSubmitting(true); setError('');
    try {
      await createSupplierPayment({
        supplier_id: supplier.id,
        amount: parseFloat(payForm.amount),
        payment_method: payForm.payment_method,
        payment_date: payForm.payment_date,
        reference: payForm.reference || null,
        notes: payForm.notes || null,
        invoice_id: payForm.invoice_id ? parseInt(payForm.invoice_id) : undefined,
      });
      setShowPay(false);
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Payment failed');
    } finally { setSubmitting(false); }
  }

  const fmt = (n: any) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
  const fmtDate = (s: string) => {
    if (!s) return '—';
    const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;
  if (!supplier) return <div className="text-center text-gray-400 mt-20">Supplier not found</div>;

  const unpaidInvoices = (supplier.invoices || []).filter((i: any) => i.status !== 'paid' && !i.deleted_at);

  return (
    <div className="pb-6">
      <PageHeader
        title={supplier.name}
        back
        right={
          isAdmin && supplier.outstanding_balance > 0 ? (
            <button onClick={() => {
              setPayForm({
                amount: '', payment_method: 'bank_transfer',
                payment_date: getKenyaDate(),
                reference: '', notes: '', invoice_id: '',
              });
              setError('');
              setShowPay(true);
            }} className="p-2 bg-green-600 text-white rounded-xl">
              <CreditCard size={20} />
            </button>
          ) : undefined
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-xl shadow-sm p-3">
          <p className="text-xs text-gray-500">Outstanding</p>
          <p className={`text-lg font-bold ${supplier.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {fmt(supplier.outstanding_balance)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-3">
          <p className="text-xs text-gray-500">Terms</p>
          <p className="text-lg font-bold text-gray-800">
            {supplier.payment_terms_days === 0 ? 'COD' : `Net ${supplier.payment_terms_days}`}
          </p>
        </div>
      </div>

      {supplier.phone && (
        <div className="bg-gray-50 rounded-xl p-3 mb-4 text-sm text-gray-600">
          <span className="text-gray-400">Phone:</span> {supplier.phone}
          {supplier.bank_name && <><br /><span className="text-gray-400">Bank:</span> {supplier.bank_name} — {supplier.bank_account}</>}
        </div>
      )}

      {/* Invoices */}
      <p className="text-sm font-semibold text-gray-600 mb-2 px-1">Invoices</p>
      {(supplier.invoices || []).filter((i: any) => !i.deleted_at).length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4 bg-white rounded-xl shadow-sm mb-4">No invoices</p>
      ) : (
        <div className="space-y-2 mb-4">
          {(supplier.invoices || []).filter((i: any) => !i.deleted_at).map((inv: any) => (
            <div key={inv.id} className="bg-white rounded-xl shadow-sm p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800 text-sm">{inv.invoice_number || `INV-${inv.id}`}</p>
                  <p className="text-xs text-gray-400">{fmtDate(inv.due_date || inv.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-800">{fmt(inv.amount)}</p>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                    inv.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {inv.status} {inv.status !== 'paid' && `· bal ${fmt(inv.balance)}`}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payments */}
      <p className="text-sm font-semibold text-gray-600 mb-2 px-1">Payments</p>
      {(supplier.payments || []).filter((p: any) => !p.deleted_at).length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4 bg-white rounded-xl shadow-sm">No payments</p>
      ) : (
        <div className="space-y-2">
          {(supplier.payments || []).filter((p: any) => !p.deleted_at).map((pay: any) => (
            <div key={pay.id} className="bg-white rounded-xl shadow-sm p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600">{fmt(pay.amount)}</p>
                <p className="text-xs text-gray-400">
                  {fmtDate(pay.payment_date)} · {pay.payment_method?.replace('_', ' ')}
                </p>
                {pay.reference && <p className="text-xs text-gray-400">Ref: {pay.reference}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payment Modal */}
      {showPay && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowPay(false)}>
          <div className="bg-white w-full rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">Record Payment — {supplier.name}</h2>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Amount (KES)</label>
                <input type="number" step="0.01" min="0.01"
                  className="w-full border border-gray-200 rounded-xl p-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={payForm.amount}
                  onChange={e => setPayForm({ ...payForm, amount: e.target.value })} />
                <p className="text-xs text-gray-400 mt-1">Outstanding: {fmt(supplier.outstanding_balance)}</p>
              </div>
              {unpaidInvoices.length > 0 && (
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Apply to Invoice</label>
                  <select className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={payForm.invoice_id} onChange={e => setPayForm({ ...payForm, invoice_id: e.target.value })}>
                    <option value="">General (auto oldest)</option>
                    {unpaidInvoices.map((inv: any) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number || `INV-${inv.id}`} — bal {fmt(inv.balance)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Method</label>
                <select className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={payForm.payment_method} onChange={e => setPayForm({ ...payForm, payment_method: e.target.value })}>
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Payment Date</label>
                <input type="date" className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={payForm.payment_date} onChange={e => setPayForm({ ...payForm, payment_date: e.target.value })} />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Reference (M-Pesa code, cheque no.)</label>
                <input type="text" className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })} />
              </div>
              <button
                onClick={handlePayment}
                disabled={submitting || !payForm.amount}
                className="w-full bg-green-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
              >
                {submitting ? 'Recording...' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
