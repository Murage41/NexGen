import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { correctionApi, desktopApproval, getCorrection, getCorrections, getShiftCorrections, getBalanceMoves } from '../services/api';
import { CorrectionUndo, correctionTitle, lineText } from '../../../../shared/ui/Corrections';
import { describeShiftBalance } from '../../../../shared/ui/ShiftCorrection';

// The Corrections register (docs/CORRECTIONS.md): every fix to a closed record,
// newest first: corrections (undone here by a new correction), balance moves,
// and the corrections to closed shifts made before 23 Sep 2026.

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const yearStart = () => `${new Date().getFullYear()}-01-01`;
type Kind = 'all' | 'correction' | 'move' | 'old';
type Row = { key: string; kind: Exclude<Kind, 'all'>; date: string; tag: string; what: string; sub?: string; by: string; status: string; id?: number };
const stageText = (stage: string | null) =>
  stage === 'invoiced' ? 'on an issued invoice' : stage === 'draft' ? 'in a draft invoice' : stage === 'unbilled' ? 'not yet invoiced'
    : stage === 'paid' ? 'paid' : stage === 'partial' ? 'partly paid' : stage === 'outstanding' ? 'unpaid' : '';

export default function Corrections() {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [undoing, setUndoing] = useState(false);

  async function load() {
    try {
      setError('');
      const range = { from: from || undefined, to: to || undefined };
      const [corr, moves, old] = await Promise.all([getCorrections(range), getBalanceMoves(range), getShiftCorrections(range)]);
      const list: Row[] = [
        ...(corr.data.data || []).map((c: any) => ({
          key: `c${c.id}`, kind: 'correction' as const, id: c.id, date: String(c.posting_date).slice(0, 10), tag: c.number,
          what: correctionTitle(c.record_type, c.kind === 'undo' ? 'undo' : c.error_kind),
          sub: `${c.reason_label ? `${c.reason_label}: ` : ''}${c.reason_note || ''}`, by: c.approved_by_name || '',
          status: c.kind === 'undo' ? 'Undo' : c.status === 'undone' ? 'Undone' : 'Posted',
        })),
        ...(moves.data.data || []).map((m: any) => ({
          key: `m${m.id}`, kind: 'move' as const, date: String(m.posting_date).slice(0, 10), tag: `Move #${m.id}`,
          what: `${kes(m.amount)} from ${m.from_name} to ${m.to_name}${m.shift_id ? ` · shift #${m.shift_id}` : ''}`,
          sub: m.reason, by: m.approved_by_name || '', status: 'Posted',
        })),
        ...(old.data.data || []).map((c: any) => ({
          key: `o${c.id}`, kind: 'old' as const, date: String(c.posting_date || c.created_at || '').slice(0, 10), tag: `Old #${c.id}`,
          what: `Shift #${c.shift_id}: ${describeShiftBalance(c.variance_before)} → ${describeShiftBalance(c.variance_after)}`,
          sub: c.reason, by: c.approved_by_name || '', status: 'Posted',
        })),
      ].sort((x, y) => y.date.localeCompare(x.date));
      setRows(list);
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

  const shown = kind === 'all' ? rows : rows.filter((r) => r.kind === kind);
  const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-sm font-semibold border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700'}`;
  const tagTone: Record<Row['kind'], string> = { correction: 'bg-blue-50 text-blue-700', move: 'bg-amber-50 text-amber-800', old: 'bg-gray-100 text-gray-600' };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Corrections</h1>
      <div className="flex items-end gap-2 mb-4 text-sm flex-wrap">
        {([['all', 'All'], ['correction', 'Corrections'], ['move', 'Balance moves'], ['old', 'Before 23 Sep']] as Array<[Kind, string]>).map(([k, label]) => (
          <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>{label}</button>
        ))}
        <span className="flex-1" />
        <label className="block"><span className="text-xs text-gray-500">From</span>
          <input type="date" className="block border border-gray-300 rounded-lg px-3 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block"><span className="text-xs text-gray-500">To</span>
          <input type="date" className="block border border-gray-300 rounded-lg px-3 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">What changed</th>
              <th className="px-3 py-2">Approved by</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Nothing in these dates.</td></tr>
            )}
            {shown.map((row) => (
              <tr key={row.key} onClick={row.id ? () => void open(row.id!) : undefined}
                className={`border-t border-gray-100 align-top ${row.id ? 'hover:bg-blue-50 cursor-pointer' : ''}`}>
                <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                <td className="px-3 py-2 whitespace-nowrap"><span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${tagTone[row.kind]}`}>{row.tag}</span></td>
                <td className="px-3 py-2">{row.what}{row.sub && <p className="text-xs text-gray-500">{row.sub}</p>}</td>
                <td className="px-3 py-2">{row.by || '—'}</td>
                <td className="px-3 py-2">{row.status}</td>
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
