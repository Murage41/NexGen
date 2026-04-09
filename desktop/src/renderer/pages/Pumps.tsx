import { useState, useEffect } from 'react';
import { getPumps, createPump, updatePump, deletePump, getTanks } from '../services/api';
import { Plus, Pencil, Trash2, Fuel, X } from 'lucide-react';

export default function Pumps() {
  const [pumps, setPumps] = useState<any[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ label: '', nozzle_label: '', fuel_type: 'petrol', tank_id: '', initial_litres: '', initial_amount: '' });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [pumpsRes, tanksRes] = await Promise.all([getPumps(), getTanks()]);
      setPumps(pumpsRes.data.data);
      setTanks(tanksRes.data.data);
    } catch (err) {
      console.error('Failed to load pumps:', err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ label: '', nozzle_label: '', fuel_type: 'petrol', tank_id: '', initial_litres: '', initial_amount: '' });
    setShowModal(true);
  }

  function openEdit(pump: any) {
    setEditing(pump);
    setForm({
      label: pump.label,
      nozzle_label: pump.nozzle_label || '',
      fuel_type: pump.fuel_type,
      tank_id: String(pump.tank_id || ''),
      initial_litres: pump.initial_litres ? String(pump.initial_litres) : '',
      initial_amount: pump.initial_amount ? String(pump.initial_amount) : '',
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      label: form.label,
      nozzle_label: form.nozzle_label || null,
      fuel_type: form.fuel_type,
      tank_id: form.tank_id ? parseInt(form.tank_id) : null,
      initial_litres: form.initial_litres ? parseFloat(form.initial_litres) : 0,
      initial_amount: form.initial_amount ? parseFloat(form.initial_amount) : 0,
    };
    try {
      if (editing) {
        await updatePump(editing.id, payload);
      } else {
        await createPump(payload);
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      console.error('Failed to save pump:', err);
      alert(err.response?.data?.error || 'Failed to save pump');
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Are you sure you want to delete this pump?')) return;
    try {
      await deletePump(id);
      loadData();
    } catch (err: any) {
      console.error('Failed to delete pump:', err);
      alert(err.response?.data?.error || 'Failed to delete pump');
    }
  }

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Fuel size={24} /> Pumps
        </h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={18} /> Add Pump
        </button>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Pump' : 'Add Pump'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pump Label *</label>
                <input
                  type="text"
                  required
                  value={form.label}
                  onChange={e => setForm({ ...form, label: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  placeholder="e.g. Pump 1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nozzle Label</label>
                <input
                  type="text"
                  value={form.nozzle_label}
                  onChange={e => setForm({ ...form, nozzle_label: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  placeholder="e.g. Nozzle A"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fuel Type *</label>
                <select
                  value={form.fuel_type}
                  onChange={e => setForm({ ...form, fuel_type: e.target.value, tank_id: '' })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                >
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tank</label>
                <select
                  value={form.tank_id}
                  onChange={e => setForm({ ...form, tank_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                >
                  <option value="">-- Select Tank --</option>
                  {tanks
                    .filter((tank: any) => tank.fuel_type === form.fuel_type)
                    .map((tank: any) => (
                    <option key={tank.id} value={tank.id}>
                      {tank.label} ({tank.fuel_type})
                    </option>
                  ))}
                </select>
              </div>
              <div className="border-t border-gray-200 pt-4 mt-2">
                <p className="text-sm font-medium text-gray-700 mb-2">Current Meter Readings</p>
                <p className="text-xs text-gray-400 mb-3">Enter the current readings on the pump's totalizer. These will be used as the starting point for the first shift.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Litres Reading</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.initial_litres}
                      onChange={e => setForm({ ...form, initial_litres: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg p-2"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">KES Reading</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.initial_amount}
                      onChange={e => setForm({ ...form, initial_amount: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg p-2"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  {editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium text-gray-600">#</th>
              <th className="text-left p-3 font-medium text-gray-600">Label</th>
              <th className="text-left p-3 font-medium text-gray-600">Nozzle</th>
              <th className="text-left p-3 font-medium text-gray-600">Fuel Type</th>
              <th className="text-left p-3 font-medium text-gray-600">Tank</th>
              <th className="text-left p-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pumps.map((pump: any) => (
              <tr key={pump.id} className="border-t hover:bg-gray-50">
                <td className="p-3 text-gray-500">{pump.id}</td>
                <td className="p-3 font-medium">{pump.label}</td>
                <td className="p-3 text-gray-600">{pump.nozzle_label || '-'}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    pump.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {pump.fuel_type.charAt(0).toUpperCase() + pump.fuel_type.slice(1)}
                  </span>
                </td>
                <td className="p-3 text-gray-600">{pump.tank_label || '-'}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(pump)} className="text-blue-600 hover:text-blue-800" title="Edit">
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => handleDelete(pump.id)} className="text-red-500 hover:text-red-700" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pumps.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">No pumps configured yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
