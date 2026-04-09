import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getShift, updateReadings, updateCollections, addShiftExpense,
  deleteShiftExpense, closeShift, addShiftCredit, deleteShiftCredit,
  repayDebt, getCreditAccounts, getShiftTankSummary,
} from '../services/api';
import { Save, Plus, Trash2, Lock, ArrowLeft, AlertTriangle, DollarSign, Droplets } from 'lucide-react';

export default function ShiftDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shift, setShift] = useState<any>(null);
  const [readings, setReadings] = useState<any[]>([]);
  const [collections, setCollections] = useState({ cash_amount: 0, mpesa_amount: 0 });
  const [shiftCredits, setShiftCredits] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [wageDeduction, setWageDeduction] = useState<any>(null);
  const [outstandingDebts, setOutstandingDebts] = useState<any[]>([]);
  const [totalOutstandingDebt, setTotalOutstandingDebt] = useState(0);
  const [newExpense, setNewExpense] = useState({ category: '', description: '', amount: '' });
  const [newCredit, setNewCredit] = useState({ customer_name: '', customer_phone: '', amount: '', description: '' });
  const [creditAccounts, setCreditAccounts] = useState<any[]>([]);
  const [creditMode, setCreditMode] = useState<'existing' | 'new'>('existing');
  const [creditSearchQuery, setCreditSearchQuery] = useState('');
  const [showCreditDropdown, setShowCreditDropdown] = useState(false);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [deductOption, setDeductOption] = useState<'full' | 'partial' | 'none'>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [showDebtRepayModal, setShowDebtRepayModal] = useState(false);
  const [debtRepayAmount, setDebtRepayAmount] = useState('');
  const [tankSummary, setTankSummary] = useState<any[]>([]);
  const [wagePaid, setWagePaid] = useState('');

  useEffect(() => { loadShift(); loadCreditAccounts(); }, [id]);

  async function loadCreditAccounts() {
    try {
      const res = await getCreditAccounts();
      setCreditAccounts(res.data.data || res.data || []);
    } catch (err) {
      console.error('Failed to load credit accounts:', err);
    }
  }

  async function loadShift() {
    try {
      const res = await getShift(parseInt(id!));
      const d = res.data.data;
      setShift(d);
      setReadings(d.readings);
      if (d.collections) {
        setCollections({ cash_amount: d.collections.cash_amount, mpesa_amount: d.collections.mpesa_amount });
      }
      setShiftCredits(d.shift_credits || []);
      setExpenses(d.expenses);
      setWageDeduction(d.wage_deduction || null);
      setOutstandingDebts(d.outstanding_debts || []);
      setTotalOutstandingDebt(d.total_outstanding_debt || 0);
      setNotes(d.notes || '');
      setWagePaid(String(d.employee_wage || 0));
      // Load tank stock summary
      try {
        const tankRes = await getShiftTankSummary(parseInt(id!));
        setTankSummary(tankRes.data.data?.tanks || []);
      } catch { setTankSummary([]); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleSaveReadings() {
    setSaving(true);
    try {
      const payload = readings.map(r => ({
        pump_id: r.pump_id,
        closing_litres: parseFloat(r.closing_litres) || 0,
        closing_amount: parseFloat(r.closing_amount) || 0,
      }));
      const res = await updateReadings(parseInt(id!), payload);
      setReadings(res.data.data);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  async function handleSaveCollections() {
    setSaving(true);
    try {
      const creditsTotal = shiftCredits.reduce((s: number, c: any) => s + c.amount, 0);
      await updateCollections(parseInt(id!), {
        cash_amount: parseFloat(String(collections.cash_amount)) || 0,
        mpesa_amount: parseFloat(String(collections.mpesa_amount)) || 0,
        credits_amount: creditsTotal,
      });
      await loadShift();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  async function handleAddExpense() {
    if (!newExpense.category || !newExpense.amount) return;
    await addShiftExpense(parseInt(id!), {
      category: newExpense.category, description: newExpense.description,
      amount: parseFloat(newExpense.amount),
    });
    setNewExpense({ category: '', description: '', amount: '' });
    await loadShift();
  }

  async function handleDeleteExpense(expenseId: number) {
    await deleteShiftExpense(parseInt(id!), expenseId);
    await loadShift();
  }

  async function handleAddCredit() {
    if (!newCredit.customer_name || !newCredit.amount) return;
    const payload: any = {
      customer_name: newCredit.customer_name,
      amount: parseFloat(newCredit.amount),
      description: newCredit.description,
    };
    if (creditMode === 'new' && newCredit.customer_phone) {
      payload.customer_phone = newCredit.customer_phone;
    }
    await addShiftCredit(parseInt(id!), payload);
    setNewCredit({ customer_name: '', customer_phone: '', amount: '', description: '' });
    setCreditSearchQuery('');
    setCreditMode('existing');
    await loadShift();
  }

  async function handleDeleteCredit(creditId: number) {
    await deleteShiftCredit(parseInt(id!), creditId);
    await loadShift();
  }

  async function handleCloseShift() {
    let deductAmount: number | null = null;
    if (variance < 0) {
      if (deductOption === 'full') {
        deductAmount = Math.min(Math.abs(variance), employeeWage);
      } else if (deductOption === 'partial') {
        deductAmount = Math.min(parseFloat(partialAmount) || 0, employeeWage, Math.abs(variance));
      }
      // 'none' = null (no deduction, full deficit becomes debt)
    }
    try {
      const res = await closeShift(parseInt(id!), { notes, deduct_amount: deductAmount, wage_paid: parseFloat(wagePaid) || 0 });
      setShowCloseModal(false);
      if (res.data?.warnings?.length) {
        alert('Shift closed with warnings:\n\n' + res.data.warnings.join('\n'));
      }
      await loadShift();
    } catch (err) { console.error(err); }
  }

  async function handleRepayDebt() {
    const amount = parseFloat(debtRepayAmount);
    if (!amount || amount <= 0) return;
    try {
      await repayDebt(parseInt(id!), amount);
      setShowDebtRepayModal(false);
      setDebtRepayAmount('');
      await loadShift();
    } catch (err) { console.error(err); }
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

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!shift) return <div className="text-red-500">Shift not found</div>;

  const isOpen = shift.status === 'open';
  const numVal = (v: any) => { const n = parseFloat(v); return n === 0 ? '' : v; };
  const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();
  const expectedSales = readings.reduce((s: number, r: any) => s + (parseFloat(r.amount_sold) || 0), 0);
  const totalCash = parseFloat(String(collections.cash_amount)) || 0;
  const totalMpesa = parseFloat(String(collections.mpesa_amount)) || 0;
  const totalCredits = shiftCredits.reduce((s: number, c: any) => s + c.amount, 0);
  const totalExpenses = expenses.reduce((s: number, e: any) => s + e.amount, 0);
  const employeeWage = shift.employee_wage || 0;
  const totalAccounted = totalCash + totalMpesa + totalCredits + totalExpenses + employeeWage;
  const variance = totalAccounted - expectedSales;
  const formatKES = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <button onClick={() => navigate('/shifts')} className="flex items-center gap-1 text-blue-600 hover:underline mb-4 text-sm">
        <ArrowLeft size={16} /> Back to Shifts
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Shift #{shift.id} — {shift.employee_name}</h1>
          <p className="text-sm text-gray-500">
            Shift Date: {shift.shift_date || new Date(shift.start_time).toLocaleDateString('en-KE')}
            {' · '}Started: {new Date(shift.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
            {shift.end_time && ` — Closed: ${new Date(shift.end_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </div>

      {/* Outstanding Debt Banner */}
      {totalOutstandingDebt > 0 && isOpen && (
        <div className="bg-orange-50 border border-orange-300 rounded-lg p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign size={18} className="text-orange-600" />
            <div>
              <p className="text-sm font-semibold text-orange-800">Outstanding Staff Debt</p>
              <p className="text-xs text-orange-600">{shift.employee_name} owes {formatKES(totalOutstandingDebt)} from previous shifts</p>
            </div>
          </div>
          <button onClick={() => { setDebtRepayAmount(String(Math.min(totalOutstandingDebt, employeeWage))); setShowDebtRepayModal(true); }}
            className="bg-orange-500 text-white px-3 py-1.5 rounded text-sm hover:bg-orange-600">
            Repay from Wage
          </button>
        </div>
      )}

      {/* Accountability Summary Card */}
      <div className={`rounded-lg p-4 mb-6 ${variance >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Shift Accountability</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mb-3">
          <div className="flex justify-between">
            <span className="text-gray-500">Expected Sales (Pump)</span>
            <span className="font-bold text-gray-800">{formatKES(expectedSales)}</span>
          </div>
          <div></div>

          <div className="flex justify-between">
            <span className="text-gray-500">Cash</span>
            <span className="font-medium">{formatKES(totalCash)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">M-Pesa</span>
            <span className="font-medium">{formatKES(totalMpesa)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Credits</span>
            <span className="font-medium">{formatKES(totalCredits)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Expenses</span>
            <span className="font-medium">{formatKES(totalExpenses)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Wage ({shift.employee_name})</span>
            <span className="font-medium">{formatKES(employeeWage)}</span>
          </div>
        </div>
        <div className="border-t pt-2 flex justify-between items-center">
          <div className="flex justify-between flex-1 mr-8">
            <span className="font-semibold text-gray-700">Total Accounted</span>
            <span className="font-bold text-gray-800">{formatKES(totalAccounted)}</span>
          </div>
          <div className="text-right">
            <span className="text-xs text-gray-500 uppercase mr-2">Variance</span>
            <span className={`text-xl font-bold ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {variance >= 0 ? '+' : ''}{formatKES(variance)}
            </span>
            {variance < 0 && <p className="text-xs text-red-500 flex items-center justify-end gap-1"><AlertTriangle size={12} /> Shortage</p>}
            {variance > 0 && <p className="text-xs text-green-500">Surplus</p>}
          </div>
        </div>
      </div>

      {/* Tank Stock Movement */}
      {tankSummary.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2 mb-3">
            <Droplets size={18} /> Tank Stock Movement
          </h2>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 font-medium text-gray-600">Tank</th>
                <th className="text-right p-2 font-medium text-gray-600">Opening (L)</th>
                <th className="text-right p-2 font-medium text-gray-600">Deliveries (L)</th>
                <th className="text-right p-2 font-medium text-gray-600">Sales (L)</th>
                <th className="text-right p-2 font-medium text-gray-600">Closing (L)</th>
              </tr>
            </thead>
            <tbody>
              {tankSummary.map((t: any) => (
                <tr key={t.tank_id} className="border-t hover:bg-gray-50">
                  <td className="p-2">
                    <span className="font-medium">{t.tank_label}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${t.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                      {t.fuel_type}
                    </span>
                  </td>
                  <td className="p-2 text-right">{Number(t.opening_stock_litres || 0).toFixed(1)}</td>
                  <td className="p-2 text-right text-green-600">{Number(t.deliveries_litres || 0) > 0 ? `+${Number(t.deliveries_litres).toFixed(1)}` : '—'}</td>
                  <td className="p-2 text-right text-red-600">{Number(t.sales_litres || 0) > 0 ? `-${Number(t.sales_litres).toFixed(1)}` : '—'}</td>
                  <td className="p-2 text-right font-semibold">{Number(t.closing_stock_litres || 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Wage & Deduction */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="text-lg font-semibold text-gray-700">Wage</h2>
        <div className="mt-2 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Daily Wage</span>
            <span className="font-medium">{formatKES(employeeWage)}</span>
          </div>
          {wageDeduction && (
            <>
              <div className="flex justify-between text-red-600">
                <span>{wageDeduction.reason}</span>
                <span className="font-medium">-{formatKES(wageDeduction.deduction_amount)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold">
                <span className="text-gray-700">Final Wage</span>
                <span className="text-gray-800">{formatKES(wageDeduction.final_wage)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pump Readings */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-700">Pump Readings</h2>
          {isOpen && (
            <button onClick={handleSaveReadings} disabled={saving} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
              <Save size={14} /> Save Readings
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Pump</th>
              <th className="text-left p-2 font-medium text-gray-600">Fuel</th>
              <th className="text-right p-2 font-medium text-gray-600">Opening (L)</th>
              <th className="text-right p-2 font-medium text-gray-600">Closing (L)</th>
              <th className="text-right p-2 font-medium text-gray-600">Litres Sold</th>
              <th className="text-right p-2 font-medium text-gray-600">Opening (KES)</th>
              <th className="text-right p-2 font-medium text-gray-600">Closing (KES)</th>
              <th className="text-right p-2 font-medium text-gray-600">Amount Sold</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((r: any, i: number) => (
              <tr key={r.id || i} className="border-t">
                <td className="p-2 font-medium">{r.pump_label} {r.nozzle_label}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${r.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                    {r.fuel_type}
                  </span>
                </td>
                <td className="p-2 text-right text-gray-500">{parseFloat(r.opening_litres).toFixed(2)}</td>
                <td className="p-2 text-right">
                  {isOpen ? (
                    <input type="number" step="0.01" value={numVal(r.closing_litres)}
                      onChange={e => updateReading(i, 'closing_litres', e.target.value)}
                      onFocus={selectOnFocus} placeholder="0.00"
                      className="w-28 text-right border border-gray-300 rounded p-1" />
                  ) : parseFloat(r.closing_litres).toFixed(2)}
                </td>
                <td className="p-2 text-right font-medium">{parseFloat(r.litres_sold).toFixed(2)}</td>
                <td className="p-2 text-right text-gray-500">{parseFloat(r.opening_amount).toFixed(2)}</td>
                <td className="p-2 text-right">
                  {isOpen ? (
                    <input type="number" step="0.01" value={numVal(r.closing_amount)}
                      onChange={e => updateReading(i, 'closing_amount', e.target.value)}
                      onFocus={selectOnFocus} placeholder="0.00"
                      className="w-32 text-right border border-gray-300 rounded p-1" />
                  ) : parseFloat(r.closing_amount).toFixed(2)}
                </td>
                <td className="p-2 text-right font-bold">{formatKES(parseFloat(r.amount_sold) || 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-bold">
            <tr>
              <td colSpan={4} className="p-2 text-right">Totals:</td>
              <td className="p-2 text-right">{readings.reduce((s: number, r: any) => s + (parseFloat(r.litres_sold) || 0), 0).toFixed(2)} L</td>
              <td colSpan={2}></td>
              <td className="p-2 text-right">{formatKES(expectedSales)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Collections */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-700">Collections</h2>
          {isOpen && (
            <button onClick={handleSaveCollections} disabled={saving} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
              <Save size={14} /> Save
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Cash (KES)</label>
            <input type="number" step="0.01" value={numVal(collections.cash_amount)} disabled={!isOpen}
              onChange={e => setCollections({ ...collections, cash_amount: parseFloat(e.target.value) || 0 })}
              onFocus={selectOnFocus} placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">M-Pesa (KES)</label>
            <input type="number" step="0.01" value={numVal(collections.mpesa_amount)} disabled={!isOpen}
              onChange={e => setCollections({ ...collections, mpesa_amount: parseFloat(e.target.value) || 0 })}
              onFocus={selectOnFocus} placeholder="0.00"
              className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Total (Cash + M-Pesa)</label>
            <div className="w-full border border-gray-200 rounded-lg p-2 bg-gray-50 font-bold text-lg">
              {formatKES(totalCash + totalMpesa)}
            </div>
          </div>
        </div>
      </div>

      {/* Credits */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Credits Given</h2>
        {shiftCredits.length > 0 && (
          <table className="w-full text-sm mb-3">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 font-medium text-gray-600">Customer</th>
                <th className="text-left p-2 font-medium text-gray-600">Description</th>
                <th className="text-right p-2 font-medium text-gray-600">Amount</th>
                {isOpen && <th className="p-2"></th>}
              </tr>
            </thead>
            <tbody>
              {shiftCredits.map((c: any) => (
                <tr key={c.id} className="border-t">
                  <td className="p-2 font-medium">{c.customer_name}</td>
                  <td className="p-2 text-gray-600">{c.description || '-'}</td>
                  <td className="p-2 text-right font-medium">{formatKES(c.amount)}</td>
                  {isOpen && (
                    <td className="p-2 text-right">
                      <button onClick={() => handleDeleteCredit(c.id)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-bold">
              <tr>
                <td colSpan={2} className="p-2 text-right">Total Credits:</td>
                <td className="p-2 text-right">{formatKES(totalCredits)}</td>
                {isOpen && <td></td>}
              </tr>
            </tfoot>
          </table>
        )}
        {shiftCredits.length === 0 && !isOpen && <p className="text-sm text-gray-400">No credits for this shift</p>}
        {isOpen && (
          <div className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <label className="block text-xs text-gray-500 mb-1">Customer</label>
                {creditMode === 'existing' ? (
                  <div className="relative">
                    <input
                      value={creditSearchQuery}
                      onChange={e => {
                        setCreditSearchQuery(e.target.value);
                        setShowCreditDropdown(true);
                        if (!e.target.value) {
                          setNewCredit({ ...newCredit, customer_name: '' });
                        }
                      }}
                      onFocus={() => setShowCreditDropdown(true)}
                      onBlur={() => setTimeout(() => setShowCreditDropdown(false), 200)}
                      placeholder="Search existing accounts..."
                      className="w-full border border-gray-300 rounded p-2 text-sm"
                    />
                    {showCreditDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {creditAccounts
                          .filter(a => !creditSearchQuery || a.name?.toLowerCase().includes(creditSearchQuery.toLowerCase()))
                          .map(a => (
                            <button
                              key={a.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm flex justify-between items-center"
                              onMouseDown={e => {
                                e.preventDefault();
                                setNewCredit({ ...newCredit, customer_name: a.name });
                                setCreditSearchQuery(a.name);
                                setShowCreditDropdown(false);
                              }}
                            >
                              <span className="font-medium">{a.name}</span>
                              <span className={`px-1.5 py-0.5 rounded text-xs ${a.type === 'employee' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                                {a.type}
                              </span>
                            </button>
                          ))}
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm text-blue-600 font-medium border-t"
                          onMouseDown={e => {
                            e.preventDefault();
                            setCreditMode('new');
                            setCreditSearchQuery('');
                            setNewCredit({ ...newCredit, customer_name: '', customer_phone: '' });
                            setShowCreditDropdown(false);
                          }}
                        >
                          + Add new customer
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={newCredit.customer_name}
                      onChange={e => setNewCredit({ ...newCredit, customer_name: e.target.value })}
                      placeholder="Customer name"
                      className="flex-1 border border-gray-300 rounded p-2 text-sm"
                    />
                    <input
                      value={newCredit.customer_phone}
                      onChange={e => setNewCredit({ ...newCredit, customer_phone: e.target.value })}
                      placeholder="Phone (optional)"
                      className="w-36 border border-gray-300 rounded p-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setCreditMode('existing');
                        setCreditSearchQuery('');
                        setNewCredit({ ...newCredit, customer_name: '', customer_phone: '' });
                      }}
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      Use existing
                    </button>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
                <input value={newCredit.description} onChange={e => setNewCredit({ ...newCredit, description: e.target.value })}
                  placeholder="Optional details" className="w-full border border-gray-300 rounded p-2 text-sm" />
              </div>
              <div className="w-32">
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <input type="number" step="0.01" value={newCredit.amount} onChange={e => setNewCredit({ ...newCredit, amount: e.target.value })}
                  placeholder="0.00" className="w-full border border-gray-300 rounded p-2 text-sm" />
              </div>
              <button onClick={handleAddCredit} className="bg-gray-800 text-white px-3 py-2 rounded text-sm hover:bg-gray-900 flex items-center gap-1">
                <Plus size={14} /> Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Expenses */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Shift Expenses</h2>
        {expenses.length > 0 && (
          <table className="w-full text-sm mb-3">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 font-medium text-gray-600">Category</th>
                <th className="text-left p-2 font-medium text-gray-600">Description</th>
                <th className="text-right p-2 font-medium text-gray-600">Amount</th>
                {isOpen && <th className="p-2"></th>}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e: any) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2">{e.category}</td>
                  <td className="p-2 text-gray-600">{e.description}</td>
                  <td className="p-2 text-right font-medium">{formatKES(e.amount)}</td>
                  {isOpen && (
                    <td className="p-2 text-right">
                      <button onClick={() => handleDeleteExpense(e.id)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-bold">
              <tr>
                <td colSpan={2} className="p-2 text-right">Total Expenses:</td>
                <td className="p-2 text-right">{formatKES(totalExpenses)}</td>
                {isOpen && <td></td>}
              </tr>
            </tfoot>
          </table>
        )}
        {expenses.length === 0 && !isOpen && <p className="text-sm text-gray-400">No expenses for this shift</p>}
        {isOpen && (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <input value={newExpense.category} onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
                placeholder="e.g. Generator Fuel, Cleaning" className="w-full border border-gray-300 rounded p-2 text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <input value={newExpense.description} onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                placeholder="Details" className="w-full border border-gray-300 rounded p-2 text-sm" />
            </div>
            <div className="w-32">
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input type="number" step="0.01" value={newExpense.amount} onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                placeholder="0.00" className="w-full border border-gray-300 rounded p-2 text-sm" />
            </div>
            <button onClick={handleAddExpense} className="bg-gray-800 text-white px-3 py-2 rounded text-sm hover:bg-gray-900 flex items-center gap-1">
              <Plus size={14} /> Add
            </button>
          </div>
        )}
      </div>

      {/* Close Shift */}
      {isOpen && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Close Shift</h2>
          <label className="block text-sm text-gray-600 mb-1">Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            className="w-full border border-gray-300 rounded-lg p-2 mb-3"
            placeholder="Any notes about this shift..." />
          <button onClick={() => setShowCloseModal(true)}
            className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">
            <Lock size={16} /> Close & Lock Shift
          </button>
        </div>
      )}

      {/* Close Shift Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Close Shift #{shift.id}</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Wages Paid This Shift (KES)</label>
              <input type="number" step="0.01" min="0" value={wagePaid}
                onChange={e => setWagePaid(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2"
              />
              <p className="text-xs text-gray-400 mt-1">
                Default: employee daily wage. Set to 0 if already paid in a previous shift today.
              </p>
            </div>

            {variance >= 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-green-800">
                  {variance === 0 ? 'Shift balanced perfectly.' : `Surplus of ${formatKES(variance)}.`}
                </p>
                <p className="text-xs text-green-600 mt-1">Wage: {formatKES(employeeWage)} (full)</p>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-800 font-semibold">Deficit: {formatKES(Math.abs(variance))}</p>
                <p className="text-xs text-red-600 mt-1">Daily wage: {formatKES(employeeWage)}</p>

                <div className="mt-3 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="deduct" checked={deductOption === 'full'}
                      onChange={() => setDeductOption('full')} className="text-red-600" />
                    <span className="text-sm">
                      Deduct {formatKES(Math.min(Math.abs(variance), employeeWage))} from wage
                      {Math.abs(variance) > employeeWage && (
                        <span className="text-red-500 text-xs ml-1">
                          ({formatKES(Math.abs(variance) - employeeWage)} carried as debt)
                        </span>
                      )}
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="deduct" checked={deductOption === 'partial'}
                      onChange={() => setDeductOption('partial')} className="text-red-600" />
                    <span className="text-sm">Deduct partial amount</span>
                  </label>
                  {deductOption === 'partial' && (
                    <div className="ml-6">
                      <input type="number" step="0.01" value={partialAmount}
                        onChange={e => setPartialAmount(e.target.value)}
                        placeholder="Amount to deduct" className="border border-gray-300 rounded p-2 text-sm w-48" />
                      {partialAmount && (
                        <p className="text-xs text-gray-500 mt-1">
                          Wage: {formatKES(employeeWage - Math.min(parseFloat(partialAmount) || 0, employeeWage))} |
                          Debt: {formatKES(Math.abs(variance) - Math.min(parseFloat(partialAmount) || 0, Math.abs(variance)))}
                        </p>
                      )}
                    </div>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="deduct" checked={deductOption === 'none'}
                      onChange={() => setDeductOption('none')} className="text-red-600" />
                    <span className="text-sm">
                      Don't deduct
                      <span className="text-red-500 text-xs ml-1">({formatKES(Math.abs(variance))} carried as debt)</span>
                    </span>
                  </label>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowCloseModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button onClick={handleCloseShift} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                Close Shift
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debt Repay Modal */}
      {showDebtRepayModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Repay Staff Debt</h2>
            <p className="text-sm text-gray-600 mb-2">
              {shift.employee_name} has {formatKES(totalOutstandingDebt)} outstanding debt.
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Daily wage: {formatKES(employeeWage)}
            </p>

            {outstandingDebts.filter((d: any) => d.status === 'outstanding').map((d: any) => (
              <div key={d.id} className="text-xs text-gray-500 mb-1 flex justify-between">
                <span>Shift #{d.shift_id} deficit</span>
                <span>{formatKES(d.balance)} remaining</span>
              </div>
            ))}

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Deduct from this shift's wage</label>
              <input type="number" step="0.01" value={debtRepayAmount}
                onChange={e => setDebtRepayAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
              {debtRepayAmount && (
                <p className="text-xs text-gray-500 mt-1">
                  Wage after deduction: {formatKES(employeeWage - Math.min(parseFloat(debtRepayAmount) || 0, employeeWage))}
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowDebtRepayModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button onClick={handleRepayDebt} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
                Deduct & Repay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
