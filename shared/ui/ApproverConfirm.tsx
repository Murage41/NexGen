import { useEffect, useState } from 'react';

// Who approves a decision, on platforms where the session doesn't already say.
//
// Mobile passes no `approval`: the signed-in admin is the approver and the
// server records them, so nothing renders and confirm() adds nothing.
// The desktop terminal has no signed-in person, so it passes its approver list
// and PIN check. The server accepts the resulting token only for exactly the
// decision it was issued for (backend services/approval.ts), so this is not a
// client-side gate.
//
// `approval` must be a stable reference (a module-level constant), or the
// approver list reloads on every render.
export type ApprovalApi = {
  listApprovers: () => Promise<any>;
  verifyPin: (body: Record<string, unknown>) => Promise<any>;
};

export type ApprovalPurpose = 'recovery' | 'deduction';

export function useApprover(approval?: ApprovalApi) {
  const [approvers, setApprovers] = useState<{ id: number; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [approverId, setApproverId] = useState('');
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (!approval) return;
    let live = true;
    approval
      .listApprovers()
      .then((r: any) => {
        if (!live) return;
        const list = r.data?.data || [];
        setApprovers(list);
        if (list.length === 1) setApproverId(String(list[0].id));
        setLoaded(true);
      })
      .catch((e: any) => {
        if (live) setLoadError(e.response?.data?.error || 'Approvers could not be loaded.');
      });
    return () => {
      live = false;
    };
  }, [approval]);

  const enabled = Boolean(approval);
  const ready = !enabled || (approverId !== '' && /^\d{4}$/.test(pin));

  // Checks the PIN for this exact decision and returns what the operation needs.
  // The PIN is cleared whether or not it was right; it is never kept or re-sent.
  async function confirm(
    purpose: ApprovalPurpose,
    subject: Record<string, unknown>,
  ): Promise<{ approval_token?: string; name?: string }> {
    if (!approval) return {};
    try {
      const r = await approval.verifyPin({
        ...subject,
        purpose,
        employee_id: Number(approverId),
        pin,
      });
      return {
        approval_token: r.data.data.approval_token,
        name: r.data.data.approver.name,
      };
    } finally {
      setPin('');
    }
  }

  return {
    enabled,
    approvers,
    loaded,
    loadError,
    approverId,
    setApproverId,
    pin,
    setPin,
    ready,
    confirm,
  };
}

export function ApproverFields({
  state,
  inputClassName,
  labelClassName,
  onApproverChange,
}: {
  state: ReturnType<typeof useApprover>;
  inputClassName: string;
  labelClassName?: string;
  onApproverChange?: () => void;
}) {
  if (!state.enabled) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block text-sm">
        <span className={labelClassName}>Approved by</span>
        <select
          className={inputClassName}
          value={state.approverId}
          onChange={(e) => {
            state.setApproverId(e.target.value);
            onApproverChange?.();
          }}
        >
          <option value="">Select administrator</option>
          {state.approvers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className={labelClassName}>Their PIN</span>
        <input
          className={inputClassName}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={state.pin}
          onChange={(e) => state.setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
      </label>
      {state.loadError ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {state.loadError}
        </p>
      ) : (
        state.loaded &&
        state.approvers.length === 0 && (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2">
            There is no active administrator to approve this. Add one under Employees.
          </p>
        )
      )}
    </div>
  );
}
