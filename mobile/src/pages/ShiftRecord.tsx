import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getShift, updateReadings, updateCollections, addShiftExpense, deleteShiftExpense, addShiftCredit, deleteShiftCredit, getCreditAccounts, addInvoiceConsumption, deleteInvoiceConsumption, getCurrentPrices, addShiftCreditReceipt, getExpenseCategories } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import { Save, Plus, Trash2, Search, UserPlus, Banknote } from 'lucide-react';

const PREDEFINED_EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Wages', 'Maintenance', 'Transport', 'Licenses',
  'Security', 'Bank Charges', 'Stationery', 'Communication', 'Generator Fuel',
  'Cleaning', 'Insurance', 'Accounting', 'Other',
];

export default function ShiftRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [shiftStatus, setShiftStatus] = useState<string>('open');
  const [readings, setReadings] = useState<any[]>([]);
  const [collections, setCollections] = useState({ cash_amount: 0, mpesa_amount: 0 });
  const [shiftCredits, setShiftCredits] = useState<any[]>([]);
  const [creditReceipts, setCreditReceipts] = useState<any[]>([]);
  const [invoiceConsumption, setInvoiceConsumption] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [newExp, setNewExp] = useState({ category: '', description: '', amount: '' });
  const [newCredit, setNewCredit] = useState({ customer_name: '', amount: '', description: '', account_id: null as number | null });
  const [newReceipt, setNewReceipt] = useState({ account_id: '', amount: '', payment_method: 'cash', notes: '' });
  // Phase 3B: invoice-mode form — shown only when the selected account is invoice-mode
  const [newInvoice, setNewInvoice] = useState({ fuel_type: 'petrol' as 'petrol' | 'diesel', litres: '' });
  const [selectedBillingMode, setSelectedBillingMode] = useState<'money' | 'invoice' | null>(null);
  const [tab, setTab] = useState<'readings' | 'collections' | 'credits' | 'expenses'>('readings');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  // Credit account search
  const [creditAccounts, setCreditAccounts] = useState<any[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<string[]>(PREDEFINED_EXPENSE_CATEGORIES);
  const [accountSearch, setAccountSearch] = useState('');
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [priceByFuel, setPriceByFuel] = useState<Record<string, number>>({});

  useEffect(() => { loadShift(); loadCreditAccounts(); loadCurrentPrices(); loadExpenseCategories(); }, [id]);

  async function loadExpenseCategories() {
    try {
      const res = await getExpenseCategories();
      setExpenseCategories(res.data.data || PREDEFINED_EXPENSE_CATEGORIES);
    } catch {
      setExpenseCategories(PREDEFINED_EXPENSE_CATEGORIES);
    }
  }

  async function loadCurrentPrices() {
    try {
      const res = await getCurrentPrices();
      const d = res.data.data || {};
      const map: Record<string, number> = {};
      if (d.petrol?.price_per_litre) map.petrol = Number(d.petrol.price_per_litre);
      if (d.diesel?.price_per_litre) map.diesel = Number(d.diesel.price_per_litre);
      setPriceByFuel(map);
    } catch (err) {
      console.error('[ShiftRecord:loadCurrentPrices]', err);
    }
  }

  async function loadCreditAccounts() {
    try {
      const res = await getCreditAccounts();
      setCreditAccounts(res.data.data || res.data);
    } catch (err) { console.error(err); }
  }

  // ---- Meter rollover helpers (mirror backend services/meterRollover.ts) ----
  function displayMod(cumulative: number, capacity: number): number {
    if (!(capacity > 0)) return cumulative;
    return Math.round((cumulative - Math.floor(cumulative / capacity) * capacity) * 100) / 100;
  }
  function compensateClient(opening: number, raw: number, capacity: number): { cumulative: number; rolledOver: boolean } {
    if (!(capacity > 0)) return { cumulative: raw, rolledOver: false };
    const rolloversSoFar = Math.floor(opening / capacity);
    const openingDisplay = opening - rolloversSoFar * capacity;
    if (raw >= openingDisplay) {
      return { cumulative: Math.round((rolloversSoFar * capacity + raw) * 100) / 100, rolledOver: false };
    }
    return { cumulative: Math.round(((rolloversSoFar + 1) * capacity + raw) * 100) / 100, rolledOver: true };
  }

  async function loadShift() {
    try {
      const res = await getShift(parseInt(id!));
      const d = res.data.data;
      setShiftStatus(d.status || 'open');
      const rs = (d.readings || []).map((r: any) => {
        const capL = Number(r.meter_capacity_litres) || 1000000;
        const capA = Number(r.meter_capacity_amount) || 1000000;
        return {
          ...r,
          raw_l_input: displayMod(Number(r.closing_litres) || 0, capL).toFixed(2),
          raw_a_input: displayMod(Number(r.closing_amount) || 0, capA).toFixed(2),
        };
      });
      setReadings(rs);
      if (d.collections) setCollections({ cash_amount: d.collections.cash_amount, mpesa_amount: d.collections.mpesa_amount });
      setShiftCredits(d.shift_credits || []);
      setCreditReceipts(d.credit_receipts || []);
      setInvoiceConsumption(d.invoice_consumption || []);
      setExpenses(d.expenses || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function saveReadings(opts: {
    confirmAnomaly?: boolean;
    confirmLargeSale?: boolean;
    rolloverByPump?: Record<number, { litres?: boolean; amount?: boolean }>;
  } = {}) {
    setSaving(true);
    try {
      const payload = readings.map(r => {
        const ro = opts.rolloverByPump?.[r.pump_id] || {};
        return {
          pump_id: r.pump_id,
          raw_closing_litres: parseFloat(r.raw_l_input) || 0,
          raw_closing_amount: parseFloat(r.raw_a_input) || 0,
          ...(ro.litres ? { rollover_litres: true } : {}),
          ...(ro.amount ? { rollover_amount: true } : {}),
        };
      });
      const res = await updateReadings(parseInt(id!), payload, opts.confirmAnomaly, opts.confirmLargeSale);
      const rs = (res.data.data || []).map((r: any) => {
        const capL = Number(r.meter_capacity_litres) || 1000000;
        const capA = Number(r.meter_capacity_amount) || 1000000;
        return {
          ...r,
          raw_l_input: displayMod(Number(r.closing_litres) || 0, capL).toFixed(2),
          raw_a_input: displayMod(Number(r.closing_amount) || 0, capA).toFixed(2),
        };
      });
      setReadings(rs);
      alert('Readings saved');
    } catch (err: any) {
      const data = err?.response?.data;
      if (err?.response?.status === 409 && data?.code === 'ROLLOVER_REQUIRED') {
        const lines = (data.rollovers || []).map((rv: any) =>
          `• ${rv.pump_label} (${rv.field}): display ${rv.raw.toFixed(2)} → cumulative ${rv.cumulative.toFixed(2)}`
        ).join('\n');
        setSaving(false);
        if (window.confirm(`Pump display rollover detected:\n\n${lines}\n\nThis means the meter passed its capacity (e.g. 999,999.99 → 0). Confirm to proceed?`)) {
          const rolloverByPump: Record<number, { litres?: boolean; amount?: boolean }> = {};
          for (const rv of data.rollovers || []) {
            rolloverByPump[rv.pump_id] = rolloverByPump[rv.pump_id] || {};
            if (rv.field === 'litres') rolloverByPump[rv.pump_id].litres = true;
            if (rv.field === 'amount') rolloverByPump[rv.pump_id].amount = true;
          }
          return saveReadings({ ...opts, rolloverByPump });
        }
        return;
      }
      if (err?.response?.status === 409 && data?.code === 'PRICE_ANOMALY') {
        const lines = (data.anomalies || []).map((a: any) =>
          `• ${a.pump_label}: KES ${a.observed.toFixed(2)}/L (expected ~KES ${a.expected.toFixed(2)}/L, ${a.deviation_pct > 0 ? '+' : ''}${a.deviation_pct}%)`
        ).join('\n');
        setSaving(false);
        if (window.confirm(`Price-per-litre looks off:\n\n${lines}\n\nDouble-check the readings. Save anyway?`)) {
          return saveReadings({ ...opts, confirmAnomaly: true });
        }
        return;
      }
      if (err?.response?.status === 409 && data?.code === 'LARGE_SALE_CONFIRMATION_REQUIRED') {
        const lines = (data.large_sales || []).map((s: any) =>
          `• ${s.pump_label}: ${Number(s.litres_sold).toFixed(2)} L / KES ${Number(s.amount_sold).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
        ).join('\n');
        setSaving(false);
        if (window.confirm(`Unusually large pump sale detected:\n\n${lines}\n\nRe-check the readings. Confirm only after manager approval.`)) {
          return saveReadings({ ...opts, confirmLargeSale: true });
        }
        return;
      }
      const msg = data?.error || err?.message || 'Failed to save readings';
      alert(msg);
      console.error('[ShiftRecord:saveReadings]', err);
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
    try {
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
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to add credit';
      alert(msg);
    }
  }

  async function handleAddCreditReceipt() {
    const amount = parseFloat(newReceipt.amount);
    if (!newReceipt.account_id || !Number.isFinite(amount) || amount <= 0) return;
    try {
      await addShiftCreditReceipt(parseInt(id!), {
        account_id: parseInt(newReceipt.account_id),
        amount,
        payment_method: newReceipt.payment_method,
        notes: newReceipt.notes || undefined,
      });
      setNewReceipt({ account_id: '', amount: '', payment_method: 'cash', notes: '' });
      await loadShift();
      await loadCreditAccounts();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to record payment';
      alert(msg);
    }
  }

  // Phase 3B: add a litre consumption entry for an invoice-mode customer.
  // No amount is collected — server computes retail_amount from fuel_prices.
  async function handleAddInvoice() {
    if (!newCredit.account_id || !newInvoice.litres) return;
    const litresNum = parseFloat(newInvoice.litres);
    if (!Number.isFinite(litresNum) || litresNum <= 0) {
      alert('Litres must be a positive number');
      return;
    }
    try {
      await addInvoiceConsumption(parseInt(id!), {
        account_id: newCredit.account_id,
        fuel_type: newInvoice.fuel_type,
        litres: litresNum,
      });
      setNewInvoice({ fuel_type: 'petrol', litres: '' });
      setNewCredit({ customer_name: '', amount: '', description: '', account_id: null });
      setAccountSearch('');
      setSelectedBillingMode(null);
      setIsNewCustomer(false);
      await loadShift();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to record consumption';
      alert(msg);
    }
  }

  async function handleDeleteInvoice(entryId: number) {
    try {
      await deleteInvoiceConsumption(parseInt(id!), entryId);
      await loadShift();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to delete entry';
      alert(msg);
    }
  }

  function selectAccount(account: any) {
    setNewCredit({ ...newCredit, customer_name: account.name, account_id: account.id });
    setAccountSearch(account.name);
    setShowAccountDropdown(false);
    setIsNewCustomer(false);
    setSelectedBillingMode((account.billing_mode as 'money' | 'invoice') || 'money');
  }

  function selectNewCustomer() {
    setIsNewCustomer(true);
    setShowAccountDropdown(false);
    setAccountSearch('');
    setNewCredit({ ...newCredit, customer_name: '', account_id: null });
    // New customers always start as money-mode (invoice-mode accounts must be
    // onboarded from the desktop CreditAccounts page first).
    setSelectedBillingMode('money');
  }

  const filteredAccounts = creditAccounts.filter(a =>
    a.type === 'customer' && a.name.toLowerCase().includes(accountSearch.toLowerCase())
  );

  async function handleDeleteCredit(creditId: number) {
    await deleteShiftCredit(parseInt(id!), creditId);
    await loadShift();
  }

  function updateReading(index: number, field: string, value: string) {
    const updated = [...readings];
    updated[index] = { ...updated[index], [field]: value };
    const row = updated[index];
    const oL = parseFloat(row.opening_litres) || 0;
    const oA = parseFloat(row.opening_amount) || 0;
    const capL = Number(row.meter_capacity_litres) || 1000000;
    const capA = Number(row.meter_capacity_amount) || 1000000;
    const rawL = parseFloat(row.raw_l_input) || 0;
    const rawA = parseFloat(row.raw_a_input) || 0;
    const cL = compensateClient(oL, rawL, capL);
    const cA = compensateClient(oA, rawA, capA);
    row.closing_litres = cL.cumulative;
    row.closing_amount = cA.cumulative;
    row.litres_sold = Math.max(0, cL.cumulative - oL);
    row.amount_sold = Math.max(0, cA.cumulative - oA);
    row._rolledOverL = cL.rolledOver;
    row._rolledOverA = cA.rolledOver;
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
  const totalCreditReceipts = creditReceipts.reduce((s: number, r: any) => s + Number(r.amount), 0);
  const totalInvoice = invoiceConsumption.reduce((s: number, c: any) => s + Number(c.retail_amount || 0), 0);
  const receiptAccounts = creditAccounts.filter((a: any) =>
    a.type === 'customer' &&
    ((a.billing_mode || 'money') === 'money') &&
    Number(a.outstanding_balance ?? a.balance ?? 0) > 0
  );
  const selectedReceiptAccount = receiptAccounts.find((a: any) => String(a.id) === String(newReceipt.account_id));
  const selectedReceiptBalance = Number(selectedReceiptAccount?.outstanding_balance ?? selectedReceiptAccount?.balance ?? 0);
  const receiptAmount = parseFloat(newReceipt.amount) || 0;

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
                  {Number(r.opening_litres) >= (Number(r.meter_capacity_litres) || 1000000) && (
                    <p className="text-[10px] text-gray-400">display {displayMod(Number(r.opening_litres), Number(r.meter_capacity_litres) || 1000000).toFixed(2)}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-400">Closing display (L)</label>
                  <input type="number" step="0.01" value={r.raw_l_input ?? ''}
                    onChange={e => updateReading(i, 'raw_l_input', e.target.value)}
                    onFocus={selectOnFocus} placeholder="display"
                    className={`w-full border rounded-lg p-2 text-sm ${r._rolledOverL ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`} />
                  {r._rolledOverL && (
                    <p className="text-[10px] text-amber-700 mt-0.5">↻ rolled → {Number(r.closing_litres).toFixed(2)}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-400">Opening (KES)</label>
                  <p className="text-sm font-medium text-gray-500">{parseFloat(r.opening_amount).toFixed(2)}</p>
                  {Number(r.opening_amount) >= (Number(r.meter_capacity_amount) || 1000000) && (
                    <p className="text-[10px] text-gray-400">display {displayMod(Number(r.opening_amount), Number(r.meter_capacity_amount) || 1000000).toFixed(2)}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-400">Closing display (KES)</label>
                  <input type="number" step="0.01" value={r.raw_a_input ?? ''}
                    onChange={e => updateReading(i, 'raw_a_input', e.target.value)}
                    onFocus={selectOnFocus} placeholder="display"
                    className={`w-full border rounded-lg p-2 text-sm ${r._rolledOverA ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`} />
                  {r._rolledOverA && (
                    <p className="text-[10px] text-amber-700 mt-0.5">↻ rolled → {Number(r.closing_amount).toFixed(2)}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-between mt-2 pt-2 border-t border-gray-100 text-xs">
                <span className="text-gray-400">Sold: <strong className="text-gray-700">{parseFloat(r.litres_sold).toFixed(2)} L</strong></span>
                <span className="text-gray-400">Amount: <strong className="text-gray-700">KES {(parseFloat(r.amount_sold) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</strong></span>
              </div>
              {(() => {
                const lSold = parseFloat(r.litres_sold) || 0;
                const aSold = parseFloat(r.amount_sold) || 0;
                const expectedPrice = priceByFuel[r.fuel_type];
                if (lSold === 0 && aSold === 0) return null;
                if (lSold > 0 && aSold === 0) {
                  return <p className="mt-1 text-xs text-red-600 font-semibold">⚠ Litres entered but amount is 0 — did you forget the closing amount?</p>;
                }
                if (aSold > 0 && lSold === 0) {
                  return <p className="mt-1 text-xs text-red-600 font-semibold">⚠ Amount entered but litres is 0 — did you forget the closing litres?</p>;
                }
                const observed = aSold / lSold;
                const off = expectedPrice ? Math.abs(observed - expectedPrice) / expectedPrice > 0.15 : false;
                return (
                  <p className={`mt-1 text-xs ${off ? 'text-red-600 font-semibold' : 'text-green-600'}`}>
                    @ KES {observed.toFixed(2)}/L
                    {expectedPrice ? ` (expected ~${expectedPrice.toFixed(2)})` : ''}
                  </p>
                );
              })()}
            </div>
          ))}
          <p className="text-xs text-gray-400 px-1">Closing accepts the digits showing on the pump display. Rollovers are detected automatically.</p>
          <button onClick={() => saveReadings({})} disabled={saving}
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
          {/* Phase 3B: invoice-mode litre entries — retail_amount counts toward shift balance */}
          {invoiceConsumption.map(c => (
            <div key={`inv-${c.id}`} className="bg-white rounded-xl p-3 shadow-sm flex items-center justify-between border-l-4 border-purple-400">
              <div>
                <p className="text-sm font-medium">{c.account_name}</p>
                <p className="text-xs text-gray-500">
                  {Number(c.litres).toLocaleString()} L {c.fuel_type} @ KES {Number(c.retail_price_at_time).toFixed(2)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">KES {Number(c.retail_amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
                {isAdmin && !c.invoice_line_id && (
                  <button onClick={() => handleDeleteInvoice(c.id)} className="text-red-400 p-1"><Trash2 size={16} /></button>
                )}
              </div>
            </div>
          ))}
          {(totalCredits > 0 || totalInvoice > 0) && (
            <div className="bg-gray-50 rounded-xl p-3 flex justify-between text-sm font-bold">
              <span>Total Credits {totalInvoice > 0 && <span className="text-xs font-normal text-gray-500">(incl. invoice)</span>}</span>
              <span>KES {(totalCredits + totalInvoice).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700 flex items-center gap-1">
                <Banknote size={15} /> Debt Payments Received
              </p>
              {totalCreditReceipts > 0 && (
                <span className="text-sm font-bold text-green-700">
                  KES {totalCreditReceipts.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>

            {creditReceipts.length > 0 && (
              <div className="space-y-2 mb-3">
                {creditReceipts.map((r: any) => (
                  <div key={r.id} className="bg-green-50 rounded-lg p-2 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{r.account_name}</p>
                      <p className="text-xs text-green-700 capitalize">{r.payment_method}</p>
                    </div>
                    <span className="text-sm font-semibold text-green-700">
                      KES {Number(r.amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {receiptAccounts.length === 0 ? (
              <p className="text-xs text-gray-400">No money-mode customer balances available for collection.</p>
            ) : (
              <div className="space-y-2">
                <select
                  value={newReceipt.account_id}
                  onChange={e => setNewReceipt({ ...newReceipt, account_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm bg-white"
                >
                  <option value="">Select customer balance...</option>
                  {receiptAccounts.map((a: any) => {
                    const balance = Number(a.outstanding_balance ?? a.balance ?? 0);
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name} - KES {balance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                      </option>
                    );
                  })}
                </select>

                <input
                  type="number"
                  step="0.01"
                  value={newReceipt.amount}
                  onChange={e => setNewReceipt({ ...newReceipt, amount: e.target.value })}
                  placeholder="Payment amount"
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm"
                />
                {selectedReceiptAccount && (
                  <p className={`text-xs ${receiptAmount > selectedReceiptBalance ? 'text-red-600' : 'text-gray-400'}`}>
                    Max payable: KES {selectedReceiptBalance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {['cash', 'mpesa'].map(method => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setNewReceipt({ ...newReceipt, payment_method: method })}
                      className={`py-2.5 rounded-lg text-sm font-medium capitalize border ${newReceipt.payment_method === method ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}
                    >
                      {method === 'mpesa' ? 'M-Pesa' : 'Cash'}
                    </button>
                  ))}
                </div>

                <input
                  value={newReceipt.notes}
                  onChange={e => setNewReceipt({ ...newReceipt, notes: e.target.value })}
                  placeholder="Notes (optional)"
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm"
                />

                <button
                  onClick={handleAddCreditReceipt}
                  disabled={!newReceipt.account_id || !newReceipt.amount || receiptAmount > selectedReceiptBalance}
                  className="w-full bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <Plus size={16} /> Record Payment
                </button>
              </div>
            )}
          </div>
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
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${a.type === 'customer' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                              {a.type}
                            </span>
                            {a.billing_mode === 'invoice' && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                                Invoice
                              </span>
                            )}
                          </div>
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

            {selectedBillingMode === 'invoice' ? (
              <>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 mb-2 text-xs text-purple-800">
                  Invoice-mode customer — record <strong>litres & fuel type</strong>. Amount is tallied at retail price for the shift balance; final invoice uses the agreed price.
                </div>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setNewInvoice({ ...newInvoice, fuel_type: 'petrol' })}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border ${newInvoice.fuel_type === 'petrol' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                  >Petrol</button>
                  <button
                    onClick={() => setNewInvoice({ ...newInvoice, fuel_type: 'diesel' })}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border ${newInvoice.fuel_type === 'diesel' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                  >Diesel</button>
                </div>
                <input type="number" step="0.01" value={newInvoice.litres} onChange={e => setNewInvoice({ ...newInvoice, litres: e.target.value })}
                  placeholder="Litres" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
                <button onClick={handleAddInvoice}
                  className="w-full bg-purple-600 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1">
                  <Plus size={16} /> Record Litres
                </button>
              </>
            ) : (
              <>
                <input value={newCredit.description} onChange={e => setNewCredit({ ...newCredit, description: e.target.value })}
                  placeholder="Optional details" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
                <input type="number" value={newCredit.amount} onChange={e => setNewCredit({ ...newCredit, amount: e.target.value })}
                  placeholder="Amount" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
                <button onClick={handleAddCredit}
                  className="w-full bg-gray-800 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1">
                  <Plus size={16} /> Add Credit
                </button>
              </>
            )}
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
            <select value={newExp.category} onChange={e => setNewExp({ ...newExp, category: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm bg-white">
              <option value="">Select category...</option>
              {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={newExp.description} onChange={e => setNewExp({ ...newExp, description: e.target.value })}
              placeholder="Description (optional)" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
            <input type="number" value={newExp.amount} onChange={e => setNewExp({ ...newExp, amount: e.target.value })}
              placeholder="Amount" className="w-full border border-gray-300 rounded-lg p-3 mb-2 text-sm" />
            <button onClick={handleAddExpense}
              disabled={!newExp.category || !newExp.amount}
              className="w-full bg-gray-800 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50">
              <Plus size={16} /> Add Expense
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
