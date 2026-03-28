import { useState, useEffect } from 'react';
import { Plus, Fuel } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getPumps, createPump, getTanks } from '../services/api';

export default function Pumps() {
  const [pumps, setPumps] = useState<any[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ label: '', nozzle_label: '', fuel_type: 'petrol', tank_id: '', initial_litres: '', initial_amount: '' });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [pumpsRes, tanksRes] = await Promise.all([getPumps(), getTanks()]);
      setPumps(pumpsRes.data.data || pumpsRes.data);
      const tanksData = tanksRes.data.data || tanksRes.data;
      setTanks(tanksData);
      if (tanksData.length > 0 && !form.tank_id) {
        setForm(f => ({ ...f, tank_id: String(tanksData[0].id) }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!form.label || !form.tank_id) return;
    setSubmitting(true);
    try {
      await createPump({
        ...form,
        tank_id: parseInt(form.tank_id),
        initial_litres: form.initial_litres ? parseFloat(form.initial_litres) : 0,
        initial_amount: form.initial_amount ? parseFloat(form.initial_amount) : 0,
      });
      setShowAdd(false);
      setForm({ label: '', nozzle_label: '', fuel_type: 'petrol', tank_id: tanks.length > 0 ? String(tanks[0].id) : '', initial_litres: '', initial_amount: '' });
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  const fuelBadge = (type: string) => {
    if (type === 'petrol') return 'bg-blue-100 text-blue-700';
    if (type === 'diesel') return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-700';
  };

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader
        title="Pumps"
        back
        right={
          <button onClick={() => setShowAdd(true)} className="p-2 bg-blue-600 text-white rounded-xl">
            <Plus size={20} />
          </button>
        }
      />

      {pumps.length === 0 ? (
        <div className="text-center mt-20">
          <Fuel size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No pumps configured</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pumps.map((p: any) => (
            <div key={p.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Fuel size={18} className={p.fuel_type === 'petrol' ? 'text-blue-500' : 'text-amber-500'} />
                    <span className="font-semibold text-gray-800">{p.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${fuelBadge(p.fuel_type)}`}>
                      {p.fuel_type}
                    </span>
                  </div>
                  {p.nozzle_label && <p className="text-xs text-gray-400 ml-7">Nozzle: {p.nozzle_label}</p>}
                  {p.tank_label && <p className="text-xs text-gray-400 ml-7">Tank: {p.tank_label}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Pump Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowAdd(false)}>
          <div className="bg-white w-full rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">Add Pump</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Pump Label</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Pump 1"
                  value={form.label}
                  onChange={e => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Nozzle Label</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Nozzle A"
                  value={form.nozzle_label}
                  onChange={e => setForm({ ...form, nozzle_label: e.target.value })}
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
                <label className="text-sm text-gray-600 mb-1 block">Tank</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={form.tank_id}
                  onChange={e => setForm({ ...form, tank_id: e.target.value })}
                >
                  {tanks.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.label} ({t.fuel_type})</option>
                  ))}
                </select>
              </div>
              <div className="border-t border-gray-200 pt-3 mt-1">
                <p className="text-sm font-medium text-gray-700 mb-1">Current Meter Readings</p>
                <p className="text-xs text-gray-400 mb-2">Enter the readings currently showing on the pump's totalizer.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Litres Reading</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                      value={form.initial_litres}
                      onChange={e => setForm({ ...form, initial_litres: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">KES Reading</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                      value={form.initial_amount}
                      onChange={e => setForm({ ...form, initial_amount: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <button
                onClick={handleAdd}
                disabled={submitting || !form.label || !form.tank_id}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
              >
                {submitting ? 'Saving...' : 'Add Pump'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
