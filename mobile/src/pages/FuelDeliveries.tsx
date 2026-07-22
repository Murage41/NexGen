import { useState, useEffect } from 'react';
import { Plus, Truck, Pencil, Trash2, FileText, AlertTriangle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import {
  getFuelDeliveries, createFuelDelivery, updateFuelDelivery, deleteFuelDelivery,
  getTanks, getSuppliers, uploadFuelDeliveryInvoiceDocument, getFuelDeliveryInvoiceDocument,
} from '../services/api';
import { getKenyaDate } from '../utils/timezone';
import { useAuth } from '../context/AuthContext';

const today = () => getKenyaDate();

const emptyForm = {
  tank_id: '',
  supplier_id: '',
  litres: '',
  cost_per_litre: '',
  date: today(),
  invoice_number: '',
};

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

export default function FuelDeliveries() {
  const { isAdmin } = useAuth();
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editDelivery, setEditDelivery] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [deliveriesRes, tanksRes, suppliersRes] = await Promise.all([getFuelDeliveries(), getTanks(), getSuppliers()]);
      setDeliveries(deliveriesRes.data.data || []);
      const tanksData = tanksRes.data.data || [];
      setTanks(tanksData);
      setSuppliers(suppliersRes.data.data || []);
      if (tanksData.length > 0 && !form.tank_id) {
        setForm(f => ({ ...f, tank_id: String(tanksData[0].id) }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setForm({ ...emptyForm, tank_id: tanks.length > 0 ? String(tanks[0].id) : '', date: today() });
    setInvoiceFile(null);
    setError('');
    setWarnings([]);
    setShowAdd(true);
  }

  function openEdit(delivery: any) {
    const pendingPrice = delivery.pricing_status === 'pending_price' || Number(delivery.cost_per_litre || 0) <= 0;
    setForm({
      tank_id: String(delivery.tank_id),
      supplier_id: delivery.supplier_id ? String(delivery.supplier_id) : '',
      litres: String(delivery.litres),
      cost_per_litre: pendingPrice ? '' : String(delivery.cost_per_litre),
      date: delivery.date,
      invoice_number: delivery.invoice_number || '',
    });
    setInvoiceFile(null);
    setEditDelivery(delivery);
    setError('');
    setWarnings([]);
  }

  async function handleSave() {
    if (!form.tank_id || !form.supplier_id || !form.litres || !form.date) return;
    setSubmitting(true);
    setError('');
    setWarnings([]);
    try {
      const payload: any = {
        tank_id: parseInt(form.tank_id),
        supplier_id: parseInt(form.supplier_id),
        litres: parseFloat(form.litres),
        date: form.date,
        invoice_number: form.invoice_number || null,
      };
      if (form.cost_per_litre !== '') payload.cost_per_litre = parseFloat(form.cost_per_litre);
      let savedId: number | undefined;
      let responseWarnings: string[] = [];
      if (editDelivery) {
        const res = await updateFuelDelivery(editDelivery.id, payload);
        savedId = res.data.data?.id || editDelivery.id;
        responseWarnings = res.data.warnings || [];
      } else {
        const res = await createFuelDelivery(payload);
        savedId = res.data.data?.id;
        responseWarnings = res.data.warnings || [];
      }
      if (invoiceFile && savedId) {
        await uploadFuelDeliveryInvoiceDocument(savedId, await fileToInvoicePayload(invoiceFile));
      }
      if (editDelivery) {
        setEditDelivery(null);
      } else {
        setShowAdd(false);
      }
      setWarnings(responseWarnings);
      setInvoiceFile(null);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save delivery');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOpenInvoice(delivery: any) {
    try {
      const res = await getFuelDeliveryInvoiceDocument(delivery.id);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to open invoice PDF');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError('');
    try {
      await deleteFuelDelivery(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete delivery');
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

  const isPendingPrice = (d: any) => d.pricing_status === 'pending_price' || Number(d.cost_per_litre || 0) <= 0;
  const totalCost = (d: any) => Number(d.total_cost || 0) || parseFloat(d.litres) * parseFloat(d.cost_per_litre);

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader
        title="Fuel Deliveries"
        back
        right={
          isAdmin ? (
            <button
              onClick={openAdd}
              disabled={tanks.length === 0 || suppliers.length === 0}
              className="p-2 bg-blue-600 text-white rounded-xl disabled:opacity-50"
            >
              <Plus size={20} />
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-700">{w}</p>
          ))}
        </div>
      )}

      {isAdmin && suppliers.length === 0 && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-sm text-amber-700">Create a supplier account before recording fuel deliveries.</p>
        </div>
      )}

      {deliveries.length === 0 ? (
        <div className="text-center mt-20">
          <Truck size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No deliveries recorded</p>
          {isAdmin && (
            <button
              onClick={openAdd}
              disabled={tanks.length === 0 || suppliers.length === 0}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm disabled:opacity-50"
            >
              Record First Delivery
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {deliveries.map((d: any) => (
            <div key={d.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Truck size={16} className="text-gray-400" />
                    <span className="font-semibold text-gray-800">{parseFloat(d.litres).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                      {d.fuel_type}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 ml-6">{d.tank_label}</p>
                  {(d.supplier_name || d.supplier) && <p className="text-xs text-gray-400 ml-6">Supplier: {d.supplier_name || d.supplier}</p>}
                  <div className="flex items-center gap-2 ml-6 mt-1">
                    <p className="text-xs text-gray-400">Invoice: {d.invoice_number || (isPendingPrice(d) ? 'Pending' : '-')}</p>
                    {isAdmin && d.invoice_file_path && (
                      <button
                        type="button"
                        onClick={() => handleOpenInvoice(d)}
                        className="inline-flex items-center gap-1 text-xs text-blue-600"
                      >
                        <FileText size={12} /> PDF
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-6 mt-1">
                    <p className="text-xs text-gray-400">{formatDate(d.date)}</p>
                    <p className={`text-xs ${isPendingPrice(d) ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                      {isPendingPrice(d) ? 'Price pending' : `@ KES ${parseFloat(d.cost_per_litre).toFixed(2)}/L`}
                    </p>
                  </div>
                  <p className={`text-sm font-semibold ml-6 mt-1 ${isPendingPrice(d) ? 'text-amber-600' : 'text-gray-700'}`}>
                    Total: {isPendingPrice(d) ? 'Pending' : `KES ${totalCost(d).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => openEdit(d)} className="p-2 text-gray-400 hover:text-blue-600 rounded-lg">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setDeleteTarget(d)} className="p-2 text-gray-400 hover:text-red-500 rounded-lg">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {(showAdd || editDelivery) && (
        <div className="mobile-modal-overlay flex items-end" onClick={() => { setShowAdd(false); setEditDelivery(null); }}>
          <div className="mobile-bottom-sheet rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">{editDelivery ? 'Edit Delivery' : 'Record Delivery'}</h2>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Delivery Date</label>
                <input
                  type="date"
                  max={today()}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-1">Stock is effective from the start of this selected date.</p>
                {form.date < today() && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle size={12} /> Backdated delivery will recompute stock and dips from this date.
                  </p>
                )}
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
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Supplier</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-100"
                  value={form.supplier_id}
                  onChange={e => setForm({ ...form, supplier_id: e.target.value })}
                  disabled={suppliers.length === 0}
                >
                  <option value="">Select supplier account</option>
                  {suppliers.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">No suppliers are configured. Add the supplier account first.</p>
                )}
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Invoice Number (optional)</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Supplier invoice number"
                  value={form.invoice_number}
                  onChange={e => setForm({ ...form, invoice_number: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Invoice PDF (optional)</label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onChange={e => setInvoiceFile(e.target.files?.[0] || null)}
                />
                {editDelivery?.invoice_file_name && !invoiceFile && (
                  <p className="text-xs text-gray-400 mt-1">Current PDF: {editDelivery.invoice_file_name}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Litres Delivered</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                    value={form.litres}
                    onChange={e => setForm({ ...form, litres: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Cost per Litre (KES, optional)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Pending"
                    value={form.cost_per_litre}
                    onChange={e => setForm({ ...form, cost_per_litre: e.target.value })}
                  />
                </div>
              </div>
              {form.litres && form.cost_per_litre && (
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-sm text-blue-700 font-medium">
                    Total Cost: KES {(parseFloat(form.litres || '0') * parseFloat(form.cost_per_litre || '0')).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )}
              {form.litres && !form.cost_per_litre && (
                <div className="bg-amber-50 rounded-xl p-3">
                  <p className="text-xs text-amber-700">Litres will be added to stock now. Supplier cost and debt stay pending until the invoice price is entered.</p>
                </div>
              )}
              {editDelivery && (
                <div className="bg-amber-50 rounded-xl p-3">
                  <p className="text-xs text-amber-700">⚠️ Editing a delivery will adjust the tank stock balance accordingly.</p>
                </div>
              )}
              <button
                onClick={handleSave}
                disabled={submitting || !form.tank_id || !form.supplier_id || !form.litres || !form.date}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
              >
                {submitting ? 'Saving...' : editDelivery ? 'Save Changes' : 'Record Delivery'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="mobile-modal-overlay flex items-center justify-center px-6">
          <div className="mobile-dialog-card bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Delete Delivery?</h3>
            <p className="text-sm text-gray-500 mb-2">
              Delete the delivery of <strong>{parseFloat(deleteTarget.litres).toLocaleString()} L</strong> on <strong>{formatDate(deleteTarget.date)}</strong>?
            </p>
            <p className="text-xs text-red-500 mb-4">⚠️ This will deduct {parseFloat(deleteTarget.litres).toLocaleString()} L from the tank's stock balance.</p>
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
