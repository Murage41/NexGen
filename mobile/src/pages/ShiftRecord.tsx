import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getShift, updateReadings, updateCollections, addShiftExpense, deleteShiftExpense, addShiftCredit, deleteShiftCredit, getCreditAccounts } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import { Save, Plus, Trash2, Search, UserPlus } from 'lucide-react';

export default function ShiftRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [shiftStatus, setShiftStatus] = useState<string>('open');
  const [readings, setReadings] = useState<any[]>([]);
  const [collections, setCollections] = useState({ cash_amount: 0, mpesa_amount: 0 });
  const [shiftCredits, setShiftCredits] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [newExp, setNewExp] = useState({ category: '', description: '', amount: '' });
  const [newCredit, setNewCredit] = useState({ customer_name: '', amount: '', description: '', account_id: null as number | null });
  const [tab, setTab] = useState<'readings' | 'collections' | 'credits' | 'expenses'>('readings');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  // Credit account search
  const [creditAccounts, setCreditAccounts] = useState<any[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadShift(); loadCreditAccounts(); }, [id]);

  async function loadCreditAccounts() {
    try {
      const res = await getCreditAccounts();
      setCreditAccounts(res.data.data || res.data);
    } catch (err) { console.error(err); }
  }

  async function loadShift() {
    try {
      const res = await getShift(parseInt(id!));
      const d = res.data.data;
      setShiftStatus(d.status || 'open');
      setReadings(d.readings || []);
      if (d.collections) setCollections({ cash_amount: d.collections.cash_amount, mpesa_amount: d.collections.mpesa_amount });
      setShiftCredits(d.shift_credits || []);
      setExpenses(d.expenses || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function saveReadings() {
    setSaving(true);
    try {
      const payload = readings.map(r => ({ pump_id: r.pump_id, closing_litres: parseFloat(r.closing_litres) || 0, closing_amount: parseFloat(r.closing_amount) || 0 }));
      const res = await updateReadings(parseInt(id!), payload);
      setReadings(res.data.data);
      alert('Readings saved');
    } catch (err: any) {
      // Phase 13: surface backend validation (e.g. Phase 12 monotonic guard)
      // instead of silently swallowing it.
      const msg = err?.response?.data?.error || err?.message || 'Failed to save readings';
      alert(msg);
      console.error(err);
    }
    finally { setSaving(false); }
  }

  async function saveCollections() {
    setSaving(true);
    try {
      const creditsTotal = shiftCredits.reduce((s: number, c: any) => s + c.amount, 0);
      await updateCollections(parseInt(id!), {
        cash_amount: parseFloat(String(collections.cash_amount)) || 0,
        mpesa_amount: parseFloat(String(collections.mpesa_amount)) || 0,
        credits_amount: creditsTotal,
      });
      alert('Collections saved');
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to save collections';
      alert(msg);
      console.error(err);
    }
    finally { setSaving(false); }
  }

  async function handleAddExpense() {
    if (!newExp.category || !newExp.amount) return;
    await addShiftExpense(parseInt(id!), { category: newExp.category, description: newExp.description, amount: parseFloat(newExp.amount) });
    setNewExp({ category: '', description: '', amount: '' });
    await loadShift();
  }

  async function handleDeleteExpense(expId: number) {
    await deleteShiftExpense(parseInt(id!), expId);
    await loadShift();
  }

  async function handleAddCredit() {
    if (!newCredit.customer_name || !newCredit.amount) return;
    const payload: any = {
      customer_name: newCredit.customer_name,
      amount: parseFloat(newCredit.amount),
      description: newCredit.description,
    };
    if (newCredit.account_id) payload.account_id = newCredit.account_id;
    await addShiftCredit(parseInt(id!), payload);
    setNewCredit({ customer_name: '', amount: '', description: '', account_id: null });
    setAccountSearch('');
    setIsNewCustomer(false);
    await loadShift();
  }

  function selectAccount(account: any) {
    setNewCredit({ ...newCredit, customer_name: account.name, account_id: account.id });
    setAccountSearch(account.name);
    setShowAccountDropdown(false);
    setIsNewCustomer(false);
  }

  function selectNewCustomer() {
    setIsNewCustomer(true);
    setShowAccountDropdown(false);
    setAccountSearch('');
    setNewCredit({ ...newCredit, customer_name: '', account_id: null });
  }

  const filteredAccounts = creditAccounts.filter(a =>
    a.name.toLowerCase().includes(accountSearch.toLowerCase())
  );

  async function handleDeleteCredit(creditId: number) {
    await deleteShiftCredit(parseInt(id!), creditId);
    await loadShift();
  }

  function updateReading(index: number, field: string, value: string) {
    const updated = [...readings];
    updated[index] = { ...updated[index], [field]: value };
    const opening = parseFloat(updated[index].opening_litres) || 0;
    const closing = parseFloat(updated[index].closing_litres) || 0;
    const openAmt = parseFloat(updated[index].opening_amount) || 0;
    const closeAmt = parseFloat(updated[index].closing_amount) || 0;
    updated[index].litres_sold = closing - opening;
    updated[index].amount_sold = closeAmt - openAmt;
    setReadings(updated);
  }

  // Helper: show empty string for 0 values so the input clears on focus
  const numVal = (v: any) => { const n = parseFloat(v); return n === 0 ? '' : v; };
  const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  // Phase 13: if the shift is already closed, editing paths would be rejected
  // by the backend (requireOpenShift guard). Rather than surface confusing
  // 400 errors, short-circuit here and push the user back to the read-only
  // view. Desktop ShiftDetail uses the same status gate.
  if (shiftStatus !== 'open') {
    return (
      <div className="pb-6">
        <PageHeader title="Record Shift" back />
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Shift is closed</p>
          <p>This shift has already been closed and can no longer be edited.</p>
          <button
            onClick={() => navigate(`/shifts/${id}`)}
            className="mt-3 w-full bg-white border border-amber-300 py-2 rounded-lg text-sm font-medium text-amber-800"
          >
            View details
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: 'readings', label: 'Readings' },
    { key: 'collections', label: 'Money In' },
    { key: 'credits', label: 'Credits' },
    { key: 'expenses', label: 'Money Out' },
  ] as const;

  const totalCredits = shiftCredits.reduce((s: number, c: any) => s + c.amount, 0);

  return (
    <div className="pb-6">
      <PageHeader title="Record Shift" back />

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-lg p-1 mb-4">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition ${tab === t.key ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Readings Tab */}
      {tab === 'readings' && (
        <div className="space-y-3">
          {readings.map((r, i) => (
            <div key={r.id || i} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">{r.pump_label} {r.nozzle_label}</p>
                <span className={`text-xs px-2 py-0.5 rounded ${r.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                  {r.fuel_type}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">Opening (L)</label>
                  <p className="text-sm font-medium text-gray-500">{parseFloat(r.opening_litres).toFixed(2)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">Closing (L)</label>
                  <input type="number" step="0.01" value={numVal(r.closing_litres)}
                    onChange={e => updateReading(i, 'closing_litres', e.target.value)}
                    onFocus={selectOnFocus} placeholder="0.00"
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Opening (KES)</label>
                  <p className="text-sm font-medium text-gray-500">{parseFloat(r.opening_amount).toFixed(2)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400">Closing (KES)</label>
                  <input type="number" step="0.01" value={numVal(r.closing_amount)}
                    onChange={e => updateReading(i, 'closing_amount', e.target.value)}
                    onFocus={selectOnFocus} placeholder="0.00"
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                </div>
              </div>
              <div className="flex justify-between mt-2 pt-2 border-t border-gray-100 text-xs">
                <span className="text-gray-400">Sold: <strong className="text-gray-700">{parseFloat(r.litres_sold).toFixed(2)} L</strong></span>
                <span className="text-gray-400">Amount: <strong className="text-gray-700">KES {(parseFloat(r.amount_sold) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</strong></span>
              </div>
            </div>
          ))}
          <button onClick={saveReadings} disabled={saving}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50">
            <Save size={18} /> Save Readings
          </button>
        </div>
      )}

      {/* Collections Tab (Cash & M-Pesa) */}
      {tab === 'collections' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-3">
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Cash Collected (KES)</label>
              <input type="number" step="0.01" value={numVal(collections.cash_amount)}
                onChange={e => setCollections({ ...collections, cash_amount: parseFloat(e.target.value) || 0 })}
                onFocus={selectOnFocus} placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg p-3 text-base" />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">M-Pesa Received (KES)</label>
              <input type="number" step="0.01" value={numVal(collections.mpesa_amount)}
                onChange={e => setCollections({ ...collections, mpesa_amount: parseFloat(e.target.value) || 0 })}
                onFocus={selectOnFocus} placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg p-3 text-base" />
            </div>
            <div className="pt-2 border-t">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total (Cash + M-Pesa)</span>
                <span className="font-bold text-lg">
                  KES {((collections.cash_amount || 0) + (collections.mpesa_amount || 0)).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
          <button onClick={saveCollections} disabled={saving}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50">
            <Save size={18} /> Save Collections
          </button>
        </div>
      )}

      {/* Credits Tab (Itemized) */}
      {tab === 'credits' && (
        <div className="space-y-3">
          {shiftCredits.map(c => (
            <div key={c.id} className="bg-white rounded-xl p-3 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{c.customer_name}</p>
                {c.description && <p className="text-xs text-gray-400">{c.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">KES {c.amount.toLocaleString()}</span>
                {isAdmin && (
                  <button onClick={() => handleDeleteCredit(c.id)} className="text-red-400 p-1"><Trash2 size={16} /></button>
                )}
              </div>
            </div>
          ))}
          {totalCredits > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 flex justify-between text-sm font-bold">
              <span>Total Credits</span>
              <span>KES {totalCredits.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm font-medium text-gray-700 mb-2">Add Credit</p>

            {/* Searchable account dropdown */}
            {!isNewCustomer ? (
              <div className="relative mb-2" ref={searchRef}>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={accountSearch}
                    onChange={e => {
                      setAccountSearch(e.target.value);
                      setShowAccountDropdown(true);
                      if (!e.target.value) setNewCredit({ ...newCredit, customer_name: '', account_id: null });
                    }}
                    onFocus={() => setShowAccountDropdown(true)}
                    placeholder="Search customer account..."
                    className="w-full border border-gray-300 rounded-lg p-3 pl-9 text-sm"
                  />
                </div>
                {showAccountDropdown && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {filteredAccounts.map(a => (
                      <button
                        key={a.id}
                        onClick={() => selectAccount(a)}
                        className="w-full text-left px-4 py-3 border-b border-gray-50 flex items-center justify-between hover:bg-gray-50"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-800">{a.name}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${a.type === 'customer' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {a.type}
                          </span>
                        </div>
                        {Number(a.outstanding_balance) > 0 && (
                          <span className="text-xs text-red-500">KES {Number(a.outstanding_balance).toLocaleString()}</span>
                        )}
                      </button>
                    ))}
                    <button
                      onClick={selectNewCustomer}
                      className="w-full text-left px-4 py-3 flex items-center gap-2 text-blue-600 hover:bg-blue-50"
                    >
                      <UserPlus size={16} />
                      <span className="text-sm font-medium">New Customer</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-2">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">New Customer</span>
                  <button onClick={() => { setIsNewCustomer(false); setAccountSearch(''); }} className="text-xs text-gray-400 underline">Cancel</button>
                </div>
                <input
                  value={newCredit.customer_name}
                  onChange={e => setNewCredit({ ...newCredit, customer_name: e.target.value })}
                  placeholder="Customer name"
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm"
                />
              </div>
            )}

            <input value={newCredit.description} onChange={e => setNewCredit({ ...newCredit, description: e.target.value })}
              placeholder="Optional details" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
            <input type="number" value={newCredit.amount} onChange={e => setNewCredit({ ...newCredit, amount: e.target.value })}
              placeholder="Amount" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
            <button onClick={handleAddCredit}
              className="w-full bg-gray-800 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1">
              <Plus size={16} /> Add Credit
            </button>
          </div>
        </div>
      )}

      {/* Expenses Tab */}
      {tab === 'expenses' && (
        <div className="space-y-3">
          {expenses.map(e => (
            <div key={e.id} className="bg-white rounded-xl p-3 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{e.category}</p>
                {e.description && <p className="text-xs text-gray-400">{e.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">KES {e.amount.toLocaleString()}</span>
                {isAdmin && (
                  <button onClick={() => handleDeleteExpense(e.id)} className="text-red-400 p-1"><Trash2 size={16} /></button>
                )}
              </div>
            </div>
          ))}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm font-medium text-gray-700 mb-2">Add Expense</p>
            <input value={newExp.category} onChange={e => setNewExp({ ...newExp, category: e.target.value })}
              placeholder="Category (e.g. Wages, Fuel)" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
            <input value={newExp.description} onChange={e => setNewExp({ ...newExp, description: e.target.value })}
              placeholder="Description (optional)" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
            <input type="number" value={newExp.amount} onChange={e => setNewExp({ ...newExp, amount: e.target.value })}
              placeholder="Amount" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
            <button onClick={handleAddExpense}
              className="w-full bg-gray-800 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1">
              <Plus size={16} /> Add Expense
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
