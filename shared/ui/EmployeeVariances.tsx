import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';
import { ReasonDialog } from './ReasonDialog';
import { newOperationKey } from './operationKey';

// An attendant's variances (backend services/employeeVariances.ts): every
// closed shift's over/short, what recovered it and what is left, like a
// cashier variance listing. Pay is never reduced for it; the employee repays
// separately. Surpluses cover shortages in the same month and what is left at
// month end stays with the station.
//
// Mobile passes no `approval`: the signed-in admin approves as themselves; the
// desktop names an admin and takes their PIN. Without `actions` it is read-only
// (an employee's own view).

export type VarianceActions = {
  repay: (employeeId: number, body: Record<string, unknown>, key: string) => Promise<any>;
  reverseRepayment: (paymentId: number, reason: string) => Promise<any>;
  waive: (employeeId: number, body: Record<string, unknown>, key: string) => Promise<any>;
  refund: (employeeId: number, body: Record<string, unknown>, key: string) => Promise<any>;
};

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (value: unknown) =>
  Math.abs(Number(value || 0)).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';
const errorText = (e: any, fallback: string) => e?.response?.data?.error || e?.message || fallback;

// Negative = short, positive = over, as on the shift page.
export function VarianceAmount({ value }: { value: number }) {
  const amount = Number(value || 0);
  if (Math.abs(amount) < 0.005) return <span className="text-gray-500">0.00</span>;
  return amount < 0
    ? <span className="text-red-700">Short {plain(amount)}</span>
    : <span className="text-green-700">Over {plain(amount)}</span>;
}

// One line for lists: what the employee owes, or has in their favour.
export function describeVarianceTotals(totals: any) {
  const owes = Number(totals?.owes || 0);
  const favour = Number(totals?.surplus_available || 0) + Number(totals?.refundable || 0);
  if (owes > 0) return { text: `Owes ${kes(owes)}`, tone: 'owes' as const };
  if (favour > 0) return { text: `${kes(favour)} in their favour`, tone: 'favour' as const };
  return { text: 'Nothing owed', tone: 'none' as const };
}

const EVENT_LABELS: Record<string, string> = {
  repayment: 'Repaid',
  waiver: 'Written off',
  refund: 'Paid back',
  legacy_owed_back: 'Owed back (from before variances)',
  legacy_reversal: 'Owed again',
};
const METHODS: Record<string, string> = { cash: 'cash', mpesa: 'M-Pesa', bank_transfer: 'bank transfer' };

function RowDetails({ row }: { row: any }) {
  const by = row.recovered_by || {};
  const legacy = (row.legacy || []).map((l: any) => l.details).find(Boolean) || null;
  const lines: string[] = [];
  if (row.corrected) {
    lines.push(`At close: ${row.closed_variance < 0 ? `short ${plain(row.closed_variance)}` : row.closed_variance > 0 ? `over ${plain(row.closed_variance)}` : 'balanced'}`);
    for (const c of row.corrections) {
      lines.push(`Corrected ${c.date}: ${c.change < 0 ? 'short' : 'over'} ${plain(c.change)} more${c.reason ? ` (${c.reason})` : ''}`);
    }
  }
  if (row.variance < 0) {
    if (by.surplus > 0) lines.push(`Covered by surplus: ${kes(by.surplus)}`);
    if (by.repaid > 0) lines.push(`Repaid: ${kes(by.repaid)}`);
    if (by.waived > 0) lines.push(`Written off: ${kes(by.waived)}`);
    if (by.recovered_before > 0) lines.push(`Recovered before variances started: ${kes(by.recovered_before)}`);
    if (by.cleared_before > 0) lines.push(`Cleared before variances started: ${kes(by.cleared_before)}`);
    if (legacy) {
      const parts = [
        ['deducted from the wage at close', legacy.deducted_from_wage_at_close],
        ['deducted from later wages', legacy.deducted_from_later_wages],
        ['repaid', legacy.repaid],
        ['taken in payroll', legacy.payroll],
      ].filter(([, v]) => Number(v) > 0);
      if (parts.length) lines.push(`Old records: ${parts.map(([label, v]) => `${label} ${kes(v)}`).join(', ')}`);
    }
  } else if (row.variance > 0) {
    if (row.surplus_used > 0) lines.push(`Used against shortages: ${kes(row.surplus_used)}`);
    if (row.kept_by_station > 0) {
      lines.push(`Kept by the station: ${kes(row.kept_by_station)}${row.before_variances ? ' (before variances started)' : ' (not used by month end)'}`);
    }
    if (row.available > 0) lines.push(`Still covers shortages this month: ${kes(row.available)}`);
  }
  return (
    <div className="text-xs text-gray-700 space-y-0.5 py-2">
      {lines.length ? lines.map((line) => <p key={line}>{line}</p>) : <p>Nothing recovered yet.</p>}
      <Link to={`/shifts/${row.shift_id}`} className="text-blue-700 underline print:hidden">Open shift #{row.shift_id}</Link>
    </div>
  );
}

function RepayForm({ statement, repay, onDone, onCancel, inputClassName }: any) {
  const owes = Number(statement.totals.owes || 0);
  const key = useRef(newOperationKey());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(kenyaToday());
  const [reference, setReference] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = Number(amount || owes);
  const needsReference = method !== 'cash' && !reference.trim();
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await repay(statement.employee.id, {
        amount: value,
        payment_method: method,
        date,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        shift_id: shiftId ? Number(shiftId) : null,
      }, key.current);
      key.current = newOperationKey();
      await onDone();
    } catch (e: any) {
      setError(errorText(e, 'The repayment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="font-semibold text-gray-800">Record a repayment</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <label className="block"><span className="text-gray-700">Amount (up to {kes(owes)})</span>
          <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" placeholder={owes.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block"><span className="text-gray-700">Paid by</span>
          <select className={inputClassName} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
            <option value="bank_transfer">Bank transfer</option>
          </select>
        </label>
        <label className="block"><span className="text-gray-700">Date received</span>
          <input className={inputClassName} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block"><span className="text-gray-700">{method === 'cash' ? 'Reference (optional)' : 'M-Pesa or bank reference'}</span>
          <input className={inputClassName} maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="block"><span className="text-gray-700">Into an open shift's drawer (shift #, optional)</span>
          <input className={inputClassName} type="number" inputMode="numeric" min="1" value={shiftId} onChange={(e) => setShiftId(e.target.value)} />
        </label>
        <label className="block"><span className="text-gray-700">Note (optional)</span>
          <input className={inputClassName} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-gray-500">
        Money handed into a drawer: enter that open shift and include it in the drawer count. Otherwise leave it blank.
      </p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !(value > 0) || value > owes || needsReference}
          className="px-3 py-2 rounded-lg bg-blue-700 text-white font-medium disabled:opacity-50">
          {busy ? 'Saving…' : `Record ${kes(value > 0 ? value : owes)}`}
        </button>
      </div>
    </div>
  );
}

function WaiveForm({ statement, waive, approval, onDone, onCancel, inputClassName }: any) {
  const approver = useApprover(approval);
  const owedRows = statement.rows.filter((r: any) => r.owed > 0);
  const key = useRef(newOperationKey());
  const [shiftId, setShiftId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const limit = shiftId
    ? Number(owedRows.find((r: any) => String(r.shift_id) === shiftId)?.owed || 0)
    : Number(statement.totals.owes || 0);
  const value = Number(amount || limit);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm('variance_waiver', {
        for_employee_id: statement.employee.id,
        shift_id: shiftId ? Number(shiftId) : 0,
        amount: value,
      });
      await waive(statement.employee.id, {
        amount: value,
        shift_id: shiftId ? Number(shiftId) : null,
        reason: reason.trim(),
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      }, key.current);
      key.current = newOperationKey();
      await onDone();
    } catch (e: any) {
      setError(errorText(e, 'The write-off could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="font-semibold text-gray-800">Write off</p>
      <p className="text-xs text-gray-500">
        For a shortage that was not the attendant's fault (a meter fault, a customer who drove off). The station takes the loss.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <label className="block"><span className="text-gray-700">Shortage</span>
          <select className={inputClassName} value={shiftId} onChange={(e) => { setShiftId(e.target.value); setAmount(''); }}>
            <option value="">Oldest first</option>
            {owedRows.map((r: any) => (
              <option key={r.shift_id} value={String(r.shift_id)}>Shift #{r.shift_id} ({r.date}) · owes {kes(r.owed)}</option>
            ))}
          </select>
        </label>
        <label className="block"><span className="text-gray-700">Amount (up to {kes(limit)})</span>
          <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" placeholder={limit.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block sm:col-span-2"><span className="text-gray-700">Why</span>
          <input className={inputClassName} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()}
          disabled={busy || !approver.ready || !(value > 0) || value > limit || reason.trim().length < 3}
          className="px-3 py-2 rounded-lg bg-amber-700 text-white font-medium disabled:opacity-50">
          {busy ? 'Saving…' : `Write off ${kes(value > 0 ? value : limit)}`}
        </button>
      </div>
    </div>
  );
}

function RefundForm({ statement, refund, approval, onDone, onCancel, inputClassName }: any) {
  const approver = useApprover(approval);
  const refundable = Number(statement.totals.refundable || 0);
  const key = useRef(newOperationKey());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(kenyaToday());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = Number(amount || refundable);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm('variance_refund', { for_employee_id: statement.employee.id, method, amount: value });
      await refund(statement.employee.id, {
        amount: value,
        method,
        date,
        reference: reference.trim() || undefined,
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      }, key.current);
      key.current = newOperationKey();
      await onDone();
    } catch (e: any) {
      setError(errorText(e, 'The payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="font-semibold text-gray-800">Pay back</p>
      <p className="text-xs text-gray-500">Money they repaid that no longer covers anything, for example after a correction.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <label className="block"><span className="text-gray-700">Amount (up to {kes(refundable)})</span>
          <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" placeholder={refundable.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block"><span className="text-gray-700">Paid by</span>
          <select className={inputClassName} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
          </select>
        </label>
        <label className="block"><span className="text-gray-700">Date paid</span>
          <input className={inputClassName} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block"><span className="text-gray-700">Reference (optional)</span>
          <input className={inputClassName} maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !approver.ready || !(value > 0) || value > refundable}
          className="px-3 py-2 rounded-lg bg-green-700 text-white font-medium disabled:opacity-50">
          {busy ? 'Saving…' : `Pay back ${kes(value > 0 ? value : refundable)}`}
        </button>
      </div>
    </div>
  );
}

// The staff-debt records from before variances started, as they were.
function EarlierRecords({ debt }: { debt: any }) {
  const debts: any[] = debt?.debts || [];
  const receipts: any[] = debt?.receipts || [];
  if (!debts.length && !receipts.length) return null;
  return (
    <details className="border rounded-lg p-3 text-sm">
      <summary className="cursor-pointer font-medium">Earlier records (staff debt before variances started)</summary>
      <p className="text-xs text-gray-500 mt-2">
        Kept as they were. What is still owed from them is included in the list above.
      </p>
      {debts.map((d) => (
        <p key={d.id} className="border-t mt-2 pt-2">
          Shift #{d.shift_id} · {String(d.created_at || '').slice(0, 10)} · shortage {kes(d.original_deficit)}
          {Number(d.deducted_from_wage) > 0 ? ` · deducted from wage ${kes(d.deducted_from_wage)}` : ''}
          {' '}· remaining {kes(d.balance)} · {d.status}
        </p>
      ))}
      {receipts.map((p) => (
        <p key={`receipt:${p.id}`} className="border-t mt-2 pt-2">
          Repayment #{p.id} · {p.date} · {METHODS[p.payment_method] || p.payment_method} · {kes(p.amount)}
          {p.notes ? ` · ${p.notes}` : ''} · {p.status}
        </p>
      ))}
    </details>
  );
}

export function VarianceStatementView({
  statement,
  self = false,
  actions,
  approval,
  onChanged,
  earlier,
  inputClassName = field,
}: {
  statement: any;
  self?: boolean;
  actions?: VarianceActions;
  approval?: ApprovalApi;
  onChanged?: () => Promise<void> | void;
  earlier?: any;
  inputClassName?: string;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [form, setForm] = useState<'' | 'repay' | 'waive' | 'refund'>('');
  const [reversing, setReversing] = useState<any>(null);
  if (!statement) return null;
  const totals = statement.totals || {};
  const who = self ? 'you' : statement.employee?.name || 'them';
  const rows: any[] = (statement.rows || []).filter((r: any) => (!from || r.date >= from) && (!to || r.date <= to));
  const shownTotal = Math.round(rows.reduce((sum, r) => sum + Number(r.real_variance || 0), 0) * 100) / 100;
  const owes = Number(totals.owes || 0);
  const surplus = Number(totals.surplus_available || 0);
  const refundable = Number(totals.refundable || 0);
  const done = async () => {
    setForm('');
    await onChanged?.();
  };

  return (
    <section className="bg-white border rounded-xl p-4 space-y-3 text-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Variances</h2>
          <p className="text-xs text-gray-500 max-w-xl">
            Every shift's over or short. Pay is never reduced for it: shortages are repaid separately. A surplus covers
            shortages in the same month; what is left at month end stays with the station.
          </p>
        </div>
        <div className="text-right">
          {owes > 0 ? (
            <p className="text-xl font-bold text-red-700">{self ? 'You owe' : 'Owes'} {kes(owes)}</p>
          ) : surplus + refundable > 0 ? (
            <p className="text-xl font-bold text-green-700">{kes(surplus + refundable)} in {self ? 'your' : 'their'} favour</p>
          ) : (
            <p className="text-xl font-bold text-gray-700">Nothing owed</p>
          )}
          {surplus > 0 && <p className="text-xs text-gray-600">Surplus this month {kes(surplus)}: covers shortages until month end</p>}
          {refundable > 0 && <p className="text-xs text-gray-600">Can be paid back to {who}: {kes(refundable)}</p>}
        </div>
      </div>

      {actions && !form && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {owes > 0 && (
            <button type="button" onClick={() => setForm('repay')} className="px-3 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium">
              Record repayment
            </button>
          )}
          {owes > 0 && (
            <button type="button" onClick={() => setForm('waive')} className="px-3 py-2 rounded-lg border border-amber-700 text-amber-800 text-sm font-medium">
              Write off
            </button>
          )}
          {refundable > 0 && (
            <button type="button" onClick={() => setForm('refund')} className="px-3 py-2 rounded-lg border border-green-700 text-green-800 text-sm font-medium">
              Pay back
            </button>
          )}
        </div>
      )}
      {actions && form === 'repay' && (
        <RepayForm statement={statement} repay={actions.repay} onDone={done} onCancel={() => setForm('')} inputClassName={inputClassName} />
      )}
      {actions && form === 'waive' && (
        <WaiveForm statement={statement} waive={actions.waive} approval={approval} onDone={done} onCancel={() => setForm('')} inputClassName={inputClassName} />
      )}
      {actions && form === 'refund' && (
        <RefundForm statement={statement} refund={actions.refund} approval={approval} onDone={done} onCancel={() => setForm('')} inputClassName={inputClassName} />
      )}

      <div className="flex flex-wrap items-end gap-2 text-sm print:hidden">
        <label className="block"><span className="text-gray-600 text-xs">From</span>
          <input type="date" className="border rounded-lg px-2 py-1 bg-white" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block"><span className="text-gray-600 text-xs">To</span>
          <input type="date" className="border rounded-lg px-2 py-1 bg-white" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && (
          <button type="button" className="text-blue-700 underline text-xs pb-1" onClick={() => { setFrom(''); setTo(''); }}>All dates</button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left p-1.5 sm:p-2 font-medium">Date</th>
              <th className="text-left p-1.5 sm:p-2 font-medium">Shift</th>
              <th className="text-right p-1.5 sm:p-2 font-medium">Shift variance</th>
              {/* On a phone, tap a row to see what recovered it. */}
              <th className="hidden sm:table-cell text-right p-2 font-medium">Recovered</th>
              <th className="text-right p-1.5 sm:p-2 font-medium">Real variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FragmentRow key={row.shift_id} row={row} open={openRow === row.shift_id} onToggle={() => setOpenRow(openRow === row.shift_id ? null : row.shift_id)} />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-gray-400">No variances for these dates.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold">
                <td className="p-1.5 sm:p-2" colSpan={3}>{from || to ? 'Total for these dates' : 'Total'}</td>
                <td className="hidden sm:table-cell" />
                <td className="p-1.5 sm:p-2 text-right tabular-nums"><VarianceAmount value={shownTotal} /></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {(statement.events || []).length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold text-sm">Repayments and adjustments</h3>
          {statement.events.map((ev: any) => (
            <div key={ev.id} className="text-sm border-t pt-1 flex flex-wrap justify-between gap-2">
              <p>
                {ev.date} · {EVENT_LABELS[ev.type] || ev.type} {kes(ev.amount)}
                {ev.method ? ` · ${METHODS[ev.method] || ev.method}` : ''}
                {ev.type === 'repayment' && ev.shift_id ? ` · into shift #${ev.shift_id} drawer` : ''}
                {ev.reference ? ` · ${ev.reference}` : ''}
                {ev.approved_by_name ? ` · approved by ${ev.approved_by_name}` : ev.created_by_name ? ` · by ${ev.created_by_name}` : ''}
                {ev.reason ? <span className="block text-xs text-gray-500">{ev.reason}</span> : null}
                {ev.type === 'waiver' && ev.unused > 0 ? <span className="block text-xs text-gray-500">{kes(ev.unused)} of it no longer applies after a correction.</span> : null}
              </p>
              {actions && ev.type === 'repayment' && ev.payment_id && (
                <button type="button" className="text-red-700 underline text-xs print:hidden" onClick={() => setReversing(ev)}>Reverse</button>
              )}
            </div>
          ))}
        </div>
      )}

      <EarlierRecords debt={earlier} />

      {actions && reversing && (
        <ReasonDialog
          title="Reverse repayment"
          onCancel={() => setReversing(null)}
          onConfirm={async (reason: string) => {
            await actions.reverseRepayment(Number(reversing.payment_id), reason);
            setReversing(null);
            await onChanged?.();
          }}
        >
          <p className="text-sm text-gray-600">
            {kes(reversing.amount)} received {reversing.date}. It stays on record, marked reversed, and is owed again.
          </p>
        </ReasonDialog>
      )}
    </section>
  );
}

function FragmentRow({ row, open, onToggle }: { row: any; open: boolean; onToggle: () => void }) {
  const status = row.status === 'kept' ? 'kept by station' : row.status === 'available' ? 'covers this month' : '';
  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="p-1.5 sm:p-2 whitespace-nowrap">{row.date}</td>
        <td className="p-1.5 sm:p-2">#{row.shift_id}{row.corrected ? <span className="ml-1 text-xs text-blue-700">corrected</span> : null}</td>
        <td className="p-1.5 sm:p-2 text-right tabular-nums"><VarianceAmount value={row.variance} /></td>
        <td className="hidden sm:table-cell p-2 text-right tabular-nums">{row.variance < 0 ? plain(row.recovered) : row.surplus_used > 0 ? `used ${plain(row.surplus_used)}` : '—'}</td>
        <td className="p-1.5 sm:p-2 text-right tabular-nums">
          <VarianceAmount value={row.real_variance} />
          {status && <span className="block text-[11px] text-gray-500">{status}</span>}
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50">
          <td colSpan={5} className="px-2"><RowDetails row={row} /></td>
        </tr>
      )}
    </>
  );
}

// A page of its own: Employees, then an employee's Variances.
export function EmployeeVariancesPage({
  employeeId,
  load,
  actions,
  approval,
  inputClassName,
}: {
  employeeId: number;
  load: (id: number) => Promise<any>;
  actions?: VarianceActions;
  approval?: ApprovalApi;
  inputClassName?: string;
}) {
  const [statement, setStatement] = useState<any>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const r = await load(employeeId);
      setStatement(r.data.data);
      setError('');
    } catch (e: any) {
      setError(errorText(e, 'Unable to load variances.'));
    }
  }, [employeeId, load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!statement) return <p role="status" className="p-4">{error || 'Loading variances…'}</p>;
  return (
    <main className="max-w-5xl mx-auto space-y-4 p-2 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to="/employees" className="text-sm text-blue-700 underline print:hidden">Employees</Link>
          <h1 className="text-2xl font-bold">{statement.employee.name}</h1>
          <p className="text-sm text-gray-500">
            Variances{statement.started_on ? ` · kept this way since ${statement.started_on}` : ''}
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="border rounded-lg px-4 py-2 bg-white print:hidden">Print</button>
      </div>
      {error && <p role="alert" className="bg-red-50 text-red-700 p-3">{error}</p>}
      <VarianceStatementView
        statement={statement}
        earlier={statement.earlier}
        actions={actions}
        approval={approval}
        onChanged={refresh}
        {...(inputClassName ? { inputClassName } : {})}
      />
    </main>
  );
}
