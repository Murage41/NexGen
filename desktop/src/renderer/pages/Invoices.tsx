import { useState, useEffect } from 'react';
import { getInvoices, createInvoice, updateInvoice, getCredits } from '../services/api';
import { Plus, FileText, X, Pencil } from 'lucide-react';

export default function Invoices() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [credits, setCredits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ credit_id: '', due_date: '', notes: '' });
  const [editForm, setEditForm] = useState({ status: '', notes: '' });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [invRes, credRes] = await Promise.all([getInvoices(), getCredits()]);
      setInvoices(invRes.data.data);
      setCredits(credRes.data.data);
    } catch (err) {
      console.error('Failed to load invoices:', err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm({
      credit_id: '',
      // Phase 13 parity: default due_date uses Kenya timezone so the picker
      // matches the owner's local calendar (was UTC → up to 3 hours skew).
      due_date: new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }),
      notes: '',
    });
    setShowCreateModal(true);
  }

  function openEdit(inv: any) {
    setEditing(inv);
    setEditForm({
      status: inv.status,
      notes: inv.notes || '',
    });
    setShowEditModal(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      credit_id: parseInt(form.credit_id),
      due_date: form.due_date,
      notes: form.notes || null,
    };
    try {
      await createInvoice(payload);
      setShowCreateModal(false);
      loadData();
    } catch (err: any) {
      console.error('Failed to create invoice:', err);
      alert(err.response?.data?.error || 'Failed to create invoice');
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const payload = {
      status: editForm.status,
      notes: editForm.notes || null,
    };
    try {
      await updateInvoice(editing.id, payload);
      setShowEditModal(false);
      loadData();
    } catch (err: any) {
      console.error('Failed to update invoice:', err);
      alert(err.response?.data?.error || 'Failed to update invoice');
    }
  }

  const formatKES = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  function statusBadge(status: string) {
    switch (status) {
      case 'draft':
        return <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">Draft</span>;
      case 'sent':
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Sent</span>;
      case 'paid':
        return <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Paid</span>;
      case 'overdue':
        return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">Overdue</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 bg-gray-100 text-gray-400 rounded text-xs font-medium">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">{status}</span>;
    }
  }

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <FileText size={24} /> Invoices
        </h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={18} /> Create Invoice
        </button>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Create Invoice from Credit</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Credit *</label>
                <select
                  required
                  value={form.credit_id}
                  onChange={e => setForm({ ...form, credit_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                >
                  <option value="">-- Select Credit --</option>
                  {credits
                    .filter((c: any) => c.status !== 'paid')
                    .map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.customer_name} - {formatKES(c.balance || c.amount)}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date *</label>
                <input
                  type="date"
                  required
                  value={form.due_date}
                  onChange={e => setForm({ ...form, due_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  rows={2}
                  placeholder="Optional notes"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Update Invoice #{editing.id}</h2>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  rows={2}
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Update
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
              <th className="text-left p-3 font-medium text-gray-600">Customer</th>
              <th className="text-right p-3 font-medium text-gray-600">Amount</th>
              <th className="text-left p-3 font-medium text-gray-600">Due Date</th>
              <th className="text-left p-3 font-medium text-gray-600">Status</th>
              <th className="text-left p-3 font-medium text-gray-600">Notes</th>
              <th className="text-left p-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv: any) => (
              <tr key={inv.id} className="border-t hover:bg-gray-50">
                <td className="p-3 text-gray-500">{inv.id}</td>
                <td className="p-3 font-medium">{inv.customer_name}</td>
                <td className="p-3 text-right font-medium">{formatKES(inv.amount)}</td>
                <td className="p-3">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : '-'}</td>
                <td className="p-3">{statusBadge(inv.status)}</td>
                <td className="p-3 text-gray-500 max-w-[200px] truncate">{inv.notes || '-'}</td>
                <td className="p-3">
                  <button onClick={() => openEdit(inv)} className="text-blue-600 hover:text-blue-800" title="Edit">
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-gray-400">No invoices created yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
