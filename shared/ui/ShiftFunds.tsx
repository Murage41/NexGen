import type { RecordType } from './Corrections';

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';

export const validOpeningAmount = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

export function fundsSummaryRows(data: any): Array<{ label: string; amount: number }> {
  return [
    ['Opening cash captured', data.opening_cash_amount], ['Opening M-Pesa captured', data.opening_mpesa_amount],
    ['Counted cash remaining', data.closing_cash], ['Counted M-Pesa balance', data.closing_mpesa],
    ['Money added', data.funds_added_total], ['Money removed', data.funds_removed_total],
    ['Expected closing funds', data.expected_closing], ['Expected receipts', data.expected_receipts],
    ['Taken in (from the counts)', data.inferred_collections],
  ].map(([label, amount]) => ({ label: String(label), amount: Number(amount || 0) }));
}

export function FundsCollectionSummary({ data, formatMoney }: { data: any; formatMoney: (amount: number) => string }) {
  return (
    <div className="space-y-1 text-sm py-2">
      <dl className="space-y-1">
        {fundsSummaryRows(data).filter((row) => row.amount !== 0 || !['Money added', 'Money removed'].includes(row.label)).map((row) => (
          <div key={row.label} className="flex justify-between gap-3">
            <dt className="text-gray-500">{row.label}</dt>
            <dd className="font-medium text-right shrink-0">{formatMoney(row.amount)}</dd>
          </div>
        ))}
      </dl>
      {Number(data.uncounted_balance_shifts || 0) > 0 && (
        <p className="text-xs text-amber-700">Some shifts have no closing count yet.</p>
      )}
    </div>
  );
}

export function FundsCloseReview({ opening, added, removed, payouts, expectedClosing, countedClosing, formatMoney }: {
  opening: number; added: number; removed: number; payouts: number; expectedClosing: number; countedClosing: number; formatMoney: (amount: number) => string;
}) {
  const rows: Array<[string, number]> = [
    ['Opening funds', opening], ['Money added', added], ['Money removed', removed],
    ['Business payments, including actual wage paid', payouts],
    ['Expected closing funds', expectedClosing], ['Counted closing funds', countedClosing],
    ['Over / short', Math.round((countedClosing - expectedClosing) * 100) / 100],
  ];
  return (
    <dl className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
      {rows.filter(([label, amount]) => amount !== 0 || (label !== 'Money added' && label !== 'Money removed')).map(([label, amount]) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-gray-500">{label}</dt>
          <dd className="font-semibold text-right shrink-0">{formatMoney(amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

// Today's date in Kenya (the station's day), as YYYY-MM-DD.
export function stationToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Opening form: the shift's day (today unless a missed shift is entered on its
// real day; the server refuses future days and days before the last close)
// and the opening funds, which start at 0.
export function OpeningFundsFields({ cash, mpesa, date, onCash, onMpesa, onDate }: {
  cash: string; mpesa: string; date: string;
  onCash: (value: string) => void; onMpesa: (value: string) => void; onDate: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-3 mb-4 text-sm">
      <label className="block font-medium text-gray-700">Date
        <input className={input} type="date" required max={stationToday()} value={date} onChange={(e) => onDate(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block font-medium text-gray-700">Opening cash
          <input className={input} type="number" min="0" step="0.01" inputMode="decimal" required value={cash} onFocus={(e) => e.target.select()} onChange={(e) => onCash(e.target.value)} />
        </label>
        <label className="block font-medium text-gray-700">Opening M-Pesa
          <input className={input} type="number" min="0" step="0.01" inputMode="decimal" required value={mpesa} onFocus={(e) => e.target.select()} onChange={(e) => onMpesa(e.target.value)} />
        </label>
      </div>
    </fieldset>
  );
}

export function ShiftFunds({ shift, formatMoney, canManage = false, onCorrect, reconciliation }: {
  shift: any; formatMoney: (amount: number) => string; canManage?: boolean;
  onCorrect?: (recordType: RecordType, target?: any) => void;
  reconciliation?: { expectedClosing: number; inferredCollections?: number; expectedReceipts: number; payouts: number };
}) {
  if (shift.reconciliation_basis !== 'balances_v1') return <p className="text-xs text-gray-500 mb-3">Opening funds were not captured for this shift. Its original collection method still applies.</p>;
  const cash = Number(shift.opening_funds?.cash_amount ?? shift.opening_cash_amount ?? 0);
  const mpesa = Number(shift.opening_funds?.mpesa_amount ?? shift.opening_mpesa_amount ?? 0);
  const movements: any[] = shift.funds_movements || [];
  const active = movements.filter((row) => !row.deleted_at);
  const added = active.filter((row) => row.direction === 'added').reduce((sum, row) => sum + Number(row.amount), 0);
  const removed = active.filter((row) => row.direction === 'removed').reduce((sum, row) => sum + Number(row.amount), 0);
  return <section className="bg-white rounded-lg border border-gray-200 p-4 mb-4 text-sm space-y-3">
    <h2 className="font-semibold text-gray-800">Opening funds</h2>
    <dl className="space-y-1">
      {(['cash', 'mpesa'] as const).map((method) => <div key={method} className="flex items-center justify-between gap-2"><dt className="text-gray-500">{method === 'cash' ? 'Opening cash float' : 'Opening M-Pesa balance'}</dt><dd className="flex items-center gap-2">{formatMoney(method === 'cash' ? cash : mpesa)}{canManage && <button type="button" className="text-xs text-blue-700 underline" onClick={() => onCorrect?.('opening_funds', { payment_method: method, amount: method === 'cash' ? cash : mpesa, shift_id: shift.id })}>Correct</button>}</dd></div>)}
      <div className="flex justify-between font-medium"><dt>Opening total</dt><dd>{formatMoney(cash + mpesa)}</dd></div>
      {added > 0 && <div className="flex justify-between"><dt className="text-gray-500">Money added</dt><dd>{formatMoney(added)}</dd></div>}
      {removed > 0 && <div className="flex justify-between"><dt className="text-gray-500">Money removed</dt><dd>{formatMoney(removed)}</dd></div>}
    </dl>
    {shift.opening_note && <p className="text-xs text-gray-500">Opening note: {shift.opening_note}</p>}
    {reconciliation && <dl className="border-t pt-2 space-y-1">
      <div className="flex justify-between gap-3"><dt className="text-gray-500">Business payments from shift funds</dt><dd>{formatMoney(reconciliation.payouts)}</dd></div>
      <div className="flex justify-between gap-3 font-medium"><dt>Expected closing funds</dt><dd>{formatMoney(reconciliation.expectedClosing)}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-gray-500">Expected receipts</dt><dd>{formatMoney(reconciliation.expectedReceipts)}</dd></div>
      {reconciliation.inferredCollections !== undefined && <div className="flex justify-between gap-3"><dt className="text-gray-500">Taken in (from the counts)</dt><dd>{formatMoney(reconciliation.inferredCollections)}</dd></div>}
    </dl>}
    {canManage && <button type="button" className="text-sm rounded-lg border border-gray-300 px-3 py-2 text-gray-700" onClick={() => onCorrect?.('shift_funds')}>Money added / removed</button>}
    {movements.length > 0 && <details><summary className="text-xs text-blue-700 cursor-pointer">Money movement history ({movements.length})</summary><ul className="mt-2 space-y-2 text-xs">
      {movements.map((row) => <li key={row.id} className="border-t pt-2"><div className="flex justify-between gap-2"><span>{row.direction === 'removed' ? 'Removed' : 'Added'} · {row.method === 'mpesa' ? 'M-Pesa' : 'Cash'} · {formatMoney(Number(row.amount))}</span><span>{row.deleted_at ? 'Reversed' : 'Active'}</span></div><p className="text-gray-500">{row.source === 'station_bank_safe' ? 'Station bank / safe' : row.source === 'owner' ? 'Owner' : 'Other'} · {row.reference} · {String(row.created_at || '').slice(0, 16).replace('T', ' ')}</p><p className="text-gray-500 break-words">{row.description || row.reason}</p>{canManage && !row.deleted_at && <button type="button" className="text-blue-700 underline mt-1" onClick={() => onCorrect?.('shift_funds', row)}>Reverse movement</button>}</li>)}
    </ul></details>}
  </section>;
}
