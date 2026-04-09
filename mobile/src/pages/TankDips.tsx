import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, AlertTriangle, Droplets } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getTank, getTankStockSummary, createTankDip, updateTankDip, deleteTankDip, getCurrentShift } from '../services/api';

const today = () => new Date().toISOString().slice(0, 10);

export default function TankDips() {
  const { id } = useParams<{ id: string }>();
  const [tank, setTank] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editDip, setEditDip] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [form, setForm] = useState({ measured_litres: '', dip_date: today() });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, [id]);

  async function loadData() {
    try {
      const [tankRes, summaryRes, shiftRes] = await Promise.all([
        getTank(parseInt(id!)),
        getTankStockSummary(parseInt(id!)),
        getCurrentShift(),
      ]);
      setTank(tankRes.data.data);
      setSummary(summaryRes.data.data);
      setHasOpenShift(!!(shiftRes.data.data));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setForm({ measured_litres: '', dip_date: today() });
    setError('');
    setShowAdd(true);
  }

  function openEdit(dip: any) {
    setForm({ measured_litres: String(dip.measured_litres), dip_date: dip.dip_date || today() });
    setEditDip(dip);
    setError('');
  }

  async function handleSave() {
    if (!form.measured_litres || !form.dip_date) return;
    setSubmitting(true);
    setError('');
    try {
      if (editDip) {
        await updateTankDip(editDip.id, {
          measured_litres: parseFloat(form.measured_litres),
          dip_date: form.dip_date,
        });
        setEditDip(null);
      } else {
        await createTankDip({
          tank_id: parseInt(id!),
          measured_litres: parseFloat(form.measured_litres),
          dip_date: form.dip_date,
        });
        setShowAdd(false);
      }
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save dip');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError('');
    try {
      await deleteTankDip(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete dip');
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  }

  function formatDate(dateStr: string) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function varianceLabel(variance: number | null) {
    if (variance === null) return null;
    if (Math.abs(variance) < 1) return { text: 'Balanced', color: 'text-green-600', bg: 'bg-green-50' };
    if (variance > 0) return { text: `+${variance.toLocaleString('en-KE', { maximumFractionDigits: 0 })} L over book`, color: 'text-amber-600', bg: 'bg-amber-50' };
    return { text: `${Math.abs(variance).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L short`, color: 'text-red-600', bg: 'bg-red-50' };
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;
  if (!tank) return <div className="text-center text-gray-400 mt-20">Tank not found</div>;

  const dips = summary?.dips || [];
  const vLabel = varianceLabel(summary?.dip_variance);

  return (
    <div className="pb-6">
      <PageHeader
        title={`${tank.label} — Dips`}
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
          <p className="text-xs text-amber-700">A shift is open. Book stock does not include current shift sales until shift close.</p>
        </div>
      )}

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Stock Summary Card */}
      {summary && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Stock Overview</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs text-gray-500">Book Stock</p>
              <p className="text-lg font-bold text-blue-700">
                {parseFloat(summary.current_stock_litres).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500">Last Dip</p>
              {summary.last_dip ? (
                <>
                  <p className="text-lg font-bold text-gray-800">
                    {parseFloat(summary.last_dip.measured_litres).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L
                  </p>
                  <p className="text-xs text-gray-400">{formatDate(summary.last_dip.dip_date)}</p>
                </>
              ) : (
                <p className="text-sm text-gray-400">No dips yet</p>
              )}
            </div>
          </div>
          {vLabel && (
            <div className={`mt-3 rounded-xl p-2.5 ${vLabel.bg}`}>
              <p className={`text-sm font-medium text-center ${vLabel.color}`}>
                Variance: {vLabel.text}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-500">
            <div>Total Deliveries: <strong className="text-gray-700">{parseFloat(summary.total_deliveries_in).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L</strong></div>
            <div>Total Sales: <strong className="text-gray-700">{parseFloat(summary.total_pump_sales_out).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L</strong></div>
          </div>
        </div>
      )}

      {/* Dip History */}
      <p className="text-sm font-semibold text-gray-600 mb-2 px-1">Dip History</p>
      {dips.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl shadow-sm">
          <Droplets size={36} className="mx-auto text-gray-300 mb-2" />
          <p className="text-gray-400 text-sm">No dip readings recorded yet</p>
          <button onClick={openAdd} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm">Record First Dip</button>
        </div>
      ) : (
        <div className="space-y-2">
          {dips.map((dip: any, idx: number) => {
            const v = dip.variance_litres != null ? parseFloat(dip.variance_litres) : null;
            return (
              <div key={dip.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-gray-800">
                        {parseFloat(dip.measured_litres).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L
                      </p>
                      {idx === 0 && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Latest</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{formatDate(dip.dip_date)}</p>
                    {dip.book_stock_at_dip != null && (
                      <div className="mt-1 flex gap-3 text-xs">
                        <span className="text-gray-400">Book: {parseFloat(dip.book_stock_at_dip).toFixed(1)} L</span>
                        <span className={v !== null ? (v < 0 ? 'text-red-600 font-medium' : v > 0 ? 'text-green-600 font-medium' : 'text-gray-500') : ''}>
                          Var: {v !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} L` : '—'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(dip)} className="p-2 text-gray-400 hover:text-blue-600 rounded-lg">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setDeleteTarget(dip)} className="p-2 text-gray-400 hover:text-red-500 rounded-lg">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {(showAdd || editDip) && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => { setShowAdd(false); setEditDip(null); }}>
          <div className="bg-white w-full rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">{editDip ? 'Edit Dip Reading' : 'Record Dip Reading'}</h2>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Dip Date</label>
                <input
                  type="date"
                  max={today()}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.dip_date}
                  onChange={e => setForm({ ...form, dip_date: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Measured Litres</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 12500.00"
                  value={form.measured_litres}
                  onChange={e => setForm({ ...form, measured_litres: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-1">Enter the physical measurement from the dip stick</p>
              </div>
              <button
                onClick={handleSave}
                disabled={submitting || !form.measured_litres || !form.dip_date}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
              >
                {submitting ? 'Saving...' : editDip ? 'Save Changes' : 'Record Dip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Delete Dip Reading?</h3>
            <p className="text-sm text-gray-500 mb-4">
              Delete the dip reading of <strong>{parseFloat(deleteTarget.measured_litres).toLocaleString()} L</strong> on <strong>{formatDate(deleteTarget.dip_date)}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={submitting} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-medium disabled:opacity-50">
                {submitting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
