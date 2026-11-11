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
const LEDGER_SHOWN = 30;
const whenText = (line: any) => {
  const at = new Date(line.at);
  const day = at.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  return line.precision === 'date' ? day : `${day}, ${at.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`;
};
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

const METHODS: Record<string, string> = { cash: 'cash', mpesa: 'M-Pesa', bank_transfer: 'bank transfer' };

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
      </div>
      <p className="text-xs text-gray-500">
        Only if the money went into an open shift's till.
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
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState<'' | 'repay' | 'move'>('');
  const [reversing, setReversing] = useState<any>(null);
  if (!statement) return null;
  const totals = statement.totals || {};
  const ledger: any[] = statement.ledger || [];
  const shown = showAll ? ledger : ledger.slice(0, LEDGER_SHOWN);
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
        </div>
        <div className="text-right">
          {owes > 0 ? (
            <p className="text-xl font-bold text-red-700">{self ? 'You still owe' : 'Still owes'} {kes(owes)}</p>
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

      {ledger.length === 0 ? <p className="text-sm text-gray-400">No shortages.</p> : (
        <ol className="border rounded-lg overflow-hidden">
          {shown.map((line) => {
            const adds = Number(line.amount) > 0;
            const balance = Number(line.balance);
            const details = [
              whenText(line),
              line.shift_id ? `Shift #${line.shift_id}` : '',
              line.method ? METHODS[line.method] || line.method : '',
              line.reference || '',
              line.by && !adds ? `by ${line.by}` : '',
            ].filter(Boolean).join(' · ');
            return (
              <li key={line.id} className={`border-l-4 border-t first:border-t-0 border-t-gray-100 px-3 py-2 flex items-start justify-between gap-3 ${adds ? 'border-l-red-500' : 'border-l-green-600'}`}>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{line.title}</p>
                  <p className="text-xs text-gray-500">{details}</p>
                  {line.reason && <p className="text-xs text-gray-500">{line.reason}</p>}
                  {actions && line.type === 'repayment' && line.payment_id && (
                    <button type="button" className="text-red-700 underline text-xs print:hidden" onClick={() => setReversing(line)}>Reverse</button>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold tabular-nums ${adds ? 'text-red-700' : 'text-green-700'}`}>{adds ? '+' : '−'}{plain(Math.abs(Number(line.amount)))}</p>
                  <p className="text-xs text-gray-500 tabular-nums">{balance < 0 ? `credit ${plain(-balance)}` : `owed ${plain(balance)}`}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {ledger.length > LEDGER_SHOWN && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="w-full py-2 text-sm text-blue-700 print:hidden">
          {showAll ? 'Show fewer' : `Show all ${ledger.length}`}
        </button>
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
            {kes(Math.abs(Number(reversing.amount)))} received {whenText(reversing)}. It stays on record, marked reversed, and is owed again.
          </p>
        </ReasonDialog>
      )}
    </section>
  );
}

export function EmployeeVariancesPage({
  employeeId,
  load,
  actions,
  approval,
  inputClassName,
  embedded = false,
}: {
  employeeId: number;
  load: (id: number) => Promise<any>;
  actions?: VarianceActions;
  approval?: ApprovalApi;
  embedded?: boolean;
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
      <div className={`flex flex-wrap items-end gap-2 ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded && <div>
          <Link to="/employees" className="text-sm text-blue-700 underline print:hidden">Employees</Link>
          <h1 className="text-2xl font-bold">{statement.employee.name}</h1>
          <p className="text-sm text-gray-500">
            Shortages{statement.started_on ? ` · kept this way since ${statement.started_on}` : ''}
          </p>
        </div>}
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
