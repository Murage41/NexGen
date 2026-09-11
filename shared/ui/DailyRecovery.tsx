import { useEffect, useState } from 'react';
import { RecoveryEditor } from './PayrollStatement';

export function DailyRecovery({
  shiftId,
  wage,
  previewRequest,
  onDecision,
  onReady,
  revision,
}: any) {
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<any>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError('');
    setDecision(null);
    onDecision(null);
    onReady(false);
    const timer = setTimeout(
      () =>
        previewRequest(shiftId, Number(wage || 0))
          .then((r: any) => {
            if (live) {
              const data = r.data.data;
              setPreview(data);
              onReady(data.recoverable <= 0);
            }
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
  }, [shiftId, wage, revision, refresh, previewRequest, onDecision, onReady]);
  if (error)
    return (
      <div role="alert" className="text-red-700 p-3">
        <p>{error}</p>
        <button type="button" className="underline mt-2" onClick={() => setRefresh(value => value + 1)}>Refresh recovery</button>
      </div>
    );
  if (!preview)
    return <p className="text-sm p-3">Checking compensation and debt…</p>;
  return (
    <RecoveryEditor
      key={`${preview.version}:${refresh}`}
      preview={preview}
      saved={decision}
      label="Confirm recovery for this close"
      savedMessage="Recovery confirmed. It will be recorded when this shift closes."
      onSave={async (value: any) => {
        setDecision(value);
        onDecision(value);
        onReady(true);
      }}
      onDirty={() => {
        setDecision(null);
        onDecision(null);
        onReady(preview.recoverable <= 0);
      }}
    />
  );
}
