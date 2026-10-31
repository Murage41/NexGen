import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getExpenseSummary, getExpenseCategories, createExpense, updateExpense, deleteExpense } from '../services/api';
import { Plus, Pencil, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { getKenyaDate, getKenyaMonth } from '../utils/timezone';

const PREDEFINED_CATEGORIES = [
  'Rent', 'Utilities', 'Maintenance', 'Transport', 'Licenses',
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
  const [month, setMonth] = useState(getKenyaMonth());
  const [view, setView] = useState<'expenses' | 'wages'>('expenses');
  const [lastMonth, setLastMonth] = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>(PREDEFINED_CATEGORIES);
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');

  useEffect(() => { loadCategories(); }, []);
  useEffect(() => { loadData(); }, [month]);

  function monthRange(m: string) {
    const [y, mo] = m.split('-').map(Number);
    const end = new Date(y, mo, 0).getDate();
    const to = m === getKenyaMonth() ? getKenyaDate() : `${m}-${String(end).padStart(2, '0')}`;
    return { from: `${m}-01`, to };
  }
  function shiftMonth(m: string, by: number) {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1 + by, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  async function loadData() {
    setLoading(true);
    try {
      const [res, prev] = await Promise.all([
        getExpenseSummary(monthRange(month)),
        getExpenseSummary(monthRange(shiftMonth(month, -1))),
      ]);
      const data = res.data.data;
      setSummary(data);
      setLastMonth(prev.data.data);
      setExpenses(data.expenses || []);
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

  function openCreate() {
    setEditing(null);
    setForm({ category: '', description: '', amount: '', date: getKenyaDate() });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(exp: any) {
    if (exp.source !== 'general') return;
    setEditing(exp);
    setForm({
      category: exp.category || '',
      description: exp.description || '',
      amount: String(exp.amount),
      date: exp.date ? exp.date.split('T')[0] : '',
    });
    setFormError('');
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
      setFormError(err.response?.data?.error || 'Failed to save expense');
    }
  }

  async function handleDelete(exp: any) {
    if (exp.source !== 'general') return;
    if (!confirm('Are you sure you want to delete this expense?')) return;
    setListError('');
    try {
      await deleteExpense(exp.id);
      loadData();
    } catch (err: any) {
      console.error('Failed to delete expense:', err);
      setListError(err.response?.data?.error || 'Failed to delete expense');
    }
  }

  const formatKES = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
  const isWage = (e: any) => e.source === 'payroll';
  const inView = expenses.filter((e: any) => (view === 'wages' ? isWage(e) : !isWage(e)));
  const usedCategories = [...new Set(inView.map((e: any) => e.category))].sort();
  const rows = categoryFilter ? inView.filter((e: any) => e.category === categoryFilter) : inView;
  const thisTotal = view === 'wages' ? summary?.total_payroll_expense : summary?.total_operating_expenses;
  const prevTotal = view === 'wages' ? lastMonth?.total_payroll_expense : lastMonth?.total_operating_expenses;
  const bars: Array<[string, number]> = Object.entries(
    inView.reduce((m: Record<string, number>, e: any) => ({ ...m, [e.category]: (m[e.category] || 0) + e.amount }), {}),
  ).sort((a: any, b: any) => b[1] - a[1]) as Array<[string, number]>;
  const barMax = bars.length ? bars[0][1] : 0;
  const monthLabel = new Date(`${month}-15`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-sm font-semibold border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700'}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Expenses</h1>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
          <Plus size={18} /> Add expense
        </button>
      </div>
      {listError && <p className="text-sm text-red-600 mb-4">{listError}</p>}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button type="button" className={chip(view === 'expenses')} onClick={() => { setView('expenses'); setCategoryFilter(''); }}>Expenses</button>
        <button type="button" className={chip(view === 'wages')} onClick={() => { setView('wages'); setCategoryFilter(''); }}>Wages</button>
        {usedCategories.length > 1 && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="ml-2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">All categories</option>
            {usedCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <span className="flex-1" />
        <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="p-1.5 rounded border border-gray-300 bg-white"><ChevronLeft size={16} /></button>
        <strong className="w-36 text-center">{monthLabel}</strong>
        <button type="button" aria-label="Next month" disabled={month >= getKenyaMonth()} onClick={() => setMonth(shiftMonth(month, 1))} className="p-1.5 rounded border border-gray-300 bg-white disabled:opacity-40"><ChevronRight size={16} /></button>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs font-semibold text-gray-500">{view === 'wages' ? 'Wages this month' : 'This month'}</p>
            <p className="text-2xl font-bold tabular-nums text-gray-800">{formatKES(thisTotal)}</p>
            {lastMonth && <p className="text-xs text-gray-500 mt-0.5">Last month {formatKES(prevTotal)}</p>}
          </div>
          <div className="col-span-2 bg-white rounded-lg shadow p-4 grid grid-cols-[9rem_1fr_6rem] gap-x-3 gap-y-2 items-center text-sm content-start">
            {bars.slice(0, 6).map(([cat, amt]) => [
              <span key={`l${cat}`} className="truncate">{cat}</span>,
              <span key={`b${cat}`} className="h-2 rounded bg-gray-100 overflow-hidden"><span className="block h-full bg-blue-600" style={{ width: `${barMax ? (amt / barMax) * 100 : 0}%` }} /></span>,
              <span key={`v${cat}`} className="text-right tabular-nums">{formatKES(amt)}</span>,
            ])}
            {bars.length === 0 && <span className="col-span-3 text-gray-400">Nothing this month.</span>}
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editing ? 'Edit expense' : 'Add expense'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            {formError && <p className="text-sm text-red-600 mb-3">{formError}</p>}
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
                  className="w-full border border-gray-300 rounded-lg p-2" rows={2} />
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

      {loading ? (
        <div className="text-gray-500 text-center py-8">Loading...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">What</th>
                <th className="text-left p-3 font-medium text-gray-600">{view === 'wages' ? 'Employee' : 'Paid from'}</th>
                <th className="text-right p-3 font-medium text-gray-600">Amount</th>
                <th className="p-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((exp: any, i: number) => (
                <tr key={`${exp.source}-${exp.id}-${i}`} className="border-t hover:bg-gray-50">
                  <td className="p-3 whitespace-nowrap">{exp.date ? new Date(exp.date + 'T12:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '-'}</td>
                  <td className="p-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold mr-2">{exp.category}</span>
                    {view === 'expenses' && <span className="text-gray-600">{exp.description || ''}</span>}
                  </td>
                  <td className="p-3">
                    {exp.source === 'shift' && exp.shift_id ? (
                      <Link to={`/shifts/${exp.shift_id}`} className="text-blue-600 hover:underline">Shift #{exp.shift_id}</Link>
                    ) : exp.source === 'payroll' ? (exp.employee_name || '-') : 'Office'}
                  </td>
                  <td className="p-3 text-right font-medium tabular-nums">{formatKES(exp.amount)}</td>
                  <td className="p-3">
                    {exp.source === 'general' && (
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => openEdit(exp)} className="text-blue-600 hover:text-blue-800" title="Edit"><Pencil size={15} /></button>
                        <button onClick={() => handleDelete(exp)} className="text-red-500 hover:text-red-700" title="Delete"><Trash2 size={15} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nothing this month.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
