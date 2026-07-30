import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Filter,
  Pencil,
  Printer,
  RefreshCw,
  Save,
  Wallet,
  X,
} from 'lucide-react';
import {
  correctInvoiceConsumption,
  getCustomerInvoices,
  getInvoiceCustomerConsumption,
  getInvoicePayments,
  getShift,
  previewInvoiceConsumptionCorrection,
  reverseInvoicePayment,
  updateCreditAccount,
} from '../services/api';

export type InvoiceCustomerWorkspaceCustomer = {
  id: number;
  name: string;
  phone?: string | null;
  issued_balance: number;
  draft_total?: number;
  unbilled_litres: number;
  unbilled_retail_amount: number;
  total_exposure: number;
};

type Props = {
  customer: InvoiceCustomerWorkspaceCustomer;
  onClose: () => void;
  onGenerateInvoice: (accountId: number) => void;
  onReceivePayment: (accountId: number) => void;
  onOpenInvoice: (invoice: { id: number }) => void;
  onChanged: () => Promise<void> | void;
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

const litres = (value: unknown) =>
  `${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} L`;

const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

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
};

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function html(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function InvoiceCustomerWorkspace({
  customer,
  onClose,
  onGenerateInvoice,
  onReceivePayment,
  onOpenInvoice,
  onChanged,
}: Props) {
  const [tab, setTab] = useState<'consumption' | 'invoices' | 'payments'>('consumption');
  const [filters, setFilters] = useState<HistoryFilters>({
    from: '',
    to: '',
    fuel_type: '',
    status: 'active',
    shift_id: '',
  });
  const [history, setHistory] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [termsDays, setTermsDays] = useState('0');
  const [savingTerms, setSavingTerms] = useState(false);
  const [correctionRow, setCorrectionRow] = useState<any | null>(null);
  const [correctionSources, setCorrectionSources] = useState<any[]>([]);
  const [correctionForm, setCorrectionForm] = useState({ litres: '', pump_id: '', reason: '' });
  const [correctionPreview, setCorrectionPreview] = useState<any | null>(null);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [reversalPayment, setReversalPayment] = useState<any | null>(null);
  const [reversalForm, setReversalForm] = useState({ reason: '', reversal_date: kenyaToday() });
  const [reversalBusy, setReversalBusy] = useState(false);

  const historyParams = (page: number, pageSize = 50) => ({
    from: filters.from || undefined,
    to: filters.to || undefined,
    fuel_type: filters.fuel_type || undefined,
    status: filters.status || 'active',
    shift_id: filters.shift_id ? Number(filters.shift_id) : undefined,
    page,
    page_size: pageSize,
  });

  async function loadHistory(page = 1) {
    try {
      setHistoryLoading(true);
      setError('');
      const response = await getInvoiceCustomerConsumption(customer.id, historyParams(page));
      setHistory(response.data.data);
      setTermsDays(String(response.data.data.account?.payment_terms_days || 0));
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load consumption history.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadDocuments() {
    const [invoiceResponse, paymentResponse] = await Promise.all([
      getCustomerInvoices({ account_id: customer.id }),
      getInvoicePayments({ account_id: customer.id }),
    ]);
    setInvoices(invoiceResponse.data.data || []);
    setPayments(paymentResponse.data.data || []);
  }

  async function loadWorkspace() {
    try {
      setLoading(true);
      setError('');
      await Promise.all([loadHistory(1), loadDocuments()]);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load customer workspace.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
  }, [customer.id]);

  const openInvoiceBalance = useMemo(
    () => invoices
      .filter((invoice) => ['issued', 'partial'].includes(invoice.status))
      .reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0),
    [invoices],
  );

  async function saveTerms() {
    const value = Number(termsDays);
    if (!Number.isInteger(value) || value < 0 || value > 365) {
      setError('Payment terms must be a whole number from 0 to 365 days.');
      return;
    }
    try {
      setSavingTerms(true);
      setError('');
      await updateCreditAccount(customer.id, { payment_terms_days: value });
      await onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save payment terms.');
    } finally {
      setSavingTerms(false);
    }
  }

  async function getAllFilteredRows() {
    const first = await getInvoiceCustomerConsumption(customer.id, historyParams(1, 100));
    const firstData = first.data.data;
    const pageCount = Number(firstData.pagination?.total_pages || 1);
    if (pageCount <= 1) return { ...firstData, rows: firstData.rows || [] };
    const responses = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        getInvoiceCustomerConsumption(customer.id, historyParams(index + 2, 100))),
    );
    return {
      ...firstData,
      rows: [
        ...(firstData.rows || []),
        ...responses.flatMap((response) => response.data.data.rows || []),
      ],
    };
  }

  async function exportCsv() {
    try {
      setHistoryLoading(true);
      const data = await getAllFilteredRows();
      const header = [
        'Date', 'Shift', 'Attendant', 'Fuel', 'Pump / Nozzle', 'Tank',
        'Litres', 'Retail price', 'Retail amount', 'Billing status',
        'Invoice', 'Correction reason',
      ];
      const body = data.rows.map((row: any) => [
        row.shift_date,
        row.shift_id,
        row.employee_name,
        row.fuel_type,
        [row.pump_label, row.nozzle_label].filter(Boolean).join(' / '),
        row.tank_label,
        row.litres,
        row.retail_price_at_time,
        row.retail_amount,
        row.billing_status,
        row.invoice_number,
        row.correction_reason,
      ].map(csvCell).join(','));
      const blob = new Blob([[header.map(csvCell).join(','), ...body].join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${customer.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-consumption.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to export consumption.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function printHistory() {
    try {
      setHistoryLoading(true);
      const data = await getAllFilteredRows();
      const popup = window.open('', '_blank', 'width=1100,height=750');
      if (!popup) throw new Error('The print window was blocked.');
      const tableRows = data.rows.map((row: any) => `
        <tr>
          <td>${html(row.shift_date)}</td>
          <td>${html(row.shift_id)}</td>
          <td>${html(row.employee_name)}</td>
          <td>${html(row.fuel_type)}</td>
          <td>${html([row.pump_label, row.nozzle_label].filter(Boolean).join(' / '))}</td>
          <td class="number">${html(Number(row.litres).toFixed(2))}</td>
          <td class="number">${html(Number(row.retail_amount).toFixed(2))}</td>
          <td>${html(row.billing_status)}</td>
          <td>${html(row.invoice_number || '')}</td>
        </tr>
      `).join('');
      popup.document.write(`<!doctype html><html><head><title>${html(customer.name)} consumption</title>
        <style>
          body{font-family:Arial,sans-serif;color:#1f2937;margin:24px}h1{font-size:20px;margin:0 0 4px}
          p{font-size:12px;color:#6b7280;margin:0 0 16px}table{width:100%;border-collapse:collapse;font-size:11px}
          th,td{border:1px solid #d1d5db;padding:6px;text-align:left}th{background:#f3f4f6}
          .number{text-align:right}@media print{body{margin:8mm}}
        </style></head><body>
        <h1>${html(customer.name)} - Fuel Consumption</h1>
        <p>Filtered total: ${html(data.pagination.total)} entries, ${html(data.totals.active_litres)} active litres. Printed ${html(kenyaToday())}.</p>
        <table><thead><tr><th>Date</th><th>Shift</th><th>Attendant</th><th>Fuel</th><th>Source</th><th>Litres</th><th>Retail amount</th><th>Status</th><th>Invoice</th></tr></thead>
        <tbody>${tableRows}</tbody></table></body></html>`);
      popup.document.close();
      popup.focus();
      popup.print();
    } catch (err: any) {
      setError(err?.message || 'Failed to prepare print view.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openCorrection(row: any) {
    try {
      setError('');
      const response = await getShift(row.shift_id);
      const readings = (response.data.data?.readings || [])
        .filter((reading: any) => reading.fuel_type === row.fuel_type);
      setCorrectionSources(readings);
      setCorrectionRow(row);
      setCorrectionForm({
        litres: String(row.litres),
        pump_id: row.pump_id ? String(row.pump_id) : readings.length === 1 ? String(readings[0].pump_id) : '',
        reason: '',
      });
      setCorrectionPreview(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load shift sources.');
    }
  }

  async function previewCorrection() {
    if (!correctionRow) return;
    const value = Number(correctionForm.litres);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Corrected litres must be greater than zero.');
      return;
    }
    try {
      setCorrectionBusy(true);
      setError('');
      const response = await previewInvoiceConsumptionCorrection(
        correctionRow.shift_id,
        correctionRow.id,
        {
          litres: value,
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
      await Promise.all([loadHistory(history?.pagination?.page || 1), loadDocuments(), onChanged()]);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to post correction.');
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function postPaymentReversal() {
    if (!reversalPayment) return;
    if (reversalForm.reason.trim().length < 10) {
      setError('Enter a reversal reason of at least 10 characters.');
      return;
    }
    try {
      setReversalBusy(true);
      setError('');
      await reverseInvoicePayment(reversalPayment.id, reversalForm);
      setReversalPayment(null);
      await Promise.all([loadDocuments(), onChanged()]);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to reverse payment.');
    } finally {
      setReversalBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-100 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between gap-5">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded" title="Back to customers">
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-gray-900 truncate">{customer.name}</h2>
              <p className="text-sm text-gray-500">{customer.phone || 'No phone number'} · Invoice customer</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onReceivePayment(customer.id)} className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700">
              <Wallet size={16} /> Receive Payment
            </button>
            <button onClick={() => onGenerateInvoice(customer.id)} className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700">
              <FileText size={16} /> Generate Invoice
            </button>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded" title="Close workspace">
              <X size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-4 bg-white border-b border-gray-200 divide-x divide-gray-200">
        <div className="px-6 py-3">
          <p className="text-xs text-gray-500">Open invoice balance</p>
          <p className="text-lg font-bold text-red-600">{fmt(openInvoiceBalance || customer.issued_balance)}</p>
        </div>
        <div className="px-6 py-3">
          <p className="text-xs text-gray-500">Unbilled consumption</p>
          <p className="text-lg font-bold text-blue-700">{litres(customer.unbilled_litres)}</p>
          <p className="text-xs text-gray-400">{fmt(customer.unbilled_retail_amount)} at retail</p>
        </div>
        <div className="px-6 py-3">
          <p className="text-xs text-gray-500">Draft value</p>
          <p className="text-lg font-bold text-amber-700">{fmt(customer.draft_total || 0)}</p>
        </div>
        <div className="px-6 py-3">
          <label className="text-xs text-gray-500" htmlFor="payment-terms">Default payment terms</label>
          <div className="flex items-center gap-2 mt-1">
            <input id="payment-terms" type="number" min="0" max="365" value={termsDays} onChange={(event) => setTermsDays(event.target.value)} className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
            <span className="text-sm text-gray-500">days</span>
            <button onClick={saveTerms} disabled={savingTerms} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50" title="Save payment terms">
              {savingTerms ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            </button>
          </div>
        </div>
      </div>

      <nav className="bg-white px-6 border-b border-gray-200 flex gap-1">
        {([
          ['consumption', 'Consumption'],
          ['invoices', `Invoices (${invoices.length})`],
          ['payments', `Payments (${payments.length})`],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="mx-6 mt-4 px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-sm flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={16} /></button>
        </div>
      )}

      <main className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-sm text-gray-500">Loading customer records...</div>
        ) : tab === 'consumption' ? (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 p-3 flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fuel</label>
                <select value={filters.fuel_type} onChange={(event) => setFilters({ ...filters, fuel_type: event.target.value })} className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                  <option value="">All fuel</option>
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Billing state</label>
                <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
                  <option value="active">All active</option>
                  <option value="unbilled">Unbilled</option>
                  <option value="reserved">In draft</option>
                  <option value="invoiced">Invoiced</option>
                  <option value="reversed">Reversed corrections</option>
                  <option value="deleted">Deleted while open</option>
                  <option value="all">Full audit history</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Shift ID</label>
                <input type="number" min="1" value={filters.shift_id} onChange={(event) => setFilters({ ...filters, shift_id: event.target.value })} className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="Any" />
              </div>
              <button onClick={() => loadHistory(1)} disabled={historyLoading} className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-800 text-white text-sm rounded hover:bg-gray-900 disabled:opacity-50">
                <Filter size={15} /> Apply
              </button>
              <div className="ml-auto flex items-center gap-1">
                <button onClick={exportCsv} disabled={historyLoading} className="p-2 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50" title="Download filtered CSV">
                  <Download size={18} />
                </button>
                <button onClick={printHistory} disabled={historyLoading} className="p-2 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50" title="Print filtered consumption">
                  <Printer size={18} />
                </button>
                <button onClick={() => loadHistory(history?.pagination?.page || 1)} disabled={historyLoading} className="p-2 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50" title="Refresh">
                  <RefreshCw size={18} className={historyLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {history && (
              <>
                <div className="grid grid-cols-4 bg-white border border-gray-200 divide-x divide-gray-200">
                  <div className="px-4 py-3"><p className="text-xs text-gray-500">Filtered entries</p><p className="font-bold text-gray-900">{history.pagination.total}</p></div>
                  <div className="px-4 py-3"><p className="text-xs text-gray-500">Active litres</p><p className="font-bold text-blue-700">{litres(history.totals.active_litres)}</p></div>
                  <div className="px-4 py-3"><p className="text-xs text-gray-500">Active retail value</p><p className="font-bold text-gray-900">{fmt(history.totals.active_retail_amount)}</p></div>
                  <div className="px-4 py-3"><p className="text-xs text-gray-500">Reversed / deleted litres</p><p className="font-bold text-red-600">{litres(history.totals.reversed_litres)}</p></div>
                </div>

                <div className="bg-white border border-gray-200 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Date / Shift</th>
                        <th className="text-left px-3 py-2">Attendant</th>
                        <th className="text-left px-3 py-2">Fuel / Source</th>
                        <th className="text-right px-3 py-2">Litres</th>
                        <th className="text-right px-3 py-2">Retail value</th>
                        <th className="text-left px-3 py-2">Billing state</th>
                        <th className="text-left px-3 py-2">Invoice / Audit</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(history.rows || []).map((row: any) => (
                        <tr key={row.id} className={`border-t border-gray-100 ${['reversed', 'deleted'].includes(row.billing_status) ? 'bg-red-50/30 text-gray-500' : 'hover:bg-gray-50'}`}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-800">{row.shift_date}</p>
                            <p className="text-xs text-gray-400">Shift #{row.shift_id}</p>
                          </td>
                          <td className="px-3 py-2">{row.employee_name || 'Unknown'}</td>
                          <td className="px-3 py-2">
                            <p className="capitalize font-medium">{row.fuel_type}</p>
                            <p className="text-xs text-gray-400">
                              {[row.pump_label, row.nozzle_label, row.tank_label].filter(Boolean).join(' · ') || 'Source not recorded'}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{litres(row.litres)}</td>
                          <td className="px-3 py-2 text-right">
                            <p>{fmt(row.retail_amount)}</p>
                            <p className="text-xs text-gray-400">@ {fmt(row.retail_price_at_time)}</p>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-block border px-2 py-0.5 text-xs font-medium rounded ${statusStyle[row.billing_status] || statusStyle.deleted}`}>
                              {String(row.billing_status).replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {row.invoice_id ? (
                              <button onClick={() => onOpenInvoice({ id: row.invoice_id })} className="font-mono text-blue-600 hover:underline">
                                {row.invoice_number || `Draft #${row.invoice_id}`}
                              </button>
                            ) : <span className="text-gray-400">Not invoiced</span>}
                            {row.correction_reason && <p className="text-red-600 mt-1 max-w-[240px]">{row.correction_reason}</p>}
                            {row.replacement_id && <p className="text-gray-400">Replaced by entry #{row.replacement_id}</p>}
                            {row.correction_of_id && <p className="text-gray-400">Corrects entry #{row.correction_of_id}</p>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.billing_status === 'unbilled' && row.shift_status === 'closed' && (
                              <button onClick={() => openCorrection(row)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Correct closed-shift entry">
                                <Pencil size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {(history.rows || []).length === 0 && (
                        <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No consumption matches these filters.</td></tr>
                      )}
                    </tbody>
                  </table>
                  <div className="border-t border-gray-200 px-4 py-2 flex items-center justify-between text-sm">
                    <span className="text-gray-500">Page {history.pagination.page} of {history.pagination.total_pages}</span>
                    <div className="flex gap-1">
                      <button onClick={() => loadHistory(history.pagination.page - 1)} disabled={historyLoading || history.pagination.page <= 1} className="p-1.5 border border-gray-300 rounded disabled:opacity-40" title="Previous page"><ChevronLeft size={16} /></button>
                      <button onClick={() => loadHistory(history.pagination.page + 1)} disabled={historyLoading || history.pagination.page >= history.pagination.total_pages} className="p-1.5 border border-gray-300 rounded disabled:opacity-40" title="Next page"><ChevronRight size={16} /></button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : tab === 'invoices' ? (
          <div className="bg-white border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                <tr><th className="text-left px-4 py-2">Invoice</th><th className="text-left px-4 py-2">Period</th><th className="text-left px-4 py-2">Due</th><th className="text-right px-4 py-2">Total</th><th className="text-right px-4 py-2">Balance</th><th className="text-left px-4 py-2">Status</th><th className="px-4 py-2"></th></tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono">{invoice.invoice_number || `Draft #${invoice.id}`}</td>
                    <td className="px-4 py-2 text-gray-600">{invoice.from_date} to {invoice.to_date}</td>
                    <td className="px-4 py-2 text-gray-600">{invoice.due_date || 'Not issued'}</td>
                    <td className="px-4 py-2 text-right">{fmt(invoice.total_amount)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmt(invoice.balance)}</td>
                    <td className="px-4 py-2"><span className={`inline-block border px-2 py-0.5 text-xs rounded ${statusStyle[invoice.status] || statusStyle.draft}`}>{invoice.status}</span></td>
                    <td className="px-4 py-2 text-right"><button onClick={() => onOpenInvoice(invoice)} className="text-blue-600 hover:underline">Open</button></td>
                  </tr>
                ))}
                {invoices.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-gray-400">No invoices for this customer.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                <tr><th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">Method / Account</th><th className="text-left px-4 py-2">Reference</th><th className="text-left px-4 py-2">Allocated invoices</th><th className="text-right px-4 py-2">Amount</th><th className="text-left px-4 py-2">Status</th><th className="px-4 py-2"></th></tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className={`border-t border-gray-100 ${payment.status === 'reversed' ? 'bg-red-50/30 text-gray-500' : 'hover:bg-gray-50'}`}>
                    <td className="px-4 py-2">{payment.payment_date}</td>
                    <td className="px-4 py-2 capitalize">{payment.payment_method}<p className="text-xs text-gray-400">{payment.received_into || payment.payment_method}</p></td>
                    <td className="px-4 py-2 text-gray-600">{payment.reference || 'None'}</td>
                    <td className="px-4 py-2 text-xs">{(payment.allocations || []).map((allocation: any) => allocation.invoice_number || `#${allocation.invoice_id}`).join(', ')}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmt(payment.amount)}</td>
                    <td className="px-4 py-2 capitalize">{payment.status || 'posted'}{payment.reversal_reason && <p className="text-xs text-red-600">{payment.reversal_reason}</p>}</td>
                    <td className="px-4 py-2 text-right">
                      {payment.status !== 'reversed' && <button onClick={() => { setReversalPayment(payment); setReversalForm({ reason: '', reversal_date: kenyaToday() }); }} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Reverse payment"><Ban size={15} /></button>}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-gray-400">No invoice payments for this customer.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {correctionRow && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl shadow-xl">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div><h3 className="font-bold text-gray-900">Correct Consumption Entry</h3><p className="text-xs text-gray-500">{correctionRow.shift_date} · Shift #{correctionRow.shift_id} · {correctionRow.fuel_type}</p></div>
              <button onClick={() => setCorrectionRow(null)} className="p-1 text-gray-400 hover:text-gray-700"><X size={19} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs text-gray-500 mb-1">Correct litres</label><input type="number" min="0.01" step="0.01" value={correctionForm.litres} onChange={(event) => { setCorrectionForm({ ...correctionForm, litres: event.target.value }); setCorrectionPreview(null); }} className="w-full border border-gray-300 rounded px-3 py-2" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">Pump / nozzle source</label><select value={correctionForm.pump_id} onChange={(event) => { setCorrectionForm({ ...correctionForm, pump_id: event.target.value }); setCorrectionPreview(null); }} className="w-full border border-gray-300 rounded px-3 py-2 bg-white"><option value="">Automatic source</option>{correctionSources.map((source) => <option key={source.pump_id} value={source.pump_id}>{source.pump_label} {source.nozzle_label} · {Number(source.litres_sold || 0).toFixed(2)} L sold</option>)}</select></div>
              </div>
              {!correctionPreview ? (
                <button onClick={previewCorrection} disabled={correctionBusy} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-50">{correctionBusy ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />} Preview impact</button>
              ) : (
                <>
                  <div className="grid grid-cols-3 border border-gray-200 divide-x divide-gray-200">
                    <div className="p-3"><p className="text-xs text-gray-500">Amount change</p><p className={`font-bold ${Number(correctionPreview.amount_delta) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(correctionPreview.amount_delta)}</p></div>
                    <div className="p-3"><p className="text-xs text-gray-500">Shift variance</p><p className="font-bold text-gray-900">{fmt(correctionPreview.variance_before)} to {fmt(correctionPreview.variance_after)}</p></div>
                    <div className="p-3"><p className="text-xs text-gray-500">Employee deficit change</p><p className={`font-bold ${Number(correctionPreview.deficit_change) > 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(correctionPreview.deficit_change)}</p></div>
                  </div>
                  <div><label className="block text-xs text-gray-500 mb-1">Correction reason</label><textarea rows={3} value={correctionForm.reason} onChange={(event) => setCorrectionForm({ ...correctionForm, reason: event.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" placeholder="Explain why this closed-shift record is being corrected" /></div>
                  <div className="flex justify-end gap-2"><button onClick={() => setCorrectionRow(null)} className="px-4 py-2 border border-gray-300 rounded text-sm">Cancel</button><button onClick={postCorrection} disabled={correctionBusy || correctionForm.reason.trim().length < 10} className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium disabled:opacity-50">Post audited correction</button></div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {reversalPayment && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md shadow-xl">
            <div className="px-5 py-4 border-b flex justify-between"><div><h3 className="font-bold">Reverse Payment</h3><p className="text-xs text-gray-500">{fmt(reversalPayment.amount)} received {reversalPayment.payment_date}</p></div><button onClick={() => setReversalPayment(null)}><X size={18} /></button></div>
            <div className="p-5 space-y-3">
              <div><label className="block text-xs text-gray-500 mb-1">Reversal date</label><input type="date" max={kenyaToday()} value={reversalForm.reversal_date} onChange={(event) => setReversalForm({ ...reversalForm, reversal_date: event.target.value })} className="w-full border border-gray-300 rounded px-3 py-2" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">Reason</label><textarea rows={3} value={reversalForm.reason} onChange={(event) => setReversalForm({ ...reversalForm, reason: event.target.value })} className="w-full border border-gray-300 rounded px-3 py-2" placeholder="Why is this payment being reversed?" /></div>
              <div className="flex justify-end gap-2"><button onClick={() => setReversalPayment(null)} className="px-4 py-2 border border-gray-300 rounded text-sm">Cancel</button><button onClick={postPaymentReversal} disabled={reversalBusy || reversalForm.reason.trim().length < 10} className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium disabled:opacity-50">Reverse payment</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
