import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getSuppliers, createSupplier, updateSupplier, deleteSupplier,
  getSupplier, createSupplierPayment, getFuelDeliveries,
} from '../services/api';
import { Truck, Plus, Pencil, Trash2, X, CreditCard, ChevronRight } from 'lucide-react';
import { getKenyaDate } from '../utils/timezone';

const emptyForm = {
  name: '', phone: '', email: '', address: '',
  bank_name: '', bank_account: '', payment_terms_days: '0', notes: '',
};

const emptyPaymentForm = {
  amount: '', payment_method: 'bank_transfer', payment_date: getKenyaDate(),
  reference: '', notes: '', invoice_id: '',
};

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
];

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // /suppliers lists them; /suppliers/:id is one supplier's page.
  const { id: supplierParam } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<any>(null);
  const [supplierTab, setSupplierTab] = useState<'bills' | 'payments' | 'details'>('bills');
  const [billFilter, setBillFilter] = useState<'unpaid' | 'all'>('unpaid');
  // Deliveries by id, so each bill can show its date, tank and litres.
  const [deliveriesById, setDeliveriesById] = useState<Map<number, any>>(new Map());

  // Modals
  const [supplierModal, setSupplierModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [paymentModal, setPaymentModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);

  const [form, setForm] = useState(emptyForm);
  const [payForm, setPayForm] = useState(emptyPaymentForm);

  useEffect(() => {
    loadList();
    getFuelDeliveries()
      .then(res => setDeliveriesById(new Map((res.data.data || []).map((d: any) => [d.id, d]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSupplierTab('bills');
    setBillFilter('unpaid');
    if (supplierParam) loadDetail(Number(supplierParam));
    else setDetail(null);
  }, [supplierParam]);

  async function loadList() {
    try {
      const res = await getSuppliers();
      setSuppliers(res.data.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function loadDetail(id: number) {
    try {
      const res = await getSupplier(id);
      setDetail(res.data.data);
    } catch (err) { console.error(err); }
  }

  function openAdd() {
    setForm(emptyForm);
    setError('');
    setSupplierModal({ open: true, editing: null });
  }

  function openEdit(s: any) {
    setForm({
      name: s.name || '', phone: s.phone || '', email: s.email || '',
      address: s.address || '', bank_name: s.bank_name || '',
      bank_account: s.bank_account || '',
      payment_terms_days: String(s.payment_terms_days ?? 0),
      notes: s.notes || '',
    });
    setError('');
    setSupplierModal({ open: true, editing: s });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        payment_terms_days: parseInt(form.payment_terms_days) || 0,
      };
      if (supplierModal.editing) {
        await updateSupplier(supplierModal.editing.id, payload);
      } else {
        await createSupplier(payload);
      }
      setSupplierModal({ open: false, editing: null });
      loadList();
      if (detail) loadDetail(detail.id);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    setSaving(true); setError('');
    try {
      await deleteSupplier(deleteConfirm.id);
      setDeleteConfirm(null);
      navigate('/suppliers');
      loadList();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete');
      setDeleteConfirm(null);
    } finally { setSaving(false); }
  }

  function openPayment() {
    setPayForm({
      ...emptyPaymentForm,
      payment_date: getKenyaDate(),
    });
    setError('');
    setPaymentModal(true);
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setSaving(true); setError('');
    try {
      await createSupplierPayment({
        supplier_id: detail.id,
        amount: parseFloat(payForm.amount),
        payment_method: payForm.payment_method,
        payment_date: payForm.payment_date,
        reference: payForm.reference || null,
        notes: payForm.notes || null,
        invoice_id: payForm.invoice_id ? parseInt(payForm.invoice_id) : undefined,
      });
      setPaymentModal(false);
      loadDetail(detail.id);
      loadList();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to record payment');
    } finally { setSaving(false); }
  }

  const fmt = (n: any) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
  const money = (n: any) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
  const fmtDate = (s: string) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  if (loading) return <div className="text-gray-500">Loading...</div>;

  const deleteModal = deleteConfirm && (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-sm">
        <h3 className="text-lg font-semibold mb-2">Delete supplier?</h3>
        <p className="text-sm text-gray-600 mb-4">Delete "{deleteConfirm.name}"? This cannot be undone.</p>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={handleDelete} disabled={saving}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );

  const supplierFormModal = supplierModal.open && (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{supplierModal.editing ? 'Edit Supplier' : 'Add Supplier'}</h2>
          <button onClick={() => setSupplierModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2" placeholder="0712 345 678" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
              <input type="text" value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account #</label>
              <input type="text" value={form.bank_account} onChange={e => setForm({ ...form, bank_account: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pay within (days)</label>
              <input type="number" min="0" value={form.payment_terms_days}
                onChange={e => setForm({ ...form, payment_terms_days: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => setSupplierModal({ open: false, editing: null })}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : supplierModal.editing ? 'Save Changes' : 'Add Supplier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // ─── Supplier page: list on the left, the supplier's bills, payments and details ───
  if (supplierParam && detail) {
    const unpaidInvoices = (detail.invoices || []).filter((i: any) => i.status !== 'paid' && !i.deleted_at);
    const todayStr = getKenyaDate();
    const daysLate = (inv: any) => inv.due_date ? Math.round((Date.parse(todayStr) - Date.parse(inv.due_date)) / 86400000) : 0;
    const overdue = unpaidInvoices.filter((i: any) => i.due_date && i.due_date < todayStr)
      .reduce((sum: number, i: any) => sum + Number(i.balance || 0), 0);
    const month = todayStr.slice(0, 7);
    const paidThisMonth = (detail.payments || []).filter((p: any) => !p.deleted_at && String(p.payment_date).startsWith(month))
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const bills = (billFilter === 'unpaid' ? unpaidInvoices : (detail.invoices || []).filter((i: any) => !i.deleted_at))
      .map((inv: any) => ({ inv, delivery: deliveriesById.get(inv.delivery_id) }))
      .sort((a: any, b: any) => String(b.delivery?.date || b.inv.created_at).localeCompare(String(a.delivery?.date || a.inv.created_at)));
    const payments = (detail.payments || []).filter((p: any) => !p.deleted_at);
    const terms = detail.payment_terms_days === 0 ? 'Pay on delivery' : `Pay within ${detail.payment_terms_days} days of delivery`;

    return (
      <div className="flex gap-5 items-start">
        <aside className="w-64 shrink-0 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-gray-100">
            <Link to="/suppliers" className="text-xl font-bold text-gray-800">Suppliers</Link>
            <button onClick={openAdd} className="flex items-center gap-1 border border-gray-300 px-2.5 py-1 rounded-lg hover:bg-gray-50 text-sm"><Plus size={14} /> Add</button>
          </div>
          {suppliers.map((s: any) => {
            const on = s.id === detail.id;
            return (
              <button key={s.id} type="button" onClick={() => navigate(`/suppliers/${s.id}`)}
                className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left text-sm border-b border-gray-100 ${on ? 'bg-blue-50 font-semibold text-blue-800' : 'hover:bg-gray-50'}`}>
                <span className="truncate">{s.name}</span>
                <span className={`tabular-nums whitespace-nowrap ${Number(s.outstanding_balance) > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{money(s.outstanding_balance)}</span>
              </button>
            );
          })}
        </aside>

        <section className="flex-1 min-w-0 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
          <header className="bg-white border border-gray-200 rounded-lg p-5 flex flex-wrap items-center gap-8">
            <div className="flex-1 min-w-[200px]">
              <h2 className="text-xl font-bold text-gray-800">{detail.name}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{terms}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500">We owe</p>
              <p className={`text-xl font-bold tabular-nums ${detail.outstanding_balance > 0 ? 'text-red-600' : 'text-gray-800'}`}>{money(detail.outstanding_balance)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500">Overdue</p>
              <p className={`text-xl font-bold tabular-nums ${overdue > 0 ? 'text-amber-600' : 'text-gray-800'}`}>{money(overdue)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500">Paid this month</p>
              <p className="text-xl font-bold tabular-nums text-gray-800">{money(paidThisMonth)}</p>
            </div>
          </header>

          <div className="flex flex-wrap justify-end gap-2">
            {detail.outstanding_balance > 0 && (
              <button onClick={openPayment} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-semibold">
                <CreditCard size={16} /> Record payment
              </button>
            )}
            <button onClick={() => openEdit(detail)} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm">
              <Pencil size={16} /> Edit
            </button>
          </div>

          <nav className="flex gap-1 border-b border-gray-200" aria-label="Supplier sections">
            {([['bills', 'Bills'], ['payments', 'Payments'], ['details', 'Details']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setSupplierTab(id)}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${supplierTab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                {label}
              </button>
            ))}
          </nav>

          {supplierTab === 'bills' && (
            <>
              <div className="flex gap-2">
                {([['unpaid', 'Unpaid'], ['all', 'All']] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setBillFilter(id)}
                    className={`px-3 py-1 rounded-full border text-sm font-semibold ${billFilter === id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 font-semibold text-gray-600">Delivered</th>
                      <th className="text-left p-3 font-semibold text-gray-600">Bill</th>
                      <th className="text-left p-3 font-semibold text-gray-600">Tank</th>
                      <th className="text-right p-3 font-semibold text-gray-600">Litres</th>
                      <th className="text-right p-3 font-semibold text-gray-600">Amount</th>
                      <th className="text-right p-3 font-semibold text-gray-600">Still owed</th>
                      <th className="text-left p-3 font-semibold text-gray-600">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map(({ inv, delivery }: any) => {
                      const late = inv.status !== 'paid' ? daysLate(inv) : 0;
                      return (
                        <tr key={inv.id} className="border-t hover:bg-gray-50">
                          <td className="p-3">{fmtDate(delivery?.date || inv.created_at?.slice(0, 10))}</td>
                          <td className="p-3 font-medium">{inv.invoice_number || `INV-${inv.id}`}</td>
                          <td className="p-3 text-gray-600">{delivery?.tank_label || '—'}</td>
                          <td className="p-3 text-right tabular-nums">{delivery ? Number(delivery.litres).toLocaleString('en-KE', { maximumFractionDigits: 0 }) : '—'}</td>
                          <td className="p-3 text-right tabular-nums">{money(inv.amount)}</td>
                          <td className={`p-3 text-right tabular-nums font-semibold ${Number(inv.balance) > 0 ? 'text-red-600' : 'text-gray-400'}`}>{money(inv.balance)}</td>
                          <td className="p-3 whitespace-nowrap">
                            {fmtDate(inv.due_date)}
                            {inv.status === 'paid'
                              ? <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Paid</span>
                              : late > 0
                                ? <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">{late} day{late === 1 ? '' : 's'} late</span>
                                : late === 0 && inv.due_date
                                  ? <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Due today</span>
                                  : inv.status === 'partial' && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Part paid</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {bills.length === 0 && (
                      <tr><td colSpan={7} className="p-8 text-center text-gray-400">{billFilter === 'unpaid' ? 'Nothing unpaid.' : 'No bills yet.'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {supplierTab === 'payments' && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3 font-semibold text-gray-600">Date</th>
                    <th className="text-right p-3 font-semibold text-gray-600">Amount</th>
                    <th className="text-left p-3 font-semibold text-gray-600">Method</th>
                    <th className="text-left p-3 font-semibold text-gray-600">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((pay: any) => (
                    <tr key={pay.id} className="border-t hover:bg-gray-50">
                      <td className="p-3">{fmtDate(pay.payment_date)}</td>
                      <td className="p-3 text-right tabular-nums font-semibold text-green-700">{money(pay.amount)}</td>
                      <td className="p-3">{PAYMENT_METHODS.find(m => m.value === pay.payment_method)?.label || pay.payment_method}</td>
                      <td className="p-3 text-gray-500">
                        {pay.reference || ''}
                        {pay.notes && <span className="block text-xs text-gray-400">{pay.notes}</span>}
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">No payments yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {supplierTab === 'details' && (
            <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
                {([
                  ['Phone', detail.phone], ['Email', detail.email], ['Address', detail.address],
                  ['Bank', detail.bank_name], ['Account', detail.bank_account], ['Terms', terms],
                  ['Deliveries', String(detail.total_deliveries ?? 0)],
                ] as const).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-semibold text-gray-500">{label}</dt>
                    <dd className="text-gray-800">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                <button type="button" onClick={() => openEdit(detail)} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50"><Pencil size={16} /> Edit details</button>
                <button type="button" onClick={() => setDeleteConfirm(detail)} className="flex items-center gap-2 border border-red-200 text-red-700 px-4 py-2 rounded-lg hover:bg-red-50"><Trash2 size={16} /> Delete</button>
              </div>
            </div>
          )}
        </section>

        {/* Payment Modal */}
        {paymentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Record payment: {detail.name}</h2>
                <button onClick={() => setPaymentModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
              <form onSubmit={handlePayment} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KES) *</label>
                  <input type="number" required step="0.01" min="0.01"
                    value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-lg font-bold" />
                  <p className="text-xs text-gray-400 mt-1">We owe {fmt(detail.outstanding_balance)}</p>
                </div>
                {unpaidInvoices.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bill</label>
                    <select value={payForm.invoice_id} onChange={e => setPayForm({ ...payForm, invoice_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg p-2">
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                  <select value={payForm.payment_method} onChange={e => setPayForm({ ...payForm, payment_method: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2">
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input type="date" required value={payForm.payment_date}
                    onChange={e => setPayForm({ ...payForm, payment_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
                  <input type="text" value={payForm.reference}
                    onChange={e => setPayForm({ ...payForm, reference: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={() => setPaymentModal(false)}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                  <button type="submit" disabled={saving || !payForm.amount}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Recording...' : 'Record payment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {supplierFormModal}
        {deleteModal}
      </div>
    );
  }

  // ─── List View ───
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Truck size={24} /> Suppliers
        </h1>
        <button onClick={openAdd} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          <Plus size={16} /> Add Supplier
        </button>
      </div>

      {error && <p className="text-sm text-red-500 mb-3 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium text-gray-600">Name</th>
              <th className="text-left p-3 font-medium text-gray-600">Phone</th>
              <th className="text-left p-3 font-medium text-gray-600">Terms</th>
              <th className="text-right p-3 font-medium text-gray-600">Outstanding</th>
              <th className="p-3 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s: any) => (
              <tr key={s.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/suppliers/${s.id}`)}>
                <td className="p-3 font-medium text-gray-800">{s.name}</td>
                <td className="p-3 text-gray-600">{s.phone || '—'}</td>
                <td className="p-3 text-gray-600">{s.payment_terms_days === 0 ? 'COD' : `Net ${s.payment_terms_days}`}</td>
                <td className={`p-3 text-right font-medium ${s.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmt(s.outstanding_balance)}
                </td>
                <td className="p-3">
                  <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEdit(s)} className="p-1 text-gray-400 hover:text-blue-600 rounded"><Pencil size={14} /></button>
                    <button onClick={() => setDeleteConfirm(s)} className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 size={14} /></button>
                    <button onClick={() => navigate(`/suppliers/${s.id}`)} className="p-1 text-gray-400 hover:text-blue-600 rounded"><ChevronRight size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-gray-400">No suppliers yet. Add your first supplier.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Supplier Add/Edit Modal */}
      {supplierFormModal}

      {deleteModal}
    </div>
  );
}
