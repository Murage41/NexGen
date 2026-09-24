import { useEffect, useRef, useState } from 'react';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';
import { newOperationKey } from './operationKey';

// Move balance (backend services/balanceMoves.ts): the one way to fix a mistake
// found on a closed shift, which itself never changes. The amount comes off one
// account (it owes less) and goes onto another (it owes more): a customer, an
// employee, or, for a customer only, the station (it writes a customer's debt
// off, or raises it). Employees pay their shortages: never the station. No
// money moves.
// Mobile passes no `approval`: the signed-in admin approves as themselves; the
// desktop names an admin and takes their PIN.

export type BalanceMoveApi = {
  parties: () => Promise<any>;
  post: (body: Record<string, unknown>, key: string) => Promise<any>;
};
export type MoveParty = { kind: 'customer' | 'employee' | 'station'; id?: number | null };

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';
const encode = (p?: MoveParty | null) => (p ? `${p.kind}:${p.kind === 'station' ? 0 : Number(p.id || 0)}` : '');
const decode = (value: string) => {
  const [kind, id] = value.split(':');
  return { kind, id: Number(id) || null };
};

function PartySelect({ value, onChange, parties, inputClassName }: any) {
  return (
    <select className={inputClassName} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      <option value="station:0">Station (customers only: writes off / raises)</option>
      <optgroup label="Customers">
        {(parties?.customers || []).map((c: any) => (
          <option key={`c${c.id}`} value={`customer:${c.id}`}>
            {c.name}{Number(c.owes) > 0 ? ` (owes ${kes(c.owes)})` : ''}
          </option>
        ))}
      </optgroup>
      <optgroup label="Employees">
        {(parties?.employees || []).map((e: any) => (
          <option key={`e${e.id}`} value={`employee:${e.id}`}>{e.name}{e.active === false ? ' (left)' : ''}</option>
        ))}
      </optgroup>
    </select>
  );
}

export function BalanceMoveForm({
  api,
  approval,
  initialFrom,
  onDone,
  onCancel,
  inputClassName = field,
}: {
  api: BalanceMoveApi;
  approval?: ApprovalApi;
  initialFrom?: MoveParty | null;
  onDone: () => Promise<void> | void;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const approver = useApprover(approval);
  const key = useRef(newOperationKey());
  const [parties, setParties] = useState<any>(null);
  const [from, setFrom] = useState(encode(initialFrom));
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.parties()
      .then((r: any) => setParties(r.data?.data || r.data || null))
      .catch((e: any) => {
        console.error('[BalanceMove:parties]', e?.response?.data || e?.message);
        setError(e?.response?.data?.error || 'Could not load customers and employees.');
      });
  }, []);

  const nameOf = (value: string) => {
    if (!value) return '…';
    const { kind, id } = decode(value);
    if (kind === 'station') return 'the station';
    const list = kind === 'customer' ? parties?.customers : parties?.employees;
    return list?.find((p: any) => Number(p.id) === id)?.name || '…';
  };
  const value = Number(amount);
  // Between a customer and an employee the move corrects that employee's
  // shift, so the shift number is required (the server checks it is theirs).
  const kinds = [from, to].map((v) => v.split(':')[0]);
  const needsShift = kinds.includes('customer') && kinds.includes('employee');
  // An employee's shortage is never written off or raised by the station.
  const stationEmployee = kinds.includes('station') && kinds.includes('employee');
  const ready = from && to && from !== to && !(from.startsWith('station') && to.startsWith('station'))
    && !stationEmployee && value > 0 && reason.trim().length >= 3 && (!needsShift || Number(shiftId) > 0);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const f = decode(from);
      const t = decode(to);
      const body = {
        from_kind: f.kind, from_id: f.id, to_kind: t.kind, to_id: t.id,
        shift_id: shiftId ? Number(shiftId) : null, amount: value,
      };
      const approved = await approver.confirm('balance_move', body);
      await api.post({
        ...body,
        reason: reason.trim(),
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      }, key.current);
      key.current = newOperationKey();
      await onDone();
    } catch (e: any) {
      console.error('[BalanceMove:submit]', e?.response?.data || e?.message);
      setError(e?.response?.data?.error || e?.message || 'The move could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-300 bg-white p-3 space-y-2 text-sm text-gray-800">
      <p className="font-semibold">Move balance</p>
      <p className="text-xs text-gray-600">
        For a mistake found on a closed shift. The shift stays as it was closed; this is dated today and no money moves.
        The amount comes off <b>From</b> (they owe less) and goes onto <b>To</b> (they owe more).
      </p>
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer">Examples</summary>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>Credit on the wrong customer: from the wrong customer, to the right one.</li>
          <li>Payment on the wrong customer: from the one who really paid, to the one it was recorded on.</li>
          <li>Made-up credit that hid a shortage: from the customer, to the attendant.</li>
          <li>Payment recorded that never came in: from the attendant, to the customer.</li>
          <li>Repayment on the wrong employee: from the one who paid, to the one it was recorded on.</li>
          <li>A customer's debt nobody will pay: from the customer, to the station.</li>
        </ul>
      </details>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-end">
        <label className="block"><span className="text-gray-700">From (owes less)</span>
          <PartySelect value={from} onChange={setFrom} parties={parties} inputClassName={inputClassName} />
        </label>
        <button type="button" onClick={() => { setFrom(to); setTo(from); }} className="px-2 py-2 text-gray-600" title="Swap" aria-label="Swap from and to">⇄</button>
        <label className="block"><span className="text-gray-700">To (owes more)</span>
          <PartySelect value={to} onChange={setTo} parties={parties} inputClassName={inputClassName} />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block"><span className="text-gray-700">Amount</span>
          <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block"><span className="text-gray-700">Shift number{needsShift ? " (the employee's shift)" : ' (optional)'}</span>
          <input className={inputClassName} type="number" inputMode="numeric" min="1" value={shiftId} onChange={(e) => setShiftId(e.target.value)} />
        </label>
      </div>
      <label className="block"><span className="text-gray-700">Reason</span>
        <input className={inputClassName} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What was wrong" />
      </label>
      {stationEmployee && <p className="text-xs text-red-700">An employee pays their shortages: the station can't write them off or add to them.</p>}
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !approver.ready || !ready}
          className="px-3 py-2 rounded-lg bg-gray-800 text-white font-medium disabled:opacity-50">
          {busy ? 'Saving…' : `Move ${kes(value > 0 ? value : 0)} from ${nameOf(from)} to ${nameOf(to)}`}
        </button>
      </div>
    </div>
  );
}

// A button that opens the form, for account pages.
export function MoveBalanceButton(props: {
  api: BalanceMoveApi;
  approval?: ApprovalApi;
  initialFrom?: MoveParty | null;
  onDone: () => Promise<void> | void;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg border border-gray-400 text-gray-800 text-sm font-medium">
        Move balance
      </button>
    );
  }
  return (
    <BalanceMoveForm
      {...props}
      onCancel={() => setOpen(false)}
      onDone={async () => { setOpen(false); await props.onDone(); }}
    />
  );
}

// Read-only list, e.g. moves that refer to a shift.
export function BalanceMoveList({ moves }: { moves: any[] }) {
  if (!moves?.length) return null;
  return (
    <div className="space-y-1 text-sm">
      {moves.map((m) => (
        <p key={m.id} className="border-t pt-1">
          {String(m.posting_date).slice(0, 10)} · Move #{m.id}: {kes(m.amount)} from {m.from_name} to {m.to_name}
          {m.shift_id ? ` · shift #${m.shift_id}` : ''}
          {m.approved_by_name ? ` · approved by ${m.approved_by_name}` : ''}
          <span className="block text-xs text-gray-500">{m.reason}</span>
        </p>
      ))}
    </div>
  );
}
