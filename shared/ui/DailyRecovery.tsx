import { useEffect, useState } from 'react';
import { RecoveryEditor } from './PayrollStatement';

export function DailyRecovery({
  shiftId,
  wage,
  previewRequest,
  onDecision,
}: any) {
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<any>(null);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError('');
    setDecision(null);
    onDecision(null);
    const timer = setTimeout(
      () =>
        previewRequest(shiftId, Number(wage || 0))
          .then((r: any) => {
            if (live) setPreview(r.data.data);
          })
          .catch((e: any) => {
            if (live)
              setError(
                e.response?.data?.error || 'Recovery preview unavailable.',
              );
          }),
      250,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [shiftId, wage]);
  if (error)
    return (
      <p role="alert" className="text-red-700 p-3">
        {error}
      </p>
    );
  if (!preview)
    return <p className="text-sm p-3">Checking compensation and debt…</p>;
  if (preview.pay_schedule !== 'daily')
    return (
      <p className="text-sm p-3">
        Shortages remain on the employee account for recovery at payroll
        approval.
      </p>
    );
  return (
    <RecoveryEditor
      key={preview.version}
      preview={preview}
      saved={decision}
      label="Confirm recovery for this close"
      savedMessage="Recovery confirmed. It will be recorded when this shift closes."
      onSave={async (value: any) => {
        setDecision(value);
        onDecision(value);
      }}
    />
  );
}
