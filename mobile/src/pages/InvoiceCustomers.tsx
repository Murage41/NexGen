import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Droplets, FileText, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getInvoiceCustomerMonitor } from '../services/api';

type MonitorCustomer = {
  id: number;
  name: string;
  phone?: string | null;
  issued_balance: number;
  open_invoice_count: number;
  draft_count: number;
  unbilled_litres: number;
  unbilled_retail_amount: number;
  unbilled_entries: number;
  first_unbilled_date?: string | null;
  last_unbilled_date?: string | null;
  last_consumption_date?: string | null;
  total_exposure: number;
  fuels: Record<string, { litres: number; retail_amount: number; entries: number }>;
  latest_open_invoices: Array<{ id: number; invoice_number: string; status: string; issue_date?: string | null; balance: number }>;
  recent_unbilled_consumption: Array<{ id: number; shift_id: number; shift_date: string; fuel_type: string; litres: number; retail_amount: number }>;
};

type MonitorData = {
  summary: {
    customer_count: number;
    issued_balance: number;
    unbilled_litres: number;
    unbilled_retail_amount: number;
    unbilled_entries: number;
    total_exposure: number;
    open_invoice_count: number;
    draft_count: number;
  };
  customers: MonitorCustomer[];
};

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtLitres = (n: number) =>
  `${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;

export default function InvoiceCustomers() {
  const [monitor, setMonitor] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadMonitor();
  }, []);

  async function loadMonitor() {
    try {
      setLoading(true);
      setError('');
      const res = await getInvoiceCustomerMonitor({ recent_limit: 5 });
      setMonitor(res.data.data || null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load invoice customers');
    } finally {
      setLoading(false);
    }
  }

  const customers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (monitor?.customers || []).filter((customer) => {
      if (!q) return true;
      return customer.name.toLowerCase().includes(q) || String(customer.phone || '').toLowerCase().includes(q);
    });
  }, [monitor, search]);

  const summary = useMemo(() => customers.reduce(
    (acc, customer) => {
      acc.customer_count += 1;
      acc.issued_balance += Number(customer.issued_balance || 0);
      acc.unbilled_litres += Number(customer.unbilled_litres || 0);
      acc.unbilled_retail_amount += Number(customer.unbilled_retail_amount || 0);
      acc.unbilled_entries += Number(customer.unbilled_entries || 0);
      acc.total_exposure += Number(customer.total_exposure || 0);
      return acc;
    },
    { customer_count: 0, issued_balance: 0, unbilled_litres: 0, unbilled_retail_amount: 0, unbilled_entries: 0, total_exposure: 0 },
  ), [customers]);

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader title="Invoice Customers" back />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-3">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl p-3 shadow-sm mb-3">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2">
          <Search size={16} className="text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer"
            className="flex-1 outline-none text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-[11px] uppercase font-medium">Exposure</span>
            <AlertTriangle size={15} />
          </div>
          <p className="text-lg font-bold text-red-600">{fmt(summary.total_exposure)}</p>
          <p className="text-xs text-gray-400">{summary.customer_count} customers</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-[11px] uppercase font-medium">Unbilled</span>
            <Droplets size={15} />
          </div>
          <p className="text-lg font-bold text-blue-700">{fmtLitres(summary.unbilled_litres)}</p>
          <p className="text-xs text-gray-400">{fmt(summary.unbilled_retail_amount)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {customers.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center text-sm text-gray-400 shadow-sm">
            No invoice-mode customers found.
          </div>
        ) : customers.map((customer) => {
          const expanded = expandedId === customer.id;
          const petrol = customer.fuels?.petrol;
          const diesel = customer.fuels?.diesel;
          return (
            <div key={customer.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => setExpandedId(expanded ? null : customer.id)}
                className="w-full p-4 text-left active:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{customer.name}</p>
                    <p className="text-xs text-gray-400">{customer.phone || 'No phone'}</p>
                  </div>
                  {expanded ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <div>
                    <p className="text-gray-400">Issued</p>
                    <p className={customer.issued_balance > 0 ? 'font-bold text-red-600' : 'font-bold text-gray-500'}>
                      {fmt(customer.issued_balance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400">Unbilled</p>
                    <p className="font-bold text-blue-700">{fmtLitres(customer.unbilled_litres)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Exposure</p>
                    <p className="font-bold text-gray-800">{fmt(customer.total_exposure)}</p>
                  </div>
                </div>
              </button>

              {expanded && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-blue-700 font-medium">Petrol</p>
                      <p className="font-bold text-gray-800">{fmtLitres(petrol?.litres || 0)}</p>
                      <p className="text-gray-500">{fmt(petrol?.retail_amount || 0)}</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3">
                      <p className="text-amber-700 font-medium">Diesel</p>
                      <p className="font-bold text-gray-800">{fmtLitres(diesel?.litres || 0)}</p>
                      <p className="text-gray-500">{fmt(diesel?.retail_amount || 0)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Recent unbilled consumption</p>
                    {customer.recent_unbilled_consumption.length === 0 ? (
                      <p className="text-xs text-gray-400">No unbilled consumption.</p>
                    ) : (
                      <div className="space-y-1">
                        {customer.recent_unbilled_consumption.map((row) => (
                          <div key={row.id} className="flex justify-between text-xs">
                            <span className="text-gray-500">{row.shift_date} - {row.fuel_type}</span>
                            <span className="font-medium">{fmtLitres(row.litres)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Open invoices</p>
                    {customer.latest_open_invoices.length === 0 ? (
                      <p className="text-xs text-gray-400">No unpaid invoices.</p>
                    ) : (
                      <div className="space-y-1">
                        {customer.latest_open_invoices.map((invoice) => (
                          <div key={invoice.id} className="flex justify-between text-xs">
                            <span className="font-mono text-gray-500 flex items-center gap-1">
                              <FileText size={12} /> {invoice.invoice_number}
                            </span>
                            <span className="font-medium text-red-600">{fmt(invoice.balance)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="text-[11px] text-gray-400">
                    Last use: {customer.last_consumption_date || 'None'}
                    {customer.first_unbilled_date && ` | Unbilled: ${customer.first_unbilled_date} to ${customer.last_unbilled_date}`}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
