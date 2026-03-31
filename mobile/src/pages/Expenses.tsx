import { useState, useEffect } from 'react';
import { Plus, Trash2, Receipt, TrendingUp, TrendingDown } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getExpenseSummary, getExpenseCategories, createExpense, deleteExpense } from '../services/api';

const PREDEFINED_CATEGORIES = [
  'Rent', 'Utilities', 'Wages', 'Maintenance', 'Transport', 'Licenses',
  'Security', 'Bank Charges', 'Stationery', 'Communication', 'Generator Fuel',
  'Cleaning', 'Insurance', 'Accounting', 'Other',
];

export default function Expenses() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ category: '', description: '', amount: '', date: new Date().toISOString().split('T')[0] });
  const [categories, setCategories] = useState<string[]>(PREDEFINED_CATEGORIES);
  const [filterCat, setFilterCat] = useState('');

  const fmt = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  useEffect(() => { loadData(); loadCategories(); }, []);

  async function loadData() {
    try {
      const monthStart = new Date().toISOString().slice(0, 7) + '-01';
      const today = new Date().toISOString().split('T')[0];
      const res = await getExpenseSummary({ from: monthStart, to: today });
      const data = res.data.data;
      setSummary(data);
      let filtered = data.expenses || [];
      if (filterCat) filtered = filtered.filter((e: any) => e.category === filterCat);
      setExpenses(filtered);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories() {
    try {
      const res = await getExpenseCategories();
      setCategories(res.data.data || PREDEFINED_CATEGORIES);
    } catch { /* fallback */ }
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

  async function handleDelete(exp: any) {
    if (exp.source === 'shift') return;
    if (!confirm('Delete this expense?')) return;
    try {
      await deleteExpense(exp.id);
      loadData();
    } catch (err) { console.error(err); }
  }

  function applyFilter(cat: string) {
    setFilterCat(cat);
    if (summary) {
      let filtered = summary.expenses || [];
      if (cat) filtered = filtered.filter((e: any) => e.category === cat);
      setExpenses(filtered);
    }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader title="Expenses" back
        right={
          <button onClick={() => setShowAdd(true)} className="p-2 bg-blue-600 text-white rounded-xl">
            <Plus size={20} />
          </button>
        }
      />

      {/* Summary Card */}
      {summary && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-gray-500">This Month's Expenses</p>
              <p className="text-xl font-bold text-red-600">{fmt(summary.total_expenses)}</p>
            </div>
            {summary.change_percent !== null && (
              <div className={`flex items-center gap-1 text-sm font-semibold ${summary.change_percent <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {summary.change_percent <= 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                {Math.abs(summary.change_percent).toFixed(0)}%
              </div>
            )}
          </div>
          {summary.top_category && (
            <p className="text-xs text-gray-400 mt-1">Top: {summary.top_category}</p>
          )}
        </div>
      )}

      {/* Category breakdown bars */}
      {summary && summary.by_category && summary.by_category.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <p className="text-xs font-semibold text-gray-500 mb-3 uppercase">By Category</p>
          <div className="space-y-2">
            {summary.by_category.slice(0, 5).map((cat: any, i: number) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-gray-700 font-medium">{cat.category}</span>
                  <span className="text-gray-500">{fmt(cat.total)} ({cat.pct.toFixed(0)}%)</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-red-400 h-2 rounded-full" style={{ width: `${Math.min(cat.pct, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button onClick={() => applyFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${!filterCat ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
          All
        </button>
        {categories.slice(0, 8).map(c => (
          <button key={c} onClick={() => applyFilter(c)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${filterCat === c ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {c}
          </button>
        ))}
      </div>

      {/* Expenses list */}
      {expenses.length === 0 ? (
        <div className="text-center mt-10">
          <Receipt size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No expenses found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((e: any, i: number) => (
            <div key={`${e.source}-${e.id}-${i}`} className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e.category}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    e.source === 'shift' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-400'
                  }`}>
                    {e.source === 'shift' ? 'Shift' : 'General'}
                  </span>
                </div>
                {e.description && <p className="text-sm text-gray-700 truncate">{e.description}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {new Date((e.date || e.created_at) + 'T12:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {e.employee_name && ` · ${e.employee_name}`}
                </p>
              </div>
              <div className="flex items-center gap-3 ml-3">
                <span className="text-base font-bold text-gray-800">{fmt(e.amount)}</span>
                {e.source === 'general' && (
                  <button onClick={() => handleDelete(e)} className="p-2 text-gray-400 hover:text-red-500">
                    <Trash2 size={18} />
                  </button>
                )}
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
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select category...</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mt-2"
                  placeholder="Or type custom category"
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
                <input type="number"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Date</label>
                <input type="date"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <button onClick={handleAdd}
                disabled={submitting || !form.category || !form.amount}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2">
                {submitting ? 'Saving...' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
