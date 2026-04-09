import { useState, useEffect } from 'react';
import { Fuel, TrendingUp, Pencil, Check, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import { getFuelPrices, getCurrentPrices, updateFuelPrice } from '../services/api';

export default function FuelPricing() {
  const { isAdmin } = useAuth();
  const [current, setCurrent] = useState<any>({});
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editForm, setEditForm] = useState({ price_per_litre: '', effective_date: '' });

  const fmt = (n: number) => `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [currentRes, historyRes] = await Promise.all([getCurrentPrices(), getFuelPrices()]);
      const currentData = currentRes.data.data || currentRes.data;
      const historyData = historyRes.data.data || historyRes.data;

      const priceMap: any = {};
      if (Array.isArray(currentData)) {
        currentData.forEach((p: any) => { priceMap[p.fuel_type] = p; });
      } else if (currentData) {
        Object.assign(priceMap, currentData);
      }
      setCurrent(priceMap);
      setHistory(historyData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(fuelType: string) {
    const cur = current[fuelType];
    setEditForm({
      price_per_litre: cur?.price_per_litre?.toString() || '',
      effective_date: new Date().toISOString().split('T')[0],
    });
    setEditing(fuelType);
  }

  async function handleSave(fuelType: string) {
    if (!editForm.price_per_litre) return;
    setSubmitting(true);
    try {
      await updateFuelPrice(fuelType, {
        price_per_litre: parseFloat(editForm.price_per_litre),
        effective_date: editForm.effective_date,
      });
      setEditing(null);
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  const fuelTypes = ['petrol', 'diesel'] as const;

  return (
    <div className="pb-6">
      <PageHeader title="Fuel Pricing" back />

      {/* Current Prices — Inline Edit Cards */}
      <div className="space-y-3 mb-6">
        {fuelTypes.map(ft => {
          const cur = current[ft];
          const isEditing = editing === ft;
          return (
            <div key={ft} className={`bg-white rounded-xl shadow-sm p-4 border-l-4 ${ft === 'petrol' ? 'border-blue-500' : 'border-amber-500'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Fuel size={20} className={ft === 'petrol' ? 'text-blue-500' : 'text-amber-500'} />
                  <p className="text-sm font-semibold text-gray-600 uppercase">{ft}</p>
                </div>
                {!isEditing && isAdmin && (
                  <button onClick={() => startEdit(ft)} className="p-2 text-gray-400 hover:text-blue-600 rounded-lg">
                    <Pencil size={16} />
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Price per Litre (KES)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full border border-gray-200 rounded-xl p-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={editForm.price_per_litre}
                      onChange={e => setEditForm({ ...editForm, price_per_litre: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Effective Date</label>
                    <input
                      type="date"
                      className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={editForm.effective_date}
                      onChange={e => setEditForm({ ...editForm, effective_date: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(null)} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-medium flex items-center justify-center gap-1">
                      <X size={16} /> Cancel
                    </button>
                    <button
                      onClick={() => handleSave(ft)}
                      disabled={submitting || !editForm.price_per_litre}
                      className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      <Check size={16} /> {submitting ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-800">
                    {cur?.price_per_litre ? fmt(cur.price_per_litre) : 'Not set'}
                  </p>
                  {cur?.effective_date && (
                    <p className="text-xs text-gray-400 mt-1">
                      per litre — effective {new Date(cur.effective_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Price History */}
      <h2 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
        <TrendingUp size={16} />
        Price History
      </h2>
      {history.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No price history</p>
      ) : (
        <div className="space-y-2">
          {history.map((p: any, i: number) => (
            <div key={p.id || i} className="bg-white rounded-xl p-3 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  p.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {p.fuel_type}
                </span>
                <span className="text-base font-semibold text-gray-800">{fmt(p.price_per_litre)}</span>
              </div>
              <span className="text-xs text-gray-400">
                {new Date(p.effective_date || p.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
