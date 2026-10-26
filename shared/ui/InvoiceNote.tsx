import { useRef, useState } from 'react';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';

// New notes adjust money payable. Issued fuel consumption, its original
// document and actual payments stay recorded. Historical litre-based notes
// remain readable and use the same reversal control below.
const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 text-sm';
const errorText = (e: any, fallback: string) => e?.response?.data?.error || e?.message || fallback;
const validAmount = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value)
  && Number(value) > 0 && Number(value) <= 100_000_000;

export function InvoiceNoteForm({
  noteType,
  invoice,
  accountId,
  approval,
  post,
  onDone,
  onCancel,
  inputClassName = field,
}: {
  noteType: 'credit_note' | 'debit_note';
  invoice?: {
    id: number;
    account_id: number;
    invoice_number: string;
    total_amount?: number | string;
    adjustment_notes?: Array<{ note_type: string; status: string; amount: number | string }>;
  } | null;
  accountId?: number;
  approval?: ApprovalApi;
  post: (body: Record<string, unknown>, operationKey: string) => Promise<any>;
  onDone: () => Promise<void> | void;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const approver = useApprover(approval);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const credit = noteType === 'credit_note';
  const faceAmount = Number(invoice?.total_amount);
  const availableCreditCents = credit && Number.isFinite(faceAmount) && Array.isArray(invoice?.adjustment_notes)
    ? Math.max(0, Math.round(faceAmount * 100) + invoice.adjustment_notes
      .filter((note) => note.status === 'posted')
      .reduce((sum, note) => sum + (note.note_type === 'debit_note' ? 1 : note.note_type === 'credit_note' ? -1 : 0)
        * Math.round(Number(note.amount) * 100), 0))
    : null;
  const withinCreditLimit = availableCreditCents === null || Math.round(Number(amount) * 100) <= availableCreditCents;
  const ready = validAmount(amount) && withinCreditLimit && reason.trim().length >= 10
    && Number(invoice?.account_id ?? accountId) > 0 && approver.ready;

  async function submit() {
    if (busy || !ready) return;
    setBusy(true);
    setError('');
    try {
      const fields = {
        account_id: invoice?.account_id ?? accountId,
        invoice_id: invoice?.id ?? 0,
        note_type: noteType,
        correction: 'amount',
        amount: Number(amount),
        reason: reason.trim(),
      };
      const fingerprint = JSON.stringify(fields);
      if (!operation.current || operation.current.fingerprint !== fingerprint) {
        const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        operation.current = { fingerprint, key: `invoice-note:${random}` };
      }
      const operationKey = operation.current.key;
      const approved = await approver.confirm('invoice_note', fields);
      await post({
        ...(invoice ? {} : { account_id: accountId }),
        note_type: noteType,
        correction: 'amount',
        amount: Number(amount),
        reason: reason.trim(),
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      }, operationKey);
      await onDone();
    } catch (e: any) {
      console.error('[InvoiceNote:submit]', e?.response?.data || e?.message);
      setError(errorText(e, 'The note could not be posted.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-gray-800">
      <p className="text-xs text-gray-600">
        {credit
          ? 'Reduce what the customer owes. Any excess remains their credit for other or later invoices. This note does not pay money out.'
          : invoice
            ? 'Add an amount the customer owes. The debit note is a separate bill linked to this invoice, due and payable like an invoice.'
            : 'Add an amount this customer owes as a separate bill. Enter the money owed and explain why.'}
      </p>
      {availableCreditCents !== null && <p className="text-xs text-gray-600">Available to credit {kes(availableCreditCents / 100)}</p>}
      <label className="block"><span className="text-xs text-gray-600">Amount (KES)</span>
        <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0.01" max="100000000" value={amount} disabled={busy} onChange={(e) => { operation.current = null; setAmount(e.target.value); }} />
        {amount !== '' && !validAmount(amount) && <span className="block mt-1 text-xs text-red-700">Enter a positive amount up to 100,000,000 KES, with at most two decimal places.</span>}
        {validAmount(amount) && !withinCreditLimit && <span className="block mt-1 text-xs text-red-700">Enter no more than the available credit amount above.</span>}
      </label>
      <label className="block"><span className="text-xs text-gray-600">Reason (at least 10 characters)</span>
        <textarea className={inputClassName} rows={3} maxLength={500} value={reason} disabled={busy} onChange={(e) => { operation.current = null; setReason(e.target.value); }} />
      </label>
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className="px-3 py-2 rounded-lg text-gray-700 disabled:opacity-50">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !ready}
          className={`px-3 py-2 rounded-lg text-white font-medium disabled:opacity-50 ${credit ? 'bg-red-600' : 'bg-green-700'}`}>
          {busy ? 'Posting…' : `Post ${credit ? 'credit' : 'debit'} note ${validAmount(amount) ? kes(amount) : ''}`}
        </button>
      </div>
    </div>
  );
}

// Reversing a credit note (or an old debit note on an invoice): dated today,
// with a reason and an administrator's approval.
export function InvoiceNoteReverse({
  note,
  approval,
  reverse,
  onDone,
  onCancel,
  inputClassName = field,
}: {
  note: { id: number; note_number: string; amount: number | string };
  approval?: ApprovalApi;
  reverse: (noteId: number, body: Record<string, unknown>) => Promise<any>;
  onDone: () => Promise<void> | void;
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
      const approved = await approver.confirm('invoice_note_reversal', { note_id: note.id });
      await reverse(note.id, { reason: reason.trim(), ...(approved.approval_token ? { approval_token: approved.approval_token } : {}) });
      await onDone();
    } catch (e: any) {
      console.error('[InvoiceNote:reverse]', e?.response?.data || e?.message);
      setError(errorText(e, 'The reversal could not be posted.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 text-sm text-gray-800">
      <p className="text-xs text-gray-600">
        {note.note_number} ({kes(note.amount)}) stays on record, marked reversed, dated today. Any credit it gave other
        invoices comes back off them.
      </p>
      <label className="block"><span className="text-xs text-gray-600">Reason (at least 10 characters)</span>
        <textarea className={inputClassName} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || reason.trim().length < 10 || !approver.ready}
          className="px-3 py-2 rounded-lg bg-red-600 text-white font-medium disabled:opacity-50">
          {busy ? 'Posting…' : 'Reverse note'}
        </button>
      </div>
    </div>
  );
}
