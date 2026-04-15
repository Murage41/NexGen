import { useState, useEffect } from 'react';
import { getExpenseSummary, getExpenseCategories, createExpense, updateExpense, deleteExpense } from '../services/api';
import { Plus, Pencil, Trash2, Receipt, X, Filter, TrendingUp, TrendingDown } from 'lucide-react';
import { getKenyaDate, getKenyaMonth } from '../utils/timezone';

const PREDEFINED_CATEGORIES = [
  'Rent', 'Utilities', 'Wages', 'Maintenance', 'Transport', 'Licenses',
  'Security', 'Bank Charges', 'Stationery', 'Communication', 'Generator Fuel',
  'Cleaning', 'Insurance', 'Accounting', 'Other',
];

export default function Expenses() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ category: '', description: '', amount: '', date: '' });
  const [dateFrom, setDateFrom] = useState(getKenyaMonth() + '-01');
  const [dateTo, setDateTo] = useState(getKenyaDate());
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>(PREDEFINED_CATEGORIES);

  useEffect(() => {
    loadData();
    loadCategories();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await getExpenseSummary({ from: dateFrom, to: dateTo });
      const data = res.data.data;
      setSummary(data);
      let filtered = data.expenses || [];
      if (categoryFilter) {
        filtered = filtered.filter((e: any) => e.category === categoryFilter);
      }
      setExpenses(filtered);
    } catch (err) {
      console.error('Failed to load expenses:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories() {
    try {
      const res = await getExpenseCategories();
      setCategories(res.data.data || PREDEFINED_CATEGORIES);
    } catch {
      // fallback to predefined
    }
  }

  function applyFilter() { loadData(); }
  function clearFilter() {
    setDateFrom(getKenyaMonth() + '-01');
    setDateTo(getKenyaDate());
    setCategoryFilter('');
    setTimeout(() => loadData(), 0);
  }

  function openCreate() {
    setEditing(null);
    setForm({ category: '', description: '', amount: '', date: getKenyaDate() });
    setShowModal(true);
  }

  function openEdit(exp: any) {
    if (exp.source === 'shift') return; // Can't edit shift expenses from here
    setEditing(exp);
    setForm({
      category: exp.category || '',
      description: exp.description || '',
      amount: String(exp.amount),
      date: exp.date ? exp.date.split('T')[0] : '',
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      category: form.category,
      description: form.description || null,
      amount: parseFloat(form.amount),
      date: form.date,
    };
    try {
      if (editing) {
        await updateExpense(editing.id, payload);
      } else {
        await createExpense(payload);
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      alert(err.response?.data?.error || 'Failed to save expense');
    }
  }

  async function handleDelete(exp: any) {
    if (exp.source === 'shift') return;
    if (!confirm('Are you sure you want to delete this expense?')) return;
    try {
      await deleteExpense(exp.id);
      loadData();
    } catch (err: any) {
      console.error('Failed to delete expense:', err);
      alert(err.response?.data?.error || 'Failed to delete expense');
    }
  }

  const formatKES = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
  const total = expenses.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Receipt size={24} /> Expenses
        </h1>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
          <Plus size={18} /> Add Expense
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 mb-1">Total Expenses (Period)</p>
            <p className="text-xl font-bold text-red-600">{formatKES(summary.total_expenses)}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 mb-1">vs Previous Period</p>
            {summary.change_percent !== null ? (
              <p className={`text-xl font-bold flex items-center gap-1 ${summary.change_percent <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {summary.change_percent <= 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
                {Math.abs(summary.change_percent).toFixed(1)}%
              </p>
            ) : (
              <p className="text-xl font-bold text-gray-400">—</p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">Prev: {formatKES(summary.previous_period_total)}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 mb-1">Top Category</p>
            <p className="text-xl font-bold text-gray-800">{summary.top_category || '—'}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500 mb-1">Categories</p>
            <p className="text-xl font-bold text-gray-800">{summary.by_category?.length || 0}</p>
          </div>
        </div>
      )}

      {/* Category Breakdown */}
      {summary && summary.by_category && summary.by_category.length > 0 && (
        <div className="bg-white rounded-lg shadow mb-6 overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Breakdown by Category</h2>
          </div>
          <div className="p-4 space-y-3">
            {summary.by_category.map((cat: any, i: number) => (
              <div key={i} className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-700 w-32 truncate">{cat.category}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4 relative">
                  <div className="bg-red-400 h-4 rounded-full transition-all"
                    style={{ width: `${Math.min(cat.pct, 100)}%` }} />
                </div>
                <span className="text-sm font-semibold text-gray-600 w-28 text-right">{formatKES(cat.total)}</span>
                <span className="text-xs text-gray-400 w-12 text-right">{cat.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Date + Category Filter */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Filter size={18} className="text-gray-400" />
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg p-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg p-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="border border-gray-300 rounded-lg p-2 text-sm min-w-[150px]">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button onClick={applyFilter}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm mt-4">
              Apply
            </button>
            <button onClick={clearFilter}
              className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm mt-4">
              Clear
            </button>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-gray-500">Filtered Total</p>
            <p className="text-lg font-bold text-gray-800">{formatKES(total)}</p>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Expense' : 'Add Expense'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <select
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                >
                  <option value="">Select category...</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="text"
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 mt-2"
                  placeholder="Or type a custom category"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" rows={2} placeholder="Optional details" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KES) *</label>
                <input type="number" required step="0.01" min="0" value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input type="date" required value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={!form.category || !form.amount}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-gray-500 text-center py-8">Loading...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Category</th>
                <th className="text-left p-3 font-medium text-gray-600">Description</th>
                <th className="text-left p-3 font-medium text-gray-600">Source</th>
                <th className="text-right p-3 font-medium text-gray-600">Amount</th>
                <th className="text-left p-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((exp: any, i: number) => (
                <tr key={`${exp.source}-${exp.id}-${i}`} className="border-t hover:bg-gray-50">
                  <td className="p-3">{exp.date ? new Date(exp.date + 'T12:00:00').toLocaleDateString('en-KE') : '-'}</td>
                  <td className="p-3 font-medium">{exp.category}</td>
                  <td className="p-3 text-gray-600">{exp.description || '-'}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      exp.source === 'shift'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {exp.source === 'shift' ? `Shift${exp.employee_name ? ` (${exp.employee_name})` : ''}` : 'General'}
                    </span>
                  </td>
                  <td className="p-3 text-right font-medium text-red-600">{formatKES(exp.amount)}</td>
                  <td className="p-3">
                    {exp.source === 'general' ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(exp)} className="text-blue-600 hover:text-blue-800" title="Edit">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => handleDelete(exp)} className="text-red-500 hover:text-red-700" title="Delete">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">shift expense</span>
                    )}
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-400">No expenses found for this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
