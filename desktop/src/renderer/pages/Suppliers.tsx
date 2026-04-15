import { useState, useEffect } from 'react';
import {
  getSuppliers, createSupplier, updateSupplier, deleteSupplier,
  getSupplier, createSupplierPayment,
} from '../services/api';
import { Truck, Plus, Pencil, Trash2, X, CreditCard, ChevronRight, ChevronLeft } from 'lucide-react';
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

  // Views: 'list' | 'detail'
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [detail, setDetail] = useState<any>(null);

  // Modals
  const [supplierModal, setSupplierModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [paymentModal, setPaymentModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);

  const [form, setForm] = useState(emptyForm);
  const [payForm, setPayForm] = useState(emptyPaymentForm);

  useEffect(() => { loadList(); }, []);

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
      setView('detail');
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
      setView('list');
      setDetail(null);
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
  const fmtDate = (s: string) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  if (loading) return <div className="text-gray-500">Loading...</div>;

  // ─── Detail View ───
  if (view === 'detail' && detail) {
    const unpaidInvoices = (detail.invoices || []).filter((i: any) => i.status !== 'paid' && !i.deleted_at);
    return (
      <div>
        <button onClick={() => { setView('list'); setDetail(null); }} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4">
          <ChevronLeft size={16} /> Back to Suppliers
        </button>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{detail.name}</h1>
            {detail.phone && <p className="text-sm text-gray-500">{detail.phone}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => openEdit(detail)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
              <Pencil size={14} /> Edit
            </button>
            {detail.outstanding_balance > 0 && (
              <button onClick={openPayment} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1">
                <CreditCard size={14} /> Record Payment
              </button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-500 mb-3 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 uppercase">Outstanding Balance</p>
            <p className={`text-2xl font-bold ${detail.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {fmt(detail.outstanding_balance)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 uppercase">Total Deliveries</p>
            <p className="text-2xl font-bold text-gray-800">{detail.total_deliveries}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 uppercase">Payment Terms</p>
            <p className="text-2xl font-bold text-gray-800">
              {detail.payment_terms_days === 0 ? 'COD' : `Net ${detail.payment_terms_days}`}
            </p>
          </div>
        </div>

        {/* Bank Details */}
        {(detail.bank_name || detail.bank_account) && (
          <div className="bg-gray-50 border rounded-lg p-3 mb-6 text-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Bank Details</p>
            {detail.bank_name && <p className="text-gray-700">{detail.bank_name}</p>}
            {detail.bank_account && <p className="text-gray-500">Acc: {detail.bank_account}</p>}
          </div>
        )}

        {/* Invoices */}
        <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold text-gray-700">Invoices</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Invoice #</th>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-right p-3 font-medium text-gray-600">Amount</th>
                <th className="text-right p-3 font-medium text-gray-600">Balance</th>
                <th className="text-left p-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {(detail.invoices || []).filter((i: any) => !i.deleted_at).map((inv: any) => (
                <tr key={inv.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-medium">{inv.invoice_number || `INV-${inv.id}`}</td>
                  <td className="p-3 text-gray-600">{fmtDate(inv.due_date || inv.created_at?.split('T')[0])}</td>
                  <td className="p-3 text-right font-medium">{fmt(inv.amount)}</td>
                  <td className="p-3 text-right">{fmt(inv.balance)}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                      inv.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
              {(!detail.invoices || detail.invoices.length === 0) && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">No invoices</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payments */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold text-gray-700">Payments</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-right p-3 font-medium text-gray-600">Amount</th>
                <th className="text-left p-3 font-medium text-gray-600">Method</th>
                <th className="text-left p-3 font-medium text-gray-600">Reference</th>
                <th className="text-left p-3 font-medium text-gray-600">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(detail.payments || []).filter((p: any) => !p.deleted_at).map((pay: any) => (
                <tr key={pay.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">{fmtDate(pay.payment_date)}</td>
                  <td className="p-3 text-right font-medium text-green-600">{fmt(pay.amount)}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">
                      {pay.payment_method?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500">{pay.reference || '—'}</td>
                  <td className="p-3 text-gray-500 text-xs">{pay.notes || '—'}</td>
                </tr>
              ))}
              {(!detail.payments || detail.payments.length === 0) && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">No payments recorded</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payment Modal */}
        {paymentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Record Payment — {detail.name}</h2>
                <button onClick={() => setPaymentModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
              <form onSubmit={handlePayment} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KES) *</label>
                  <input type="number" required step="0.01" min="0.01"
                    value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-lg font-bold" />
                  <p className="text-xs text-gray-400 mt-1">Outstanding: {fmt(detail.outstanding_balance)}</p>
                </div>
                {unpaidInvoices.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Apply to Invoice (optional)</label>
                    <select value={payForm.invoice_id} onChange={e => setPayForm({ ...payForm, invoice_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg p-2">
                      <option value="">General payment (auto-apply oldest)</option>
                      {unpaidInvoices.map((inv: any) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoice_number || `INV-${inv.id}`} — bal {fmt(inv.balance)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                  <select value={payForm.payment_method} onChange={e => setPayForm({ ...payForm, payment_method: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2">
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date *</label>
                  <input type="date" required value={payForm.payment_date}
                    onChange={e => setPayForm({ ...payForm, payment_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reference (M-Pesa code, cheque no.)</label>
                  <input type="text" value={payForm.reference}
                    onChange={e => setPayForm({ ...payForm, reference: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea rows={2} value={payForm.notes}
                    onChange={e => setPayForm({ ...payForm, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={() => setPaymentModal(false)}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                  <button type="submit" disabled={saving || !payForm.amount}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                    {saving ? 'Recording...' : 'Record Payment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
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
              <tr key={s.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => loadDetail(s.id)}>
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
                    <button onClick={() => loadDetail(s.id)} className="p-1 text-gray-400 hover:text-blue-600 rounded"><ChevronRight size={14} /></button>
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
      {supplierModal.open && (
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
                    className="w-full border border-gray-300 rounded-lg p-2" placeholder="e.g. Mache Petroleum" />
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms (days)</label>
                  <input type="number" min="0" value={form.payment_terms_days}
                    onChange={e => setForm({ ...form, payment_terms_days: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" />
                  <p className="text-xs text-gray-400 mt-1">0 = Cash on Delivery</p>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
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
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-2">Delete Supplier?</h3>
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
      )}
    </div>
  );
}
