import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { getSupplier, createSupplierPayment, getFuelDeliveries } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getKenyaDate } from '../utils/timezone';

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
];

type Section = 'unpaid' | 'all' | 'payments' | 'details';

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const [supplier, setSupplier] = useState<any>(null);
  // Deliveries by id, so each bill shows its date, tank and litres.
  const [deliveriesById, setDeliveriesById] = useState<Map<number, any>>(new Map());
  const [section, setSection] = useState<Section>('unpaid');
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
      const [supplierRes, deliveriesRes] = await Promise.all([
        getSupplier(parseInt(id!)),
        getFuelDeliveries().catch(() => null),
      ]);
      setSupplier(supplierRes.data.data);
      setDeliveriesById(new Map((deliveriesRes?.data.data || []).map((d: any) => [d.id, d])));
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
  const money = (n: any) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const fmtDate = (s: string) => {
    if (!s) return '—';
    const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  };

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;
  if (!supplier) return <div className="text-center text-gray-400 mt-20">Supplier not found</div>;

  const todayStr = getKenyaDate();
  const allBills = (supplier.invoices || []).filter((i: any) => !i.deleted_at);
  const unpaidInvoices = allBills.filter((i: any) => i.status !== 'paid');
  const overdue = unpaidInvoices.filter((i: any) => i.due_date && i.due_date < todayStr)
    .reduce((sum: number, i: any) => sum + Number(i.balance || 0), 0);
  const bills = (section === 'unpaid' ? unpaidInvoices : allBills)
    .map((inv: any) => ({ inv, delivery: deliveriesById.get(inv.delivery_id) }))
    .sort((a: any, b: any) => String(b.delivery?.date || b.inv.created_at).localeCompare(String(a.delivery?.date || a.inv.created_at)));
  const payments = (supplier.payments || []).filter((p: any) => !p.deleted_at);
  const terms = supplier.payment_terms_days === 0 ? 'Pay on delivery' : `Pay within ${supplier.payment_terms_days} days`;

  function dueText(inv: any) {
    if (inv.status === 'paid') return { text: 'Paid', tone: 'text-green-700' };
    if (!inv.due_date) return { text: '', tone: '' };
    const late = Math.round((Date.parse(todayStr) - Date.parse(inv.due_date)) / 86400000);
    if (late > 0) return { text: `${late} day${late === 1 ? '' : 's'} late`, tone: 'text-red-600 font-semibold' };
    if (late === 0) return { text: 'Due today', tone: 'text-red-600 font-semibold' };
    return { text: `Due ${fmtDate(inv.due_date)}`, tone: 'text-gray-500' };
  }

  return (
    <div className="pb-6">
      <PageHeader title={supplier.name} back />

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-white rounded-xl shadow-sm p-3 border-t-4 border-red-500">
          <p className="text-xs font-semibold text-gray-500">We owe</p>
          <p className={`text-lg font-bold tabular-nums ${supplier.outstanding_balance > 0 ? 'text-red-600' : 'text-gray-800'}`}>{money(supplier.outstanding_balance)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-3 border-t-4 border-amber-500">
          <p className="text-xs font-semibold text-gray-500">Overdue</p>
          <p className={`text-lg font-bold tabular-nums ${overdue > 0 ? 'text-amber-600' : 'text-gray-800'}`}>{money(overdue)}</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
        {([['unpaid', 'Unpaid bills'], ['all', 'All bills'], ['payments', 'Payments'], ['details', 'Details']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSection(key)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full border text-sm font-semibold ${section === key ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {(section === 'unpaid' || section === 'all') && (
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100 mb-3">
          {bills.map(({ inv, delivery }: any) => {
            const due = dueText(inv);
            const fuel = delivery ? `${delivery.fuel_type ? delivery.fuel_type.charAt(0).toUpperCase() + delivery.fuel_type.slice(1) : delivery.tank_label} ${Number(delivery.litres).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L` : (inv.invoice_number || `INV-${inv.id}`);
            const owed = inv.status === 'paid' ? inv.amount : inv.balance;
            return (
              <div key={inv.id} className="flex items-start justify-between gap-3 p-3.5 text-sm">
                <div>
                  <p className="text-gray-800">{fmtDate(delivery?.date || inv.created_at)} · {fuel}</p>
                  <p className={`text-[13px] ${due.tone}`}>
                    {due.text}
                    {inv.status === 'partial' && <span className="text-gray-500 font-normal"> · was {money(inv.amount)}</span>}
                  </p>
                </div>
                <strong className="tabular-nums whitespace-nowrap">{money(owed)}</strong>
              </div>
            );
          })}
          {bills.length === 0 && <p className="p-6 text-center text-sm text-gray-400">{section === 'unpaid' ? 'Nothing unpaid' : 'No bills yet'}</p>}
        </div>
      )}

      {section === 'payments' && (
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100 mb-3">
          {payments.map((pay: any) => (
            <div key={pay.id} className="flex items-start justify-between gap-3 p-3.5 text-sm">
              <div>
                <p className="text-gray-800">{fmtDate(pay.payment_date)} · {PAYMENT_METHODS.find(m => m.value === pay.payment_method)?.label || pay.payment_method}</p>
                {pay.reference && <p className="text-xs text-gray-400">{pay.reference}</p>}
              </div>
              <strong className="tabular-nums whitespace-nowrap text-green-700">{money(pay.amount)}</strong>
            </div>
          ))}
          {payments.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No payments yet</p>}
        </div>
      )}

      {section === 'details' && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3 grid grid-cols-2 gap-3 text-sm">
          {([
            ['Phone', supplier.phone], ['Terms', terms], ['Bank', supplier.bank_name], ['Account', supplier.bank_account],
          ] as const).map(([label, value]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-gray-500">{label}</p>
              <p className="text-gray-800 break-words">{value || '—'}</p>
            </div>
          ))}
        </div>
      )}

      {isAdmin && supplier.outstanding_balance > 0 && (
        <button
          onClick={() => {
            setPayForm({
              amount: '', payment_method: 'bank_transfer',
              payment_date: getKenyaDate(),
              reference: '', notes: '', invoice_id: '',
            });
            setError('');
            setShowPay(true);
          }}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold"
        >
          Record payment
        </button>
      )}

      {/* Payment Modal */}
      {showPay && (
        <div className="mobile-modal-overlay flex items-end" onClick={() => setShowPay(false)}>
          <div className="mobile-bottom-sheet rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">Record payment</h2>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Amount (KES)</label>
                <input type="number" step="0.01" min="0.01"
                  className="w-full border border-gray-200 rounded-xl p-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={payForm.amount}
                  onChange={e => setPayForm({ ...payForm, amount: e.target.value })} />
                <p className="text-xs text-gray-400 mt-1">We owe {fmt(supplier.outstanding_balance)}</p>
              </div>
              {unpaidInvoices.length > 0 && (
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Bill</label>
                  <select className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={payForm.invoice_id} onChange={e => setPayForm({ ...payForm, invoice_id: e.target.value })}>
                    <option value="">Oldest bills first</option>
                    {unpaidInvoices.map((inv: any) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number || `INV-${inv.id}`}: {fmt(inv.balance)} owed
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Method</label>
                <select className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={payForm.payment_method} onChange={e => setPayForm({ ...payForm, payment_method: e.target.value })}>
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Date</label>
                <input type="date" className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={payForm.payment_date} onChange={e => setPayForm({ ...payForm, payment_date: e.target.value })} />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Reference</label>
                <input type="text" className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })} />
              </div>
              <button
                onClick={handlePayment}
                disabled={submitting || !payForm.amount}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-semibold disabled:opacity-50 mt-2"
              >
                {submitting ? 'Recording...' : 'Record payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
