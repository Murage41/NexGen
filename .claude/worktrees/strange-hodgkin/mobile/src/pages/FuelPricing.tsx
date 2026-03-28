import { useState, useEffect } from 'react';
import { Plus, Fuel, TrendingUp } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import { getFuelPrices, getCurrentPrices, createFuelPrice } from '../services/api';

export default function FuelPricing() {
  const { isAdmin } = useAuth();
  const [current, setCurrent] = useState<any>({});
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ fuel_type: 'petrol', price_per_litre: '' });

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

  async function handleAdd() {
    if (!form.price_per_litre) return;
    setSubmitting(true);
    try {
      await createFuelPrice({ fuel_type: form.fuel_type, price_per_litre: parseFloat(form.price_per_litre) });
      setShowAdd(false);
      setForm({ fuel_type: 'petrol', price_per_litre: '' });
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader
        title="Fuel Pricing"
        back
        right={
          isAdmin ? (
            <button onClick={() => setShowAdd(true)} className="p-2 bg-blue-600 text-white rounded-xl">
              <Plus size={20} />
            </button>
          ) : undefined
        }
      />

      {/* Current Prices */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm text-center">
          <Fuel size={28} className="mx-auto text-blue-500 mb-2" />
          <p className="text-sm text-gray-500 mb-1">Petrol</p>
          <p className="text-2xl font-bold text-gray-800">
            {current.petrol?.price_per_litre ? fmt(current.petrol.price_per_litre) : '--'}
          </p>
          <p className="text-xs text-gray-400 mt-1">per litre</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm text-center">
          <Fuel size={28} className="mx-auto text-amber-500 mb-2" />
          <p className="text-sm text-gray-500 mb-1">Diesel</p>
          <p className="text-2xl font-bold text-gray-800">
            {current.diesel?.price_per_litre ? fmt(current.diesel.price_per_litre) : '--'}
          </p>
          <p className="text-xs text-gray-400 mt-1">per litre</p>
        </div>
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

      {/* Add Price Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowAdd(false)}>
          <div className="bg-white w-full rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">Set New Price</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Fuel Type</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={form.fuel_type}
                  onChange={e => setForm({ ...form, fuel_type: e.target.value })}
                >
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Price per Litre (KES)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  value={form.price_per_litre}
                  onChange={e => setForm({ ...form, price_per_litre: e.target.value })}
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={submitting || !form.price_per_litre}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
              >
                {submitting ? 'Saving...' : 'Set Price'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
