import { useState } from 'react';

// The transaction code on a payment (update #28): required for M-Pesa, bank
// and cheque, stored in capitals; cash has none. AddCode puts the missing code
// on an older payment, once (POST /payment-codes).
export const codeLabel = (method: unknown): string | null => {
  const m = String(method || '');
  if (m === 'mpesa') return 'M-Pesa code';
  if (m === 'bank' || m === 'bank_transfer') return 'Bank reference';
  if (m === 'cheque') return 'Cheque number';
  return null;
};

export function PaymentCodeField({
  method,
  value,
  onChange,
  className = 'w-full rounded-lg border border-gray-300 p-3 text-sm uppercase tracking-wide',
}: {
  method: unknown;
  value: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  const label = codeLabel(method);
  if (!label) return null;
  return (
    <input value={value} onChange={(e) => onChange(e.target.value.toUpperCase().replace(/\s+/g, ''))}
      placeholder={method === 'mpesa' ? 'M-Pesa code, like SKL4ABCD12' : label}
      maxLength={method === 'mpesa' ? 10 : 60} autoCapitalize="characters" className={className} aria-label={label} />
  );
}

// A code is needed and present (M-Pesa codes are 10 letters and digits).
export const codeReady = (method: unknown, code: string) =>
  !codeLabel(method) || (method === 'mpesa' ? /^[A-Z0-9]{10}$/.test(code) : code.trim().length > 0);

export function AddCode({
  method,
  save,
  onSaved,
}: {
  method: unknown;
  save: (code: string) => Promise<unknown>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!codeLabel(method)) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        Add code
      </button>
    );
  }
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await save(code);
      setOpen(false);
      setCode('');
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not save the code.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <PaymentCodeField method={method} value={code} onChange={setCode}
          className="w-36 rounded border border-gray-300 px-2 py-1 text-xs uppercase tracking-wide" />
        <button type="button" onClick={submit} disabled={busy || !codeReady(method, code)}
          className="rounded bg-teal-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">Save</button>
        <button type="button" onClick={() => { setOpen(false); setCode(''); setError(''); }} className="px-1 text-xs text-gray-500">Cancel</button>
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
