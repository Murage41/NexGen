import { useState } from 'react';
import { FileDown } from 'lucide-react';

// Opens a saved document (M8: invoice, debit-note bill, credit note) as a PDF
// in a new tab. The tab opens on the tap itself, so phones do not block it, and
// the PDF fills it when it arrives. The server's plain message shows on failure
// (e.g. the station profile is not filled in yet).
export function DocumentButton({
  load,
  label = 'PDF',
  className = 'inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50',
}: {
  load: () => Promise<{ data: BlobPart }>;
  label?: string;
  className?: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function open() {
    setError('');
    setBusy(true);
    const tab = window.open('', '_blank');
    try {
      const response = await load();
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      if (tab) tab.location.href = url;
      else window.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (err: any) {
      tab?.close();
      let message = err?.message || 'Could not open the document.';
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try { message = JSON.parse(await data.text()).error || message; } catch { /* keep the generic message */ }
      }
      console.error('[DocumentButton:open]', message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={open} disabled={busy} className={className} title="Open the PDF">
        <FileDown size={14} /> {busy ? 'Opening...' : label}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}
