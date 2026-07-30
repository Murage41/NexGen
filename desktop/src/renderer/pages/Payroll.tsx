import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Calculator,
  CircleDollarSign,
  Plus,
  RefreshCcw,
  RotateCcw,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import {
  addPayrollDeduction,
  addPayrollPayment,
  approvePayrollRun,
  calculatePayrollRun,
  deletePayrollDeduction,
  getCurrentShift,
  getPayrollRun,
  getPayrollRuns,
  previewPayrollRun,
  reversePayrollPayment,
  voidPayrollRun,
} from '../services/api';

const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const currentMonth = () => kenyaToday().slice(0, 7);
const monthBounds = (month: string) => {
  const [year, value] = month.split('-').map(Number);
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10),
  };
};
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const suggestedPeriod = (schedule: string, anchor = kenyaToday()) => {
  if (schedule === 'daily') return { start: anchor, end: anchor };
  if (schedule === 'weekly') return { start: addDays(anchor, -6), end: anchor };
  if (schedule === 'biweekly') return { start: addDays(anchor, -13), end: anchor };
  const current = monthBounds(anchor.slice(0, 7));
  return anchor === current.end ? current : monthBounds(addDays(current.start, -1).slice(0, 7));
};
const periodFromStart = (schedule: string, start: string) => {
  if (schedule === 'daily') return { start, end: start };
  if (schedule === 'weekly') return { start, end: addDays(start, 6) };
  if (schedule === 'biweekly') return { start, end: addDays(start, 13) };
  return monthBounds(start.slice(0, 7));
};
const kes = (value: number) => `KES ${Number(value || 0).toLocaleString('en-KE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

export default function Payroll() {
  const bounds = suggestedPeriod('monthly');
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [selectedLine, setSelectedLine] = useState<any>(null);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCalculate, setShowCalculate] = useState(false);
  const [showDeduction, setShowDeduction] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [runForm, setRunForm] = useState({
    name: `${currentMonth()} payroll`,
    pay_schedule: 'monthly',
    period_start: bounds.start,
    period_end: bounds.end,
  });
  const [deductionForm, setDeductionForm] = useState({
    deduction_type: 'staff_debt',
    amount: '',
    authorization_reference: '',
    notes: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_method: 'bank_transfer',
    payment_date: kenyaToday(),
    reference: '',
    notes: '',
    from_shift: false,
  });

  useEffect(() => { loadRuns(); }, []);
  useEffect(() => {
    if (!showCalculate) return;
    let cancelled = false;
    setPreview(null);
    setPreviewError('');
    setPreviewBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await previewPayrollRun({
          pay_schedule: runForm.pay_schedule,
          period_start: runForm.period_start,
          period_end: runForm.period_end,
        });
        if (cancelled) return;
        setPreview(response.data.data);
      } catch (error: any) {
        if (cancelled) return;
        setPreviewError(error.response?.data?.error || 'Payroll preview is unavailable.');
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    showCalculate,
    runForm.pay_schedule,
    runForm.period_start,
    runForm.period_end,
  ]);

  function openCalculate() {
    const period = suggestedPeriod(runForm.pay_schedule);
    setRunForm({
      ...runForm,
      name: `${period.start} ${runForm.pay_schedule} payroll`,
      period_start: period.start,
      period_end: period.end,
    });
    setShowCalculate(true);
  }

  function changeSchedule(schedule: string) {
    const period = suggestedPeriod(schedule);
    setRunForm({
      ...runForm,
      name: `${period.start} ${schedule} payroll`,
      pay_schedule: schedule,
      period_start: period.start,
      period_end: period.end,
    });
  }

  function changePeriodStart(value: string) {
    const start = runForm.pay_schedule === 'monthly' ? `${value}-01` : value;
    const period = periodFromStart(runForm.pay_schedule, start);
    setRunForm({
      ...runForm,
      name: `${period.start} ${runForm.pay_schedule} payroll`,
      period_start: period.start,
      period_end: period.end,
    });
  }

  async function loadRuns(selectId?: number) {
    try {
      const [runsResponse, shiftResponse] = await Promise.all([
        getPayrollRuns(),
        getCurrentShift().catch(() => null),
      ]);
      const rows = runsResponse.data.data || [];
      setRuns(rows);
      setCurrentShift(shiftResponse?.data?.data || null);
      const targetId = selectId || selectedRun?.id || rows[0]?.id;
      if (targetId) await loadRun(targetId);
    } catch (error) {
      console.error('Failed to load payroll', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadRun(id: number) {
    const response = await getPayrollRun(id);
    setSelectedRun(response.data.data);
    setSelectedLine(null);
  }

  async function calculate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await calculatePayrollRun(runForm);
      const id = response.data.data.id;
      setShowCalculate(false);
      await loadRuns(id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to calculate payroll');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!selectedRun || !confirm(`Approve ${selectedRun.name}? Earnings and deductions will be locked.`)) return;
    setBusy(true);
    try {
      await approvePayrollRun(selectedRun.id);
      await loadRuns(selectedRun.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to approve payroll');
    } finally {
      setBusy(false);
    }
  }

  function openDeduction(line: any) {
    setSelectedLine(line);
    setDeductionForm({
      deduction_type: 'staff_debt',
      amount: '',
      authorization_reference: '',
      notes: '',
    });
    setShowDeduction(true);
  }

  async function saveDeduction(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRun || !selectedLine) return;
    setBusy(true);
    try {
      await addPayrollDeduction(selectedRun.id, selectedLine.id, {
        ...deductionForm,
        amount: Number(deductionForm.amount),
      });
      setShowDeduction(false);
      await loadRun(selectedRun.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to add deduction');
    } finally {
      setBusy(false);
    }
  }

  async function removeDeduction(deduction: any) {
    if (!selectedRun || !confirm('Remove this draft deduction?')) return;
    try {
      await deletePayrollDeduction(selectedRun.id, deduction.id);
      await loadRun(selectedRun.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to remove deduction');
    }
  }

  function openPayment(line: any) {
    setSelectedLine(line);
    setPaymentForm({
      amount: String(line.balance_due || ''),
      payment_method: 'bank_transfer',
      payment_date: kenyaToday(),
      reference: '',
      notes: '',
      from_shift: false,
    });
    setShowPayment(true);
  }

  async function savePayment(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLine) return;
    setBusy(true);
    try {
      await addPayrollPayment(selectedLine.id, {
        amount: Number(paymentForm.amount),
        payment_method: paymentForm.payment_method,
        payment_date: paymentForm.payment_date,
        shift_id: paymentForm.from_shift ? currentShift?.id : null,
        reference: paymentForm.reference || null,
        notes: paymentForm.notes || null,
      });
      setShowPayment(false);
      await loadRuns(selectedRun.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to record payroll payment');
    } finally {
      setBusy(false);
    }
  }

  async function reversePayment(payment: any) {
    const reason = prompt('Reason for reversing this payment:');
    if (!reason) return;
    try {
      await reversePayrollPayment(payment.id, reason);
      await loadRuns(selectedRun.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to reverse payment');
    }
  }

  async function voidRun() {
    if (!selectedRun) return;
    const reason = prompt('Reason for voiding this payroll run:');
    if (!reason) return;
    try {
      await voidPayrollRun(selectedRun.id, reason);
      await loadRuns(selectedRun.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to void payroll');
    }
  }

  const outstanding = useMemo(
    () => runs
      .filter((run) => ['approved', 'partially_paid'].includes(run.status))
      .reduce((sum, run) => sum + Math.max(0, Number(run.net_total || 0) - Number(run.paid_total || 0)), 0),
    [runs],
  );

  if (loading) return <div className="text-gray-500">Loading payroll...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><WalletCards size={24} /> Payroll</h1>
          <p className="text-sm text-gray-500 mt-1">Calculate earnings, approve deductions, and record payments</p>
        </div>
        <button onClick={openCalculate} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          <Calculator size={18} /> Calculate Payroll
        </button>
      </div>

      <div className="grid grid-cols-4 gap-5 border-y border-gray-200 py-4 mb-5">
        <Metric label="Payroll runs" value={String(runs.length)} />
        <Metric label="Outstanding payable" value={kes(outstanding)} />
        <Metric label="Open shift" value={currentShift ? `#${currentShift.id}` : 'None'} />
        <Metric label="Selected status" value={selectedRun?.status?.replace('_', ' ') || 'None'} />
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-5 items-start">
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Payroll Runs</h2>
            <button onClick={() => loadRuns()} className="p-1.5 text-gray-400 hover:text-blue-600" title="Refresh"><RefreshCcw size={16} /></button>
          </div>
          <div className="max-h-[650px] overflow-y-auto">
            {runs.map((run) => (
              <button key={run.id} onClick={() => loadRun(run.id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${selectedRun?.id === run.id ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''}`}>
                <div className="flex justify-between gap-3">
                  <p className="font-medium text-gray-800 truncate">{run.name}</p>
                  <Status value={run.status} />
                </div>
                <p className="text-xs text-gray-500 mt-1">{run.period_start} to {run.period_end}</p>
                <div className="flex justify-between text-xs mt-2">
                  <span className="text-gray-400 capitalize">{run.pay_schedule}</span>
                  <span className="font-medium text-gray-700">{kes(run.net_total)}</span>
                </div>
              </button>
            ))}
            {runs.length === 0 && <p className="p-6 text-sm text-center text-gray-400">No payroll runs yet.</p>}
          </div>
        </div>

        {selectedRun ? (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-900">{selectedRun.name}</h2>
                  <Status value={selectedRun.status} />
                </div>
                <p className="text-sm text-gray-500 mt-1">{selectedRun.period_start} to {selectedRun.period_end}</p>
              </div>
              <div className="flex gap-2">
                {selectedRun.status === 'calculated' && (
                  <button onClick={approve} disabled={busy} className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                    <BadgeCheck size={17} /> Approve
                  </button>
                )}
                {!['void', 'paid'].includes(selectedRun.status) && (
                  <button onClick={voidRun} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="Void payroll run">
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 px-5 py-4 bg-gray-50 border-b border-gray-200">
              <Metric label="Gross earnings" value={kes(selectedRun.gross_total)} />
              <Metric label="Deductions" value={kes(selectedRun.deduction_total)} />
              <Metric label="Net pay" value={kes(selectedRun.net_total)} />
              <Metric label="Paid" value={kes(selectedRun.paid_total)} />
            </div>

            <table className="w-full text-sm">
              <thead className="text-gray-500 bg-white">
                <tr>
                  <th className="text-left p-3 font-medium">Employee</th>
                  <th className="text-right p-3 font-medium">Gross</th>
                  <th className="text-right p-3 font-medium">Deductions</th>
                  <th className="text-right p-3 font-medium">Net</th>
                  <th className="text-right p-3 font-medium">Paid</th>
                  <th className="text-right p-3 font-medium">Due</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedRun.lines.map((line: any) => (
                  <Fragment key={line.id}>
                    <tr className={`border-t border-gray-100 ${selectedLine?.id === line.id ? 'bg-blue-50' : ''}`}>
                      <td className="p-3">
                        <button onClick={() => setSelectedLine(selectedLine?.id === line.id ? null : line)}
                          className="font-medium text-gray-900 hover:text-blue-700">{line.employee_name}</button>
                      </td>
                      <td className="p-3 text-right tabular-nums">{kes(line.gross_earnings)}</td>
                      <td className="p-3 text-right tabular-nums">{kes(line.total_deductions)}</td>
                      <td className="p-3 text-right tabular-nums font-medium">{kes(line.net_pay)}</td>
                      <td className="p-3 text-right tabular-nums">{kes(line.paid_amount)}</td>
                      <td className="p-3 text-right tabular-nums">{kes(line.balance_due)}</td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          {selectedRun.status === 'calculated' && (
                            <button onClick={() => openDeduction(line)} className="p-2 text-gray-500 hover:text-blue-700" title="Add deduction"><Plus size={17} /></button>
                          )}
                          {['approved', 'partially_paid'].includes(selectedRun.status) && Number(line.balance_due) > 0 && (
                            <button onClick={() => openPayment(line)} className="p-2 text-gray-500 hover:text-green-700" title="Record payment"><CircleDollarSign size={18} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {selectedLine?.id === line.id && (
                      <tr key={`${line.id}-details`} className="bg-gray-50 border-t border-gray-100">
                        <td colSpan={7} className="p-4">
                          <LineDetails line={line} run={selectedRun} removeDeduction={removeDeduction} reversePayment={reversePayment} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="border border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-400">
            Select a payroll run.
          </div>
        )}
      </div>

      {showCalculate && (
        <Modal title="Calculate Payroll" onClose={() => setShowCalculate(false)}>
          <form onSubmit={calculate} className="space-y-3">
            <Field label="Run name"><input required className="input" value={runForm.name} onChange={(event) => setRunForm({ ...runForm, name: event.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Schedule">
                <select className="input" value={runForm.pay_schedule} onChange={(event) => changeSchedule(event.target.value)}>
                  <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 14 days</option><option value="monthly">Monthly</option>
                </select>
              </Field>
              <Field label={runForm.pay_schedule === 'monthly' ? 'Payroll month' : 'Period start'}>
                <input
                  required
                  type={runForm.pay_schedule === 'monthly' ? 'month' : 'date'}
                  className="input"
                  value={runForm.pay_schedule === 'monthly' ? runForm.period_start.slice(0, 7) : runForm.period_start}
                  onChange={(event) => changePeriodStart(event.target.value)}
                />
              </Field>
              <Field label="Period end"><input readOnly type="date" className="input bg-gray-50" value={runForm.period_end} /></Field>
            </div>
            <PayrollPreview preview={preview} error={previewError} busy={previewBusy} />
            <Actions
              busy={busy}
              disabled={previewBusy || !preview || Boolean(previewError) || preview.employee_count === 0}
              onCancel={() => setShowCalculate(false)}
              label="Calculate"
            />
          </form>
        </Modal>
      )}

      {showDeduction && selectedLine && (
        <Modal title={`Deduction - ${selectedLine.employee_name}`} onClose={() => setShowDeduction(false)}>
          <form onSubmit={saveDeduction} className="space-y-3">
            <Field label="Deduction type">
              <select className="input" value={deductionForm.deduction_type} onChange={(event) => setDeductionForm({ ...deductionForm, deduction_type: event.target.value })}>
                <option value="staff_debt">Staff debt</option><option value="statutory">Statutory</option><option value="advance">Salary advance</option><option value="manual">Other authorized deduction</option>
              </select>
            </Field>
            <Field label="Amount (KES)"><input required min="0.01" step="0.01" type="number" className="input" value={deductionForm.amount} onChange={(event) => setDeductionForm({ ...deductionForm, amount: event.target.value })} /></Field>
            <Field label="Authorization reference"><input className="input" required={deductionForm.deduction_type === 'staff_debt'} value={deductionForm.authorization_reference} onChange={(event) => setDeductionForm({ ...deductionForm, authorization_reference: event.target.value })} /></Field>
            <Field label="Notes"><textarea className="input" rows={2} value={deductionForm.notes} onChange={(event) => setDeductionForm({ ...deductionForm, notes: event.target.value })} /></Field>
            <Actions busy={busy} onCancel={() => setShowDeduction(false)} label="Add Deduction" />
          </form>
        </Modal>
      )}

      {showPayment && selectedLine && (
        <Modal title={`Payroll Payment - ${selectedLine.employee_name}`} onClose={() => setShowPayment(false)}>
          <form onSubmit={savePayment} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (KES)"><input required min="0.01" max={selectedLine.balance_due} step="0.01" type="number" className="input" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></Field>
              <Field label="Payment date"><input required type="date" className="input" value={paymentForm.payment_date} onChange={(event) => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} /></Field>
              <Field label="Method">
                <select className="input" value={paymentForm.payment_method} onChange={(event) => setPaymentForm({ ...paymentForm, payment_method: event.target.value })}>
                  {paymentForm.from_shift ? <><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></> : <><option value="bank_transfer">Bank transfer</option><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="cheque">Cheque</option></>}
                </select>
              </Field>
              <Field label="Reference"><input className="input" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} /></Field>
            </div>
            <label className={`flex items-center gap-3 border rounded-lg p-3 ${currentShift ? 'cursor-pointer' : 'opacity-50'}`}>
              <input type="checkbox" disabled={!currentShift} checked={paymentForm.from_shift}
                onChange={(event) => setPaymentForm({
                  ...paymentForm,
                  from_shift: event.target.checked,
                  payment_method: event.target.checked ? 'cash' : 'bank_transfer',
                })} />
              <span className="text-sm text-gray-700">Pay from open shift drawer {currentShift ? `#${currentShift.id}` : '(no open shift)'}</span>
            </label>
            <Field label="Notes"><textarea className="input" rows={2} value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></Field>
            <Actions busy={busy} onCancel={() => setShowPayment(false)} label="Record Payment" />
          </form>
        </Modal>
      )}
    </div>
  );
}

function LineDetails({ line, run, removeDeduction, reversePayment }: any) {
  return (
    <div className="grid grid-cols-3 gap-5">
      <DetailList title="Earnings" rows={line.earnings.map((row: any) => ({
        id: row.id,
        label: row.description || row.source_type,
        value: kes(row.gross_amount),
      }))} />
      <div>
        <p className="text-xs uppercase font-semibold text-gray-400 mb-2">Deductions</p>
        <div className="space-y-2">
          {line.deductions.filter((row: any) => row.status !== 'reversed').map((row: any) => (
            <div key={row.id} className="flex items-center justify-between text-sm">
              <span className="text-gray-600 capitalize">{row.deduction_type.replace('_', ' ')}</span>
              <div className="flex items-center gap-1">
                <span>{kes(row.amount)}</span>
                {run.status === 'calculated' && (
                  <button onClick={() => removeDeduction(row)} className="p-1 text-gray-400 hover:text-red-600" title="Remove deduction"><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          ))}
          {line.deductions.length === 0 && <p className="text-sm text-gray-400">No deductions</p>}
        </div>
      </div>
      <div>
        <p className="text-xs uppercase font-semibold text-gray-400 mb-2">Payments</p>
        <div className="space-y-2">
          {line.payments.map((row: any) => (
            <div key={row.id} className={`flex items-center justify-between text-sm ${row.status === 'reversed' ? 'line-through text-gray-400' : ''}`}>
              <span className="text-gray-600">{row.payment_date} - {row.payment_method.replace('_', ' ')}</span>
              <div className="flex items-center gap-1">
                <span>{kes(row.amount)}</span>
                {row.status === 'posted' && !String(row.reference || '').startsWith('SHIFT-WAGE:') && (
                  <button onClick={() => reversePayment(row)} className="p-1 text-gray-400 hover:text-red-600" title="Reverse payment"><RotateCcw size={14} /></button>
                )}
              </div>
            </div>
          ))}
          {line.payments.length === 0 && <p className="text-sm text-gray-400">No payments</p>}
        </div>
      </div>
    </div>
  );
}

function DetailList({ title, rows }: any) {
  return (
    <div>
      <p className="text-xs uppercase font-semibold text-gray-400 mb-2">{title}</p>
      <div className="space-y-2">
        {rows.map((row: any) => <div key={row.id} className="flex justify-between text-sm"><span className="text-gray-600">{row.label}</span><span>{row.value}</span></div>)}
        {rows.length === 0 && <p className="text-sm text-gray-400">None</p>}
      </div>
    </div>
  );
}

function PayrollPreview({ preview, error, busy }: any) {
  if (busy) {
    return <div className="border-y border-gray-200 py-4 text-sm text-gray-500">Reviewing payroll period...</div>;
  }
  if (error) {
    return <div className="border-y border-red-200 bg-red-50 py-3 px-1 text-sm text-red-700">{error}</div>;
  }
  if (!preview) return null;
  return (
    <div className="border-y border-gray-200 py-4">
      <div className="grid grid-cols-4 gap-4 mb-3">
        <Metric label="Employees" value={String(preview.employee_count)} />
        <Metric label="Gross" value={kes(preview.gross_total)} />
        <Metric label="Previously paid" value={kes(preview.prior_paid_total)} />
        <Metric label="Balance due" value={kes(preview.balance_due)} />
      </div>
      {preview.lines.length > 0 && (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {preview.lines.map((line: any) => (
            <div key={line.employee_id} className="grid grid-cols-[1fr_repeat(3,110px)] gap-3 py-2 text-sm">
              <span className="font-medium text-gray-800">{line.employee_name}</span>
              <span className="text-right text-gray-500">{kes(line.gross_earnings)}</span>
              <span className="text-right text-gray-500">{kes(line.prior_shift_payments)}</span>
              <span className="text-right font-medium text-gray-800">{kes(line.balance_due)}</span>
            </div>
          ))}
        </div>
      )}
      {preview.employee_count === 0 && <p className="text-sm text-amber-700">No unprocessed earnings in this period.</p>}
    </div>
  );
}

function Status({ value }: { value: string }) {
  const styles: Record<string, string> = {
    calculated: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    partially_paid: 'bg-cyan-100 text-cyan-700',
    paid: 'bg-green-100 text-green-700',
    void: 'bg-gray-200 text-gray-500',
  };
  return <span className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-medium capitalize ${styles[value] || 'bg-gray-100 text-gray-600'}`}>{value?.replace('_', ' ')}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase font-medium text-gray-400">{label}</p><p className="text-lg font-semibold text-gray-800 mt-1 capitalize">{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>{children}</label>;
}

function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-5 py-4 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" title="Close"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Actions({ busy, disabled = false, onCancel, label }: any) {
  return (
    <div className="flex justify-end gap-2 border-t pt-4 mt-5">
      <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
      <button type="submit" disabled={busy || disabled} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Working...' : label}
      </button>
    </div>
  );
}
