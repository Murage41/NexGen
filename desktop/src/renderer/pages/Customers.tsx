import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Users } from 'lucide-react';
import { getCreditAccounts, getInvoiceCustomerMonitor } from '../services/api';

type Row = {
  key: string;
  id: number;
  name: string;
  kind: 'credit' | 'invoice';
  owes: number;
  flags: string[];
};

const kes = (value: number) => `KES ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

// Every customer in one list, money (credit) and invoice alike. Opening one
// goes to its own page: the credit account or the invoice customer's records.
export default function Customers() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | 'credit' | 'invoice'>('all');

  useEffect(() => {
    Promise.all([
      getCreditAccounts({ billing_mode: 'money', type: 'customer' }),
      getInvoiceCustomerMonitor({ recent_limit: 0 }),
    ]).then(([credit, invoice]) => {
      const money: Row[] = (credit.data.data || credit.data || []).map((account: any) => {
        const rules = (account.credit_check?.breaches || []).map((breach: any) => breach.rule);
        return {
          key: `credit-${account.id}`, id: account.id, name: account.name, kind: 'credit' as const,
          owes: Number(account.outstanding_balance || 0),
          flags: [rules.includes('credit_limit') ? 'Over limit' : '', rules.includes('repayment_limit') ? 'Overdue' : ''].filter(Boolean),
        };
      });
      const billed: Row[] = (invoice.data.data?.customers || []).map((customer: any) => ({
        key: `invoice-${customer.id}`, id: customer.id, name: customer.name, kind: 'invoice' as const,
        owes: Number(customer.total_exposure || 0),
        flags: Number(customer.draft_count || 0) > 0 ? ['Draft invoice'] : [],
      }));
      setRows([...money, ...billed].sort((a, b) => a.name.localeCompare(b.name)));
    }).catch((err) => console.error('[Customers:load]', err?.response?.data || err?.message))
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => rows.filter((row) =>
    (kind === 'all' || row.kind === kind) && row.name.toLowerCase().includes(search.trim().toLowerCase())), [rows, kind, search]);
  const owedBy = (which: Row['kind']) => rows.filter((row) => row.kind === which).reduce((sum, row) => sum + row.owes, 0);
  const open = (row: Row) => navigate(row.kind === 'credit' ? `/credit-accounts?account=${row.id}` : `/customer-invoices?customer=${row.id}`);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Users size={24} /> Customers</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => navigate('/customer-invoices?tab=invoices')} className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50">Invoices</button>
          <button type="button" onClick={() => navigate('/customer-invoices?tab=payments')} className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50">Invoice payments</button>
          <button type="button" onClick={() => navigate('/credit-accounts?new=1')} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><Plus size={16} /> New customer</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="bg-white border border-gray-200 rounded-lg p-4 border-t-4 border-t-amber-500">
          <p className="text-xs font-semibold text-gray-500">Credit customers owe</p>
          <p className="text-2xl font-bold tabular-nums">{kes(owedBy('credit'))}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 border-t-4 border-t-blue-600">
          <p className="text-xs font-semibold text-gray-500">Invoice customers: billed + unbilled fuel</p>
          <p className="text-2xl font-bold tabular-nums">{kes(owedBy('invoice'))}</p>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-3 border-b border-gray-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search customers"
              className="w-full h-10 border border-gray-300 rounded-lg pl-9 pr-3 text-sm" />
          </div>
          <div className="flex rounded-lg bg-gray-100 p-1 text-sm">
            {(['all', 'credit', 'invoice'] as const).map((value) => (
              <button key={value} type="button" onClick={() => setKind(value)}
                className={`px-3 py-1.5 rounded-md font-semibold ${kind === value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600'}`}>
                {value === 'all' ? 'All' : value === 'credit' ? 'Credit' : 'Invoice'}
              </button>
            ))}
          </div>
        </div>
        {loading ? <p className="p-6 text-gray-400">Loading customers...</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left p-3 font-medium">Customer</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium"></th>
                <th className="text-right p-3 font-medium">Owes</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key} onClick={() => open(row)} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="p-3 font-medium text-gray-900">{row.name}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${row.kind === 'credit' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                      {row.kind === 'credit' ? 'Credit' : 'Invoice'}
                    </span>
                  </td>
                  <td className="p-3">
                    {row.flags.map((flag) => (
                      <span key={flag} className={`mr-1 px-2 py-0.5 rounded text-xs font-semibold ${flag === 'Draft invoice' ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-700'}`}>{flag}</span>
                    ))}
                  </td>
                  <td className={`p-3 text-right tabular-nums font-semibold ${row.owes > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{kes(row.owes)}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-400">No customers found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
