import { useState } from 'react';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';

// Credit and debit notes for invoice customers (backend
// services/invoiceAdjustments.ts). Every note is fuel, litres and a price per
// litre: what was wrong is the litres (priced at the invoice's own price) or
// the price (the same litres at the difference). A credit note beyond what the
// invoice still owes becomes the customer's credit for their next invoice. A
// debit note is a bill of its own, for an invoice or for a shift. Notes are
// dated today and approved by an administrator (desktop: name and PIN; phone:
// the signed-in admin).

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 text-sm';
const errorText = (e: any, fallback: string) => e?.response?.data?.error || e?.message || fallback;

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
  // The invoice it corrects; without one, a debit note for a shift.
  invoice?: { id: number; account_id: number; invoice_number: string; lines: any[] } | null;
  accountId?: number;
  approval?: ApprovalApi;
  post: (body: Record<string, unknown>) => Promise<any>;
  onDone: () => Promise<void> | void;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const approver = useApprover(approval);
  const lines = invoice?.lines || [];
  const [fuel, setFuel] = useState(lines[0]?.fuel_type || 'diesel');
  const [correction, setCorrection] = useState<'litres' | 'price'>('litres');
  const [litres, setLitres] = useState('');
  const [price, setPrice] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const line = lines.find((l: any) => l.fuel_type === fuel);
  const byLitres = correction === 'litres' && Boolean(invoice);
  const unitPrice = byLitres ? Number(line?.agreed_price || 0) : Number(price);
  const amount = Math.round(Number(litres) * unitPrice * 100) / 100;
  const credit = noteType === 'credit_note';
  const ready = Number(litres) > 0 && unitPrice > 0 && reason.trim().length >= 10
    && (Boolean(invoice) || Number(shiftId) > 0) && approver.ready;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const fields = {
        account_id: invoice?.account_id ?? accountId,
        invoice_id: invoice?.id ?? 0,
        note_type: noteType,
        correction: invoice ? correction : 'litres',
        fuel_type: fuel,
        litres: Number(litres),
        unit_price: byLitres ? 0 : unitPrice,
      };
      const approved = await approver.confirm('invoice_note', fields);
      await post({
        ...(invoice ? {} : { account_id: accountId }),
        note_type: noteType,
        correction: fields.correction,
        fuel_type: fuel,
        litres: Number(litres),
        ...(byLitres ? {} : { unit_price: unitPrice }),
        shift_id: shiftId ? Number(shiftId) : undefined,
        reason: reason.trim(),
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
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
          ? 'The customer owes less. What the invoice still owes is reduced; anything beyond that is their credit, which pays their next invoice. It is never paid out.'
          : invoice
            ? 'The customer owes more. The debit note is a bill of its own, referring to this invoice, due and payable like an invoice.'
            : 'Fuel taken on a shift that was recorded on someone else, or missed. The debit note is a bill of its own, due and payable like an invoice.'}
        {' '}Dated today. No change to tank stock.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="text-xs text-gray-600">Fuel</span>
          <select className={inputClassName} value={fuel} onChange={(e) => setFuel(e.target.value)}>
            {invoice
              ? lines.map((l: any) => (
                <option key={l.id} value={l.fuel_type}>
                  {l.fuel_type} ({Number(l.total_litres).toFixed(2)} L at {kes(l.agreed_price)})
                </option>
              ))
              : ['petrol', 'diesel'].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        {invoice && (
          <label className="block"><span className="text-xs text-gray-600">What was wrong</span>
            <select className={inputClassName} value={correction} onChange={(e) => setCorrection(e.target.value as 'litres' | 'price')}>
              <option value="litres">The litres</option>
              <option value="price">The price per litre</option>
            </select>
          </label>
        )}
        <label className="block"><span className="text-xs text-gray-600">{correction === 'price' && invoice ? 'Litres the price was wrong on' : credit ? 'Litres not taken' : 'Litres taken'}</span>
          <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" value={litres} onChange={(e) => setLitres(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">{byLitres ? 'Price per litre (the invoice\'s)' : invoice ? 'Price difference per litre' : 'Price per litre'}</span>
          {byLitres
            ? <input className={`${inputClassName} bg-gray-50`} value={line ? Number(line.agreed_price).toFixed(2) : ''} readOnly />
            : <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </label>
        <label className="block"><span className="text-xs text-gray-600">Shift number{invoice ? ' (optional)' : ''}</span>
          <input className={inputClassName} type="number" inputMode="numeric" min="1" value={shiftId} onChange={(e) => setShiftId(e.target.value)} />
        </label>
        <div className="block">
          <span className="text-xs text-gray-600">Amount</span>
          <p className="py-2 font-semibold">{amount > 0 ? kes(amount) : '—'}</p>
        </div>
      </div>
      <label className="block"><span className="text-xs text-gray-600">Reason (at least 10 characters)</span>
        <textarea className={inputClassName} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !ready}
          className={`px-3 py-2 rounded-lg text-white font-medium disabled:opacity-50 ${credit ? 'bg-red-600' : 'bg-green-700'}`}>
          {busy ? 'Posting…' : `Post ${credit ? 'credit' : 'debit'} note ${amount > 0 ? kes(amount) : ''}`}
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
