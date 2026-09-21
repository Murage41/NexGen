import { useMemo, useState } from 'react';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';

// Correcting a credit, payment or fuel-on-account entry of a CLOSED shift
// (backend services/shiftCorrections.ts). Nothing is edited: the original stays
// on record, marked corrected, and the correction is dated today.
//
// Flow: choose what was wrong -> Preview (changes nothing) -> Post, approved by
// an administrator. Mobile passes no `approval`: the signed-in admin approves as
// themselves. The desktop passes it: an administrator picks their name and
// enters their PIN, bound to exactly the previewed correction.

export type CorrectionEntry = {
  entry_type: 'credit' | 'payment' | 'invoice_consumption';
  entry_id: number;
  account_id: number;
  account_name: string;
  amount?: number;
  litres?: number;
  fuel_type?: string;
  pump_id?: number | null;
  payment_method?: string;
};

export type CorrectionAccount = {
  id: number;
  name: string;
  type: string;
  billing_mode?: string | null;
};

export type CorrectionPump = {
  pump_id: number;
  pump_label: string;
  nozzle_label?: string | null;
  fuel_type: string;
};

export type CorrectionApi = {
  preview: (shiftId: number, body: Record<string, unknown>) => Promise<any>;
  post: (shiftId: number, body: Record<string, unknown>) => Promise<any>;
};

type Kind = 'wrong_customer' | 'wrong_amount' | 'not_valid';

const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KIND_LABELS: Record<CorrectionEntry['entry_type'], Record<Kind, string>> = {
  credit: {
    wrong_customer: 'Wrong customer',
    wrong_amount: 'Wrong amount',
    not_valid: 'It never happened (for example, entered twice)',
  },
  payment: {
    wrong_customer: 'Wrong customer or employee',
    wrong_amount: 'Wrong amount',
    not_valid: 'It was never received (for example, entered twice)',
  },
  invoice_consumption: {
    wrong_customer: 'Wrong customer',
    wrong_amount: 'Wrong litres or pump',
    not_valid: 'It was never supplied (for example, entered twice)',
  },
};

const WHAT: Record<CorrectionEntry['entry_type'], string> = {
  credit: 'credit',
  payment: 'payment',
  invoice_consumption: 'fuel on account',
};

function owedLabel(account: any) {
  if (account.measure === 'uninvoiced_fuel') return `Uninvoiced fuel for ${account.name}`;
  return `${account.name} owes`;
}

// A shift's variance in words: below zero the drawer was short.
export function describeShiftBalance(variance: unknown) {
  const value = Math.round(Number(variance || 0) * 100) / 100;
  if (value < 0) return `shortage of ${kes(-value)}`;
  if (value > 0) return `surplus of ${kes(value)}`;
  return 'balanced';
}

export function ShiftCorrectionForm({
  shiftId,
  entry,
  accounts,
  pumps = [],
  api,
  approval,
  onDone,
  onCancel,
  inputClassName = field,
}: {
  shiftId: number;
  entry: CorrectionEntry;
  accounts: CorrectionAccount[];
  pumps?: CorrectionPump[];
  api: CorrectionApi;
  approval?: ApprovalApi;
  onDone: (result: any) => void;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const approver = useApprover(approval);
  const [kind, setKind] = useState<Kind | ''>('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [pumpId, setPumpId] = useState(entry.pump_id ? String(entry.pump_id) : '');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const targets = useMemo(() => accounts.filter((a) => {
    if (Number(a.id) === Number(entry.account_id)) return false;
    const money = a.type === 'customer' && (a.billing_mode || 'money') === 'money';
    if (entry.entry_type === 'invoice_consumption') return a.type === 'customer' && a.billing_mode === 'invoice';
    if (entry.entry_type === 'payment') return money || a.type === 'employee';
    return money;
  }), [accounts, entry]);
  const fuelPumps = pumps.filter((p) => !entry.fuel_type || p.fuel_type === entry.fuel_type);

  // Any change withdraws the preview: what is approved must be what is shown.
  const change = (apply: () => void) => {
    apply();
    setPreview(null);
    setError('');
  };

  function body(): Record<string, unknown> {
    const request: Record<string, unknown> = {
      entry_type: entry.entry_type,
      entry_id: entry.entry_id,
      kind,
      note: note.trim() || undefined,
    };
    if (kind === 'wrong_customer') request.account_id = Number(accountId);
    if (kind === 'wrong_amount') {
      if (entry.entry_type === 'invoice_consumption') {
        request.litres = Number(litres || entry.litres);
        if (pumpId) request.pump_id = Number(pumpId);
      } else {
        request.amount = Number(amount);
      }
    }
    return request;
  }

  const complete = kind !== ''
    && (kind !== 'wrong_customer' || accountId !== '')
    && (kind !== 'wrong_amount' || (entry.entry_type === 'invoice_consumption'
      ? Number(litres || entry.litres) > 0
      : Number(amount) > 0));

  async function runPreview() {
    setBusy(true);
    setError('');
    try {
      const response = await api.preview(shiftId, body());
      setPreview(response.data.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'The correction could not be previewed.');
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm('shift_correction', { confirmation_token: preview.confirmation_token });
      const response = await api.post(shiftId, {
        ...body(),
        confirmation_token: preview.confirmation_token,
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
      onDone(response.data.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'The correction could not be posted.');
      if (e?.response?.data?.code === 'CORRECTION_STALE') setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const attendant = preview?.attendant;
  const shortageMoved = attendant && (attendant.debt_added || attendant.debt_reduced || attendant.refund_owed || attendant.not_refunded);

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-gray-500">
          {WHAT[entry.entry_type].charAt(0).toUpperCase() + WHAT[entry.entry_type].slice(1)} for {entry.account_name}
        </p>
        <p className="font-semibold text-gray-900">
          {entry.entry_type === 'invoice_consumption'
            ? `${Number(entry.litres || 0).toFixed(2)} L ${entry.fuel_type || ''}`
            : `${kes(entry.amount)}${entry.payment_method ? ` · ${entry.payment_method}` : ''}`}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium text-gray-700 mb-1">What was wrong?</legend>
        {(Object.keys(KIND_LABELS[entry.entry_type]) as Kind[]).map((value) => (
          <label key={value} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="correction-kind"
              className="mt-1"
              checked={kind === value}
              onChange={() => change(() => setKind(value))}
            />
            <span>{KIND_LABELS[entry.entry_type][value]}</span>
          </label>
        ))}
      </fieldset>

      {kind === 'wrong_customer' && (
        <label className="block">
          <span className="text-gray-700">It should have been</span>
          <select className={inputClassName} value={accountId} onChange={(e) => change(() => setAccountId(e.target.value))}>
            <option value="">Select…</option>
            {targets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.type === 'employee' ? ' (employee debt)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {kind === 'wrong_amount' && entry.entry_type !== 'invoice_consumption' && (
        <label className="block">
          <span className="text-gray-700">The right amount (KES)</span>
          <input
            className={inputClassName}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => change(() => setAmount(e.target.value))}
          />
        </label>
      )}

      {kind === 'wrong_amount' && entry.entry_type === 'invoice_consumption' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-gray-700">The right litres</span>
            <input
              className={inputClassName}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder={String(entry.litres ?? '')}
              value={litres}
              onChange={(e) => change(() => setLitres(e.target.value))}
            />
          </label>
          {fuelPumps.length > 1 && (
            <label className="block">
              <span className="text-gray-700">Pump</span>
              <select className={inputClassName} value={pumpId} onChange={(e) => change(() => setPumpId(e.target.value))}>
                <option value="">Keep as recorded</option>
                {fuelPumps.map((p) => (
                  <option key={p.pump_id} value={p.pump_id}>
                    {p.pump_label} {p.nozzle_label || ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {kind !== '' && (
        <label className="block">
          <span className="text-gray-700">Note (optional)</span>
          <input
            className={inputClassName}
            maxLength={500}
            placeholder="For example: customer showed the receipt"
            value={note}
            onChange={(e) => change(() => setNote(e.target.value))}
          />
        </label>
      )}

      {preview && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="font-semibold text-blue-900">{preview.summary}</p>
          <ul className="space-y-1 text-blue-900">
            {(preview.accounts || []).map((a: any) => (
              <li key={a.account_id}>
                {owedLabel(a)}: {kes(a.owed_before)} → <strong>{kes(a.owed_after)}</strong>
              </li>
            ))}
            {Number(preview.variance_before) !== Number(preview.variance_after) && (
              <li>
                Shift #{preview.shift?.id}: {describeShiftBalance(preview.variance_before)} → <strong>{describeShiftBalance(preview.variance_after)}</strong>
              </li>
            )}
          </ul>
          <div className="border-t border-blue-200 pt-2 text-blue-900">
            {!shortageMoved && <p>{attendant?.name}'s shortage does not change.</p>}
            {attendant?.debt_added > 0 && (
              <p>{attendant.name} is charged {kes(attendant.debt_added)}: that money should have been in the drawer.</p>
            )}
            {attendant?.debt_reduced > 0 && (
              <p>{attendant.name}'s unpaid shortage is reduced by {kes(attendant.debt_reduced)}.</p>
            )}
            {attendant?.refund_owed > 0 && (
              <p>
                {kes(attendant.refund_owed)} that {attendant.name} already repaid is owed back to them. Settle it from their pay statement.
              </p>
            )}
            {attendant?.not_refunded > 0 && (
              <p>{kes(attendant.not_refunded)} of the shortage was never repaid, so nothing is owed back for it.</p>
            )}
          </div>
          <p className="text-xs text-blue-800">
            Dated {preview.posting_date}. The original entry stays on record, marked corrected.
          </p>
        </div>
      )}

      {preview && <ApproverFields state={approver} inputClassName={inputClassName} />}
      {preview && !approver.enabled && (
        <p className="text-xs text-gray-500">Posting records you as the administrator who approved it.</p>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-100">
          Cancel
        </button>
        {!preview ? (
          <button
            type="button"
            onClick={runPreview}
            disabled={busy || !complete}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Preview'}
          </button>
        ) : (
          <button
            type="button"
            onClick={post}
            disabled={busy || !approver.ready}
            className="px-3 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Posting…' : 'Post correction'}
          </button>
        )}
      </div>
    </div>
  );
}

// The corrections made to one shift, newest first.
export function ShiftCorrectionList({ corrections }: { corrections: any[] }) {
  if (!corrections?.length) return null;
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {corrections.map((c) => {
        const attendant = c.details?.attendant;
        return (
          <li key={c.id} className="py-2">
            <p className="font-medium text-gray-800">{c.reason}</p>
            <p className="text-xs text-gray-500">
              #{c.id} · {c.posting_date || String(c.created_at || '').slice(0, 10)}
              {c.approved_by_name ? ` · approved by ${c.approved_by_name}` : ''}
              {c.recorded_by_name && c.recorded_by_name !== c.approved_by_name ? ` · recorded by ${c.recorded_by_name}` : ''}
            </p>
            {c.note && <p className="text-xs text-gray-600">Note: {c.note}</p>}
            {attendant && (attendant.debt_added > 0 || attendant.debt_reduced > 0 || attendant.refund_owed > 0) && (
              <p className="text-xs text-gray-600">
                {attendant.debt_added > 0 && `${attendant.name} charged ${kes(attendant.debt_added)}. `}
                {attendant.debt_reduced > 0 && `${attendant.name}'s shortage reduced by ${kes(attendant.debt_reduced)}. `}
                {attendant.refund_owed > 0 && `${kes(attendant.refund_owed)} owed back to ${attendant.name}.`}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
