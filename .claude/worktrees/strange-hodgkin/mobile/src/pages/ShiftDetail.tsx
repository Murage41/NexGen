import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getShift, closeShift, getStaffDebts, repayDebt } from '../services/api';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import { AlertTriangle, Lock, Edit3, X, DollarSign, CreditCard } from 'lucide-react';

export default function ShiftDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [shift, setShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [deductOption, setDeductOption] = useState<'full' | 'partial' | 'none'>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closing, setClosing] = useState(false);

  // Debt repay state
  const [debts, setDebts] = useState<any[]>([]);
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [repayAmount, setRepayAmount] = useState('');
  const [repaying, setRepaying] = useState(false);

  useEffect(() => { loadShift(); }, [id]);

  async function loadShift() {
    try {
      const res = await getShift(parseInt(id!));
      const d = res.data.data;
      setShift(d);
      // Use outstanding_debts from shift response, or fetch separately
      if (d.outstanding_debts) {
        setDebts(d.outstanding_debts);
      } else if (d.employee_id) {
        try {
          const debtRes = await getStaffDebts(d.employee_id);
          setDebts(debtRes.data.data?.debts || []);
        } catch { setDebts([]); }
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleClose() {
    setClosing(true);
    try {
      let deduct_amount: number | null = null;
      if (variance < 0) {
        const deficit = Math.abs(variance);
        const wage = shift.employee_wage || 0;
        if (deductOption === 'full') {
          deduct_amount = Math.min(deficit, wage);
        } else if (deductOption === 'partial') {
          const amt = parseFloat(partialAmount) || 0;
          deduct_amount = Math.min(amt, wage, deficit);
        } else {
          deduct_amount = 0;
        }
      }
      await closeShift(parseInt(id!), { notes: closeNotes || undefined, deduct_amount });
      setShowCloseModal(false);
      await loadShift();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to close shift');
    } finally { setClosing(false); }
  }

  async function handleRepayDebt() {
    const amt = parseFloat(repayAmount);
    if (!amt || amt <= 0) return;
    setRepaying(true);
    try {
      await repayDebt(parseInt(id!), amt);
      setShowDebtModal(false);
      setRepayAmount('');
      await loadShift();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to repay debt');
    } finally { setRepaying(false); }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;
  if (!shift) return <div className="text-center text-red-500 mt-20">Shift not found</div>;

  const fmt = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isOpen = shift.status === 'open';
  const expected = shift.expected_sales || 0;
  const totalCash = shift.total_cash || 0;
  const totalMpesa = shift.total_mpesa || 0;
  const totalCredits = shift.total_credits || 0;
  const totalExpenses = shift.total_expenses || 0;
  const employeeWage = shift.employee_wage || 0;
  const totalAccounted = totalCash + totalMpesa + totalCredits + totalExpenses + employeeWage;
  const variance = totalAccounted - expected;

  const totalDebt = debts.reduce((s: number, d: any) => s + (d.balance || 0), 0);

  return (
    <div className="pb-6">
      <PageHeader title={`Shift #${shift.id}`} back />

      {/* Summary */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-800">{shift.employee_name}</p>
          <p className="text-xs text-gray-400">{new Date(shift.start_time).toLocaleString('en-KE')}</p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {isOpen ? 'Open' : 'Closed'}
        </span>
      </div>

      {/* Outstanding Debt Banner (admin only) */}
      {isAdmin && isOpen && totalDebt > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-orange-600" />
            <div>
              <p className="text-sm font-semibold text-orange-800">Outstanding Debt</p>
              <p className="text-xs text-orange-600">{debts.length} unpaid shift deficit{debts.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-orange-700">{fmt(totalDebt)}</p>
            <button onClick={() => { setRepayAmount(String(Math.min(totalDebt, employeeWage))); setShowDebtModal(true); }}
              className="text-xs text-orange-600 underline mt-0.5">Repay from Wage</button>
          </div>
        </div>
      )}

      {/* Accountability Card */}
      <div className={`rounded-xl p-4 mb-4 ${variance >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <p className="text-[10px] text-gray-500 uppercase font-semibold mb-2">Accountability</p>

        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">Expected (Pump Sales)</span>
          <span className="font-bold">{fmt(expected)}</span>
        </div>

        <div className="border-t border-gray-200 pt-1 mt-1 space-y-0.5 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Cash</span>
            <span>{fmt(totalCash)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">M-Pesa</span>
            <span>{fmt(totalMpesa)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Credits</span>
            <span>{fmt(totalCredits)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Expenses</span>
            <span>{fmt(totalExpenses)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Wage</span>
            <span>{fmt(employeeWage)}</span>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-1 mt-1 flex justify-between text-sm">
          <span className="font-semibold text-gray-700">Total Accounted</span>
          <span className="font-bold">{fmt(totalAccounted)}</span>
        </div>

        <div className="border-t border-gray-300 pt-2 mt-2 flex justify-between items-center">
          <span className="text-xs text-gray-500 uppercase font-semibold">Variance</span>
          <span className={`text-lg font-bold ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {variance >= 0 ? '+' : ''}{fmt(variance)}
          </span>
        </div>
        {variance < 0 && (
          <div className="flex items-center gap-1 justify-end mt-0.5">
            <AlertTriangle size={12} className="text-red-500" />
            <span className="text-xs text-red-500">Shortage</span>
          </div>
        )}
      </div>

      {/* Wage & Deduction */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
        <p className="font-semibold text-gray-700 mb-2">Wage</p>
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Daily Wage</span>
            <span className="font-medium">{fmt(employeeWage)}</span>
          </div>
          {shift.wage_deduction && (
            <>
              <div className="flex justify-between text-red-600">
                <span className="text-xs">{shift.wage_deduction.reason}</span>
                <span className="font-medium">-{fmt(shift.wage_deduction.deduction_amount)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold">
                <span className="text-gray-700">Final Wage</span>
                <span>{fmt(shift.wage_deduction.final_wage)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Readings */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
        <p className="font-semibold text-gray-700 mb-2">Pump Readings</p>
        {shift.readings?.map((r: any) => (
          <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
            <div>
              <p className="text-sm font-medium">{r.pump_label} {r.nozzle_label}</p>
              <p className="text-xs text-gray-400">{r.fuel_type} · {parseFloat(r.litres_sold).toFixed(1)} L</p>
            </div>
            <p className="font-semibold text-sm">{fmt(parseFloat(r.amount_sold) || 0)}</p>
          </div>
        ))}
        {(!shift.readings || shift.readings.length === 0) && <p className="text-sm text-gray-400">No readings</p>}
      </div>

      {/* Collections */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
        <p className="font-semibold text-gray-700 mb-2">Collections</p>
        {shift.collections ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Cash</span><span>{fmt(shift.collections.cash_amount)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">M-Pesa</span><span>{fmt(shift.collections.mpesa_amount)}</span></div>
          </div>
        ) : <p className="text-sm text-gray-400">Not recorded yet</p>}
      </div>

      {/* Credits */}
      {shift.shift_credits?.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
          <p className="font-semibold text-gray-700 mb-2">Credits Given</p>
          {shift.shift_credits.map((c: any) => (
            <div key={c.id} className="flex justify-between py-1 text-sm">
              <div>
                <span className="text-gray-600 font-medium">{c.customer_name}</span>
                {c.description && <span className="text-gray-400 ml-1 text-xs">({c.description})</span>}
              </div>
              <span>{fmt(c.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 mt-1 text-sm font-bold">
            <span>Total Credits</span>
            <span>{fmt(totalCredits)}</span>
          </div>
        </div>
      )}

      {/* Expenses */}
      {shift.expenses?.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
          <p className="font-semibold text-gray-700 mb-2">Shift Expenses</p>
          {shift.expenses.map((e: any) => (
            <div key={e.id} className="flex justify-between py-1 text-sm">
              <div>
                <span className="text-gray-600">{e.category}</span>
                {e.description && <span className="text-gray-400 ml-1 text-xs">({e.description})</span>}
              </div>
              <span>{fmt(e.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 mt-1 text-sm font-bold">
            <span>Total Expenses</span>
            <span>{fmt(totalExpenses)}</span>
          </div>
        </div>
      )}

      {/* Staff Debts Detail (admin only, when debts exist) */}
      {isAdmin && debts.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
          <p className="font-semibold text-gray-700 mb-2">Staff Debt History</p>
          {debts.map((d: any) => (
            <div key={d.id} className="flex justify-between py-1.5 border-b border-gray-100 last:border-0 text-sm">
              <div>
                <p className="text-gray-600">Shift #{d.shift_id}</p>
                <p className="text-xs text-gray-400">
                  Deficit: {fmt(d.original_deficit)} · Deducted: {fmt(d.deducted_from_wage)}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-semibold ${d.status === 'cleared' ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(d.balance)}
                </p>
                <p className={`text-xs ${d.status === 'cleared' ? 'text-green-500' : 'text-orange-500'}`}>
                  {d.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {isOpen && (
        <div className="space-y-2 mt-4">
          <button onClick={() => navigate(`/shifts/${id}/record`)}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2">
            <Edit3 size={18} /> Record Readings & Collections
          </button>
          {isAdmin && (
            <button onClick={() => setShowCloseModal(true)}
              className="w-full bg-red-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2">
              <Lock size={18} /> Close & Lock Shift
            </button>
          )}
        </div>
      )}

      {/* Close Shift Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center">
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">Close Shift #{shift.id}</h3>
              <button onClick={() => setShowCloseModal(false)} className="p-1 text-gray-400">
                <X size={20} />
              </button>
            </div>

            {/* Summary in modal */}
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Expected Sales</span>
                <span className="font-semibold">{fmt(expected)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Accounted</span>
                <span className="font-semibold">{fmt(totalAccounted)}</span>
              </div>
              <div className={`flex justify-between font-bold ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                <span>Variance</span>
                <span>{variance >= 0 ? '+' : ''}{fmt(variance)}</span>
              </div>
            </div>

            {/* Deduction options — only when deficit */}
            {variance < 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Deficit: {fmt(Math.abs(variance))} — Wage: {fmt(employeeWage)}
                </p>

                {/* Option: Full deduct */}
                <label className="flex items-start gap-3 p-3 rounded-lg border mb-2 cursor-pointer"
                  style={{ borderColor: deductOption === 'full' ? '#2563eb' : '#e5e7eb', background: deductOption === 'full' ? '#eff6ff' : 'white' }}>
                  <input type="radio" name="deduct" checked={deductOption === 'full'} onChange={() => setDeductOption('full')} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Deduct Full</p>
                    <p className="text-xs text-gray-500">
                      Deduct {fmt(Math.min(Math.abs(variance), employeeWage))} from wage
                      {Math.abs(variance) > employeeWage && (
                        <span className="text-orange-600"> · {fmt(Math.abs(variance) - employeeWage)} carried as debt</span>
                      )}
                    </p>
                  </div>
                </label>

                {/* Option: Partial deduct */}
                <label className="flex items-start gap-3 p-3 rounded-lg border mb-2 cursor-pointer"
                  style={{ borderColor: deductOption === 'partial' ? '#2563eb' : '#e5e7eb', background: deductOption === 'partial' ? '#eff6ff' : 'white' }}>
                  <input type="radio" name="deduct" checked={deductOption === 'partial'} onChange={() => setDeductOption('partial')} className="mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Deduct Partial</p>
                    {deductOption === 'partial' && (
                      <div className="mt-2">
                        <input type="number" step="0.01" value={partialAmount}
                          onChange={e => setPartialAmount(e.target.value)}
                          placeholder={`Max ${Math.min(Math.abs(variance), employeeWage).toFixed(2)}`}
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                        {partialAmount && (
                          <p className="text-xs text-orange-600 mt-1">
                            {fmt(Math.abs(variance) - Math.min(parseFloat(partialAmount) || 0, employeeWage, Math.abs(variance)))} carried as debt
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </label>

                {/* Option: Don't deduct */}
                <label className="flex items-start gap-3 p-3 rounded-lg border mb-2 cursor-pointer"
                  style={{ borderColor: deductOption === 'none' ? '#2563eb' : '#e5e7eb', background: deductOption === 'none' ? '#eff6ff' : 'white' }}>
                  <input type="radio" name="deduct" checked={deductOption === 'none'} onChange={() => setDeductOption('none')} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Don't Deduct</p>
                    <p className="text-xs text-orange-600">
                      Full {fmt(Math.abs(variance))} carried as debt
                    </p>
                  </div>
                </label>
              </div>
            )}

            {/* Notes */}
            <div className="mb-4">
              <label className="text-sm text-gray-600 mb-1 block">Notes (optional)</label>
              <input value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                placeholder="e.g. Pump 2 had issues..."
                className="w-full border border-gray-300 rounded-lg p-3 text-sm" />
            </div>

            {/* Confirm */}
            <button onClick={handleClose} disabled={closing}
              className="w-full bg-red-600 text-white py-3 rounded-xl font-semibold disabled:opacity-50">
              {closing ? 'Closing...' : 'Confirm Close & Lock'}
            </button>
          </div>
        </div>
      )}

      {/* Debt Repay Modal */}
      {showDebtModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center">
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">Repay Staff Debt</h3>
              <button onClick={() => setShowDebtModal(false)} className="p-1 text-gray-400">
                <X size={20} />
              </button>
            </div>

            <div className="bg-orange-50 rounded-lg p-3 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Outstanding</span>
                <span className="font-bold text-orange-700">{fmt(totalDebt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Today's Wage</span>
                <span className="font-semibold">{fmt(employeeWage)}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm text-gray-600 mb-1 block">Amount to Deduct from Wage</label>
              <input type="number" step="0.01" value={repayAmount}
                onChange={e => setRepayAmount(e.target.value)}
                placeholder={`Max ${Math.min(totalDebt, employeeWage).toFixed(2)}`}
                className="w-full border border-gray-300 rounded-lg p-3 text-sm" />
              <p className="text-xs text-gray-400 mt-1">
                Clears oldest debts first. Max: {fmt(Math.min(totalDebt, employeeWage))}
              </p>
            </div>

            <button onClick={handleRepayDebt} disabled={repaying}
              className="w-full bg-orange-600 text-white py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
              <DollarSign size={18} />
              {repaying ? 'Processing...' : 'Confirm Repayment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
