import { useState, useEffect } from 'react';
import { getFuelPrices, getCurrentPrices, updateFuelPrice } from '../services/api';
import { DollarSign, Pencil, Check, X } from 'lucide-react';
import { getKenyaDate } from '../utils/timezone';

export default function FuelPricing() {
  const [prices, setPrices] = useState<any[]>([]);
  const [currentPrices, setCurrentPrices] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ price_per_litre: '', effective_date: '', epra_max_price: '' });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [pricesRes, currentRes] = await Promise.all([getFuelPrices(), getCurrentPrices()]);
      setPrices(pricesRes.data.data);
      const cur = currentRes.data.data;
      // Normalize: API returns { petrol: {...}, diesel: {...} }
      setCurrentPrices(cur || {});
    } catch (err) {
      console.error('Failed to load fuel prices:', err);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(fuelType: string) {
    const current = currentPrices[fuelType];
    setEditForm({
      price_per_litre: current?.price_per_litre?.toString() || '',
      effective_date: getKenyaDate(),
      epra_max_price: current?.epra_max_price?.toString() || '',
    });
    setErrorMsg(null);
    setEditing(fuelType);
  }

  async function handleSave(fuelType: string) {
    setSaving(true);
    setErrorMsg(null);
    try {
      const payload: any = {
        price_per_litre: parseFloat(editForm.price_per_litre),
        effective_date: editForm.effective_date,
      };
      if (editForm.epra_max_price) {
        payload.epra_max_price = parseFloat(editForm.epra_max_price);
        payload.epra_effective_date = editForm.effective_date;
      }
      await updateFuelPrice(fuelType, payload);
      setEditing(null);
      loadData();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to update price');
    } finally {
      setSaving(false);
    }
  }

  function ceilingStatus(price: number, max: number | null | undefined): { color: string; label: string } | null {
    if (!max) return null;
    if (price > max) return { color: 'bg-red-100 text-red-700 border-red-300', label: `Over ceiling (KES ${max})` };
    if (price >= max * 0.95) return { color: 'bg-amber-100 text-amber-700 border-amber-300', label: `Within 5% of ceiling (KES ${max})` };
    return { color: 'bg-green-100 text-green-700 border-green-300', label: `Ceiling KES ${max}` };
  }

  const formatKES = (n: number) => `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  if (loading) return <div className="text-gray-500">Loading...</div>;

  const fuelTypes = ['petrol', 'diesel'];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mb-6">
        <DollarSign size={24} /> Fuel Pricing
      </h1>

      {/* Current Prices - Inline Edit Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {fuelTypes.map(ft => {
          const current = currentPrices[ft];
          const isEditing = editing === ft;
          return (
            <div key={ft} className={`bg-white rounded-lg shadow p-6 border-l-4 ${ft === 'petrol' ? 'border-blue-500' : 'border-amber-500'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-500 uppercase tracking-wide">{ft}</p>
                {!isEditing && (
                  <button onClick={() => startEdit(ft)} className="text-gray-400 hover:text-blue-600">
                    <Pencil size={16} />
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Price per Litre (KES)</label>
                    <input type="number" step="0.01" min="0" required
                      value={editForm.price_per_litre}
                      onChange={e => setEditForm({ ...editForm, price_per_litre: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg p-2 text-lg font-bold" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">EPRA Ceiling (KES, optional)</label>
                    <input type="number" step="0.01" min="0"
                      value={editForm.epra_max_price}
                      onChange={e => setEditForm({ ...editForm, epra_max_price: e.target.value })}
                      placeholder="e.g. 195.50"
                      className="w-full border border-gray-300 rounded-lg p-2" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Effective Date</label>
                    <input type="date" required
                      value={editForm.effective_date}
                      onChange={e => setEditForm({ ...editForm, effective_date: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg p-2" />
                  </div>
                  {errorMsg && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{errorMsg}</p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setEditing(null); setErrorMsg(null); }} className="p-1.5 text-gray-400 hover:text-gray-600 rounded">
                      <X size={18} />
                    </button>
                    <button onClick={() => handleSave(ft)} disabled={saving || !editForm.price_per_litre}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
                      <Check size={14} /> {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-3xl font-bold text-gray-800">{current ? formatKES(current.price_per_litre) : 'Not set'}</p>
                  {current && (
                    <p className="text-sm text-gray-400 mt-1">
                      per litre — effective {new Date(current.effective_date).toLocaleDateString('en-KE')}
                    </p>
                  )}
                  {current && (() => {
                    const status = ceilingStatus(Number(current.price_per_litre), current.epra_max_price);
                    if (!status) return null;
                    return (
                      <span className={`inline-block mt-2 text-xs px-2 py-1 rounded border ${status.color}`}>
                        {status.label}
                      </span>
                    );
                  })()}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Price History Table (read-only) */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-700">Price History</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium text-gray-600">Fuel Type</th>
              <th className="text-left p-3 font-medium text-gray-600">Price per Litre</th>
              <th className="text-left p-3 font-medium text-gray-600">Effective Date</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((price: any) => (
              <tr key={price.id} className="border-t hover:bg-gray-50">
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    price.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {price.fuel_type.charAt(0).toUpperCase() + price.fuel_type.slice(1)}
                  </span>
                </td>
                <td className="p-3 font-medium">{formatKES(price.price_per_litre)}</td>
                <td className="p-3 text-gray-600">{new Date(price.effective_date).toLocaleDateString('en-KE')}</td>
              </tr>
            ))}
            {prices.length === 0 && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-gray-400">No price history yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
