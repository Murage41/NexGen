import { useEffect, useState } from 'react';
import { BadgeCheck, Calculator, CircleDollarSign, WalletCards, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import {
  addPayrollPayment,
  approvePayrollRun,
  calculatePayrollRun,
  getCurrentShift,
  getPayrollRun,
  getPayrollRuns,
} from '../services/api';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const month = () => today().slice(0, 7);
const monthEnd = () => {
  const [year, value] = month().split('-').map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
};
const kes = (value: number) => `KES ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

export default function Payroll() {
  const [runs, setRuns] = useState<any[]>([]);
  const [run, setRun] = useState<any>(null);
  const [line, setLine] = useState<any>(null);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [calculateSheet, setCalculateSheet] = useState(false);
  const [paymentSheet, setPaymentSheet] = useState(false);
  const [runForm, setRunForm] = useState({
    name: `${month()} payroll`,
    pay_schedule: 'monthly',
    period_start: `${month()}-01`,
    period_end: monthEnd(),
  });
  const [payment, setPayment] = useState({
    amount: '',
    payment_method: 'bank_transfer',
    payment_date: today(),
    reference: '',
    from_shift: false,
  });

  useEffect(() => { load(); }, []);

  async function load(selectedId?: number) {
    try {
      const [runsResponse, shiftResponse] = await Promise.all([
        getPayrollRuns(),
        getCurrentShift().catch(() => null),
      ]);
      const rows = runsResponse.data.data || [];
      setRuns(rows);
      setCurrentShift(shiftResponse?.data?.data || null);
      const id = selectedId || run?.id || rows[0]?.id;
      if (id) {
        const response = await getPayrollRun(id);
        setRun(response.data.data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function selectRun(id: number) {
    const response = await getPayrollRun(id);
    setRun(response.data.data);
  }

  async function calculate() {
    setBusy(true);
    try {
      const response = await calculatePayrollRun(runForm);
      setCalculateSheet(false);
      await load(response.data.data.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to calculate payroll');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!run || !confirm(`Approve ${run.name}?`)) return;
    setBusy(true);
    try {
      await approvePayrollRun(run.id);
      await load(run.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to approve payroll');
    } finally {
      setBusy(false);
    }
  }

  function openPayment(payrollLine: any) {
    setLine(payrollLine);
    setPayment({
      amount: String(payrollLine.balance_due),
      payment_method: 'bank_transfer',
      payment_date: today(),
      reference: '',
      from_shift: false,
    });
    setPaymentSheet(true);
  }

  async function savePayment() {
    if (!line) return;
    setBusy(true);
    try {
      await addPayrollPayment(line.id, {
        amount: Number(payment.amount),
        payment_method: payment.payment_method,
        payment_date: payment.payment_date,
        reference: payment.reference || null,
        shift_id: payment.from_shift ? currentShift?.id : null,
      });
      setPaymentSheet(false);
      await load(run.id);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader title="Payroll" back right={
        <button onClick={() => setCalculateSheet(true)} className="p-2 bg-blue-600 text-white rounded-xl" title="Calculate payroll">
          <Calculator size={19} />
        </button>
      } />

      <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4">
        {runs.map((item) => (
          <button key={item.id} onClick={() => selectRun(item.id)}
            className={`flex-none w-48 text-left border rounded-xl p-3 ${run?.id === item.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}>
            <div className="flex justify-between gap-2">
              <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
              <Status value={item.status} />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">{item.period_start} to {item.period_end}</p>
            <p className="text-sm font-semibold text-gray-700 mt-2">{kes(item.net_total)}</p>
          </button>
        ))}
      </div>

      {run ? (
        <>
          <div className="bg-white border border-gray-100 rounded-xl p-4 mt-2">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-gray-900">{run.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{run.period_start} to {run.period_end}</p>
              </div>
              <Status value={run.status} />
            </div>
            <div className="grid grid-cols-2 gap-y-3 mt-4">
              <Metric label="Gross" value={kes(run.gross_total)} />
              <Metric label="Deductions" value={kes(run.deduction_total)} />
              <Metric label="Net" value={kes(run.net_total)} />
              <Metric label="Paid" value={kes(run.paid_total)} />
            </div>
            {run.status === 'calculated' && (
              <button onClick={approve} disabled={busy}
                className="w-full mt-4 bg-green-600 text-white py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                <BadgeCheck size={18} /> Approve Payroll
              </button>
            )}
          </div>

          <p className="text-xs uppercase font-semibold text-gray-400 mt-5 mb-2">Employees</p>
          <div className="space-y-3">
            {run.lines.map((payrollLine: any) => (
              <div key={payrollLine.id} className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-gray-900">{payrollLine.employee_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{payrollLine.earnings.length} earning line{payrollLine.earnings.length === 1 ? '' : 's'}</p>
                  </div>
                  <p className="font-bold text-gray-800">{kes(payrollLine.net_pay)}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mt-3 pt-3 border-t">
                  <Metric label="Gross" value={kes(payrollLine.gross_earnings)} small />
                  <Metric label="Paid" value={kes(payrollLine.paid_amount)} small />
                  <Metric label="Due" value={kes(payrollLine.balance_due)} small />
                </div>
                {['approved', 'partially_paid'].includes(run.status) && Number(payrollLine.balance_due) > 0 && (
                  <button onClick={() => openPayment(payrollLine)}
                    className="w-full mt-3 border border-blue-200 text-blue-700 py-2 rounded-xl text-sm font-medium flex justify-center items-center gap-2">
                    <CircleDollarSign size={17} /> Record Payment
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center mt-20">
          <WalletCards size={45} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No payroll runs</p>
        </div>
      )}

      {calculateSheet && (
        <Sheet title="Calculate Payroll" onClose={() => setCalculateSheet(false)}>
          <div className="space-y-3">
            <Input label="Run name" value={runForm.name} onChange={(value) => setRunForm({ ...runForm, name: value })} />
            <Select label="Payment schedule" value={runForm.pay_schedule} onChange={(value) => setRunForm({ ...runForm, pay_schedule: value })}
              options={[['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 14 days'], ['monthly', 'Monthly']]} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Period start" type="date" value={runForm.period_start} onChange={(value) => setRunForm({ ...runForm, period_start: value })} />
              <Input label="Period end" type="date" value={runForm.period_end} onChange={(value) => setRunForm({ ...runForm, period_end: value })} />
            </div>
            <button onClick={calculate} disabled={busy} className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-50">
              {busy ? 'Calculating...' : 'Calculate'}
            </button>
          </div>
        </Sheet>
      )}

      {paymentSheet && line && (
        <Sheet title={`Pay - ${line.employee_name}`} onClose={() => setPaymentSheet(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Amount (KES)" type="number" value={payment.amount} onChange={(value) => setPayment({ ...payment, amount: value })} />
              <Input label="Payment date" type="date" value={payment.payment_date} onChange={(value) => setPayment({ ...payment, payment_date: value })} />
            </div>
            <Select label="Payment method" value={payment.payment_method} onChange={(value) => setPayment({ ...payment, payment_method: value })}
              options={payment.from_shift
                ? [['cash', 'Cash'], ['mpesa', 'M-Pesa']]
                : [['bank_transfer', 'Bank transfer'], ['mpesa', 'M-Pesa'], ['cash', 'Cash'], ['cheque', 'Cheque']]} />
            <Input label="Reference" value={payment.reference} onChange={(value) => setPayment({ ...payment, reference: value })} />
            <label className={`flex gap-3 items-center border rounded-xl p-3 ${currentShift ? '' : 'opacity-50'}`}>
              <input type="checkbox" disabled={!currentShift} checked={payment.from_shift}
                onChange={(event) => setPayment({
                  ...payment,
                  from_shift: event.target.checked,
                  payment_method: event.target.checked ? 'cash' : 'bank_transfer',
                })} />
              <span className="text-sm text-gray-700">Pay from open shift {currentShift ? `#${currentShift.id}` : ''}</span>
            </label>
            <button onClick={savePayment} disabled={busy} className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-50">
              {busy ? 'Saving...' : 'Record Payment'}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Status({ value }: { value: string }) {
  const style: Record<string, string> = {
    calculated: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    partially_paid: 'bg-cyan-100 text-cyan-700',
    paid: 'bg-green-100 text-green-700',
    void: 'bg-gray-200 text-gray-500',
  };
  return <span className={`shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[9px] font-medium capitalize ${style[value] || 'bg-gray-100'}`}>{value?.replace('_', ' ')}</span>;
}

function Metric({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return <div><p className="text-[10px] uppercase text-gray-400">{label}</p><p className={`${small ? 'text-xs' : 'text-sm'} font-semibold text-gray-800 mt-0.5`}>{value}</p></div>;
}

function Sheet({ title, onClose, children }: any) {
  return (
    <div className="mobile-modal-overlay flex items-end" onClick={onClose}>
      <div className="mobile-bottom-sheet rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-between items-center mb-4"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} title="Close"><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return <label><span className="text-xs text-gray-600 mb-1 block">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full h-11 border rounded-xl px-3 text-sm" /></label>;
}

function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[][];
}) {
  return <label><span className="text-xs text-gray-600 mb-1 block">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full h-11 border rounded-xl px-3 text-sm bg-white">{options.map(([key, text]: string[]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}
