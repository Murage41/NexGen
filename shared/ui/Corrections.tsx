import { useEffect, useState } from 'react';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';

// Corrections (backend services/corrections.ts, docs/CORRECTIONS.md): the one
// way to fix a mistake in a closed record. Before a shift closes, fix it on the
// shift; after, correct it here. The shift keeps what it closed with; the
// correction is recorded next to it with what it changed.
//
// The flow: what was wrong → the right value (only that field) → the effects in
// plain words (and, if a shift gets worse, who carries it) → a reason → the
// admin approves exactly what was shown (desktop: name and PIN; phone: the
// signed-in admin). Phase 1 corrects fuel on account.

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 text-sm';
const errorText = (e: any, fallback: string) => e?.response?.data?.error || e?.message || fallback;
const litresText = (litres: unknown, fuel: unknown) => `${Number(litres || 0).toFixed(2)} L of ${fuel}`;

export type CorrectionApi = {
  // POST /corrections/preview, POST /corrections, POST /corrections/:id/undo,
  // GET /corrections/reasons (axios responses).
  preview: (body: Record<string, unknown>) => Promise<any>;
  post: (body: Record<string, unknown>) => Promise<any>;
  undo: (id: number, body: Record<string, unknown>) => Promise<any>;
  reasons: () => Promise<any>;
  // Invoice customers the fuel may belong to.
  customers: () => Promise<Array<{ id: number; name: string }>>;
};

export type CorrectableEntry = {
  id: number;
  account_id: number;
  account_name?: string | null;
  shift_id: number;
  shift_date?: string | null;
  fuel_type: string;
  litres: number | string;
  retail_amount: number | string;
};

export const ERROR_KINDS: Array<{ kind: string; label: string }> = [
  { kind: 'wrong_litres', label: 'The litres were wrong' },
  { kind: 'wrong_fuel', label: 'It was the other fuel' },
  { kind: 'wrong_customer', label: 'It was another customer' },
  { kind: 'wrong_shift', label: 'It was on another shift' },
  { kind: 'duplicate', label: 'It was never taken, or was recorded twice' },
  { kind: 'missing', label: 'Fuel was taken but not recorded' },
];
export const errorKindLabel = (kind: string) =>
  kind === 'undo' ? 'Undo' : ERROR_KINDS.find((k) => k.kind === kind)?.label || kind;

export function CorrectionForm({
  api,
  approval,
  entry,
  shift,
  onDone,
  onCancel,
  inputClassName = field,
}: {
  api: CorrectionApi;
  approval?: ApprovalApi;
  // The fuel entry being corrected, or the closed shift missing an entry.
  entry?: CorrectableEntry | null;
  shift?: { id: number; shift_date?: string | null } | null;
  onDone: (correction: any) => Promise<void> | void;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const approver = useApprover(approval);
  const [kind, setKind] = useState(entry ? '' : 'missing');
  const [litres, setLitres] = useState(entry ? String(Number(entry.litres)) : '');
  const [fuel, setFuel] = useState(entry ? (entry.fuel_type === 'diesel' ? 'petrol' : 'diesel') : '');
  const [accountId, setAccountId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [chargeTo, setChargeTo] = useState('');
  const [reasons, setReasons] = useState<Array<{ code: string; label: string }>>([]);
  const [customers, setCustomers] = useState<Array<{ id: number; name: string }>>([]);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [plan, setPlan] = useState<{ data?: any; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.reasons().then((r) => setReasons(r.data.data || [])).catch(() => setReasons([]));
    api.customers().then(setCustomers).catch(() => setCustomers([]));
  }, []);

  const request: Record<string, unknown> = { record_type: 'fuel_on_account', error_kind: kind };
  if (entry) request.target_id = entry.id;
  if (kind === 'wrong_litres' || kind === 'wrong_fuel' || kind === 'missing') request.litres = Number(litres);
  if (kind === 'wrong_fuel' || kind === 'missing') request.fuel_type = fuel;
  if (kind === 'wrong_customer' || kind === 'missing') request.account_id = Number(accountId);
  if (kind === 'wrong_shift') request.shift_id = Number(shiftId);
  if (kind === 'missing') request.shift_id = shift?.id;
  if (chargeTo) request.charge_to = chargeTo;
  const complete = Boolean(kind)
    && (!('litres' in request) || Number(litres) > 0)
    && (!('fuel_type' in request) || Boolean(fuel))
    && (!('account_id' in request) || Number(accountId) > 0)
    && (kind !== 'wrong_shift' || Number(shiftId) > 0);
  const key = JSON.stringify(request);

  useEffect(() => {
    setPlan(null);
    if (!complete) return;
    let live = true;
    const timer = setTimeout(() => {
      api.preview(request)
        .then((r) => { if (live) setPlan({ data: r.data.data }); })
        .catch((e) => { if (live) setPlan({ error: errorText(e, 'This correction is not possible.') }); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [key]);

  const needsChoice = Boolean(plan?.data?.needs_choice);
  const ready = Boolean(plan?.data) && (!needsChoice || Boolean(chargeTo)) && Boolean(reasonCode)
    && reasonNote.trim().length >= 10 && approver.ready;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      // The approval is for exactly this plan, reason included: preview it
      // once more and stop if anything changed since it was shown.
      const body = { ...request, reason_code: reasonCode, reason_note: reasonNote.trim() };
      const final = (await api.preview(body)).data.data;
      if (JSON.stringify(final.effects) !== JSON.stringify(plan?.data?.effects)) {
        setPlan({ data: final });
        setError('Something changed since this was shown. Check the effects again, then post.');
        return;
      }
      const approved = await approver.confirm('correction', { plan_hash: final.plan_hash });
      const posted = await api.post({
        ...body,
        plan_hash: final.plan_hash,
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
      await onDone(posted.data.data);
    } catch (e: any) {
      console.error('[Corrections:submit]', e?.response?.data || e?.message);
      setError(errorText(e, 'The correction could not be posted.'));
    } finally {
      setBusy(false);
    }
  }

  const worse = (plan?.data?.shifts || []).filter((s: any) => s.worse && s.attendant_id);
  const other = customers.filter((c) => !entry || Number(c.id) !== Number(entry.account_id));

  return (
    <div className="space-y-3 text-sm text-gray-800">
      {entry ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
          As recorded: fuel entry #{entry.id}, {litresText(entry.litres, entry.fuel_type)}
          {entry.account_name ? ` on ${entry.account_name}` : ''} in shift #{entry.shift_id}
          {entry.shift_date ? ` (${String(entry.shift_date).slice(0, 10)})` : ''}, {kes(entry.retail_amount)}.
        </div>
      ) : (
        <p className="text-xs text-gray-600">
          Fuel on account taken in shift #{shift?.id}{shift?.shift_date ? ` (${String(shift.shift_date).slice(0, 10)})` : ''} but not
          recorded. It is added at the shift's pump price.
        </p>
      )}

      {entry && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-gray-700 mb-1">What was wrong?</legend>
          {ERROR_KINDS.filter((k) => k.kind !== 'missing').map((k) => (
            <label key={k.kind} className="flex items-center gap-2">
              <input type="radio" name="error_kind" checked={kind === k.kind} onChange={() => { setKind(k.kind); setChargeTo(''); }} />
              {k.label}
            </label>
          ))}
        </fieldset>
      )}

      {kind && kind !== 'duplicate' && (
        <div className="grid grid-cols-2 gap-2">
          {(kind === 'wrong_fuel' || kind === 'missing') && (
            <label className="block"><span className="text-xs text-gray-600">Fuel taken</span>
              <select className={inputClassName} value={fuel} onChange={(e) => setFuel(e.target.value)}>
                <option value="">Choose</option>
                {['petrol', 'diesel'].filter((f) => kind === 'missing' || f !== entry?.fuel_type).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          )}
          {(kind === 'wrong_litres' || kind === 'wrong_fuel' || kind === 'missing') && (
            <label className="block"><span className="text-xs text-gray-600">Litres taken</span>
              <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" value={litres} onChange={(e) => setLitres(e.target.value)} />
            </label>
          )}
          {(kind === 'wrong_customer' || kind === 'missing') && (
            <label className="block col-span-2"><span className="text-xs text-gray-600">Customer who took it</span>
              <select className={inputClassName} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose the customer</option>
                {other.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {kind === 'wrong_shift' && (
            <label className="block col-span-2"><span className="text-xs text-gray-600">The shift it was taken on (shift number, from Shifts)</span>
              <input className={inputClassName} type="number" inputMode="numeric" min="1" value={shiftId} onChange={(e) => setShiftId(e.target.value)} />
            </label>
          )}
        </div>
      )}

      {plan?.error && <p className="text-xs text-red-700">{plan.error}</p>}
      {plan?.data && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-gray-800">
          <p className="font-semibold mb-1">What this correction does</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {plan.data.effects.map((effect: string, i: number) => <li key={i}>{effect}</li>)}
          </ul>
        </div>
      )}

      {needsChoice && (
        <fieldset className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
          <legend className="font-semibold text-gray-800 px-1">Who carries it?</legend>
          <p className="text-gray-700">
            {worse.map((s: any) => `Shift #${s.shift_id} (${s.attendant_name || 'no attendant'}) gets worse by ${kes(-s.change)}.`).join(' ')}
          </p>
          <label className="flex items-center gap-2">
            <input type="radio" name="charge_to" checked={chargeTo === 'attendant'} onChange={() => setChargeTo('attendant')} />
            The attendant (normal rules: it adds to their shortage on that shift)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="charge_to" checked={chargeTo === 'station'} onChange={() => setChargeTo('station')} />
            The station (not their doing)
          </label>
        </fieldset>
      )}

      {plan?.data && (
        <>
          <label className="block"><span className="text-xs text-gray-600">Reason</span>
            <select className={inputClassName} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">Choose a reason</option>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs text-gray-600">What happened (at least 10 characters)</span>
            <textarea className={inputClassName} rows={2} maxLength={500} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
          </label>
          <ApproverFields state={approver} inputClassName={inputClassName} />
        </>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !ready}
          className="px-3 py-2 rounded-lg text-white font-medium bg-blue-600 disabled:opacity-50">
          {busy ? 'Posting…' : 'Post the correction'}
        </button>
      </div>
    </div>
  );
}

// Undoing a correction made in error: a new correction that cancels it.
export function CorrectionUndo({
  correction,
  api,
  approval,
  onDone,
  onCancel,
  inputClassName = field,
}: {
  correction: { id: number; number: string };
  api: CorrectionApi;
  approval?: ApprovalApi;
  onDone: (undo: any) => Promise<void> | void;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const approver = useApprover(approval);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm('correction_undo', { correction_id: correction.id });
      const done = await api.undo(correction.id, {
        reason_note: reason.trim(),
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
      await onDone(done.data.data);
    } catch (e: any) {
      console.error('[Corrections:undo]', e?.response?.data || e?.message);
      setError(errorText(e, 'The correction could not be undone.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-gray-800">
      <p className="text-xs text-gray-600">
        A new correction cancels {correction.number} exactly: the entry it reversed comes back, the one it added is reversed, and
        anything it did to the attendant is cancelled.
      </p>
      <label className="block"><span className="text-xs text-gray-600">Why (at least 10 characters)</span>
        <textarea className={inputClassName} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || reason.trim().length < 10 || !approver.ready}
          className="px-3 py-2 rounded-lg text-white font-medium bg-red-600 disabled:opacity-50">
          {busy ? 'Undoing…' : `Undo ${correction.number}`}
        </button>
      </div>
    </div>
  );
}

const result = (value: number) => (value < 0 ? `short ${kes(-value)}` : value > 0 ? `over ${kes(value)}` : 'balanced');

// On a closed shift: the corrections made since it closed and the result they
// lead to. The shift's own figures stay as it closed.
export function ShiftCorrectionsBanner({ corrections, asClosed }: { corrections: any; asClosed: number }) {
  if (!corrections?.lines?.length) return null;
  const numbers = [...new Set(corrections.lines.map((l: any) => l.number))];
  const byNumber = numbers.map((number) => ({ number, lines: corrections.lines.filter((l: any) => l.number === number) }));
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-gray-800 space-y-1">
      <p className="font-semibold">
        {numbers.length} correction{numbers.length === 1 ? '' : 's'} since close: result at close {result(asClosed)}; corrected result{' '}
        {result(Number(corrections.corrected_variance ?? asClosed))}.
      </p>
      <p className="text-xs text-gray-600">The shift's own figures stay as it closed. Corrections are recorded next to it, never in it.</p>
      <ul className="text-xs space-y-0.5">
        {byNumber.map(({ number, lines }: any) => {
          const change = lines.reduce((sum: number, l: any) => sum + Number(l.shift_effect || 0), 0);
          const first = lines[0];
          return (
            <li key={number}>
              <strong>{number}</strong> ({String(first.posting_date).slice(0, 10)}{first.status === 'undone' ? ', undone' : ''}): {errorKindLabel(first.error_kind)}
              {lines.map((l: any, i: number) => (
                <span key={i}>
                  {' '}· {l.action === 'add' ? 'added' : l.action === 'restore' ? 'restored' : 'reversed'} {litresText(l.litres, l.fuel_type)}
                  {l.party_name ? ` on ${l.party_name}` : ''}
                </span>
              ))}
              {' '}· shift {change >= 0 ? 'better' : 'worse'} by {kes(Math.abs(change))}
              {change < 0 && first.charge_to ? ` (${first.charge_to === 'station' ? 'the station carries it' : 'the attendant carries it'})` : ''}
              {first.reason_note ? `: ${first.reason_note}` : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
