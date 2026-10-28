import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, AlertTriangle, Droplets } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import {
  getTanks, getTankStockSummary, createTankDip, updateTankDip, deleteTankDip, getCurrentShift, createTankAdjustment,
  getFuelDeliveries, getTankLedger, getTankAdjustments,
} from '../services/api';
import { getKenyaDate } from '../utils/timezone';
import { useAuth } from '../context/AuthContext';

const today = () => getKenyaDate();

const VARIANCE_CATEGORIES = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'natural_loss', label: 'Natural Loss' },
  { value: 'operational_loss', label: 'Operational Loss' },
  { value: 'meter_drift', label: 'Meter Drift' },
  { value: 'delivery_variance', label: 'Delivery Variance' },
];

const POSITIVE_ADJUSTMENT_REASONS = [
  { value: 'stock_take', label: 'Physical dip found stock above book' },
  { value: 'delivery_correction_gain', label: 'Approved delivery correction gain' },
  { value: 'meter_calibration_gain', label: 'Meter or calibration correction gain' },
  { value: 'opening_balance_correction_gain', label: 'Opening balance correction gain' },
  { value: 'other_gain', label: 'Other approved stock gain' },
];

const NEGATIVE_ADJUSTMENT_REASONS = [
  { value: 'dip_reconciliation_loss', label: 'Physical dip found stock below book' },
  { value: 'evaporation_loss', label: 'Evaporation or temperature loss' },
  { value: 'spillage_loss', label: 'Spillage loss' },
  { value: 'leakage_loss', label: 'Leakage loss' },
  { value: 'theft_loss', label: 'Theft / unexplained loss' },
  { value: 'contamination_loss', label: 'Contamination write-down' },
  { value: 'calibration_loss', label: 'Calibration or meter test loss' },
  { value: 'write_off', label: 'Inventory write-off' },
  { value: 'other_loss', label: 'Other approved stock loss' },
];

const variancePillClass = (cat: string) => {
  switch (cat) {
    case 'natural_loss': return 'bg-blue-100 text-blue-700';
    case 'operational_loss': return 'bg-amber-100 text-amber-700';
    case 'meter_drift': return 'bg-purple-100 text-purple-700';
    case 'delivery_variance': return 'bg-cyan-100 text-cyan-700';
    default: return 'bg-gray-100 text-gray-600';
  }
};

const varianceCategoryLabel = (cat: string) => VARIANCE_CATEGORIES.find(c => c.value === cat)?.label || cat;

export default function TankDips() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const [tank, setTank] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<'dips' | 'deliveries' | 'ledger' | 'adjustments'>('dips');
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editDip, setEditDip] = useState<any | null>(null);
  const [adjustDip, setAdjustDip] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [form, setForm] = useState({ measured_litres: '', dip_date: today(), variance_category: 'unclassified', variance_notes: '' });
  const [adjustForm, setAdjustForm] = useState({ reason: '', notes: '', cost_per_litre: '' });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, [id]);

  async function loadData() {
    try {
      const tankId = parseInt(id!);
      const [tanksRes, summaryRes, shiftRes, deliveriesRes, ledgerRes, adjustmentsRes] = await Promise.all([
        getTanks(),
        getTankStockSummary(tankId),
        getCurrentShift(),
        getFuelDeliveries({ tank_id: tankId }).catch(() => null),
        getTankLedger(tankId).catch(() => null),
        getTankAdjustments(tankId).catch(() => null),
      ]);
      // The list carries the litres in the tank now (less the open shift's sales).
      setTank((tanksRes.data.data || []).find((t: any) => t.id === tankId) || null);
      setSummary(summaryRes.data.data);
      setHasOpenShift(!!(shiftRes.data.data));
      setDeliveries(deliveriesRes?.data.data || []);
      setLedger(ledgerRes?.data.data || []);
      setAdjustments(adjustmentsRes?.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setForm({ measured_litres: '', dip_date: today(), variance_category: 'unclassified', variance_notes: '' });
    setError('');
    setWarnings([]);
    setShowAdd(true);
  }

  function openEdit(dip: any) {
    setForm({
      measured_litres: String(dip.measured_litres),
      dip_date: dip.dip_date || today(),
      variance_category: dip.variance_category || 'unclassified',
      variance_notes: dip.variance_notes || '',
    });
    setEditDip(dip);
    setError('');
    setWarnings([]);
  }

  async function handleSave() {
    if (!form.measured_litres || !form.dip_date) return;
    setSubmitting(true);
    setError('');
    setWarnings([]);
    try {
      const basePayload = {
        measured_litres: parseFloat(form.measured_litres),
        dip_date: form.dip_date,
        variance_category: form.variance_category,
        variance_notes: form.variance_notes || null,
      };
      const res = editDip
        ? await updateTankDip(editDip.id, basePayload)
        : await createTankDip({ ...basePayload, tank_id: parseInt(id!) });
      const respWarnings: string[] = res?.data?.warnings || [];
      if (respWarnings.length > 0) {
        setWarnings(respWarnings);
        await loadData();
      } else {
        setEditDip(null);
        setShowAdd(false);
        await loadData();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save dip');
    } finally {
      setSubmitting(false);
    }
  }

  function openAdjust(dip: any) {
    const change = Number(dip.variance_litres || 0);
    const reasons = change > 0 ? POSITIVE_ADJUSTMENT_REASONS : change < 0 ? NEGATIVE_ADJUSTMENT_REASONS : [];
    setAdjustDip(dip);
    setAdjustForm({ reason: reasons[0]?.value || '', notes: '', cost_per_litre: '' });
    setError('');
    setWarnings([]);
  }

  async function handleAdjust() {
    if (!adjustDip || !adjustForm.reason || (adjustNotesRequired && !adjustForm.notes.trim())) return;
    setSubmitting(true);
    setError('');
    setWarnings([]);
    try {
      const payload: any = {
        reference_dip_id: adjustDip.id,
        reason: adjustForm.reason,
        notes: adjustForm.notes.trim(),
      };
      if (adjustForm.cost_per_litre) payload.cost_per_litre = parseFloat(adjustForm.cost_per_litre);
      const res = await createTankAdjustment(parseInt(id!), payload);
      setWarnings(res?.data?.warnings || []);
      setAdjustDip(null);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to post adjustment');
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
  // The last dip against the book stock at that time (not against today's stock).
  const vLabel = varianceLabel(dips[0]?.variance_litres != null ? Number(dips[0].variance_litres) : null);
  const adjustChange = adjustDip ? Number(adjustDip.variance_litres || 0) : 0;
  const adjustReasons = adjustChange > 0
    ? POSITIVE_ADJUSTMENT_REASONS
    : adjustChange < 0
      ? NEGATIVE_ADJUSTMENT_REASONS
      : [];
  const adjustNotesRequired = adjustForm.reason === 'other_gain' || adjustForm.reason === 'other_loss';

  const stockNow = Number(tank.stock_now_litres ?? summary?.current_stock_litres ?? 0);
  const pctFull = Math.min(100, Math.max(0, (stockNow / Math.max(1, Number(tank.capacity_litres || 1))) * 100));
  const low = tank.reorder_level_litres != null && stockNow <= Number(tank.reorder_level_litres);
  const litres = (n: any) => `${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L`;
  const LEDGER_EVENTS: Record<string, string> = { delivery: 'Delivery', shift_sale: 'Shift sales', stock_adjustment: 'Adjustment', adjustment: 'Adjustment' };

  return (
    <div className="pb-6">
      <PageHeader title={tank.label} back />

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {warnings.length > 0 && !showAdd && !editDip && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-800 space-y-1">
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          </div>
        </div>
      )}

      {/* The tank now */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold text-gray-500">In the tank now</p>
          <p className={`text-xl font-bold tabular-nums ${low ? 'text-red-600' : 'text-gray-800'}`}>{litres(stockNow)}</p>
        </div>
        <div className="mt-2 h-2 rounded-full bg-gray-200 overflow-hidden">
          <div className={`h-full ${low ? 'bg-red-500' : pctFull <= 25 ? 'bg-amber-400' : 'bg-blue-600'}`} style={{ width: `${pctFull}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-gray-500">
          <span>{pctFull.toFixed(0)}% of {litres(tank.capacity_litres)}</span>
          <span>{tank.reorder_level_litres == null ? 'No order level' : `Order at ${litres(tank.reorder_level_litres)}`}</span>
        </div>
        {vLabel && dips[0] && (
          <p className={`mt-2 text-sm font-medium ${vLabel.color}`}>Last dip {formatDate(dips[0].dip_date)}: {vLabel.text}</p>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
        {([['dips', 'Dips'], ['deliveries', 'Deliveries'], ['ledger', 'Ledger'], ['adjustments', 'Adjustments']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSection(key)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full border text-sm font-semibold ${section === key ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {section === 'dips' && (
        <>
          {isAdmin && (
            <button onClick={openAdd} className="mb-3 w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-xl font-semibold">
              <Plus size={18} /> Record dip
            </button>
          )}
          {hasOpenShift && <p className="mb-2 px-1 text-xs text-amber-700">Book stock leaves out the open shift's sales until it closes.</p>}
          {dips.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-xl shadow-sm">
              <Droplets size={36} className="mx-auto text-gray-300 mb-2" />
              <p className="text-gray-400 text-sm">No dips yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {dips.map((dip: any) => {
                const v = dip.variance_litres != null ? parseFloat(dip.variance_litres) : null;
                return (
                  <div key={dip.id} className="bg-white rounded-xl shadow-sm p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-gray-800">{formatDate(dip.dip_date)} · {litres(dip.measured_litres)}</p>
                          <span className={`text-sm font-semibold tabular-nums ${v !== null && Math.abs(v) >= 0.05 ? (v < 0 ? 'text-red-600' : 'text-green-600') : 'text-gray-400'}`}>
                            {v === null ? '—' : Math.abs(v) < 0.05 ? '0 L' : `${v > 0 ? '+' : ''}${v.toFixed(1)} L`}
                          </span>
                        </div>
                        {dip.book_stock_at_dip != null && (
                          <p className="text-xs text-gray-400 mt-0.5">Book {parseFloat(dip.book_stock_at_dip).toFixed(1)} L</p>
                        )}
                        {(v !== null && Math.abs(v) >= 1 && (dip.variance_category || 'unclassified') !== 'unclassified') && (
                          <span className={`inline-block mt-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium ${variancePillClass(dip.variance_category)}`}>
                            {varianceCategoryLabel(dip.variance_category)}
                          </span>
                        )}
                        {dip.variance_notes && <p className="text-[11px] text-gray-400 mt-1">{dip.variance_notes}</p>}
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(dip)} className="p-2 text-gray-400 hover:text-blue-600 rounded-lg" aria-label="Edit dip">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => setDeleteTarget(dip)} className="p-2 text-gray-400 hover:text-red-500 rounded-lg" aria-label="Delete dip">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                    {isAdmin && !hasOpenShift && v !== null && Math.abs(v) >= 0.01 && !dip.adjustment_id && (
                      <button
                        onClick={() => openAdjust(dip)}
                        className="mt-3 w-full bg-blue-50 text-blue-700 py-2 rounded-xl text-sm font-medium"
                      >
                        Adjust book stock to this dip
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {section === 'deliveries' && (
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {deliveries.map((d: any) => (
            <div key={d.id} className="flex items-baseline justify-between gap-3 p-3.5 text-sm">
              <div>
                <p className="font-semibold text-gray-800">{formatDate(d.date)} · {litres(d.litres)}</p>
                <p className="text-xs text-gray-500">{d.supplier_name || '—'}{d.invoice_number ? ` · ${d.invoice_number}` : ''}</p>
              </div>
              <span className="tabular-nums text-gray-700">{Number(d.cost_per_litre || 0) > 0 ? `KES ${Number(d.total_cost).toLocaleString('en-KE', { maximumFractionDigits: 0 })}` : 'Price pending'}</span>
            </div>
          ))}
          {deliveries.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No deliveries yet</p>}
        </div>
      )}

      {section === 'ledger' && (
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {ledger.map((entry: any) => {
            const change = parseFloat(entry.litres_change);
            return (
              <div key={entry.id} className="flex items-baseline justify-between gap-3 p-3.5 text-sm">
                <div>
                  <p className="font-semibold text-gray-800">{LEDGER_EVENTS[entry.event_type] || entry.event_type.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-gray-500">{new Date(entry.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold tabular-nums ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>{change >= 0 ? '+' : ''}{change.toLocaleString('en-KE', { maximumFractionDigits: 1 })}</p>
                  <p className="text-xs text-gray-400 tabular-nums">{litres(entry.balance_after)}</p>
                </div>
              </div>
            );
          })}
          {ledger.length === 0 && <p className="p-6 text-center text-sm text-gray-400">Nothing yet</p>}
        </div>
      )}

      {section === 'adjustments' && (
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {adjustments.map((a: any) => (
            <div key={a.id} className="flex items-baseline justify-between gap-3 p-3.5 text-sm">
              <div>
                <p className="font-semibold text-gray-800">{formatDate(a.adjustment_date)}</p>
                <p className="text-xs text-gray-500">{[...POSITIVE_ADJUSTMENT_REASONS, ...NEGATIVE_ADJUSTMENT_REASONS].find(r => r.value === a.reason)?.label || a.reason}</p>
              </div>
              <span className={`font-semibold tabular-nums ${Number(a.litres_change) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {Number(a.litres_change) >= 0 ? '+' : ''}{Number(a.litres_change).toFixed(1)} L
              </span>
            </div>
          ))}
          {adjustments.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No adjustments</p>}
        </div>
      )}

      {/* Add / Edit Modal */}
      {(showAdd || editDip) && (
        <div className="mobile-modal-overlay flex items-end" onClick={() => { setShowAdd(false); setEditDip(null); }}>
          <div className="mobile-bottom-sheet rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">{editDip ? 'Edit Dip Reading' : 'Record Dip Reading'}</h2>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Date</label>
                <input
                  type="date"
                  max={today()}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.dip_date}
                  onChange={e => setForm({ ...form, dip_date: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Litres measured</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 12500.00"
                  value={form.measured_litres}
                  onChange={e => setForm({ ...form, measured_litres: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Reason for difference</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.variance_category}
                  onChange={e => setForm({ ...form, variance_category: e.target.value })}
                >
                  {VARIANCE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-amber-800 space-y-1">
                      {warnings.map((w, i) => <p key={i}>{w}</p>)}
                    </div>
                  </div>
                </div>
              )}
              {warnings.length > 0 ? (
                <button
                  onClick={() => { setWarnings([]); setShowAdd(false); setEditDip(null); }}
                  className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl text-base font-medium mt-2"
                >
                  Close
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={submitting || !form.measured_litres || !form.dip_date}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
                >
                  {submitting ? 'Saving...' : editDip ? 'Save Changes' : 'Record Dip'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Adjustment Modal */}
      {adjustDip && (
        <div className="mobile-modal-overlay flex items-end" onClick={() => setAdjustDip(null)}>
          <div className="mobile-bottom-sheet rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">Adjust To Dip</h2>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm mb-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Book at dip</span>
                <span className="font-medium">{parseFloat(adjustDip.book_stock_at_dip).toLocaleString('en-KE', { maximumFractionDigits: 1 })} L</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Dip reading</span>
                <span className="font-medium">{parseFloat(adjustDip.measured_litres).toLocaleString('en-KE', { maximumFractionDigits: 1 })} L</span>
              </div>
              <div className={`flex justify-between font-semibold ${adjustChange >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                <span>Adjustment</span>
                <span>{adjustChange >= 0 ? '+' : ''}{adjustChange.toFixed(2)} L</span>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Reason</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={adjustForm.reason}
                  onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                >
                  {adjustReasons.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Showing {adjustChange > 0 ? 'positive stock gain' : 'negative stock loss'} reasons only.
                </p>
              </div>
              {adjustChange > 0 && (
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Cost per litre</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Latest cost"
                    value={adjustForm.cost_per_litre}
                    onChange={e => setAdjustForm({ ...adjustForm, cost_per_litre: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">
                  Approval Notes {adjustNotesRequired ? '' : '(optional)'}
                </label>
                <textarea
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={adjustForm.notes}
                  onChange={e => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                />
              </div>
              <button
                onClick={handleAdjust}
                disabled={submitting || !adjustForm.reason || (adjustNotesRequired && !adjustForm.notes.trim()) || Math.abs(adjustChange) < 0.01}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50"
              >
                {submitting ? 'Posting...' : 'Post Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="mobile-modal-overlay flex items-center justify-center px-6">
          <div className="mobile-dialog-card bg-white rounded-2xl p-6 w-full max-w-sm">
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
