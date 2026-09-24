import { useState } from 'react';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';

// Credit a normal credit customer holds on account after a closed-shift
// correction left them paid ahead (backend receivablePayments.ts). It pays their
// next credit automatically when that credit's shift closes, or an
// administrator refunds it here. Mobile passes no `approval`: the signed-in
// admin approves as themselves; the desktop names an admin and takes their PIN.

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';

export function CustomerCreditPanel({
  account,
  canRefund,
  approval,
  refund,
  onRefunded,
  inputClassName = field,
}: {
  account: any;
  canRefund: boolean;
  approval?: ApprovalApi;
  refund: (accountId: number, body: Record<string, unknown>) => Promise<any>;
  onRefunded: () => Promise<void> | void;
  inputClassName?: string;
}) {
  const held = Number(account?.credit_on_account || 0);
  const refunds: any[] = account?.refunds || [];
  const approver = useApprover(approval);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(kenyaToday());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (held <= 0 && refunds.length === 0) return null;

  const value = Number(amount || held);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm('customer_refund', { account_id: account.id, method, amount: value });
      await refund(account.id, {
        amount: value,
        method,
        date,
        reference: reference.trim() || undefined,
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
      setOpen(false);
      setAmount('');
      setReference('');
      await onRefunded();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'The refund could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2 text-sm">
      {held > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-green-900">In credit: {kes(held)}</p>
            <p className="text-xs text-green-800">
              Paid ahead. It pays their next credit automatically when that shift closes.
            </p>
          </div>
          {canRefund && !open && (
            <button type="button" onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg border border-green-700 text-green-800 font-medium">
              Refund
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t border-green-200 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-gray-700">Amount (up to {kes(held)})</span>
              <input
                className={inputClassName}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder={held.toFixed(2)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-gray-700">Paid back by</span>
              <select className={inputClassName} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
              </select>
            </label>
            <label className="block">
              <span className="text-gray-700">Date paid</span>
              <input className={inputClassName} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-gray-700">Reference (optional)</span>
              <input className={inputClassName} maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </div>
          <ApproverFields state={approver} inputClassName={inputClassName} />
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !approver.ready || !(value > 0) || value > held}
              className="px-3 py-2 rounded-lg bg-green-700 text-white font-medium disabled:opacity-50"
            >
              {busy ? 'Saving…' : `Refund ${kes(value > 0 ? value : held)}`}
            </button>
          </div>
        </div>
      )}

      {refunds.length > 0 && (
        <div className="border-t border-green-200 pt-2">
          <p className="text-xs font-semibold text-green-900 mb-1">Refunds</p>
          {refunds.map((r) => (
            <p key={r.id} className="text-xs text-gray-700">
              {r.refund_date} · {kes(r.amount)} · {r.method === 'mpesa' ? 'M-Pesa' : 'cash'}
              {r.reference ? ` · ${r.reference}` : ''}
              {r.approved_by_name ? ` · approved by ${r.approved_by_name}` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
