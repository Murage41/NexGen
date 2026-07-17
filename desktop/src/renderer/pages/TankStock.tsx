import { useState, useEffect } from 'react';
import {
  getTanks, createTank, updateTank, deleteTank,
  getFuelDeliveries, createFuelDelivery, updateFuelDelivery, deleteFuelDelivery,
  uploadFuelDeliveryInvoiceDocument, getFuelDeliveryInvoiceDocument,
  getTankDips, createTankDip, updateTankDip, deleteTankDip,
  getCurrentShift, getTankLedger, getSuppliers, getTankAdjustments, createTankAdjustment,
} from '../services/api';
import { Plus, Database, X, Truck, Droplets, Pencil, Trash2, AlertTriangle, BookOpen, SlidersHorizontal, FileText } from 'lucide-react';
import { getKenyaDate } from '../utils/timezone';

const today = () => getKenyaDate();

const emptyTankForm = { label: '', fuel_type: 'petrol', capacity_litres: '' };
const emptyDeliveryForm = { tank_id: '', supplier_id: '', litres: '', cost_per_litre: '', date: today(), delivery_time: '', invoice_number: '' };
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
  const [activeTab, setActiveTab] = useState<'tanks' | 'deliveries' | 'dips' | 'adjustments' | 'ledger'>('tanks');
  const [ledgerData, setLedgerData] = useState<any[]>([]);
  const [ledgerTankId, setLedgerTankId] = useState<string>('');
  const [adjustmentTankId, setAdjustmentTankId] = useState<string>('');

  // Modal state
  const [tankModal, setTankModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [deliveryModal, setDeliveryModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [dipModal, setDipModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [adjustmentModal, setAdjustmentModal] = useState<{ open: boolean }>({ open: false });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; item: any } | null>(null);

  const [tankForm, setTankForm] = useState(emptyTankForm);
  const [deliveryForm, setDeliveryForm] = useState(emptyDeliveryForm);
  const [deliveryInvoiceFile, setDeliveryInvoiceFile] = useState<File | null>(null);
  const [dipForm, setDipForm] = useState(emptyDipForm);
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustmentForm);
  const [dipWarnings, setDipWarnings] = useState<string[]>([]);
  const [adjustmentWarnings, setAdjustmentWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
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
    setDeliveryInvoiceFile(null);
    setError('');
    setDeliveryModal({ open: true, editing: null });
  }
  function openEditDelivery(d: any) {
    setDeliveryForm({
      tank_id: String(d.tank_id),
      supplier_id: d.supplier_id ? String(d.supplier_id) : '',
      litres: String(d.litres),
      cost_per_litre: String(d.cost_per_litre),
      date: d.date,
      delivery_time: d.delivery_timestamp
        ? String(d.delivery_timestamp).slice(11, 16)
        : '',
      invoice_number: d.invoice_number || '',
    });
    setDeliveryInvoiceFile(null);
    setError('');
    setDeliveryModal({ open: true, editing: d });
  }
  async function handleSaveDelivery(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (!deliveryForm.supplier_id) {
        throw new Error('Select an existing supplier account before recording a delivery.');
      }
      const payload: any = {
        tank_id: parseInt(deliveryForm.tank_id),
        supplier_id: parseInt(deliveryForm.supplier_id),
        litres: parseFloat(deliveryForm.litres),
        cost_per_litre: parseFloat(deliveryForm.cost_per_litre),
        date: deliveryForm.date,
        invoice_number: deliveryForm.invoice_number || null,
        ...(deliveryForm.delivery_time ? { delivery_time: deliveryForm.delivery_time } : {}),
      };
      let savedId: number | undefined;
      if (deliveryModal.editing) {
        const res = await updateFuelDelivery(deliveryModal.editing.id, payload);
        savedId = res.data.data?.id || deliveryModal.editing.id;
      } else {
        const res = await createFuelDelivery(payload);
        savedId = res.data.data?.id;
      }
      if (deliveryInvoiceFile && savedId) {
        await uploadFuelDeliveryInvoiceDocument(savedId, await fileToInvoicePayload(deliveryInvoiceFile));
      }
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
  function openAddDip() {
    setDipForm({ ...emptyDipForm, tank_id: tanks.length > 0 ? String(tanks[0].id) : '', dip_date: today() });
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

  // ── Delete ─────────────────────────────────────────
  async function loadAdjustments(tankId: string) {
    if (!tankId) {
      setAdjustments([]);
      return;
    }
    try {
      const res = await getTankAdjustments(parseInt(tankId));
      setAdjustments(res.data.data || []);
    } catch {
      setAdjustments([]);
    }
  }

  function openAddAdjustment() {
    const tankId = adjustmentTankId || (tanks.length > 0 ? String(tanks[0].id) : '');
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
      setAdjustmentTankId(adjustmentForm.tank_id);
      await Promise.all([loadData(), loadAdjustments(adjustmentForm.tank_id)]);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to post adjustment');
    } finally { setSaving(false); }
  }

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
  const adjustmentProjectedStock = selectedAdjustmentDip ? Number(selectedAdjustmentDip.measured_litres || 0) : null;

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

      {adjustmentWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          {adjustmentWarnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
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
          {(['tanks', 'deliveries', 'dips', 'adjustments', 'ledger'] as const).map(tab => (
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
            <button
              onClick={openAddDelivery}
              disabled={tanks.length === 0 || suppliersList.length === 0}
              title={suppliersList.length === 0 ? 'Create a supplier account first' : undefined}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
            >
              <Truck size={16} /> Record Delivery
            </button>
          )}
          {activeTab === 'dips' && (
            <button onClick={openAddDip} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">
              <Droplets size={16} /> Record Dip
            </button>
          )}
          {activeTab === 'adjustments' && (
            <button onClick={openAddAdjustment} disabled={hasOpenShift || tanks.length === 0} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50">
              <SlidersHorizontal size={16} /> Post Adjustment
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
          {suppliersList.length === 0 && (
            <div className="p-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 flex items-center gap-1">
              <AlertTriangle size={12} /> Create a supplier account before recording fuel deliveries.
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Tank</th>
                <th className="text-right p-3 font-medium text-gray-600">Litres</th>
                <th className="text-right p-3 font-medium text-gray-600">Cost/L</th>
                <th className="text-right p-3 font-medium text-gray-600">Total Cost</th>
                <th className="text-left p-3 font-medium text-gray-600">Supplier</th>
                <th className="text-left p-3 font-medium text-gray-600">Invoice</th>
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
                  <td className="p-3 text-gray-600">{d.supplier_name || d.supplier || '—'}</td>
                  <td className="p-3 text-gray-600">
                    <div className="flex items-center gap-2">
                      <span>{d.invoice_number || '-'}</span>
                      {d.invoice_file_path && (
                        <button
                          type="button"
                          onClick={() => handleOpenDeliveryInvoice(d)}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                        >
                          <FileText size={13} /> PDF
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEditDelivery(d)} className="p-1 text-gray-400 hover:text-blue-600 rounded"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteConfirm({ type: 'delivery', item: d })} className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {deliveries.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-gray-400">No deliveries recorded.</td></tr>}
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
                <th className="text-left p-3 font-medium text-gray-600">Category</th>
                <th className="text-left p-3 font-medium text-gray-600">Recorded At</th>
                <th className="p-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {dips.map((d: any) => {
                const v = d.variance_litres != null ? parseFloat(d.variance_litres) : null;
                const cat = d.variance_category || 'unclassified';
                return (
                  <tr key={d.id} className={`border-t hover:bg-gray-50 ${v !== null && Math.abs(v) > 0 ? (v < -50 ? 'bg-red-50' : '') : ''}`}>
                    <td className="p-3 font-medium">{fmtDate(d.dip_date)}</td>
                    <td className="p-3">{d.tank_label || `Tank #${d.tank_id}`}</td>
                    <td className="p-3 text-right font-medium">{fmt(d.measured_litres)}</td>
                    <td className="p-3 text-right text-gray-500">{d.book_stock_at_dip != null ? fmt(d.book_stock_at_dip) : '—'}</td>
                    <td className={`p-3 text-right font-medium ${v !== null ? (v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : 'text-gray-600') : ''}`}>
                      {v !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} L` : '—'}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${variancePillClass(cat)}`}>{varianceLabel(cat)}</span>
                      {d.variance_notes && <p className="text-xs text-gray-400 mt-1 truncate max-w-[180px]" title={d.variance_notes}>{d.variance_notes}</p>}
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
              {dips.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-gray-400">No dip readings recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjustments Tab */}
      {activeTab === 'adjustments' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {hasOpenShift && (
            <div className="p-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 flex items-center gap-1">
              <AlertTriangle size={12} /> Stock adjustments are disabled while a shift is open.
            </div>
          )}
          <div className="p-4 border-b flex items-center gap-3">
            <select value={adjustmentTankId} onChange={async (e) => {
              setAdjustmentTankId(e.target.value);
              await loadAdjustments(e.target.value);
            }} className="border border-gray-300 rounded-lg p-2 text-sm">
              <option value="">Select a tank...</option>
              {tanks.map((t: any) => <option key={t.id} value={t.id}>{t.label} ({t.fuel_type})</option>)}
            </select>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Reference Dip</th>
                <th className="text-left p-3 font-medium text-gray-600">Reason</th>
                <th className="text-right p-3 font-medium text-gray-600">Change (L)</th>
                <th className="text-right p-3 font-medium text-gray-600">Cost/L</th>
                <th className="text-left p-3 font-medium text-gray-600">Notes</th>
                <th className="text-left p-3 font-medium text-gray-600">By</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((a: any) => (
                <tr key={a.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">{fmtDate(a.adjustment_date)}</td>
                  <td className="p-3 text-xs text-gray-500">
                    {a.reference_dip_id ? (
                      <>
                        <span className="font-medium text-gray-700">Dip #{a.reference_dip_id}</span>
                        <span className="block">{fmt(a.reference_dip_litres)} L {a.reference_dip_date ? `on ${fmtDate(a.reference_dip_date)}` : ''}</span>
                      </>
                    ) : (
                      'Legacy/manual'
                    )}
                  </td>
                  <td className="p-3">{ADJUSTMENT_REASONS.find(r => r.value === a.reason)?.label || a.reason}</td>
                  <td className={`p-3 text-right font-medium ${Number(a.litres_change) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {Number(a.litres_change) >= 0 ? '+' : ''}{Number(a.litres_change).toFixed(1)}
                  </td>
                  <td className="p-3 text-right">{a.cost_per_litre != null ? formatKES(Number(a.cost_per_litre)) : '—'}</td>
                  <td className="p-3 text-xs text-gray-500">{a.notes}</td>
                  <td className="p-3 text-xs text-gray-500">{a.created_by_name || 'System'}</td>
                </tr>
              ))}
              {adjustments.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">{adjustmentTankId ? 'No adjustments posted for this tank.' : 'Select a tank to view adjustments.'}</td></tr>}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input type="date" required max={today()} value={deliveryForm.date} onChange={e => setDeliveryForm({ ...deliveryForm, date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time (optional)</label>
                  <input type="time" value={deliveryForm.delivery_time} onChange={e => setDeliveryForm({ ...deliveryForm, delivery_time: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" />
                  <p className="text-xs text-gray-500 mt-1">Leave blank = now. Set if delivery arrived before/after dips on the same date.</p>
                </div>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
                <select required value={deliveryForm.supplier_id}
                  onChange={e => setDeliveryForm({ ...deliveryForm, supplier_id: e.target.value })}
                  disabled={suppliersList.length === 0}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100">
                  <option value="">-- Select Supplier --</option>
                  {suppliersList.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">Deliveries must be tied to an existing supplier account and AP invoice.</p>
                {suppliersList.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">No suppliers are configured. Add the supplier account first.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number (optional)</label>
                <input type="text" value={deliveryForm.invoice_number} onChange={e => setDeliveryForm({ ...deliveryForm, invoice_number: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="Supplier invoice number" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice PDF (optional)</label>
                <input type="file" accept="application/pdf,.pdf" onChange={e => setDeliveryInvoiceFile(e.target.files?.[0] || null)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                {deliveryModal.editing?.invoice_file_name && !deliveryInvoiceFile && (
                  <p className="text-xs text-gray-500 mt-1">Current PDF: {deliveryModal.editing.invoice_file_name}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">You can edit the delivery later to add the scanned invoice.</p>
              </div>
              {deliveryModal.editing && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">⚠️ Editing will adjust the tank's stock balance accordingly.</p>
              )}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Variance Category</label>
                <select value={dipForm.variance_category} onChange={e => setDipForm({ ...dipForm, variance_category: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  {VARIANCE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">Classify any difference between book and physical stock for tracking shrinkage.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea rows={2} value={dipForm.variance_notes} onChange={e => setDipForm({ ...dipForm, variance_notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" placeholder="Optional context (incident, weather, calibration date...)" />
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
                <p className="text-xs text-gray-400 mt-1">Take a dip first. The adjustment amount is calculated from the selected dip.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason *</label>
                <select required value={adjustmentForm.reason} onChange={e => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })}
                  disabled={!selectedAdjustmentDip || adjustmentReasonOptions.length === 0}
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100">
                  <option value="">-- Select reason --</option>
                  {adjustmentReasonOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {selectedAdjustmentDip && (
                  <p className="text-xs text-gray-400 mt-1">
                    Showing {adjustmentChange > 0 ? 'positive stock gain' : adjustmentChange < 0 ? 'negative stock loss' : 'no-change'} reasons only.
                  </p>
                )}
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
                  <p className="text-xs text-gray-500 mt-2">After posting, book stock at this dip becomes {fmt(adjustmentProjectedStock)} L.</p>
                </div>
              )}
              {adjustmentChange > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost per Litre (optional)</label>
                  <input type="number" step="0.01" min="0" value={adjustmentForm.cost_per_litre}
                    onChange={e => setAdjustmentForm({ ...adjustmentForm, cost_per_litre: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2" placeholder="Leave blank to use latest batch cost" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason Details *</label>
                <textarea rows={3} required value={adjustmentForm.notes}
                  onChange={e => setAdjustmentForm({ ...adjustmentForm, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm" placeholder="Physical dip result, incident reference, approval note..." />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setAdjustmentModal({ open: false })} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving || !adjustmentForm.reference_dip_id || !adjustmentForm.reason || Math.abs(adjustmentChange) < 0.01} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
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
