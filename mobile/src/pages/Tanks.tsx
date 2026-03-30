import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Droplets, Pencil, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getTanks, createTank, updateTank, deleteTank, getCurrentShift } from '../services/api';

const FUEL_COLORS: Record<string, { badge: string; icon: string }> = {
  petrol: { badge: 'bg-blue-100 text-blue-700', icon: 'text-blue-500' },
  diesel: { badge: 'bg-amber-100 text-amber-700', icon: 'text-amber-500' },
};

const emptyForm = { label: '', fuel_type: 'petrol', capacity_litres: '' };

export default function Tanks() {
  const navigate = useNavigate();
  const [tanks, setTanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editTank, setEditTank] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [tanksRes, shiftRes] = await Promise.all([getTanks(), getCurrentShift()]);
      setTanks(tanksRes.data.data || []);
      setHasOpenShift(!!(shiftRes.data.data));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setForm(emptyForm);
    setError('');
    setShowAdd(true);
  }

  function openEdit(tank: any) {
    setForm({ label: tank.label, fuel_type: tank.fuel_type, capacity_litres: String(tank.capacity_litres) });
    setEditTank(tank);
    setError('');
  }

  async function handleSave() {
    if (!form.label || !form.capacity_litres) return;
    setSubmitting(true);
    setError('');
    try {
      const payload = { ...form, capacity_litres: parseFloat(form.capacity_litres) };
      if (editTank) {
        await updateTank(editTank.id, payload);
        setEditTank(null);
      } else {
        await createTank(payload);
        setShowAdd(false);
      }
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save tank');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError('');
    try {
      await deleteTank(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete tank');
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  }

  const stockPercent = (tank: any) => {
    if (!tank.capacity_litres || tank.capacity_litres === 0) return 0;
    return Math.min(100, Math.max(0, (tank.current_stock_litres / tank.capacity_litres) * 100));
  };

  const stockColor = (pct: number) => {
    if (pct <= 15) return 'bg-red-500';
    if (pct <= 30) return 'bg-amber-400';
    return 'bg-green-500';
  };

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader
        title="Tanks & Stock"
        back
        right={
          <button onClick={openAdd} className="p-2 bg-blue-600 text-white rounded-xl">
            <Plus size={20} />
          </button>
        }
      />

      {hasOpenShift && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-700">A shift is currently open. Editing and deleting tanks is disabled until the shift is closed.</p>
        </div>
      )}

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {tanks.length === 0 ? (
        <div className="text-center mt-20">
          <Droplets size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No tanks configured</p>
          <button onClick={openAdd} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm">Add First Tank</button>
        </div>
      ) : (
        <div className="space-y-3">
          {tanks.map((tank: any) => {
            const pct = stockPercent(tank);
            const colors = FUEL_COLORS[tank.fuel_type] || FUEL_COLORS.petrol;
            const stock = parseFloat(tank.current_stock_litres || 0);
            return (
              <div key={tank.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Droplets size={18} className={colors.icon} />
                      <div>
                        <p className="font-semibold text-gray-800">{tank.label}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors.badge}`}>
                          {tank.fuel_type}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!hasOpenShift && (
                        <>
                          <button
                            onClick={() => openEdit(tank)}
                            className="p-2 text-gray-400 hover:text-blue-600 rounded-lg"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(tank)}
                            className="p-2 text-gray-400 hover:text-red-500 rounded-lg"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Stock level bar */}
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Stock: <strong className="text-gray-800">{stock.toLocaleString('en-KE', { maximumFractionDigits: 0 })} L</strong></span>
                      <span>Capacity: {parseFloat(tank.capacity_litres).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${stockColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{pct.toFixed(1)}% full</p>
                  </div>
                </div>

                {/* Dips link */}
                <button
                  onClick={() => navigate(`/tanks/${tank.id}/dips`)}
                  className="w-full border-t border-gray-100 px-4 py-2.5 flex items-center justify-between text-sm text-blue-600 hover:bg-blue-50 active:bg-blue-50"
                >
                  <span>View Dips & Stock History</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {(showAdd || editTank) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => { setShowAdd(false); setEditTank(null); }}>
          <div className="bg-white w-full rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">{editTank ? 'Edit Tank' : 'Add Tank'}</h2>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Tank Label</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Tank A — Petrol"
                  value={form.label}
                  onChange={e => setForm({ ...form, label: e.target.value })}
                />
              </div>
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
                <label className="text-sm text-gray-600 mb-1 block">Capacity (Litres)</label>
                <input
                  type="number"
                  step="1"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 20000"
                  value={form.capacity_litres}
                  onChange={e => setForm({ ...form, capacity_litres: e.target.value })}
                />
              </div>
              <button
                onClick={handleSave}
                disabled={submitting || !form.label || !form.capacity_litres}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
              >
                {submitting ? 'Saving...' : editTank ? 'Save Changes' : 'Add Tank'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Delete Tank?</h3>
            <p className="text-sm text-gray-500 mb-4">
              Delete <strong>{deleteTarget.label}</strong>? This cannot be undone. Any pumps linked to this tank must be reassigned first.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="flex-1 py-3 bg-red-500 text-white rounded-xl font-medium disabled:opacity-50"
              >
                {submitting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
