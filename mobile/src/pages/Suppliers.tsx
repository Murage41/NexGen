import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, ChevronRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getSuppliers, createSupplier } from '../services/api';
import { useAuth } from '../context/AuthContext';

const emptyForm = { name: '', phone: '', payment_terms_days: '0', bank_name: '', bank_account: '' };

export default function Suppliers() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  function load() {
    getSuppliers()
      .then(res => setSuppliers(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  async function handleAdd() {
    if (!form.name.trim()) return;
    setSaving(true); setError('');
    try {
      const res = await createSupplier({ ...form, name: form.name.trim(), payment_terms_days: parseInt(form.payment_terms_days) || 0 });
      setShowAdd(false);
      const created = res.data.data;
      if (created?.id) navigate(`/suppliers/${created.id}`);
      else load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not add the supplier');
    } finally { setSaving(false); }
  }

  const fmt = (n: any) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
  const input = 'w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader
        title="Suppliers"
        back
        right={
          isAdmin ? (
            <button onClick={() => { setForm(emptyForm); setError(''); setShowAdd(true); }} className="p-2 bg-blue-600 text-white rounded-xl" aria-label="Add supplier">
              <Plus size={20} />
            </button>
          ) : undefined
        }
      />

      {suppliers.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl shadow-sm">
          <Truck size={36} className="mx-auto text-gray-300 mb-2" />
          <p className="text-gray-400 text-sm">No suppliers yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {suppliers.map((s: any) => (
            <div
              key={s.id}
              onClick={() => navigate(`/suppliers/${s.id}`)}
              className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between gap-3 active:bg-gray-50"
            >
              <p className="flex-1 font-semibold text-gray-800">{s.name}</p>
              <div className="flex items-center gap-2">
                <p className={`text-sm font-bold tabular-nums ${s.outstanding_balance > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {fmt(s.outstanding_balance)}
                </p>
                <ChevronRight size={16} className="text-gray-300" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="mobile-modal-overlay flex items-end" onClick={() => setShowAdd(false)}>
          <div className="mobile-bottom-sheet rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">Add supplier</h2>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Name</label>
                <input className={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Phone</label>
                  <input type="tel" className={input} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Pay within (days)</label>
                  <input type="number" min="0" className={input} value={form.payment_terms_days} onChange={e => setForm({ ...form, payment_terms_days: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Bank</label>
                  <input className={input} value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Account</label>
                  <input className={input} value={form.bank_account} onChange={e => setForm({ ...form, bank_account: e.target.value })} />
                </div>
              </div>
              <button
                onClick={handleAdd}
                disabled={saving || !form.name.trim()}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-semibold disabled:opacity-50 mt-2"
              >
                {saving ? 'Adding...' : 'Add supplier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
