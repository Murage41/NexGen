import { useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

// One light customer list for the shift screens (update #28): tap the field and
// a sheet slides up (phone) or opens in the middle (desktop) with every
// customer, A to Z or biggest balance first, and a search box that only brings
// up the keyboard when tapped. Replaces the phone's own dark list.
export type PickerCustomer = { id: number; name: string; owes?: number; tag?: string | null };

const money = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

export function CustomerField({
  value,
  placeholder = 'Choose customer',
  onOpen,
}: {
  value: PickerCustomer | null;
  placeholder?: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white p-3 text-left text-sm">
      {value ? (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-gray-800">{value.name}</span>
          {value.tag && <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">{value.tag}</span>}
          {Number(value.owes || 0) > 0 && <span className="shrink-0 text-xs text-red-600">{money(Number(value.owes))}</span>}
        </span>
      ) : (
        <span className="text-gray-400">{placeholder}</span>
      )}
      <ChevronDown size={16} className="shrink-0 text-gray-400" />
    </button>
  );
}

export function CustomerPicker({
  open,
  title = 'Choose customer',
  customers,
  order = 'name',
  emptyText = 'No customers yet. An administrator adds them in Customers.',
  onPick,
  onClose,
}: {
  open: boolean;
  title?: string;
  customers: PickerCustomer[];
  order?: 'name' | 'owes';
  emptyText?: string;
  onPick: (customer: PickerCustomer) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => (order === 'owes' ? Number(b.owes || 0) - Number(a.owes || 0) : 0) || a.name.localeCompare(b.name));
  }, [customers, search, order]);
  if (!open) return null;
  const close = () => { setSearch(''); onClose(); };

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/30 sm:items-center" onClick={close}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 sm:hidden" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">{title}</h3>
          <button type="button" onClick={close} className="p-1 text-gray-400" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="relative mb-2">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name"
            className="w-full rounded-lg border border-gray-300 p-2.5 pl-9 text-sm" />
        </div>
        <div className="-mx-1 overflow-y-auto">
          {list.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-gray-400">{search ? 'No customer by that name.' : emptyText}</p>
          ) : list.map((c) => (
            <button key={c.id} type="button" onClick={() => { setSearch(''); onPick(c); }}
              className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-2 py-3 text-left last:border-0 active:bg-gray-50 hover:bg-gray-50">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-800">{c.name}</span>
                {c.tag && <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">{c.tag}</span>}
              </span>
              <span className={`shrink-0 text-xs ${Number(c.owes || 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {Number(c.owes || 0) > 0 ? money(Number(c.owes)) : 'owes 0'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
