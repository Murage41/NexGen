import { useState } from 'react';

export function ReasonDialog({ title, children, onConfirm, onCancel }: any) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      onCancel();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Unable to save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 print:hidden">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md bg-white rounded-xl p-5 space-y-4 text-gray-900"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {children}
        <label className="block text-sm">
          Reason
          <textarea
            autoFocus
            className="w-full border rounded-lg p-2 mt-1"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            disabled={busy}
            onClick={onCancel}
            className="border rounded-lg px-3 py-2"
          >
            Cancel
          </button>
          <button
            disabled={busy || reason.trim().length < 3}
            onClick={submit}
            className="bg-blue-700 text-white rounded-lg px-3 py-2 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </section>
    </div>
  );
}
