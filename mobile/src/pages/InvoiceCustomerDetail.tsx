import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  Pencil,
  ReceiptText,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import {
  correctInvoiceConsumption,
  getCustomerInvoices,
  getInvoiceCustomerConsumption,
  getInvoiceCustomerMonitor,
  getInvoicePayments,
  getShift,
  previewInvoiceConsumptionCorrection,
} from '../services/api';

type CustomerSummary = {
  id: number;
  name: string;
  phone?: string | null;
  issued_balance: number;
  draft_count: number;
  unbilled_litres: number;
  unbilled_retail_amount: number;
  total_exposure: number;
};

type HistoryFilters = {
  from: string;
  to: string;
  fuel_type: string;
  status: string;
  shift_id: string;
};

const fmt = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtLitres = (value: unknown) =>
  `${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} L`;

const statusStyle: Record<string, string> = {
  unbilled: 'bg-blue-50 text-blue-700 border-blue-200',
  reserved: 'bg-amber-50 text-amber-700 border-amber-200',
  invoiced: 'bg-green-50 text-green-700 border-green-200',
  released: 'bg-gray-100 text-gray-600 border-gray-200',
  reversed: 'bg-red-50 text-red-700 border-red-200',
  deleted: 'bg-gray-100 text-gray-500 border-gray-200',
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  issued: 'bg-blue-50 text-blue-700 border-blue-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-green-50 text-green-700 border-green-200',
  void: 'bg-red-50 text-red-700 border-red-200',
  posted: 'bg-green-50 text-green-700 border-green-200',
};

export default function InvoiceCustomerDetail() {
  const { id } = useParams();
  const accountId = Number(id);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [history, setHistory] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [tab, setTab] = useState<'consumption' | 'invoices' | 'payments'>('consumption');
  const [filters, setFilters] = useState<HistoryFilters>({
    from: '',
    to: '',
    fuel_type: '',
    status: 'active',
    shift_id: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [correctionRow, setCorrectionRow] = useState<any | null>(null);
  const [correctionSources, setCorrectionSources] = useState<any[]>([]);
  const [correctionForm, setCorrectionForm] = useState({ litres: '', pump_id: '', reason: '' });
  const [correctionPreview, setCorrectionPreview] = useState<any | null>(null);
  const [correctionBusy, setCorrectionBusy] = useState(false);

  const historyParams = (page: number) => ({
    from: filters.from || undefined,
    to: filters.to || undefined,
    fuel_type: filters.fuel_type || undefined,
    status: filters.status || 'active',
    shift_id: filters.shift_id ? Number(filters.shift_id) : undefined,
    page,
    page_size: 20,
  });

  async function loadHistory(page = 1) {
    try {
      setHistoryLoading(true);
      setError('');
      const response = await getInvoiceCustomerConsumption(accountId, historyParams(page));
      setHistory(response.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load consumption history.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadPage() {
    try {
      setLoading(true);
      setError('');
      const [monitorResponse, historyResponse, invoiceResponse, paymentResponse] = await Promise.all([
        getInvoiceCustomerMonitor({ recent_limit: 1 }),
        getInvoiceCustomerConsumption(accountId, historyParams(1)),
        getCustomerInvoices({ account_id: accountId }),
        getInvoicePayments({ account_id: accountId }),
      ]);
      const match = (monitorResponse.data.data?.customers || [])
        .find((row: CustomerSummary) => Number(row.id) === accountId);
      setCustomer(match || {
        id: accountId,
        name: historyResponse.data.data?.account?.name || `Customer #${accountId}`,
        phone: historyResponse.data.data?.account?.phone,
        issued_balance: 0,
        draft_count: 0,
        unbilled_litres: 0,
        unbilled_retail_amount: 0,
        total_exposure: 0,
      });
      setHistory(historyResponse.data.data);
      setInvoices(invoiceResponse.data.data || []);
      setPayments(paymentResponse.data.data || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load customer records.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (Number.isInteger(accountId) && accountId > 0) {
      loadPage();
    } else {
      setError('Invalid invoice customer.');
      setLoading(false);
    }
  }, [accountId]);

  const openBalance = useMemo(
    () => invoices
      .filter((invoice) => ['issued', 'partial'].includes(invoice.status))
      .reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0),
    [invoices],
  );

  async function openCorrection(row: any) {
    try {
      setError('');
      const response = await getShift(row.shift_id);
      const sources = (response.data.data?.readings || [])
        .filter((reading: any) => reading.fuel_type === row.fuel_type);
      setCorrectionSources(sources);
      setCorrectionRow(row);
      setCorrectionForm({
        litres: String(row.litres),
        pump_id: row.pump_id
          ? String(row.pump_id)
          : sources.length === 1
            ? String(sources[0].pump_id)
            : '',
        reason: '',
      });
      setCorrectionPreview(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load shift sources.');
    }
  }

  async function previewCorrection() {
    if (!correctionRow) return;
    const correctedLitres = Number(correctionForm.litres);
    if (!Number.isFinite(correctedLitres) || correctedLitres <= 0) {
      setError('Corrected litres must be greater than zero.');
      return;
    }
    if (correctionSources.length > 1 && !correctionForm.pump_id) {
      setError('Select the pump or nozzle source before previewing.');
      return;
    }
    try {
      setCorrectionBusy(true);
      setError('');
      const response = await previewInvoiceConsumptionCorrection(
        correctionRow.shift_id,
        correctionRow.id,
        {
          litres: correctedLitres,
          pump_id: correctionForm.pump_id ? Number(correctionForm.pump_id) : null,
        },
      );
      setCorrectionPreview(response.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Correction preview failed.');
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function postCorrection() {
    if (!correctionRow || !correctionPreview) return;
    if (correctionForm.reason.trim().length < 10) {
      setError('Enter a correction reason of at least 10 characters.');
      return;
    }
    try {
      setCorrectionBusy(true);
      setError('');
      await correctInvoiceConsumption(correctionRow.shift_id, correctionRow.id, {
        litres: Number(correctionForm.litres),
        pump_id: correctionForm.pump_id ? Number(correctionForm.pump_id) : null,
        reason: correctionForm.reason.trim(),
        confirmation_token: correctionPreview.confirmation_token,
      });
      setCorrectionRow(null);
      setCorrectionPreview(null);
      await loadPage();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to post correction.');
    } finally {
      setCorrectionBusy(false);
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 mt-20">Loading customer records...</div>;
  }

  return (
    <div className="pb-6">
      <PageHeader
        title={customer?.name || 'Invoice Customer'}
        back
        right={(
          <button
            onClick={loadPage}
            disabled={loading || historyLoading}
            className="p-2 text-gray-500 disabled:opacity-40"
            aria-label="Refresh customer records"
          >
            <RefreshCw size={18} className={loading || historyLoading ? 'animate-spin' : ''} />
          </button>
        )}
      />

      {customer?.phone && <p className="-mt-3 mb-3 pl-8 text-xs text-gray-400">{customer.phone}</p>}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm mb-3 flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm min-w-0">
          <p className="text-[10px] uppercase text-gray-400">Invoiced</p>
          <p className="text-sm font-bold text-red-600 break-words">
            {fmt(invoices.length > 0 ? openBalance : customer?.issued_balance)}
          </p>
        </div>
        <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm min-w-0">
          <p className="text-[10px] uppercase text-gray-400">Unbilled</p>
          <p className="text-sm font-bold text-blue-700 break-words">{fmtLitres(customer?.unbilled_litres)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm min-w-0">
          <p className="text-[10px] uppercase text-gray-400">Exposure</p>
          <p className="text-sm font-bold text-gray-800 break-words">{fmt(customer?.total_exposure)}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 bg-white border border-gray-200 rounded-lg p-1 mb-3">
        {([
          ['consumption', 'Consumption'],
          ['invoices', `Invoices ${invoices.length}`],
          ['payments', `Payments ${payments.length}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`min-h-10 px-1 py-2 text-xs font-semibold rounded-md ${
              tab === key ? 'bg-gray-800 text-white' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'consumption' && (
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Filtered consumption</p>
                <p className="font-bold text-gray-800">
                  {fmtLitres(history?.totals?.active_litres)} across {history?.pagination?.total || 0} entries
                </p>
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`p-2 rounded-md ${showFilters ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}
                aria-label="Consumption filters"
              >
                <Filter size={18} />
              </button>
            </div>

            {showFilters && (
              <div className="border-t border-gray-100 mt-3 pt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-gray-500">
                    From
                    <input
                      type="date"
                      value={filters.from}
                      onChange={(event) => setFilters({ ...filters, from: event.target.value })}
                      className="mt-1 w-full border border-gray-300 rounded-md p-2 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-500">
                    To
                    <input
                      type="date"
                      value={filters.to}
                      onChange={(event) => setFilters({ ...filters, to: event.target.value })}
                      className="mt-1 w-full border border-gray-300 rounded-md p-2 text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-gray-500">
                    Fuel
                    <select
                      value={filters.fuel_type}
                      onChange={(event) => setFilters({ ...filters, fuel_type: event.target.value })}
                      className="mt-1 w-full border border-gray-300 rounded-md p-2 text-sm bg-white"
                    >
                      <option value="">All fuel</option>
                      <option value="petrol">Petrol</option>
                      <option value="diesel">Diesel</option>
                    </select>
                  </label>
                  <label className="text-xs text-gray-500">
                    Billing state
                    <select
                      value={filters.status}
                      onChange={(event) => setFilters({ ...filters, status: event.target.value })}
                      className="mt-1 w-full border border-gray-300 rounded-md p-2 text-sm bg-white"
                    >
                      <option value="active">All active</option>
                      <option value="unbilled">Unbilled</option>
                      <option value="reserved">In draft</option>
                      <option value="invoiced">Invoiced</option>
                      <option value="reversed">Reversed</option>
                      <option value="deleted">Deleted</option>
                      <option value="all">Full audit</option>
                    </select>
                  </label>
                </div>
                <label className="block text-xs text-gray-500">
                  Shift number
                  <input
                    type="number"
                    min="1"
                    value={filters.shift_id}
                    onChange={(event) => setFilters({ ...filters, shift_id: event.target.value })}
                    placeholder="Any shift"
                    className="mt-1 w-full border border-gray-300 rounded-md p-2 text-sm"
                  />
                </label>
                <button
                  onClick={() => loadHistory(1)}
                  disabled={historyLoading}
                  className="w-full bg-gray-800 text-white rounded-md py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  Apply Filters
                </button>
              </div>
            )}
          </div>

          {(history?.rows || []).map((row: any) => (
            <div
              key={row.id}
              className={`bg-white border rounded-lg p-3 shadow-sm ${
                ['reversed', 'deleted'].includes(row.billing_status) ? 'border-red-100 bg-red-50/30' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {row.shift_date} <span className="font-normal text-gray-400">Shift #{row.shift_id}</span>
                  </p>
                  <p className="text-xs text-gray-400">{row.employee_name || 'Unknown attendant'}</p>
                </div>
                <span className={`border rounded px-2 py-0.5 text-[11px] font-medium ${statusStyle[row.billing_status] || statusStyle.deleted}`}>
                  {String(row.billing_status).replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-end justify-between gap-3 mt-3">
                <div className="min-w-0">
                  <p className="capitalize text-xs font-semibold text-gray-600">{row.fuel_type}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {[row.pump_label, row.nozzle_label, row.tank_label].filter(Boolean).join(' / ') || 'Source not recorded'}
                  </p>
                  {row.invoice_number && (
                    <p className="text-xs font-mono text-blue-600 mt-1">{row.invoice_number}</p>
                  )}
                  {row.correction_reason && (
                    <p className="text-xs text-red-600 mt-1">{row.correction_reason}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-gray-800">{fmtLitres(row.litres)}</p>
                  <p className="text-xs text-gray-400">{fmt(row.retail_amount)}</p>
                </div>
              </div>
              {row.billing_status === 'unbilled' && row.shift_status === 'closed' && (
                <button
                  onClick={() => openCorrection(row)}
                  className="mt-3 w-full border-t border-gray-100 pt-2 text-blue-700 text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <Pencil size={14} /> Correct Closed-Shift Entry
                </button>
              )}
            </div>
          ))}

          {(history?.rows || []).length === 0 && (
            <div className="bg-white border border-gray-100 rounded-lg p-6 text-center text-sm text-gray-400">
              No consumption matches these filters.
            </div>
          )}

          {history && (
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Page {history.pagination.page} of {history.pagination.total_pages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => loadHistory(history.pagination.page - 1)}
                  disabled={historyLoading || history.pagination.page <= 1}
                  className="p-2 border border-gray-300 rounded-md disabled:opacity-30"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  onClick={() => loadHistory(history.pagination.page + 1)}
                  disabled={historyLoading || history.pagination.page >= history.pagination.total_pages}
                  className="p-2 border border-gray-300 rounded-md disabled:opacity-30"
                  aria-label="Next page"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="space-y-3">
          {invoices.map((invoice) => (
            <div key={invoice.id} className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={17} className="text-blue-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold truncate">
                      {invoice.invoice_number || `Draft #${invoice.id}`}
                    </p>
                    <p className="text-xs text-gray-400">{invoice.from_date} to {invoice.to_date}</p>
                  </div>
                </div>
                <span className={`border rounded px-2 py-0.5 text-[11px] ${statusStyle[invoice.status] || statusStyle.draft}`}>
                  {invoice.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <div><p className="text-gray-400">Due</p><p className="font-medium">{invoice.due_date || 'Not issued'}</p></div>
                <div className="text-right"><p className="text-gray-400">Total</p><p className="font-medium">{fmt(invoice.total_amount)}</p></div>
                <div className="text-right"><p className="text-gray-400">Balance</p><p className="font-bold text-red-600">{fmt(invoice.balance)}</p></div>
              </div>
            </div>
          ))}
          {invoices.length === 0 && (
            <div className="bg-white rounded-lg p-6 text-center text-sm text-gray-400">
              <ReceiptText size={24} className="mx-auto mb-2" /> No invoices for this customer.
            </div>
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div className="space-y-3">
          {payments.map((payment) => (
            <div
              key={payment.id}
              className={`bg-white border rounded-lg p-3 shadow-sm ${
                payment.status === 'reversed' ? 'border-red-100 bg-red-50/30' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Wallet size={17} className="text-green-600" />
                  <div>
                    <p className="text-sm font-semibold capitalize">{payment.payment_method}</p>
                    <p className="text-xs text-gray-400">{payment.payment_date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-800">{fmt(payment.amount)}</p>
                  <span className={`inline-block border rounded px-2 py-0.5 text-[11px] ${statusStyle[payment.status || 'posted'] || statusStyle.posted}`}>
                    {payment.status || 'posted'}
                  </span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-gray-100 text-xs text-gray-500">
                <p>Received into: {payment.received_into || payment.payment_method}</p>
                <p>Reference: {payment.reference || 'None'}</p>
                <p className="mt-1">
                  Allocated to: {(payment.allocations || [])
                    .map((allocation: any) => allocation.invoice_number || `Invoice #${allocation.invoice_id}`)
                    .join(', ') || 'None'}
                </p>
                {payment.reversal_reason && <p className="text-red-600 mt-1">{payment.reversal_reason}</p>}
              </div>
            </div>
          ))}
          {payments.length === 0 && (
            <div className="bg-white rounded-lg p-6 text-center text-sm text-gray-400">
              <Wallet size={24} className="mx-auto mb-2" /> No invoice payments for this customer.
            </div>
          )}
        </div>
      )}

      {correctionRow && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
          <div className="bg-white w-full max-h-[92vh] overflow-y-auto rounded-t-xl p-4">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="font-bold text-gray-900">Correct Consumption</h2>
                <p className="text-xs text-gray-500">
                  {correctionRow.shift_date} / Shift #{correctionRow.shift_id} / {correctionRow.fuel_type}
                </p>
              </div>
              <button onClick={() => setCorrectionRow(null)} className="p-1 text-gray-500" aria-label="Close correction">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs text-gray-500">
                Correct litres
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={correctionForm.litres}
                  onChange={(event) => {
                    setCorrectionForm({ ...correctionForm, litres: event.target.value });
                    setCorrectionPreview(null);
                  }}
                  className="mt-1 w-full border border-gray-300 rounded-lg p-3 text-sm"
                />
              </label>

              <label className="block text-xs text-gray-500">
                Pump / nozzle source
                <select
                  value={correctionForm.pump_id}
                  onChange={(event) => {
                    setCorrectionForm({ ...correctionForm, pump_id: event.target.value });
                    setCorrectionPreview(null);
                  }}
                  className="mt-1 w-full border border-gray-300 rounded-lg p-3 text-sm bg-white"
                >
                  {correctionSources.length !== 1 && <option value="">Select source</option>}
                  {correctionSources.map((source) => (
                    <option key={source.pump_id} value={source.pump_id}>
                      {[source.pump_label, source.nozzle_label].filter(Boolean).join(' / ')}
                      {' - '}{Number(source.litres_sold || 0).toFixed(2)} L sold
                    </option>
                  ))}
                </select>
              </label>

              {!correctionPreview ? (
                <button
                  onClick={previewCorrection}
                  disabled={correctionBusy}
                  className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {correctionBusy ? <RefreshCw size={17} className="animate-spin" /> : <Check size={17} />}
                  Preview Impact
                </button>
              ) : (
                <>
                  <div className="grid grid-cols-3 border border-gray-200 rounded-lg divide-x divide-gray-200">
                    <div className="p-2 min-w-0">
                      <p className="text-[10px] text-gray-400">Amount change</p>
                      <p className="text-xs font-bold break-words">{fmt(correctionPreview.amount_delta)}</p>
                    </div>
                    <div className="p-2 min-w-0">
                      <p className="text-[10px] text-gray-400">New variance</p>
                      <p className="text-xs font-bold break-words">{fmt(correctionPreview.variance_after)}</p>
                    </div>
                    <div className="p-2 min-w-0">
                      <p className="text-[10px] text-gray-400">Deficit change</p>
                      <p className="text-xs font-bold break-words">{fmt(correctionPreview.deficit_change)}</p>
                    </div>
                  </div>
                  <label className="block text-xs text-gray-500">
                    Correction reason
                    <textarea
                      rows={3}
                      value={correctionForm.reason}
                      onChange={(event) => setCorrectionForm({ ...correctionForm, reason: event.target.value })}
                      placeholder="Explain why this closed-shift entry is being corrected"
                      className="mt-1 w-full border border-gray-300 rounded-lg p-3 text-sm"
                    />
                  </label>
                  <button
                    onClick={postCorrection}
                    disabled={correctionBusy || correctionForm.reason.trim().length < 10}
                    className="w-full bg-red-600 text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50"
                  >
                    Post Audited Correction
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
