import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApprovalApi } from './ApproverConfirm';
import { ReasonDialog } from './ReasonDialog';
import { newOperationKey } from './operationKey';
import { BalanceMoveForm, type BalanceMoveApi } from './BalanceMove';

// An employee's shortages (backend services/employeeVariances.ts): the shifts
// they ran that were short, what they have paid, and what is still owed. Pay is
// never reduced for it; the employee pays separately, in money. A surplus is
// the station's and never appears here. No write-offs, no paying back.
//
// `approval` is only passed on to Move balance. Without `actions` the view is
// read-only (an employee's own view).

export type VarianceActions = {
  repay: (employeeId: number, body: Record<string, unknown>, key: string) => Promise<any>;
  reverseRepayment: (paymentId: number, reason: string) => Promise<any>;
  move?: BalanceMoveApi;
};

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (value: unknown) =>
  Math.abs(Number(value || 0)).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';
const errorText = (e: any, fallback: string) => e?.response?.data?.error || e?.message || fallback;

// A shift's over or short, as on the shift page: negative = short.
export function VarianceAmount({ value }: { value: number }) {
  const amount = Number(value || 0);
  if (Math.abs(amount) < 0.005) return <span className="text-gray-500">0.00</span>;
  return amount < 0
    ? <span className="text-red-700">Short {plain(amount)}</span>
    : <span className="text-green-700">Over {plain(amount)}</span>;
}

// One line for lists: what the employee owes, or their credit.
export function describeVarianceTotals(totals: any) {
  const owes = Number(totals?.owes || 0);
  const credit = Number(totals?.credit || 0);
  if (owes > 0) return { text: `Owes ${kes(owes)}`, tone: 'owes' as const };
  if (credit > 0) return { text: `Credit ${kes(credit)}`, tone: 'favour' as const };
  return { text: 'Nothing owed', tone: 'none' as const };
}

const EVENT_LABELS: Record<string, string> = {
  repayment: 'Paid',
  move: 'Balance move',
  waiver: 'Written off (before 24 Sep 2026)',
  refund: 'Paid back (before 24 Sep 2026)',
  legacy_owed_back: 'Credit from the old records',
  legacy_reversal: 'Owed again',
};
const METHODS: Record<string, string> = { cash: 'cash', mpesa: 'M-Pesa', bank_transfer: 'bank transfer' };

function RowDetails({ row }: { row: any }) {
  const by = row.paid_by || {};
  const legacy = (row.legacy || []).map((l: any) => l.details).find(Boolean) || null;
  const lines: string[] = [];
  if (row.corrected) {
    lines.push(`Shortage at close: ${kes(row.closed_shortage)}`);
    for (const c of row.corrections) {
      lines.push(`Changed ${c.date}: ${c.change > 0 ? 'short' : 'less short by'} ${plain(c.change)}${c.change > 0 ? ' more' : ''}${c.reason ? ` (${c.reason})` : ''}`);
    }
  }
  if (by.repaid > 0) lines.push(`Paid: ${kes(by.repaid)}`);
  if (by.moved > 0) lines.push(`Moved off by a balance move: ${kes(by.moved)}`);
  if (by.waived > 0) lines.push(`Written off before 24 Sep 2026: ${kes(by.waived)}`);
  if (by.recovered_before > 0) lines.push(`Recovered by the old records: ${kes(by.recovered_before)}`);
  if (by.cleared_before > 0) lines.push(`Cleared by the old records: ${kes(by.cleared_before)}`);
  if (legacy) {
    const parts = [
      ['deducted from the wage at close', legacy.deducted_from_wage_at_close],
      ['deducted from later wages', legacy.deducted_from_later_wages],
      ['repaid', legacy.repaid],
      ['taken in payroll', legacy.payroll],
    ].filter(([, v]) => Number(v) > 0);
    if (parts.length) lines.push(`Old records: ${parts.map(([label, v]) => `${label} ${kes(v)}`).join(', ')}`);
  }
  return (
    <div className="text-xs text-gray-700 space-y-0.5 py-2">
      {lines.length ? lines.map((line) => <p key={line}>{line}</p>) : <p>Nothing paid yet.</p>}
      <Link to={`/shifts/${row.shift_id}`} className="text-blue-700 underline print:hidden">Open shift #{row.shift_id}</Link>
    </div>
  );
}

// The employee pays in money, oldest shortage first, on a date, optionally
// into an open shift's drawer.
function PaymentForm({ statement, repay, onDone, onCancel, inputClassName }: any) {
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
      console.error('[EmployeeVariances:payment]', e?.response?.data || e?.message);
      setError(errorText(e, 'The payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="font-semibold text-gray-800">Record a payment</p>
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

// The staff-debt records from before variances started, as they were.
function EarlierRecords({ debt }: { debt: any }) {
  const debts: any[] = debt?.debts || [];
  const receipts: any[] = debt?.receipts || [];
  if (!debts.length && !receipts.length) return null;
  return (
    <details className="border rounded-lg p-3 text-sm">
      <summary className="cursor-pointer font-medium">Earlier records (staff debt before this list started)</summary>
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
  const [form, setForm] = useState<'' | 'repay' | 'move'>('');
  const [reversing, setReversing] = useState<any>(null);
  if (!statement) return null;
  const totals = statement.totals || {};
  const rows: any[] = (statement.rows || []).filter((r: any) => (!from || r.date >= from) && (!to || r.date <= to));
  const shownOwed = Math.round(rows.reduce((sum, r) => sum + Number(r.owed || 0), 0) * 100) / 100;
  const owes = Number(totals.owes || 0);
  const credit = Number(totals.credit || 0);
  const done = async () => {
    setForm('');
    await onChanged?.();
  };

  return (
    <section className="bg-white border rounded-xl p-4 space-y-3 text-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Shortages</h2>
          <p className="text-xs text-gray-500 max-w-xl">
            The shifts {self ? 'you' : 'they'} ran that were short, and what {self ? 'you have' : 'they have'} paid. Pay is
            never reduced for it. A surplus belongs to the station and does not appear here.
          </p>
        </div>
        <div className="text-right">
          {owes > 0 ? (
            <p className="text-xl font-bold text-red-700">{self ? 'You owe' : 'Owes'} {kes(owes)}</p>
          ) : (
            <p className="text-xl font-bold text-gray-700">Nothing owed</p>
          )}
          {credit > 0 && <p className="text-xs text-gray-600">Credit {kes(credit)}: it pays the next shortage</p>}
        </div>
      </div>

      {actions && !form && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {owes > 0 && (
            <button type="button" onClick={() => setForm('repay')} className="px-3 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium">
              Record payment
            </button>
          )}
          {actions.move && (
            <button type="button" onClick={() => setForm('move')} className="px-3 py-2 rounded-lg border border-gray-500 text-gray-800 text-sm font-medium">
              Move balance
            </button>
          )}
        </div>
      )}
      {actions && form === 'repay' && (
        <PaymentForm statement={statement} repay={actions.repay} onDone={done} onCancel={() => setForm('')} inputClassName={inputClassName} />
      )}
      {actions?.move && form === 'move' && (
        <BalanceMoveForm api={actions.move} approval={approval} initialFrom={{ kind: 'employee', id: statement.employee.id }} onDone={done} onCancel={() => setForm('')} inputClassName={inputClassName} />
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
              <th className="text-right p-1.5 sm:p-2 font-medium">Shortage</th>
              {/* On a phone, tap a row to see what paid it. */}
              <th className="hidden sm:table-cell text-right p-2 font-medium">Paid</th>
              <th className="text-right p-1.5 sm:p-2 font-medium">Still owed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FragmentRow key={row.shift_id} row={row} open={openRow === row.shift_id} onToggle={() => setOpenRow(openRow === row.shift_id ? null : row.shift_id)} />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-gray-400">No shortages for these dates.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold">
                <td className="p-1.5 sm:p-2" colSpan={3}>{from || to ? 'Still owed for these dates' : 'Still owed'}</td>
                <td className="hidden sm:table-cell" />
                <td className="p-1.5 sm:p-2 text-right tabular-nums">{kes(shownOwed)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {(statement.events || []).length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold text-sm">Payments and moves</h3>
          {statement.events.map((ev: any) => (
            <div key={ev.id} className="text-sm border-t pt-1 flex flex-wrap justify-between gap-2">
              <p>
                {ev.date} · {EVENT_LABELS[ev.type] || ev.type} {kes(ev.amount)}
                {ev.method && METHODS[ev.method] ? ` · ${METHODS[ev.method]}` : ''}
                {ev.type === 'repayment' && ev.shift_id ? ` · into shift #${ev.shift_id} drawer` : ''}
                {ev.reference ? ` · ${ev.reference}` : ''}
                {ev.approved_by_name ? ` · approved by ${ev.approved_by_name}` : ev.created_by_name ? ` · by ${ev.created_by_name}` : ''}
                {ev.reason ? <span className="block text-xs text-gray-500">{ev.reason}</span> : null}
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
          title="Reverse payment"
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
  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="p-1.5 sm:p-2 whitespace-nowrap">{row.date}</td>
        <td className="p-1.5 sm:p-2">#{row.shift_id}{row.corrected ? <span className="ml-1 text-xs text-blue-700">changed</span> : null}</td>
        <td className="p-1.5 sm:p-2 text-right tabular-nums">{kes(row.shortage)}</td>
        <td className="hidden sm:table-cell p-2 text-right tabular-nums">{plain(row.paid)}</td>
        <td className={`p-1.5 sm:p-2 text-right tabular-nums ${row.owed > 0 ? 'text-red-700' : 'text-gray-500'}`}>
          {row.owed > 0 ? kes(row.owed) : 'Paid'}
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
      setError(errorText(e, 'Unable to load shortages.'));
    }
  }, [employeeId, load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!statement) return <p role="status" className="p-4">{error || 'Loading shortages…'}</p>;
  return (
    <main className="max-w-5xl mx-auto space-y-4 p-2 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to="/employees" className="text-sm text-blue-700 underline print:hidden">Employees</Link>
          <h1 className="text-2xl font-bold">{statement.employee.name}</h1>
          <p className="text-sm text-gray-500">
            Shortages{statement.started_on ? ` · kept this way since ${statement.started_on}` : ''}
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
