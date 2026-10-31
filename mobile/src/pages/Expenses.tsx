import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Receipt } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getExpenseSummary, getExpenseCategories, createExpense, deleteExpense } from '../services/api';
import { getKenyaDate, getKenyaMonth } from '../utils/timezone';
import { notify, errorText } from '../../../shared/ui/Notify';
import { useAuth } from '../context/AuthContext';

const PREDEFINED_CATEGORIES = [
  'Rent', 'Utilities', 'Maintenance', 'Transport', 'Licenses',
  'Security', 'Bank Charges', 'Stationery', 'Communication', 'Generator Fuel',
  'Cleaning', 'Insurance', 'Accounting', 'Other',
];

export default function Expenses() {
  const { isAdmin } = useAuth();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ category: '', description: '', amount: '', date: getKenyaDate() });
  const [categories, setCategories] = useState<string[]>(PREDEFINED_CATEGORIES);
  const [view, setView] = useState<'expenses' | 'wages'>('expenses');
  const navigate = useNavigate();

  const fmt = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  useEffect(() => { loadData(); loadCategories(); }, []);

  async function loadData() {
    try {
      const monthStart = getKenyaMonth() + '-01';
      const today = getKenyaDate();
      const res = await getExpenseSummary({ from: monthStart, to: today });
      const data = res.data.data;
      setSummary(data);
      setExpenses(data.expenses || []);
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
      setForm({ category: '', description: '', amount: '', date: getKenyaDate() });
      loadData();
    } catch (err: any) {
      console.error(err);
      notify('error', errorText(err, 'Expense not saved.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(exp: any) {
    if (exp.source !== 'general') return;
    if (!confirm('Delete this expense?')) return;
    try {
      await deleteExpense(exp.id);
      loadData();
    } catch (err: any) { console.error(err); notify('error', errorText(err, 'Expense not deleted.')); }
  }

  const rows = expenses.filter((e: any) => (view === 'wages' ? e.source === 'payroll' : e.source !== 'payroll'));
  const bars = Object.entries(rows.reduce((m: Record<string, number>, e: any) => ({ ...m, [e.category]: (m[e.category] || 0) + e.amount }), {}))
    .sort((a: any, b: any) => b[1] - a[1]) as Array<[string, number]>;
  const chip = (on: boolean) => `px-4 py-2 rounded-full text-sm font-semibold border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700'}`;

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader title="Expenses" back
        right={
          isAdmin ? (
            <button onClick={() => setShowAdd(true)} className="p-2 bg-blue-600 text-white rounded-xl">
              <Plus size={20} />
            </button>
          ) : undefined
        }
      />

      <div className="flex gap-2 mb-4">
        <button type="button" className={chip(view === 'expenses')} onClick={() => setView('expenses')}>Expenses</button>
        <button type="button" className={chip(view === 'wages')} onClick={() => setView('wages')}>Wages</button>
      </div>

      {summary && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <p className="text-xs text-gray-500">{view === 'wages' ? 'Wages this month' : 'This month'}</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{fmt(view === 'wages' ? summary.total_payroll_expense : summary.total_operating_expenses)}</p>
          {bars.length > 0 && (
            <div className="space-y-2 mt-3 pt-3 border-t border-gray-100">
              {bars.slice(0, 5).map(([cat, amt]) => (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-gray-700 font-medium">{cat}</span>
                    <span className="text-gray-500 tabular-nums">{fmt(amt)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${(amt / bars[0][1]) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-center mt-10">
          <Receipt size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">Nothing this month</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((e: any, i: number) => (
            <div key={`${e.source}-${e.id}-${i}`}
              onClick={e.source === 'shift' && e.shift_id && isAdmin ? () => navigate(`/shifts/${e.shift_id}`) : undefined}
              className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between active:bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{e.category}{view === 'expenses' && e.description ? ` · ${e.description}` : ''}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date((e.date || e.created_at) + 'T12:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                  {' · '}{e.source === 'shift' ? `Shift #${e.shift_id}` : e.source === 'payroll' ? (e.employee_name || '') : 'Office'}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <span className="text-base font-bold text-gray-800 tabular-nums">{fmt(e.amount)}</span>
                {e.source === 'general' && isAdmin && (
                  <button onClick={() => handleDelete(e)} className="p-2 text-gray-400 hover:text-red-500" aria-label="Delete">
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
        <div className="mobile-modal-overlay flex items-end" onClick={() => setShowAdd(false)}>
          <div className="mobile-bottom-sheet rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">Add expense</h2>
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
                {submitting ? 'Saving...' : 'Add expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
