import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getTanks, createTank, updateTank, deleteTank,
  getFuelDeliveries, createFuelDelivery, updateFuelDelivery, deleteFuelDelivery,
  uploadFuelDeliveryInvoiceDocument, getFuelDeliveryInvoiceDocument,
  getTankDips, createTankDip, updateTankDip, deleteTankDip,
  getCurrentShift, getTankLedger, getSuppliers, getTankAdjustments, createTankAdjustment,
  getTankDipTrends,
} from '../services/api';
import { Plus, X, Truck, Droplets, Pencil, Trash2, AlertTriangle, SlidersHorizontal, FileText } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getKenyaDate } from '../utils/timezone';
import { OrderLevelField, isLowStock } from '../../../../shared/ui/TankLowStock';

const today = () => getKenyaDate();

const emptyTankForm = { label: '', fuel_type: 'petrol', capacity_litres: '', reorder_level_litres: '' };
const emptyDeliveryForm = { tank_id: '', supplier_id: '', litres: '', cost_per_litre: '', date: today(), invoice_number: '' };
const emptyDipForm = { tank_id: '', measured_litres: '', dip_date: today(), variance_category: 'unclassified', variance_notes: '' };
const emptyAdjustmentForm = { tank_id: '', reference_dip_id: '', reason: '', notes: '', cost_per_litre: '' };

const VARIANCE_CATEGORIES = [
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'natural_loss', label: 'Natural Loss (evaporation/temperature)' },
  { value: 'operational_loss', label: 'Operational Loss (spillage/calibration)' },
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

const ADJUSTMENT_REASONS = [...POSITIVE_ADJUSTMENT_REASONS, ...NEGATIVE_ADJUSTMENT_REASONS];

const variancePillClass = (cat: string) => {
  switch (cat) {
    case 'natural_loss': return 'bg-blue-100 text-blue-700';
    case 'operational_loss': return 'bg-amber-100 text-amber-700';
    case 'meter_drift': return 'bg-purple-100 text-purple-700';
    case 'delivery_variance': return 'bg-cyan-100 text-cyan-700';
    default: return 'bg-gray-100 text-gray-600';
  }
};

const varianceLabel = (cat: string) => VARIANCE_CATEGORIES.find(c => c.value === cat)?.label.split(' (')[0] || cat;

function fileToInvoicePayload(file: File): Promise<{ file_name: string; mime_type: string; data_base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve({
        file_name: file.name,
        mime_type: file.type || 'application/pdf',
        data_base64: result.includes(',') ? result.split(',')[1] : result,
      });
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read invoice PDF'));
    reader.readAsDataURL(file);
  });
}

export default function TankStock() {
  const [tanks, setTanks] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [dips, setDips] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [suppliersList, setSuppliersList] = useState<any[]>([]);
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [loading, setLoading] = useState(true);
  const { id: tankParam } = useParams();
  const navigate = useNavigate();
  const [tankTab, setTankTab] = useState<'ledger' | 'dips' | 'deliveries' | 'adjustments'>('ledger');
  const [ledgerData, setLedgerData] = useState<any[]>([]);
  const [trendsData, setTrendsData] = useState<any[]>([]);
  const selectedTank = tanks.find((t: any) => String(t.id) === tankParam) || null;

  // Modal state
  const [tankModal, setTankModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  // During an open shift only the order level of an existing tank can change.
  const lockTankDetails = hasOpenShift && !!tankModal.editing;
  const [deliveryModal, setDeliveryModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [dipModal, setDipModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [adjustmentModal, setAdjustmentModal] = useState<{ open: boolean }>({ open: false });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; item: any } | null>(null);

  const [tankForm, setTankForm] = useState(emptyTankForm);
  const [deliveryForm, setDeliveryForm] = useState(emptyDeliveryForm);
  const [deliveryInvoiceFile, setDeliveryInvoiceFile] = useState<File | null>(null);
  const [dipForm, setDipForm] = useState(emptyDipForm);
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustmentForm);
  const [deliveryWarnings, setDeliveryWarnings] = useState<string[]>([]);
  const [dipWarnings, setDipWarnings] = useState<string[]>([]);
  const [adjustmentWarnings, setAdjustmentWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
    getTankDipTrends(6).then(res => setTrendsData(res.data.data || [])).catch(() => setTrendsData([]));
  }, []);

  useEffect(() => {
    setTankTab('ledger');
    if (tankParam) loadTank(tankParam);
  }, [tankParam]);

  // The open tank's ledger and adjustments (per tank on the server).
  async function loadTank(tankId: string) {
    const [ledgerRes, adjustmentsRes] = await Promise.all([
      getTankLedger(parseInt(tankId)).catch(() => null),
      getTankAdjustments(parseInt(tankId)).catch(() => null),
    ]);
    setLedgerData(ledgerRes?.data.data || []);
    setAdjustments(adjustmentsRes?.data.data || []);
  }

  async function loadData() {
    if (tankParam) loadTank(tankParam);
    try {
      const [tanksRes, deliveriesRes, dipsRes, shiftRes, suppliersRes] = await Promise.all([
        getTanks(),
        getFuelDeliveries(),
        getTankDips(),
        getCurrentShift(),
        getSuppliers(),
      ]);
      setTanks(tanksRes.data.data || []);
      setDeliveries(deliveriesRes.data.data || []);
      setDips(dipsRes.data.data || []);
      setHasOpenShift(!!(shiftRes.data.data));
      setSuppliersList(suppliersRes.data.data || []);
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
    setTankForm({
      label: tank.label,
      fuel_type: tank.fuel_type,
      capacity_litres: String(tank.capacity_litres),
      reorder_level_litres: tank.reorder_level_litres == null ? '' : String(Number(tank.reorder_level_litres)),
    });
    setError('');
    setTankModal({ open: true, editing: tank });
  }
  async function handleSaveTank(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        ...tankForm,
        capacity_litres: parseFloat(tankForm.capacity_litres),
        reorder_level_litres: tankForm.reorder_level_litres === '' ? null : parseFloat(tankForm.reorder_level_litres),
      };
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
    const tank = selectedTank || tanks[0];
    setDeliveryForm({ ...emptyDeliveryForm, tank_id: tank ? String(tank.id) : '', date: today() });
    setDeliveryInvoiceFile(null);
    setError('');
    setDeliveryWarnings([]);
    setDeliveryModal({ open: true, editing: null });
  }
  function openEditDelivery(d: any) {
    const pendingPrice = d.pricing_status === 'pending_price' || Number(d.cost_per_litre || 0) <= 0;
    setDeliveryForm({
      tank_id: String(d.tank_id),
      supplier_id: d.supplier_id ? String(d.supplier_id) : '',
      litres: String(d.litres),
      cost_per_litre: pendingPrice ? '' : String(d.cost_per_litre),
      date: d.date,
      invoice_number: d.invoice_number || '',
    });
    setDeliveryInvoiceFile(null);
    setError('');
    setDeliveryWarnings([]);
    setDeliveryModal({ open: true, editing: d });
  }
  async function handleSaveDelivery(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setDeliveryWarnings([]);
    try {
      if (!deliveryForm.supplier_id) {
        throw new Error('Select an existing supplier account before recording a delivery.');
      }
      const parsedCost = deliveryForm.cost_per_litre === '' ? undefined : parseFloat(deliveryForm.cost_per_litre);
      const payload: any = {
        tank_id: parseInt(deliveryForm.tank_id),
        supplier_id: parseInt(deliveryForm.supplier_id),
        litres: parseFloat(deliveryForm.litres),
        date: deliveryForm.date,
        invoice_number: deliveryForm.invoice_number || null,
      };
      if (parsedCost !== undefined) payload.cost_per_litre = parsedCost;
      let savedId: number | undefined;
      let warnings: string[] = [];
      if (deliveryModal.editing) {
        const res = await updateFuelDelivery(deliveryModal.editing.id, payload);
        savedId = res.data.data?.id || deliveryModal.editing.id;
        warnings = res.data.warnings || [];
      } else {
        const res = await createFuelDelivery(payload);
        savedId = res.data.data?.id;
        warnings = res.data.warnings || [];
      }
      if (deliveryInvoiceFile && savedId) {
        await uploadFuelDeliveryInvoiceDocument(savedId, await fileToInvoicePayload(deliveryInvoiceFile));
      }
      setDeliveryWarnings(warnings);
      setDeliveryModal({ open: false, editing: null });
      setDeliveryInvoiceFile(null);
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to save delivery');
    } finally { setSaving(false); }
  }

  async function handleOpenDeliveryInvoice(d: any) {
    try {
      const res = await getFuelDeliveryInvoiceDocument(d.id);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to open invoice PDF');
    }
  }

  // ── Dips ───────────────────────────────────────────
  function openAddDip(tank?: any) {
    setDipForm({ ...emptyDipForm, tank_id: tank ? String(tank.id) : tanks.length > 0 ? String(tanks[0].id) : '', dip_date: today() });
    setError('');
    setDipWarnings([]);
    setDipModal({ open: true, editing: null });
  }
  function openEditDip(d: any) {
    setDipForm({
      tank_id: String(d.tank_id),
      measured_litres: String(d.measured_litres),
      dip_date: d.dip_date || today(),
      variance_category: d.variance_category || 'unclassified',
      variance_notes: d.variance_notes || '',
    });
    setError('');
    setDipWarnings([]);
    setDipModal({ open: true, editing: d });
  }
  async function handleSaveDip(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setDipWarnings([]);
    try {
      const payload = {
        tank_id: parseInt(dipForm.tank_id),
        measured_litres: parseFloat(dipForm.measured_litres),
        dip_date: dipForm.dip_date,
        variance_category: dipForm.variance_category,
        variance_notes: dipForm.variance_notes || null,
      };
      const res = dipModal.editing
        ? await updateTankDip(dipModal.editing.id, payload)
        : await createTankDip(payload);
      const warnings: string[] = res?.data?.warnings || [];
      if (warnings.length > 0) {
        setDipWarnings(warnings);
        loadData();
      } else {
        setDipModal({ open: false, editing: null });
        loadData();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save dip');
    } finally { setSaving(false); }
  }

  // ── Adjustments ────────────────────────────────────
  function openAddAdjustment() {
    const tankId = selectedTank ? String(selectedTank.id) : (tanks.length > 0 ? String(tanks[0].id) : '');
    setAdjustmentForm({ ...emptyAdjustmentForm, tank_id: tankId });
    setAdjustmentWarnings([]);
    setError('');
    setAdjustmentModal({ open: true });
  }

  function handleAdjustmentTankChange(tankId: string) {
    setAdjustmentForm({ ...emptyAdjustmentForm, tank_id: tankId });
  }

  function handleAdjustmentDipChange(dipId: string) {
    const dip = dips.find((d: any) => String(d.id) === dipId);
    const change = dip ? Number(dip.variance_litres || 0) : 0;
    const reasons = change > 0 ? POSITIVE_ADJUSTMENT_REASONS : change < 0 ? NEGATIVE_ADJUSTMENT_REASONS : [];
    setAdjustmentForm({
      ...adjustmentForm,
      reference_dip_id: dipId,
      reason: reasons[0]?.value || '',
      cost_per_litre: '',
    });
  }

  async function handleSaveAdjustment(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(''); setAdjustmentWarnings([]);
    try {
      const payload: any = {
        reference_dip_id: parseInt(adjustmentForm.reference_dip_id),
        reason: adjustmentForm.reason,
        notes: adjustmentForm.notes,
      };
      if (adjustmentForm.cost_per_litre) payload.cost_per_litre = parseFloat(adjustmentForm.cost_per_litre);
      const res = await createTankAdjustment(parseInt(adjustmentForm.tank_id), payload);
      setAdjustmentWarnings(res.data.warnings || []);
      setAdjustmentModal({ open: false });
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to post adjustment');
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    setSaving(true); setError('');
    try {
      if (deleteConfirm.type === 'tank') { await deleteTank(deleteConfirm.item.id); navigate('/tank-stock'); }
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
  const litres1 = (n: any) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 1 });
  const isPendingDeliveryPrice = (d: any) => d.pricing_status === 'pending_price' || Number(d.cost_per_litre || 0) <= 0;
  const deliveryCostLabel = (d: any) => isPendingDeliveryPrice(d) ? 'Pending' : formatKES(Number(d.cost_per_litre));
  const deliveryTotalLabel = (d: any) => isPendingDeliveryPrice(d) ? 'Pending' : formatKES(Number(d.total_cost));
  const fmtDate = (s: string) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const adjustmentTankDips = adjustmentForm.tank_id
    ? dips.filter((d: any) => String(d.tank_id) === String(adjustmentForm.tank_id))
    : [];
  const selectedAdjustmentDip = adjustmentTankDips.find((d: any) => String(d.id) === String(adjustmentForm.reference_dip_id));
  const adjustmentChange = selectedAdjustmentDip ? Number(selectedAdjustmentDip.variance_litres || 0) : 0;
  const adjustmentReasonOptions = adjustmentChange > 0
    ? POSITIVE_ADJUSTMENT_REASONS
    : adjustmentChange < 0
      ? NEGATIVE_ADJUSTMENT_REASONS
      : [];
  const adjustmentNotesRequired = adjustmentForm.reason === 'other_gain' || adjustmentForm.reason === 'other_loss';

  if (loading) return <div className="text-gray-500">Loading...</div>;

  const tankTone = (tank: any) => {
    const stock = Number(tank.stock_now_litres ?? tank.current_stock_litres ?? 0);
    const pct = Math.min(100, Math.max(0, (stock / Math.max(1, Number(tank.capacity_litres || 1))) * 100));
    return { stock, pct, low: isLowStock(tank), bar: isLowStock(tank) || stock < 0 ? 'bg-red-500' : pct <= 25 ? 'bg-amber-400' : 'bg-blue-600' };
  };
  const fuelPill = (fuel: string) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${fuel === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{fuel}</span>
  );
  const LEDGER_EVENTS: Record<string, string> = { delivery: 'Delivery', shift_sale: 'Shift sales', stock_adjustment: 'Adjustment', adjustment: 'Adjustment' };

  const deliveriesTable = (rows: any[], showTank: boolean) => (
    <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left p-3 font-semibold text-gray-600">Date</th>
            {showTank && <th className="text-left p-3 font-semibold text-gray-600">Tank</th>}
            <th className="text-right p-3 font-semibold text-gray-600">Litres</th>
            <th className="text-right p-3 font-semibold text-gray-600">Cost/L</th>
            <th className="text-right p-3 font-semibold text-gray-600">Total</th>
            <th className="text-left p-3 font-semibold text-gray-600">Supplier</th>
            <th className="text-left p-3 font-semibold text-gray-600">Invoice</th>
            <th className="p-3 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d: any) => (
            <tr key={d.id} className="border-t hover:bg-gray-50">
              <td className="p-3 whitespace-nowrap">{fmtDate(d.date)}</td>
              {showTank && <td className="p-3 font-medium">{d.tank_label || `Tank #${d.tank_id}`}</td>}
              <td className="p-3 text-right tabular-nums">{fmt(d.litres)}</td>
              <td className={`p-3 text-right tabular-nums whitespace-nowrap ${isPendingDeliveryPrice(d) ? 'text-amber-600 font-medium' : ''}`}>{deliveryCostLabel(d)}</td>
              <td className={`p-3 text-right tabular-nums whitespace-nowrap font-medium ${isPendingDeliveryPrice(d) ? 'text-amber-600' : ''}`}>{deliveryTotalLabel(d)}</td>
              <td className="p-3 text-gray-600">{d.supplier_name || d.supplier || '—'}</td>
              <td className="p-3 text-gray-600">
                <div className="flex items-center gap-2">
                  {d.invoice_number && <span>{d.invoice_number}</span>}
                  {d.invoice_file_path && (
                    <button type="button" onClick={() => handleOpenDeliveryInvoice(d)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                      <FileText size={13} /> PDF
                    </button>
                  )}
                </div>
              </td>
              <td className="p-3">
                <div className="flex gap-1 justify-end">
                  <button onClick={() => openEditDelivery(d)} className="p-1 text-gray-400 hover:text-blue-600 rounded" title="Edit delivery"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteConfirm({ type: 'delivery', item: d })} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Delete delivery"><Trash2 size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={showTank ? 8 : 7} className="p-8 text-center text-gray-400">No deliveries yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  // The tank on screen (from /tank-stock/:id); without one the page lists all deliveries.
  const tankDips = selectedTank ? dips.filter((d: any) => d.tank_id === selectedTank.id) : [];
  const tankDeliveries = selectedTank ? deliveries.filter((d: any) => d.tank_id === selectedTank.id) : deliveries;
  const lastDip = tankDips[0];
  const lastDipRaw = lastDip?.variance_litres != null ? Number(lastDip.variance_litres) : null;
  const lastDipVariance = lastDipRaw != null && Math.abs(lastDipRaw) < 0.05 ? 0 : lastDipRaw;
  const tankTrend = selectedTank ? (trendsData.find((t: any) => t.tank_id === selectedTank.id)?.series || []) : [];

  return (
    <div>
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
      )}

      {deliveryWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          {deliveryWarnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      {adjustmentWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          {adjustmentWarnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      <div className="flex gap-5 items-start">
        {/* Tanks list */}
        <aside className="w-64 shrink-0 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-gray-100">
            <h1 className="text-xl font-bold text-gray-800">Stock</h1>
            <button
              onClick={openAddDelivery}
              disabled={tanks.length === 0 || suppliersList.length === 0}
              title={suppliersList.length === 0 ? 'Add a supplier first' : undefined}
              className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 text-sm font-semibold disabled:opacity-50"
            >
              <Truck size={15} /> Record delivery
            </button>
          </div>
          {tanks.map((tank: any) => {
            const t = tankTone(tank);
            const on = selectedTank?.id === tank.id;
            return (
              <button key={tank.id} type="button" onClick={() => navigate(`/tank-stock/${tank.id}`)}
                className={`w-full block px-4 py-3 text-left text-sm border-b border-gray-100 ${on ? 'bg-blue-50 font-semibold text-blue-800' : 'hover:bg-gray-50'}`}>
                <span className="flex justify-between gap-2">
                  <span className="truncate">{tank.label}</span>
                  <span className={`tabular-nums ${t.low || t.stock < 0 ? 'text-red-600 font-semibold' : ''}`}>{fmt(t.stock)} L</span>
                </span>
                <span className="mt-1.5 block h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <span className={`block h-full ${t.bar}`} style={{ width: `${t.pct}%` }} />
                </span>
              </button>
            );
          })}
          <button type="button" onClick={() => navigate('/tank-stock')}
            className={`w-full block px-4 py-3 text-left text-sm border-b border-gray-100 ${!selectedTank ? 'bg-blue-50 font-semibold text-blue-800' : 'text-blue-700 hover:bg-gray-50'}`}>
            All deliveries
          </button>
          <button type="button" onClick={openAddTank} className="w-full flex items-center gap-1.5 px-4 py-3 text-left text-sm text-gray-500 hover:bg-gray-50">
            <Plus size={14} /> Add tank
          </button>
        </aside>

        <section className="flex-1 min-w-0 space-y-4">
          {!selectedTank && (
            <>
              <h2 className="text-xl font-bold text-gray-800">All deliveries</h2>
              {suppliersList.length === 0 && (
                <p className="text-sm text-amber-700">Add a supplier before recording deliveries.</p>
              )}
              {deliveriesTable(deliveries, true)}
            </>
          )}

          {selectedTank && (
            <>
              <header className="bg-white border border-gray-200 rounded-lg p-5 flex flex-wrap items-center gap-8">
                <div className="flex-1 min-w-[200px]">
                  <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">{selectedTank.label} {fuelPill(selectedTank.fuel_type)}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">{fmt(selectedTank.capacity_litres)} L · {tankTone(selectedTank).pct.toFixed(0)}% full</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500">In the tank now</p>
                  <p className={`text-xl font-bold tabular-nums ${tankTone(selectedTank).low ? 'text-red-600' : 'text-gray-800'}`}>{fmt(tankTone(selectedTank).stock)} L</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500">Order at</p>
                  <p className="text-xl font-bold tabular-nums text-gray-800">{selectedTank.reorder_level_litres == null ? '—' : `${fmt(selectedTank.reorder_level_litres)} L`}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500">Last dip{lastDip ? ` · ${fmtDate(lastDip.dip_date)}` : ''}</p>
                  <p className={`text-xl font-bold tabular-nums ${lastDipVariance == null ? 'text-gray-400' : lastDipVariance < 0 ? 'text-red-600' : lastDipVariance > 0 ? 'text-green-600' : 'text-gray-800'}`}>
                    {lastDipVariance == null ? '—' : `${lastDipVariance > 0 ? '+' : ''}${litres1(lastDipVariance)} L`}
                  </p>
                </div>
              </header>

              <div className="flex flex-wrap items-center justify-between gap-3">
                {hasOpenShift
                  ? <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700"><AlertTriangle size={13} /> Shift open: adjustments wait until it closes</span>
                  : <span />}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openAddDip(selectedTank)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-semibold">
                    <Droplets size={16} /> Record dip
                  </button>
                  <button onClick={openAddAdjustment} disabled={hasOpenShift} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50">
                    <SlidersHorizontal size={16} /> Adjust
                  </button>
                  <button onClick={() => openEditTank(selectedTank)} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm">
                    <Pencil size={16} /> Edit
                  </button>
                  {!hasOpenShift && (
                    <button onClick={() => setDeleteConfirm({ type: 'tank', item: selectedTank })} className="p-2 text-gray-400 hover:text-red-500 rounded-lg" title="Delete tank"><Trash2 size={16} /></button>
                  )}
                </div>
              </div>

              <nav className="flex gap-1 border-b border-gray-200" aria-label="Tank sections">
                {([['ledger', 'Stock ledger'], ['dips', 'Dips'], ['deliveries', 'Deliveries'], ['adjustments', 'Adjustments']] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setTankTab(id)}
                    className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tankTab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                    {label}
                  </button>
                ))}
              </nav>

              {tankTab === 'ledger' && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 font-semibold text-gray-600">When</th>
                        <th className="text-left p-3 font-semibold text-gray-600">What</th>
                        <th className="text-right p-3 font-semibold text-gray-600">Litres</th>
                        <th className="text-right p-3 font-semibold text-gray-600">Balance</th>
                        <th className="text-left p-3 font-semibold text-gray-600">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerData.map((entry: any) => {
                        const change = parseFloat(entry.litres_change);
                        return (
                          <tr key={entry.id} className="border-t hover:bg-gray-50">
                            <td className="p-3 text-gray-500 whitespace-nowrap">{new Date(entry.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="p-3 font-medium">{LEDGER_EVENTS[entry.event_type] || entry.event_type.replace(/_/g, ' ')}</td>
                            <td className={`p-3 text-right tabular-nums font-medium ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>{change >= 0 ? '+' : ''}{litres1(change)}</td>
                            <td className="p-3 text-right tabular-nums font-medium">{litres1(entry.balance_after)}</td>
                            <td className="p-3 text-xs text-gray-500">{entry.notes || ''}</td>
                          </tr>
                        );
                      })}
                      {ledgerData.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nothing yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              {tankTab === 'dips' && (
                <>
                  {tankTrend.length > 1 && tankTrend.some((s: any) => Number(s.cumulative_variance_pct) !== 0) && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Variance by month (%)</p>
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={tankTrend}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="month" tickFormatter={(m: string) => new Date(`${m}-01`).toLocaleDateString('en-KE', { month: 'short' })} />
                          <YAxis tickFormatter={(v: number) => `${v}%`} width={48} />
                          <Tooltip
                            formatter={(value: number) => [value == null ? '—' : `${value}%`, 'Variance']}
                            labelFormatter={(m: string) => new Date(`${m}-01`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })} />
                          <Line type="monotone" dataKey="cumulative_variance_pct" stroke="#087F8C" connectNulls dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {hasOpenShift && <p className="text-xs text-amber-700">Book stock leaves out the open shift's sales until it closes.</p>}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left p-3 font-semibold text-gray-600">Date</th>
                          <th className="text-right p-3 font-semibold text-gray-600">Measured</th>
                          <th className="text-right p-3 font-semibold text-gray-600">Book</th>
                          <th className="text-right p-3 font-semibold text-gray-600">Difference</th>
                          <th className="text-left p-3 font-semibold text-gray-600">Reason</th>
                          <th className="p-3 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {tankDips.map((d: any) => {
                          const v = d.variance_litres != null ? parseFloat(d.variance_litres) : null;
                          const cat = d.variance_category || 'unclassified';
                          return (
                            <tr key={d.id} className="border-t hover:bg-gray-50">
                              <td className="p-3 font-medium">{fmtDate(d.dip_date)}</td>
                              <td className="p-3 text-right tabular-nums font-medium">{fmt(d.measured_litres)}</td>
                              <td className="p-3 text-right tabular-nums text-gray-500">{d.book_stock_at_dip != null ? fmt(d.book_stock_at_dip) : '—'}</td>
                              <td className={`p-3 text-right tabular-nums font-medium ${v !== null && Math.abs(v) >= 0.05 ? (v < 0 ? 'text-red-600' : 'text-green-600') : 'text-gray-400'}`}>
                                {v === null ? '—' : Math.abs(v) < 0.05 ? '0 L' : `${v > 0 ? '+' : ''}${v.toFixed(1)} L`}
                              </td>
                              <td className="p-3">
                                {cat !== 'unclassified' && <span className={`px-2 py-0.5 rounded text-xs font-medium ${variancePillClass(cat)}`}>{varianceLabel(cat)}</span>}
                                {d.variance_notes && <p className="text-xs text-gray-400 mt-1 truncate max-w-[220px]" title={d.variance_notes}>{d.variance_notes}</p>}
                              </td>
                              <td className="p-3">
                                <div className="flex gap-1 justify-end">
                                  <button onClick={() => openEditDip(d)} className="p-1 text-gray-400 hover:text-blue-600 rounded" title="Edit dip"><Pencil size={14} /></button>
                                  <button onClick={() => setDeleteConfirm({ type: 'dip', item: d })} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Delete dip"><Trash2 size={14} /></button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {tankDips.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">No dips yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {tankTab === 'deliveries' && deliveriesTable(tankDeliveries, false)}

              {tankTab === 'adjustments' && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 font-semibold text-gray-600">Date</th>
                        <th className="text-left p-3 font-semibold text-gray-600">Dip</th>
                        <th className="text-left p-3 font-semibold text-gray-600">Reason</th>
                        <th className="text-right p-3 font-semibold text-gray-600">Litres</th>
                        <th className="text-right p-3 font-semibold text-gray-600">Cost/L</th>
                        <th className="text-left p-3 font-semibold text-gray-600">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjustments.map((a: any) => (
                        <tr key={a.id} className="border-t hover:bg-gray-50">
                          <td className="p-3">{fmtDate(a.adjustment_date)}</td>
                          <td className="p-3 text-gray-500">
                            {a.reference_dip_id ? `${fmt(a.reference_dip_litres)} L${a.reference_dip_date ? ` on ${fmtDate(a.reference_dip_date)}` : ''}` : '—'}
                          </td>
                          <td className="p-3">
                            {ADJUSTMENT_REASONS.find(r => r.value === a.reason)?.label || a.reason}
                            {a.notes && <p className="text-xs text-gray-400 mt-0.5">{a.notes}</p>}
                          </td>
                          <td className={`p-3 text-right tabular-nums font-medium ${Number(a.litres_change) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {Number(a.litres_change) >= 0 ? '+' : ''}{Number(a.litres_change).toFixed(1)}
                          </td>
                          <td className="p-3 text-right tabular-nums">{a.cost_per_litre != null ? formatKES(Number(a.cost_per_litre)) : '—'}</td>
                          <td className="p-3 text-gray-500">{a.created_by_name || 'System'}</td>
                        </tr>
                      ))}
                      {adjustments.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">No adjustments.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>

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
              {lockTankDetails && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Shift open: only the order level can change.</p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input type="text" required disabled={lockTankDetails} value={tankForm.label} onChange={e => setTankForm({ ...tankForm, label: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fuel Type *</label>
                <select disabled={lockTankDetails} value={tankForm.fuel_type} onChange={e => setTankForm({ ...tankForm, fuel_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100">
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Capacity (Litres) *</label>
                <input type="number" required min="1" disabled={lockTankDetails} value={tankForm.capacity_litres} onChange={e => setTankForm({ ...tankForm, capacity_litres: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100" placeholder="e.g. 20000" />
              </div>
              <OrderLevelField
                value={tankForm.reorder_level_litres}
                onChange={(value) => setTankForm({ ...tankForm, reorder_level_litres: value })}
                capacity={parseFloat(tankForm.capacity_litres) || 0}
                avgDailyLitres={tankModal.editing?.avg_daily_litres}
                inputClassName="w-full border border-gray-300 rounded-lg p-2"
              />
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost per Litre (KES)</label>
                  <input type="number" step="0.01" min="0" value={deliveryForm.cost_per_litre} onChange={e => setDeliveryForm({ ...deliveryForm, cost_per_litre: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" placeholder="Pending" />
                </div>
              </div>
              {deliveryForm.litres && deliveryForm.cost_per_litre && (
                <div className="bg-blue-50 rounded-lg p-2 text-sm text-blue-700 font-medium">
                  Total: KES {(parseFloat(deliveryForm.litres || '0') * parseFloat(deliveryForm.cost_per_litre || '0')).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </div>
              )}
              {deliveryForm.litres && !deliveryForm.cost_per_litre && (
                <div className="bg-amber-50 rounded-lg p-2 text-sm text-amber-700">
                  No price: no supplier bill yet.
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
                <select required value={deliveryForm.supplier_id}
                  onChange={e => setDeliveryForm({ ...deliveryForm, supplier_id: e.target.value })}
                  disabled={suppliersList.length === 0}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100">
                  <option value="">-- Select Supplier --</option>
                  {suppliersList.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice number</label>
                <input type="text" value={deliveryForm.invoice_number} onChange={e => setDeliveryForm({ ...deliveryForm, invoice_number: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice PDF</label>
                <input type="file" accept="application/pdf,.pdf" onChange={e => setDeliveryInvoiceFile(e.target.files?.[0] || null)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                {deliveryModal.editing?.invoice_file_name && !deliveryInvoiceFile && (
                  <p className="text-xs text-gray-500 mt-1">Current PDF: {deliveryModal.editing.invoice_file_name}</p>
                )}
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setDeliveryModal({ open: false, editing: null })} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving || !deliveryForm.supplier_id} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Litres measured *</label>
                <input type="number" required step="0.01" min="0" value={dipForm.measured_litres} onChange={e => setDipForm({ ...dipForm, measured_litres: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason for difference</label>
                <select value={dipForm.variance_category} onChange={e => setDipForm({ ...dipForm, variance_category: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  {VARIANCE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {dipWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-amber-800 space-y-1">
                      {dipWarnings.map((w, i) => <p key={i}>{w}</p>)}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => { setDipModal({ open: false, editing: null }); setDipWarnings([]); }} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">{dipWarnings.length > 0 ? 'Close' : 'Cancel'}</button>
                {dipWarnings.length === 0 && (
                  <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving...' : dipModal.editing ? 'Save Changes' : 'Record'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjustment Modal */}
      {adjustmentModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Post Stock Adjustment</h2>
              <button onClick={() => setAdjustmentModal({ open: false })} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <form onSubmit={handleSaveAdjustment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tank *</label>
                <select required value={adjustmentForm.tank_id} onChange={e => handleAdjustmentTankChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  <option value="">-- Select Tank --</option>
                  {tanks.map((t: any) => <option key={t.id} value={t.id}>{t.label} ({t.fuel_type})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference Dip *</label>
                <select required value={adjustmentForm.reference_dip_id} onChange={e => handleAdjustmentDipChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  <option value="">-- Select dip reading --</option>
                  {adjustmentTankDips.map((d: any) => {
                    const change = Number(d.variance_litres || 0);
                    const adjusted = !!d.adjustment_id;
                    return (
                      <option key={d.id} value={d.id} disabled={adjusted || Math.abs(change) < 0.01}>
                        {fmtDate(d.dip_date)} - {fmt(d.measured_litres)} L ({change >= 0 ? '+' : ''}{change.toFixed(1)} L){adjusted ? ' - already adjusted' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
                <select required value={adjustmentForm.reason} onChange={e => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })}
                  disabled={!selectedAdjustmentDip || adjustmentReasonOptions.length === 0}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100">
                  <option value="">-- Select reason --</option>
                  {adjustmentReasonOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              {selectedAdjustmentDip && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Book at dip</span>
                    <span className="font-medium">{fmt(selectedAdjustmentDip.book_stock_at_dip)} L</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Dip reading</span>
                    <span className="font-medium">{fmt(selectedAdjustmentDip.measured_litres)} L</span>
                  </div>
                  <div className={`flex justify-between font-semibold ${adjustmentChange >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    <span>Adjustment to post</span>
                    <span>{adjustmentChange >= 0 ? '+' : ''}{adjustmentChange.toFixed(2)} L</span>
                  </div>
                </div>
              )}
              {adjustmentChange > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost per litre</label>
                  <input type="number" step="0.01" min="0" value={adjustmentForm.cost_per_litre}
                    onChange={e => setAdjustmentForm({ ...adjustmentForm, cost_per_litre: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" placeholder="Latest cost" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Details {adjustmentNotesRequired ? '*' : ''}
                </label>
                <textarea rows={3} required={adjustmentNotesRequired} value={adjustmentForm.notes}
                  onChange={e => setAdjustmentForm({ ...adjustmentForm, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setAdjustmentModal({ open: false })} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving || !adjustmentForm.reference_dip_id || !adjustmentForm.reason || Math.abs(adjustmentChange) < 0.01 || (adjustmentNotesRequired && adjustmentForm.notes.trim().length < 3)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Posting...' : 'Post Adjustment'}
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
