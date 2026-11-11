// A shift's History (desktop and phone): one short line per thing that
// happened, latest first, with who did it. Edits arrive grouped from the server
// (backend/src/services/shiftEdits.ts): a sitting of automatic saves is one line.

const DOT: Record<string, string> = {
  add: 'bg-blue-600',
  change: 'bg-amber-500',
  remove: 'bg-red-600',
  event: 'bg-gray-800',
};

const kes = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

function amountText(event: any) {
  if (event.amount === undefined || event.amount === null) return '';
  const value = Number(event.amount);
  if (event.type === 'shift_closed') return value < 0 ? `short ${kes(-value)}` : value > 0 ? `over ${kes(value)}` : 'balanced';
  return `${kes(value)}${event.litres !== undefined ? ` · ${Number(event.litres).toLocaleString('en-KE')} L` : ''}`;
}

export function ShiftHistoryList({ events, compact = false }: { events: any[]; compact?: boolean }) {
  if (!events?.length) return <p className="text-sm text-gray-400 p-4">Nothing yet.</p>;
  let lastDay = '';
  return (
    <ol className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {events.map((event) => {
        const at = new Date(event.occurred_at);
        const day = at.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
        const showDay = day !== lastDay;
        lastDay = day;
        const time = event.precision === 'date' ? '' : at.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
        const amount = amountText(event);
        return (
          <li key={event.id}>
            {showDay && <p className="px-4 py-1.5 bg-gray-50 text-xs font-bold uppercase tracking-wide text-gray-500 border-t border-gray-100 first:border-t-0">{day}</p>}
            <div className={`grid ${compact ? 'grid-cols-[2.75rem_0.75rem_1fr]' : 'grid-cols-[3.5rem_0.75rem_1fr_auto]'} gap-x-2.5 px-4 py-2.5 border-t border-gray-100 text-sm`}>
              <span className="text-gray-500 tabular-nums">{time}</span>
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${DOT[event.tone] || 'bg-gray-400'}`} />
              <div className="min-w-0">
                <p>
                  <span className="font-semibold text-gray-800">{event.title}</span>
                  {event.description && <span className="text-gray-600"> · {event.description}</span>}
                  {amount && <span className={`tabular-nums ${event.tone === 'remove' ? 'text-red-700 line-through' : 'text-gray-700'}`}> · {amount}</span>}
                </p>
                {(event.lines || []).map((line: string) => (
                  <p key={line} className="text-xs text-gray-600 tabular-nums">{line}</p>
                ))}
                {compact && event.actor && <p className="text-xs text-gray-400">{event.actor}</p>}
              </div>
              {!compact && <span className="text-xs text-gray-500 whitespace-nowrap">{event.actor || ''}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
