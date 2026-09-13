import { useState } from 'react';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';

const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';

// Shown when a credit or fuel-on-account entry would break a customer's limit
// (the server's 409 CREDIT_LIMIT_BREACH). Nothing has been recorded yet.
//
// A signed-in admin approves as themselves, so `approval` is omitted for them.
// The desktop and an attendant's phone pass it: an administrator picks their
// name and enters their PIN. The server re-checks the limits and verifies the
// approval when the entry is resubmitted, so this is only the prompt.
export function isCreditLimitBreach(error: any) {
  return error?.response?.data?.code === 'CREDIT_LIMIT_BREACH' && error?.response?.data?.details;
}

export function CreditLimitPrompt({
  breach,
  approval,
  purpose,
  subject,
  onApprove,
  onCancel,
  inputClassName = field,
  actionLabel = 'Approve and record',
}: {
  breach: any;
  approval?: ApprovalApi;
  purpose: 'credit_override' | 'consumption_override';
  subject: Record<string, unknown>;
  onApprove: (fields: { limit_override: true; approval_token?: string }) => Promise<void>;
  onCancel: () => void;
  inputClassName?: string;
  actionLabel?: string;
}) {
  const approver = useApprover(approval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function approve() {
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm(purpose, subject);
      await onApprove({
        limit_override: true,
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'The approval could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3 text-sm">
      <div>
        <p className="font-semibold text-amber-900">Admin approval needed for {breach?.account?.name}</p>
        <ul className="list-disc pl-5 mt-1 space-y-0.5 text-amber-900">
          {(breach?.breaches || []).map((item: any) => (
            <li key={item.rule}>{item.message}</li>
          ))}
        </ul>
      </div>
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {!approver.enabled && (
        <p className="text-xs text-amber-800">Approving records you as the administrator who allowed this.</p>
      )}
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700 hover:bg-amber-100">
          Cancel
        </button>
        <button
          type="button"
          onClick={approve}
          disabled={busy || !approver.ready}
          className="px-3 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Approving…' : actionLabel}
        </button>
      </div>
    </div>
  );
}
