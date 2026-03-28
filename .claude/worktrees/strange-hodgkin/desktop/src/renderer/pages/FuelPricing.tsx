import { useState, useEffect } from 'react';
import { getFuelPrices, getCurrentPrices, createFuelPrice, deleteFuelPrice } from '../services/api';
import { Plus, Trash2, DollarSign, X } from 'lucide-react';

export default function FuelPricing() {
  const [prices, setPrices] = useState<any[]>([]);
  const [currentPrices, setCurrentPrices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ fuel_type: 'petrol', price_per_litre: '', effective_date: '' });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [pricesRes, currentRes] = await Promise.all([getFuelPrices(), getCurrentPrices()]);
      setPrices(pricesRes.data.data);
      setCurrentPrices(currentRes.data.data);
    } catch (err) {
      console.error('Failed to load fuel prices:', err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm({
      fuel_type: 'petrol',
      price_per_litre: '',
      effective_date: new Date().toISOString().split('T')[0],
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      fuel_type: form.fuel_type,
      price_per_litre: parseFloat(form.price_per_litre),
      effective_date: form.effective_date,
    };
    try {
      await createFuelPrice(payload);
      setShowModal(false);
      loadData();
    } catch (err: any) {
      console.error('Failed to create fuel price:', err);
      alert(err.response?.data?.error || 'Failed to create fuel price');
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Are you sure you want to delete this price entry?')) return;
    try {
      await deleteFuelPrice(id);
      loadData();
    } catch (err: any) {
      console.error('Failed to delete fuel price:', err);
      alert(err.response?.data?.error || 'Failed to delete fuel price');
    }
  }

  const formatKES = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <DollarSign size={24} /> Fuel Pricing
        </h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={18} /> Set New Price
        </button>
      </div>

      {/* Current Prices */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {currentPrices.length > 0 ? currentPrices.map((cp: any) => (
          <div key={cp.fuel_type} className={`bg-white rounded-lg shadow p-6 border-l-4 ${
            cp.fuel_type === 'petrol' ? 'border-blue-500' : 'border-amber-500'
          }`}>
            <p className="text-sm text-gray-500 uppercase tracking-wide">{cp.fuel_type} - Current Price</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{formatKES(cp.price_per_litre)}</p>
            <p className="text-sm text-gray-400 mt-1">per litre - effective {new Date(cp.effective_date).toLocaleDateString('en-KE')}</p>
          </div>
        )) : (
          <div className="col-span-2 bg-white rounded-lg shadow p-6 text-gray-400 text-center">
            No current prices set. Add a price to get started.
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Set New Fuel Price</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fuel Type *</label>
                <select
                  value={form.fuel_type}
                  onChange={e => setForm({ ...form, fuel_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                >
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price per Litre (KES) *</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  value={form.price_per_litre}
                  onChange={e => setForm({ ...form, price_per_litre: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date *</label>
                <input
                  type="date"
                  required
                  value={form.effective_date}
                  onChange={e => setForm({ ...form, effective_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Save Price
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Price History Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-700">Price History</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium text-gray-600">#</th>
              <th className="text-left p-3 font-medium text-gray-600">Fuel Type</th>
              <th className="text-left p-3 font-medium text-gray-600">Price per Litre</th>
              <th className="text-left p-3 font-medium text-gray-600">Effective Date</th>
              <th className="text-left p-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((price: any) => (
              <tr key={price.id} className="border-t hover:bg-gray-50">
                <td className="p-3 text-gray-500">{price.id}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    price.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {price.fuel_type.charAt(0).toUpperCase() + price.fuel_type.slice(1)}
                  </span>
                </td>
                <td className="p-3 font-medium">{formatKES(price.price_per_litre)}</td>
                <td className="p-3 text-gray-600">{new Date(price.effective_date).toLocaleDateString('en-KE')}</td>
                <td className="p-3">
                  <button onClick={() => handleDelete(price.id)} className="text-red-500 hover:text-red-700" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {prices.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-400">No price history yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
