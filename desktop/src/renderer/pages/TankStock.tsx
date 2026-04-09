import { useState, useEffect } from 'react';
import {
  getTanks, createTank, updateTank, deleteTank,
  getFuelDeliveries, createFuelDelivery, updateFuelDelivery, deleteFuelDelivery,
  getTankDips, createTankDip, updateTankDip, deleteTankDip,
  getCurrentShift, getTankLedger,
} from '../services/api';
import { Plus, Database, X, Truck, Droplets, Pencil, Trash2, AlertTriangle, BookOpen } from 'lucide-react';

const today = () => new Date().toISOString().split('T')[0];

const emptyTankForm = { label: '', fuel_type: 'petrol', capacity_litres: '' };
const emptyDeliveryForm = { tank_id: '', supplier: '', litres: '', cost_per_litre: '', date: today() };
const emptyDipForm = { tank_id: '', measured_litres: '', dip_date: today() };

export default function TankStock() {
  const [tanks, setTanks] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [dips, setDips] = useState<any[]>([]);
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tanks' | 'deliveries' | 'dips' | 'ledger'>('tanks');
  const [ledgerData, setLedgerData] = useState<any[]>([]);
  const [ledgerTankId, setLedgerTankId] = useState<string>('');

  // Modal state
  const [tankModal, setTankModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [deliveryModal, setDeliveryModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [dipModal, setDipModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; item: any } | null>(null);

  const [tankForm, setTankForm] = useState(emptyTankForm);
  const [deliveryForm, setDeliveryForm] = useState(emptyDeliveryForm);
  const [dipForm, setDipForm] = useState(emptyDipForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [tanksRes, deliveriesRes, dipsRes, shiftRes] = await Promise.all([
        getTanks(),
        getFuelDeliveries(),
        getTankDips(),
        getCurrentShift(),
      ]);
      setTanks(tanksRes.data.data || []);
      setDeliveries(deliveriesRes.data.data || []);
      setDips(dipsRes.data.data || []);
      setHasOpenShift(!!(shiftRes.data.data));
    } catch (err) {
      console.error('Failed to load tank data:', err);
    } finally {
      setLoading(false);
    }
  }

  // ── Tanks ──────────────────────────────────────────
  function openAddTank() {
    setTankForm(emptyTankForm);
    setError('');
    setTankModal({ open: true, editing: null });
  }
  function openEditTank(tank: any) {
    setTankForm({ label: tank.label, fuel_type: tank.fuel_type, capacity_litres: String(tank.capacity_litres) });
    setError('');
    setTankModal({ open: true, editing: tank });
  }
  async function handleSaveTank(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = { ...tankForm, capacity_litres: parseFloat(tankForm.capacity_litres) };
      if (tankModal.editing) {
        await updateTank(tankModal.editing.id, payload);
      } else {
        await createTank(payload);
      }
      setTankModal({ open: false, editing: null });
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save tank');
    } finally { setSaving(false); }
  }

  // ── Deliveries ─────────────────────────────────────
  function openAddDelivery() {
    setDeliveryForm({ ...emptyDeliveryForm, tank_id: tanks.length > 0 ? String(tanks[0].id) : '', date: today() });
    setError('');
    setDeliveryModal({ open: true, editing: null });
  }
  function openEditDelivery(d: any) {
    setDeliveryForm({
      tank_id: String(d.tank_id),
      supplier: d.supplier || '',
      litres: String(d.litres),
      cost_per_litre: String(d.cost_per_litre),
      date: d.date,
    });
    setError('');
    setDeliveryModal({ open: true, editing: d });
  }
  async function handleSaveDelivery(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        tank_id: parseInt(deliveryForm.tank_id),
        supplier: deliveryForm.supplier || null,
        litres: parseFloat(deliveryForm.litres),
        cost_per_litre: parseFloat(deliveryForm.cost_per_litre),
        date: deliveryForm.date,
      };
      if (deliveryModal.editing) {
        await updateFuelDelivery(deliveryModal.editing.id, payload);
      } else {
        await createFuelDelivery(payload);
      }
      setDeliveryModal({ open: false, editing: null });
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save delivery');
    } finally { setSaving(false); }
  }

  // ── Dips ───────────────────────────────────────────
  function openAddDip() {
    setDipForm({ ...emptyDipForm, tank_id: tanks.length > 0 ? String(tanks[0].id) : '', dip_date: today() });
    setError('');
    setDipModal({ open: true, editing: null });
  }
  function openEditDip(d: any) {
    setDipForm({
      tank_id: String(d.tank_id),
      measured_litres: String(d.measured_litres),
      dip_date: d.dip_date || today(),
    });
    setError('');
    setDipModal({ open: true, editing: d });
  }
  async function handleSaveDip(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        tank_id: parseInt(dipForm.tank_id),
        measured_litres: parseFloat(dipForm.measured_litres),
        dip_date: dipForm.dip_date,
      };
      if (dipModal.editing) {
        await updateTankDip(dipModal.editing.id, payload);
      } else {
        await createTankDip(payload);
      }
      setDipModal({ open: false, editing: null });
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save dip');
    } finally { setSaving(false); }
  }

  // ── Delete ─────────────────────────────────────────
  async function handleDelete() {
    if (!deleteConfirm) return;
    setSaving(true); setError('');
    try {
      if (deleteConfirm.type === 'tank') await deleteTank(deleteConfirm.item.id);
      if (deleteConfirm.type === 'delivery') await deleteFuelDelivery(deleteConfirm.item.id);
      if (deleteConfirm.type === 'dip') await deleteTankDip(deleteConfirm.item.id);
      setDeleteConfirm(null);
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete');
      setDeleteConfirm(null);
    } finally { setSaving(false); }
  }

  const formatKES = (n: number) => `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
  const fmt = (n: any) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
  const fmtDate = (s: string) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Database size={24} /> Tank Stock Management
        </h1>
      </div>

      {hasOpenShift && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle size={16} className="flex-shrink-0" />
          A shift is currently open. Editing tanks and recording dips is disabled until the shift is closed.
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
      )}

      {/* Stock Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {tanks.map((tank: any) => {
          const stock = parseFloat(tank.current_stock_litres || 0);
          const capacity = parseFloat(tank.capacity_litres || 1);
          const pct = Math.min(100, Math.max(0, (stock / capacity) * 100));
          return (
            <div key={tank.id} className={`bg-white rounded-lg shadow p-4 border-l-4 ${tank.fuel_type === 'petrol' ? 'border-blue-500' : 'border-amber-500'}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">{tank.label}</h3>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${tank.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                  {tank.fuel_type}
                </span>
              </div>
              <p className="text-sm text-gray-500 mb-2">Capacity: {fmt(tank.capacity_litres)} L</p>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Book Stock:</span>
                <span className={`font-bold ${stock < 0 ? 'text-red-600' : 'text-gray-800'}`}>{fmt(stock)} L</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${pct <= 15 ? 'bg-red-500' : pct <= 30 ? 'bg-amber-400' : tank.fuel_type === 'petrol' ? 'bg-blue-500' : 'bg-amber-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">{pct.toFixed(1)}% full</p>
            </div>
          );
        })}
        {tanks.length === 0 && (
          <div className="col-span-3 bg-white rounded-lg shadow p-6 text-gray-400 text-center">
            No tanks configured. Add a tank to get started.
          </div>
        )}
      </div>

      {/* Tabs + Actions */}
      <div className="flex items-center justify-between border-b mb-4">
        <div className="flex gap-1">
          {(['tanks', 'deliveries', 'dips', 'ledger'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition capitalize ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'dips' ? 'Tank Dips' : tab === 'ledger' ? 'Stock Ledger' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div>
          {activeTab === 'tanks' && (
            <button onClick={openAddTank} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">
              <Plus size={16} /> Add Tank
            </button>
          )}
          {activeTab === 'deliveries' && (
            <button onClick={openAddDelivery} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">
              <Truck size={16} /> Record Delivery
            </button>
          )}
          {activeTab === 'dips' && (
            <button onClick={openAddDip} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">
              <Droplets size={16} /> Record Dip
            </button>
          )}
        </div>
      </div>

      {/* Tanks Tab */}
      {activeTab === 'tanks' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Label</th>
                <th className="text-left p-3 font-medium text-gray-600">Fuel Type</th>
                <th className="text-right p-3 font-medium text-gray-600">Capacity (L)</th>
                <th className="text-right p-3 font-medium text-gray-600">Book Stock (L)</th>
                <th className="p-3 font-medium text-gray-600 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {tanks.map((tank: any) => (
                <tr key={tank.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-medium">{tank.label}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${tank.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                      {tank.fuel_type}
                    </span>
                  </td>
                  <td className="p-3 text-right">{fmt(tank.capacity_litres)}</td>
                  <td className={`p-3 text-right font-medium ${parseFloat(tank.current_stock_litres) < 0 ? 'text-red-600' : ''}`}>
                    {fmt(tank.current_stock_litres)}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      {!hasOpenShift && (
                        <>
                          <button onClick={() => openEditTank(tank)} className="p-1 text-gray-400 hover:text-blue-600 rounded"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteConfirm({ type: 'tank', item: tank })} className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tanks.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">No tanks configured.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Deliveries Tab */}
      {activeTab === 'deliveries' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Tank</th>
                <th className="text-right p-3 font-medium text-gray-600">Litres</th>
                <th className="text-right p-3 font-medium text-gray-600">Cost/L</th>
                <th className="text-right p-3 font-medium text-gray-600">Total Cost</th>
                <th className="text-left p-3 font-medium text-gray-600">Supplier</th>
                <th className="p-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d: any) => (
                <tr key={d.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">{fmtDate(d.date)}</td>
                  <td className="p-3 font-medium">{d.tank_label || `Tank #${d.tank_id}`}</td>
                  <td className="p-3 text-right">{fmt(d.litres)}</td>
                  <td className="p-3 text-right">{formatKES(d.cost_per_litre)}</td>
                  <td className="p-3 text-right font-medium">{formatKES(d.total_cost)}</td>
                  <td className="p-3 text-gray-600">{d.supplier || '—'}</td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEditDelivery(d)} className="p-1 text-gray-400 hover:text-blue-600 rounded"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteConfirm({ type: 'delivery', item: d })} className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {deliveries.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">No deliveries recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Dips Tab */}
      {activeTab === 'dips' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {hasOpenShift && (
            <div className="p-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 flex items-center gap-1">
              <AlertTriangle size={12} /> Book stock does not include current shift sales until the shift is closed.
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Dip Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Tank</th>
                <th className="text-right p-3 font-medium text-gray-600">Measured (L)</th>
                <th className="text-right p-3 font-medium text-gray-600">Book Stock (L)</th>
                <th className="text-right p-3 font-medium text-gray-600">Variance (L)</th>
                <th className="text-left p-3 font-medium text-gray-600">Recorded At</th>
                <th className="p-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {dips.map((d: any) => {
                const v = d.variance_litres != null ? parseFloat(d.variance_litres) : null;
                return (
                  <tr key={d.id} className={`border-t hover:bg-gray-50 ${v !== null && Math.abs(v) > 0 ? (v < -50 ? 'bg-red-50' : '') : ''}`}>
                    <td className="p-3 font-medium">{fmtDate(d.dip_date)}</td>
                    <td className="p-3">{d.tank_label || `Tank #${d.tank_id}`}</td>
                    <td className="p-3 text-right font-medium">{fmt(d.measured_litres)}</td>
                    <td className="p-3 text-right text-gray-500">{d.book_stock_at_dip != null ? fmt(d.book_stock_at_dip) : '—'}</td>
                    <td className={`p-3 text-right font-medium ${v !== null ? (v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : 'text-gray-600') : ''}`}>
                      {v !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} L` : '—'}
                    </td>
                    <td className="p-3 text-gray-500 text-xs">{d.timestamp ? new Date(d.timestamp).toLocaleString('en-KE') : '—'}</td>
                    <td className="p-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEditDip(d)} className="p-1 text-gray-400 hover:text-blue-600 rounded"><Pencil size={14} /></button>
                        <button onClick={() => setDeleteConfirm({ type: 'dip', item: d })} className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {dips.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">No dip readings recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Ledger Tab */}
      {activeTab === 'ledger' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b flex items-center gap-3">
            <select value={ledgerTankId} onChange={async (e) => {
              setLedgerTankId(e.target.value);
              if (e.target.value) {
                try { const res = await getTankLedger(parseInt(e.target.value)); setLedgerData(res.data.data || []); }
                catch { setLedgerData([]); }
              } else { setLedgerData([]); }
            }} className="border border-gray-300 rounded-lg p-2 text-sm">
              <option value="">Select a tank...</option>
              {tanks.map((t: any) => <option key={t.id} value={t.id}>{t.label} ({t.fuel_type})</option>)}
            </select>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Date/Time</th>
                <th className="text-left p-3 font-medium text-gray-600">Event</th>
                <th className="text-right p-3 font-medium text-gray-600">Change (L)</th>
                <th className="text-right p-3 font-medium text-gray-600">Balance (L)</th>
                <th className="text-left p-3 font-medium text-gray-600">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ledgerData.map((entry: any) => (
                <tr key={entry.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-xs text-gray-500">{new Date(entry.created_at).toLocaleString('en-KE')}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      entry.event_type === 'delivery' ? 'bg-green-100 text-green-700' :
                      entry.event_type === 'shift_sale' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>{entry.event_type.replace('_', ' ')}</span>
                  </td>
                  <td className={`p-3 text-right font-medium ${parseFloat(entry.litres_change) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {parseFloat(entry.litres_change) >= 0 ? '+' : ''}{parseFloat(entry.litres_change).toFixed(1)}
                  </td>
                  <td className="p-3 text-right font-medium">{parseFloat(entry.balance_after).toFixed(1)}</td>
                  <td className="p-3 text-xs text-gray-500">{entry.notes || '—'}</td>
                </tr>
              ))}
              {ledgerData.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">{ledgerTankId ? 'No ledger entries yet.' : 'Select a tank to view its stock ledger.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Tank Modal */}
      {tankModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{tankModal.editing ? 'Edit Tank' : 'Add Tank'}</h2>
              <button onClick={() => setTankModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <form onSubmit={handleSaveTank} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
                <input type="text" required value={tankForm.label} onChange={e => setTankForm({ ...tankForm, label: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="e.g. Tank A — Petrol" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fuel Type *</label>
                <select value={tankForm.fuel_type} onChange={e => setTankForm({ ...tankForm, fuel_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Capacity (Litres) *</label>
                <input type="number" required min="1" value={tankForm.capacity_litres} onChange={e => setTankForm({ ...tankForm, capacity_litres: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="e.g. 20000" />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setTankModal({ open: false, editing: null })} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving...' : tankModal.editing ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delivery Modal */}
      {deliveryModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{deliveryModal.editing ? 'Edit Delivery' : 'Record Fuel Delivery'}</h2>
              <button onClick={() => setDeliveryModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <form onSubmit={handleSaveDelivery} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input type="date" required max={today()} value={deliveryForm.date} onChange={e => setDeliveryForm({ ...deliveryForm, date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tank *</label>
                <select required value={deliveryForm.tank_id} onChange={e => setDeliveryForm({ ...deliveryForm, tank_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  <option value="">-- Select Tank --</option>
                  {tanks.map((t: any) => <option key={t.id} value={t.id}>{t.label} ({t.fuel_type})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Litres *</label>
                  <input type="number" required step="0.01" min="0" value={deliveryForm.litres} onChange={e => setDeliveryForm({ ...deliveryForm, litres: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost per Litre (KES) *</label>
                  <input type="number" required step="0.01" min="0" value={deliveryForm.cost_per_litre} onChange={e => setDeliveryForm({ ...deliveryForm, cost_per_litre: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
                </div>
              </div>
              {deliveryForm.litres && deliveryForm.cost_per_litre && (
                <div className="bg-blue-50 rounded-lg p-2 text-sm text-blue-700 font-medium">
                  Total: KES {(parseFloat(deliveryForm.litres || '0') * parseFloat(deliveryForm.cost_per_litre || '0')).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <input type="text" value={deliveryForm.supplier} onChange={e => setDeliveryForm({ ...deliveryForm, supplier: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="e.g. Total Kenya" />
              </div>
              {deliveryModal.editing && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">⚠️ Editing will adjust the tank's stock balance accordingly.</p>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setDeliveryModal({ open: false, editing: null })} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving...' : deliveryModal.editing ? 'Save Changes' : 'Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dip Modal */}
      {dipModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{dipModal.editing ? 'Edit Dip Reading' : 'Record Tank Dip'}</h2>
              <button onClick={() => setDipModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <form onSubmit={handleSaveDip} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dip Date *</label>
                <input type="date" required max={today()} value={dipForm.dip_date} onChange={e => setDipForm({ ...dipForm, dip_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tank *</label>
                <select required value={dipForm.tank_id} onChange={e => setDipForm({ ...dipForm, tank_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  <option value="">-- Select Tank --</option>
                  {tanks.map((t: any) => <option key={t.id} value={t.id}>{t.label} ({t.fuel_type})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Measured Litres *</label>
                <input type="number" required step="0.01" min="0" value={dipForm.measured_litres} onChange={e => setDipForm({ ...dipForm, measured_litres: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
                <p className="text-xs text-gray-400 mt-1">Enter the physical dip stick measurement</p>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setDipModal({ open: false, editing: null })} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving...' : dipModal.editing ? 'Save Changes' : 'Record'}
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
            <h3 className="text-lg font-semibold mb-2">Confirm Delete</h3>
            <p className="text-sm text-gray-600 mb-2">
              {deleteConfirm.type === 'tank' && `Delete tank "${deleteConfirm.item.label}"? Any linked pumps must be reassigned first.`}
              {deleteConfirm.type === 'delivery' && `Delete this delivery of ${fmt(deleteConfirm.item.litres)} L on ${fmtDate(deleteConfirm.item.date)}? This will reduce the tank stock accordingly.`}
              {deleteConfirm.type === 'dip' && `Delete this dip reading of ${fmt(deleteConfirm.item.measured_litres)} L on ${fmtDate(deleteConfirm.item.dip_date)}?`}
            </p>
            <p className="text-xs text-red-500 mb-4">This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
