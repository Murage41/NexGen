import { useEffect, useState } from 'react';

// One small message style for both apps: a short "done" after a save that
// matters, a warning, or an error. Shown for a few seconds in a corner; the
// manuals hold explanations, so a message is a few words.
export type NoticeKind = 'success' | 'warning' | 'error';
type Notice = { id: number; kind: NoticeKind; text: string };

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<(list: Notice[]) => void>();
const emit = () => listeners.forEach((listener) => listener(notices));

export function dismissNotice(id: number) {
  notices = notices.filter((notice) => notice.id !== id);
  emit();
}

export function notify(kind: NoticeKind, text: string) {
  if (!text || notices.some((notice) => notice.kind === kind && notice.text === text)) return;
  const notice = { id: nextId++, kind, text };
  notices = [...notices.slice(-2), notice];
  emit();
  setTimeout(() => dismissNotice(notice.id), kind === 'error' ? 8000 : 3500);
}

// Write requests that deserve a "done": the ones that open or close a shift,
// move money or finalise a record. Autosaves (readings, counts) stay quiet;
// their own Saved/Synced marker shows them.
const DONE: Array<[string, RegExp, string]> = [
  ['post', /^\/shifts$/, 'Shift opened'],
  ['put', /^\/shifts\/\d+\/close$/, 'Shift closed'],
  ['post', /^\/shifts\/\d+\/cancel$/, 'Shift cancelled'],
  ['post', /^\/shifts\/\d+\/credit-receipts$/, 'Payment recorded'],
  ['post', /^\/credit-accounts\/\d+\/payments$/, 'Payment recorded'],
  ['post', /^\/credit-accounts\/\d+\/refunds$/, 'Refund recorded'],
  ['post', /^\/customer-invoices\/payments$/, 'Payment recorded'],
  ['post', /^\/supplier-payments$/, 'Payment recorded'],
  ['post', /^\/payroll\/lines\/\d+\/payments$/, 'Payment recorded'],
  ['post', /^\/payroll\/employees\/\d+\/receipts$/, 'Payment recorded'],
  ['post', /\/reverse$/, 'Reversed'],
  ['post', /^\/customer-invoices$/, 'Draft invoice created'],
  ['post', /^\/customer-invoices\/\d+\/issue$/, 'Invoice issued'],
  ['post', /^\/customer-invoices\/\d+\/void$/, 'Invoice voided'],
  ['post', /^\/customer-invoices\/\d+\/adjustments$/, 'Note posted'],
  ['post', /^\/customer-invoices\/debit-notes$/, 'Debit note posted'],
  ['post', /^\/corrections$/, 'Correction saved'],
  ['post', /^\/corrections\/\d+\/undo$/, 'Correction undone'],
  ['post', /^\/balance-moves$/, 'Balance moved'],
  ['post', /^\/expenses$/, 'Expense saved'],
  ['put', /^\/expenses\/\d+$/, 'Expense saved'],
  ['post', /^\/fuel-deliveries$/, 'Delivery recorded'],
  ['put', /^\/fuel-deliveries\/\d+$/, 'Delivery saved'],
  ['post', /^\/tank-dips$/, 'Dip recorded'],
  ['post', /^\/tanks\/\d+\/adjustments$/, 'Stock adjustment posted'],
  ['post', /^\/employees$/, 'Employee added'],
  ['put', /^\/employees\/\d+$/, 'Employee saved'],
  ['post', /^\/employees\/\d+\/compensation-plans$/, 'Pay plan saved'],
  ['post', /^\/payroll\/runs\/calculate$/, 'Payroll calculated'],
  ['post', /^\/payroll\/runs\/\d+\/approve$/, 'Payroll approved'],
  ['post', /^\/payroll\/runs\/\d+\/void$/, 'Payroll voided'],
  ['post', /^\/credit-accounts$/, 'Customer added'],
  ['put', /^\/credit-accounts\/\d+$/, 'Customer saved'],
  ['post', /^\/suppliers$/, 'Supplier added'],
  ['put', /^\/suppliers\/\d+$/, 'Supplier saved'],
  ['post', /^\/supplier-invoices$/, 'Supplier invoice saved'],
  ['post', /^\/fuel-prices$/, 'Price saved'],
  ['put', /^\/fuel-prices\/[a-z_]+$/, 'Price saved'],
  ['put', /^\/operations\/settings$/, 'Settings saved'],
  ['delete', /.*/, 'Deleted'],
];

export function doneMessageFor(method?: string, url?: string): string | null {
  const verb = String(method || 'get').toLowerCase();
  if (verb === 'get') return null;
  const path = String(url || '').split('?')[0].replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  // Readings and counts autosave on open shifts; their own marker shows it.
  if (/^\/shifts\/\d+\/(readings|collections|opening-readings)$/.test(path)) return null;
  if (/^\/(auth|corrections\/preview)/.test(path)) return null;
  const hit = DONE.find(([m, pattern]) => m === verb && pattern.test(path));
  return hit ? hit[2] : null;
}

// Plain words for what went wrong; the server's own message when it gave one.
export function errorText(error: any, fallback = 'That did not work. Try again.'): string {
  if (!error?.response) return 'No connection to NexGen. Check the network and try again.';
  const message = error.response.data?.error || error.response.data?.message;
  if (error.response.status >= 500) return message ? `Server problem: ${message}` : 'Server problem. Try again; if it repeats, restart NexGen on the station PC.';
  return message || fallback;
}

export function Notifications({ placement = 'top' }: { placement?: 'top' | 'bottom' }) {
  const [list, setList] = useState<Notice[]>(notices);
  useEffect(() => {
    listeners.add(setList);
    return () => { listeners.delete(setList); };
  }, []);
  if (list.length === 0) return null;
  const position = placement === 'top' ? 'top-4 right-4' : 'bottom-20 left-3 right-3';
  return (
    <div className={`fixed ${position} z-[100] flex flex-col gap-2 print:hidden`}>
      {list.map((notice) => (
        <div key={notice.id} role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            notice.kind === 'success' ? 'bg-green-700 text-white' : notice.kind === 'warning' ? 'bg-amber-500 text-gray-900' : 'bg-red-700 text-white'}`}>
          <span className="flex-1">{notice.kind === 'success' ? '✓ ' : ''}{notice.text}</span>
          <button type="button" onClick={() => dismissNotice(notice.id)} aria-label="Dismiss" className="opacity-80 hover:opacity-100">×</button>
        </div>
      ))}
    </div>
  );
}
