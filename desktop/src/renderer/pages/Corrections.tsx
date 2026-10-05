import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, X } from 'lucide-react';
import { correctionApi, desktopApproval, getCorrection, getCorrections } from '../services/api';
import { CorrectionUndo, correctionTitle, lineText } from '../../../../shared/ui/Corrections';

// The Corrections register (docs/CORRECTIONS.md): every correction made to a
// closed record, newest first, with what it did and who approved it. A
// correction made in error is undone here by a new correction that cancels it.

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const stageText = (stage: string | null) =>
  stage === 'invoiced' ? 'on an issued invoice' : stage === 'draft' ? 'in a draft invoice' : stage === 'unbilled' ? 'not yet invoiced'
    : stage === 'paid' ? 'paid' : stage === 'partial' ? 'partly paid' : stage === 'outstanding' ? 'unpaid' : '';

export default function Corrections() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [undoing, setUndoing] = useState(false);

  async function load() {
    try {
      setError('');
      setRows((await getCorrections({ from: from || undefined, to: to || undefined })).data.data || []);
    } catch (err: any) {
      console.error('[Corrections:load]', err?.response?.data || err?.message);
      setError(err?.response?.data?.error || 'Corrections could not be loaded.');
    }
  }

  async function open(id: number) {
    try {
      setDetail((await getCorrection(id)).data.data);
    } catch (err: any) {
      console.error('[Corrections:open]', err?.response?.data || err?.message);
      setError(err?.response?.data?.error || 'The correction could not be loaded.');
    }
  }

  useEffect(() => { void load(); }, [from, to]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <ClipboardCheck size={24} /> Corrections
        </h1>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Before a shift closes, fix mistakes on the shift. After it closes, correct them: the shift keeps what it closed with,
        and each correction is recorded here with what it changed. Start a correction from the record: a fuel entry in the
        customer's fuel history, or the fuel on account list of a closed shift.
      </p>
      <div className="flex items-end gap-3 mb-4 text-sm">
        <label className="block"><span className="text-xs text-gray-500">From</span>
          <input type="date" className="block border border-gray-300 rounded-lg px-3 py-2" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block"><span className="text-xs text-gray-500">To</span>
          <input type="date" className="block border border-gray-300 rounded-lg px-3 py-2" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Posted</th>
              <th className="px-3 py-2">What was wrong</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Approved by</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No corrections in this period.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} onClick={() => void open(row.id)} className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer">
                <td className="px-3 py-2 font-medium text-blue-700">{row.number}</td>
                <td className="px-3 py-2">{String(row.posting_date).slice(0, 10)}</td>
                <td className="px-3 py-2">{correctionTitle(row.record_type, row.error_kind)}</td>
                <td className="px-3 py-2 text-gray-600">{row.reason_label ? `${row.reason_label}: ` : ''}{row.reason_note}</td>
                <td className="px-3 py-2">{row.approved_by_name}</td>
                <td className="px-3 py-2">{row.kind === 'undo' ? 'Undo' : row.status === 'undone' ? 'Undone' : 'Posted'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/45 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {detail.number}: {correctionTitle(detail.record_type, detail.kind === 'undo' ? 'undo' : detail.error_kind)}
              </h2>
              <button onClick={() => { setDetail(null); setUndoing(false); }} className="p-1 text-gray-400 hover:text-gray-700"><X size={19} /></button>
            </div>
            <p className="text-gray-600">
              Posted {String(detail.posting_date).slice(0, 10)} (happened {String(detail.effective_date).slice(0, 10)}), approved by {detail.approved_by_name}.
              {detail.reason_label ? ` ${detail.reason_label}.` : ''} {detail.reason_note}
            </p>
            {detail.related?.length > 0 && (
              <p className="text-gray-600">
                {detail.kind === 'undo' ? 'Undoes ' : 'Undone by '}
                {detail.related.map((r: any) => (
                  <button key={r.id} onClick={() => void open(r.id)} className="text-blue-700 hover:underline">{r.number}</button>
                ))}.
              </p>
            )}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="font-semibold mb-1">What it did</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {detail.effects.map((effect: string, i: number) => <li key={i}>{effect}</li>)}
              </ul>
            </div>
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-1">Line</th><th>Shift</th><th>Where it was</th><th>Document</th><th className="text-right">Shift result</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line: any) => (
                  <tr key={line.id} className="border-t border-gray-100">
                    <td className="py-1">{lineText(line)}{line.record_type === 'fuel_on_account' ? `, ${kes(line.amount)}` : ''}</td>
                    <td><Link to={`/shifts/${line.shift_id}`} className="text-blue-700 hover:underline">#{line.shift_id}</Link></td>
                    <td>{stageText(line.stage)}{line.invoice_number ? ` ${line.invoice_number}` : ''}</td>
                    <td>{line.document_number || ''}</td>
                    <td className="text-right">{Number(line.shift_effect) >= 0 ? '+' : '−'}{kes(Math.abs(Number(line.shift_effect)))}{line.charge_to && Number(line.shift_effect) !== 0 ? ` (${line.charge_to})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.kind !== 'undo' && detail.status === 'posted' && (
              detail.undo_blocked_by ? (
                <p className="text-xs text-gray-500">Can't be undone: {detail.undo_blocked_by}</p>
              ) : undoing ? (
                <CorrectionUndo
                  correction={detail}
                  api={correctionApi}
                  approval={desktopApproval}
                  onDone={async (undo) => { setUndoing(false); await load(); await open(undo.id); }}
                  onCancel={() => setUndoing(false)}
                />
              ) : (
                <div className="flex justify-end">
                  <button onClick={() => setUndoing(true)} className="px-3 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50">
                    Undo this correction
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
