// Closed-shift corrections posted before 23 Sep 2026, when closed shifts
// became unchangeable (backend services/shiftCorrections.ts). Only the history
// is shown; mistakes are fixed with balance moves now (BalanceMove.tsx).

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// What a correction did to the attendant's variances (Employees, Variances).
// Corrections recorded before variances started carry the old debt fields.
function attendantLines(attendant: any): string[] {
  if (!attendant) return [];
  const name = attendant.name;
  if ('owes_before' in attendant) {
    const lines: string[] = [];
    const before = Number(attendant.owes_before || 0);
    const after = Number(attendant.owes_after || 0);
    if (before !== after) {
      lines.push(`${name} owes ${kes(before)} → ${kes(after)}${after > before ? ': that money should have been in the drawer.' : '.'}`);
    }
    const freed = Number(attendant.refundable_after || 0) - Number(attendant.refundable_before || 0);
    if (freed > 0) lines.push(`${kes(freed)} that ${name} already repaid can be paid back to them from their Variances.`);
    const surplus = Number(attendant.surplus_after || 0) - Number(attendant.surplus_before || 0);
    if (surplus !== 0) lines.push(`${name}'s surplus this month changes by ${kes(surplus)}.`);
    return lines;
  }
  return [
    attendant.debt_added > 0 ? `${name} charged ${kes(attendant.debt_added)}.` : '',
    attendant.debt_reduced > 0 ? `${name}'s shortage reduced by ${kes(attendant.debt_reduced)}.` : '',
    attendant.refund_owed > 0 ? `${kes(attendant.refund_owed)} owed back to ${name}.` : '',
  ].filter(Boolean);
}

// A shift's variance in words: below zero the drawer was short.
export function describeShiftBalance(variance: unknown) {
  const value = Math.round(Number(variance || 0) * 100) / 100;
  if (value < 0) return `shortage of ${kes(-value)}`;
  if (value > 0) return `surplus of ${kes(value)}`;
  return 'balanced';
}

export function ShiftCorrectionList({ corrections }: { corrections: any[] }) {
  if (!corrections?.length) return null;
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {corrections.map((c) => {
        const attendant = c.details?.attendant;
        return (
          <li key={c.id} className="py-2">
            <p className="font-medium text-gray-800">{c.reason}</p>
            <p className="text-xs text-gray-500">
              #{c.id} · {c.posting_date || String(c.created_at || '').slice(0, 10)}
              {c.approved_by_name ? ` · approved by ${c.approved_by_name}` : ''}
              {c.recorded_by_name && c.recorded_by_name !== c.approved_by_name ? ` · recorded by ${c.recorded_by_name}` : ''}
            </p>
            {c.note && <p className="text-xs text-gray-600">Note: {c.note}</p>}
            {attendantLines(attendant).length > 0 && (
              <p className="text-xs text-gray-600">{attendantLines(attendant).join(' ')}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
