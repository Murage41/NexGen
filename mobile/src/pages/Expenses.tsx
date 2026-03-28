import { useState, useEffect } from 'react';
import { Plus, Trash2, Receipt } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getExpenses, createExpense, deleteExpense } from '../services/api';

export default function Expenses() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ category: '', description: '', amount: '', date: new Date().toISOString().split('T')[0] });

  const fmt = (n: number) => `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const res = await getExpenses();
      setExpenses(res.data.data || res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!form.category || !form.amount) return;
    setSubmitting(true);
    try {
      await createExpense({ ...form, amount: parseFloat(form.amount) });
      setShowAdd(false);
      setForm({ category: '', description: '', amount: '', date: new Date().toISOString().split('T')[0] });
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this expense?')) return;
    try {
      await deleteExpense(id);
      loadData();
    } catch (err) {
      console.error(err);
    }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader
        title="Expenses"
        back
        right={
          <button onClick={() => setShowAdd(true)} className="p-2 bg-blue-600 text-white rounded-xl">
            <Plus size={20} />
          </button>
        }
      />

      {expenses.length === 0 ? (
        <div className="text-center mt-20">
          <Receipt size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No expenses recorded</p>
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((e: any) => (
            <div key={e.id} className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e.category}</span>
                </div>
                {e.description && <p className="text-sm text-gray-700 truncate">{e.description}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(e.date || e.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
              <div className="flex items-center gap-3 ml-3">
                <span className="text-base font-bold text-gray-800">{fmt(e.amount)}</span>
                <button onClick={() => handleDelete(e.id)} className="p-2 text-gray-400 hover:text-red-500">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Expense Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowAdd(false)}>
          <div className="bg-white w-full rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">Add Expense</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Category</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Fuel, Maintenance"
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Description</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional description"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Amount (KES)</label>
                <input
                  type="number"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Date</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={submitting || !form.category || !form.amount}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
              >
                {submitting ? 'Saving...' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
