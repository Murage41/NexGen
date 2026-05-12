import { useState, useEffect } from 'react';
import {
  getCustomerInvoices,
  getCustomerInvoice,
  previewCustomerInvoice,
  createCustomerInvoiceDraft,
  updateCustomerInvoiceLine,
  issueCustomerInvoice,
  voidCustomerInvoice,
  deleteCustomerInvoiceDraft,
  getCreditAccounts,
  getInvoicePayments,
  createInvoicePayment,
  deleteInvoicePayment,
} from '../services/api';
import { FileText, Plus, X, Send, Ban, Trash2, Pencil, Check, DollarSign, Wallet } from 'lucide-react';

type Account = { id: number; name: string; billing_mode?: string; outstanding_balance?: number };
type Invoice = {
  id: number;
  account_id: number;
  account_name?: string;
  invoice_number: string;
  from_date: string;
  to_date: string;
  issue_date: string | null;
  status: 'draft' | 'issued' | 'partial' | 'paid' | 'void';
  total_amount: number;
  balance: number;
  notes?: string;
};

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  issued: 'bg-blue-100 text-blue-700',
  partial: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-600',
};

const fmt = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const firstOfMonth = () => {
  const d = new Date(today());
  d.setDate(1);
  return d.toLocaleDateString('en-CA');
};

export default function CustomerInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [error, setError] = useState('');

  // Generate (draft) modal
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState({ account_id: '', from_date: firstOfMonth(), to_date: today(), notes: '' });
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [agreedPrices, setAgreedPrices] = useState<{ petrol?: string; diesel?: string }>({});

  // Detail modal
  const [detail, setDetail] = useState<any | null>(null);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState('');

  // Phase 3D — Payments
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices');
  const [payments, setPayments] = useState<any[]>([]);
  const [showReceive, setShowReceive] = useState(false);
  const [payForm, setPayForm] = useState({
    account_id: '',
    amount: '',
    payment_method: 'cash',
    payment_date: today(),
    reference: '',
    notes: '',
  });
  const [payResult, setPayResult] = useState<any | null>(null);
  const [submittingPay, setSubmittingPay] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadInvoices();
    loadPayments();
  }, [statusFilter, accountFilter]);

  async function loadPayments() {
    try {
      const params: any = {};
      if (accountFilter) params.account_id = Number(accountFilter);
      const res = await getInvoicePayments(params);
      setPayments(res.data.data || []);
    } catch (err: any) {
      console.error(err);
    }
  }

  function openReceive() {
    setPayForm({
      account_id: accountFilter || '',
      amount: '',
      payment_method: 'cash',
      payment_date: today(),
      reference: '',
      notes: '',
    });
    setPayResult(null);
    setError('');
    setShowReceive(true);
  }

  async function submitPayment() {
    if (!payForm.account_id || !payForm.amount) {
      setError('Customer and amount required');
      return;
    }
    const amt = Number(payForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Amount must be positive');
      return;
    }
    try {
      setError('');
      setSubmittingPay(true);
      const res = await createInvoicePayment({
        account_id: Number(payForm.account_id),
        amount: amt,
        payment_method: payForm.payment_method || undefined,
        payment_date: payForm.payment_date || undefined,
        reference: payForm.reference || undefined,
        notes: payForm.notes || undefined,
      });
      setPayResult(res.data.data);
      await loadInvoices();
      await loadPayments();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to record payment');
    } finally {
      setSubmittingPay(false);
    }
  }

  async function handleDeletePayment(paymentId: number) {
    if (!confirm('Delete this payment? Allocations will be reversed and invoice balances updated.')) return;
    try {
      await deleteInvoicePayment(paymentId);
      await loadInvoices();
      await loadPayments();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    }
  }

  async function loadData() {
    try {
      setLoading(true);
      const [invRes, acctRes] = await Promise.all([
        getCustomerInvoices(),
        getCreditAccounts({ billing_mode: 'invoice' }),
      ]);
      setInvoices(invRes.data.data || []);
      setAccounts(acctRes.data.data || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function loadInvoices() {
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      if (accountFilter) params.account_id = Number(accountFilter);
      const res = await getCustomerInvoices(params);
      setInvoices(res.data.data || []);
    } catch (err: any) {
      console.error(err);
    }
  }

  function openGenerate() {
    setGenForm({ account_id: '', from_date: firstOfMonth(), to_date: today(), notes: '' });
    setPreview(null);
    setAgreedPrices({});
    setError('');
    setShowGenerate(true);
  }

  async function runPreview() {
    if (!genForm.account_id || !genForm.from_date || !genForm.to_date) {
      setError('Select account and date range');
      return;
    }
    try {
      setError('');
      setPreviewing(true);
      const res = await previewCustomerInvoice({
        account_id: Number(genForm.account_id),
        from: genForm.from_date,
        to: genForm.to_date,
      });
      setPreview(res.data.data);
      // Pre-fill agreed_prices with the suggested retail avg
      const prices: any = {};
      for (const l of res.data.data.lines) {
        prices[l.fuel_type] = String(l.suggested_agreed_price);
      }
      setAgreedPrices(prices);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function saveDraft() {
    if (!preview || preview.lines.length === 0) {
      setError('Nothing to invoice');
      return;
    }
    try {
      setError('');
      const payload: any = {
        account_id: Number(genForm.account_id),
        from_date: genForm.from_date,
        to_date: genForm.to_date,
        notes: genForm.notes || undefined,
        agreed_prices: {},
      };
      for (const [ft, v] of Object.entries(agreedPrices)) {
        if (v !== undefined && v !== '') payload.agreed_prices[ft] = Number(v);
      }
      await createCustomerInvoiceDraft(payload);
      setShowGenerate(false);
      await loadInvoices();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save draft');
    }
  }

  async function openDetail(inv: Invoice) {
    try {
      const res = await getCustomerInvoice(inv.id);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    }
  }

  async function handleIssue(id: number) {
    if (!confirm('Issue this invoice? It will be locked and added to the customer balance.')) return;
    try {
      await issueCustomerInvoice(id);
      setDetail(null);
      await loadInvoices();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    }
  }

  async function handleVoid(id: number) {
    if (!confirm('Void this invoice? Consumption rows will be unlinked and can be re-invoiced.')) return;
    try {
      await voidCustomerInvoice(id);
      setDetail(null);
      await loadInvoices();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    }
  }

  async function handleDeleteDraft(id: number) {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    try {
      await deleteCustomerInvoiceDraft(id);
      setDetail(null);
      await loadInvoices();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    }
  }

  async function saveLinePrice(invoiceId: number, lineId: number) {
    try {
      const priceNum = Number(editPrice);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        alert('Enter a valid price');
        return;
      }
      await updateCustomerInvoiceLine(invoiceId, lineId, { agreed_price: priceNum });
      setEditingLineId(null);
      setEditPrice('');
      // Refresh detail
      const res = await getCustomerInvoice(invoiceId);
      setDetail(res.data.data);
      await loadInvoices();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Customer Invoices</h1>
          <p className="text-sm text-gray-500">Bill invoice-mode customers for litres taken on credit.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openReceive}
            className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700"
          >
            <DollarSign size={16} /> Receive Payment
          </button>
          <button
            onClick={openGenerate}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700"
          >
            <Plus size={16} /> Generate Invoice
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        <button
          onClick={() => setTab('invoices')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
            tab === 'invoices' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText size={14} className="inline mr-1.5 -mt-0.5" />
          Invoices
        </button>
        <button
          onClick={() => setTab('payments')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
            tab === 'payments' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Wallet size={14} className="inline mr-1.5 -mt-0.5" />
          Payments
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All customers</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {tab === 'invoices' && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
        )}
      </div>

      {tab === 'invoices' && (loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          <FileText size={28} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm">No invoices yet. Click "Generate Invoice" to bill a customer.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Invoice #</th>
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Period</th>
                <th className="text-left px-4 py-2.5">Issued</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-right px-4 py-2.5">Balance</th>
                <th className="text-center px-4 py-2.5">Status</th>
                <th className="text-center px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {inv.status === 'draft' ? <span className="text-gray-400">(draft)</span> : inv.invoice_number}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{inv.account_name}</td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {inv.from_date} → {inv.to_date}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{inv.issue_date || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{fmt(inv.total_amount)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {Number(inv.balance) > 0 ? (
                      <span className="font-semibold text-red-600">{fmt(inv.balance)}</span>
                    ) : (
                      <span className="text-gray-400">{fmt(inv.balance)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status] || 'bg-gray-100'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => openDetail(inv)} className="text-blue-600 text-xs hover:underline">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {tab === 'payments' && (
        payments.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            <Wallet size={28} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">No payments yet. Click "Receive Payment" to record one.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-left px-4 py-2.5">Customer</th>
                  <th className="text-left px-4 py-2.5">Method</th>
                  <th className="text-left px-4 py-2.5">Reference</th>
                  <th className="text-right px-4 py-2.5">Amount</th>
                  <th className="text-left px-4 py-2.5">Allocated to</th>
                  <th className="text-center px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const allocSum = (p.allocations || []).reduce((s: number, a: any) => s + Number(a.amount_applied), 0);
                  const unallocated = Number(p.amount) - allocSum;
                  return (
                    <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                      <td className="px-4 py-2.5 text-gray-600">{p.payment_date}</td>
                      <td className="px-4 py-2.5 font-medium">{p.account_name}</td>
                      <td className="px-4 py-2.5 capitalize">{p.payment_method}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{p.reference || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{fmt(p.amount)}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {(p.allocations || []).length === 0 ? (
                          <span className="text-amber-600">unallocated</span>
                        ) : (
                          <div className="space-y-0.5">
                            {p.allocations.map((a: any) => (
                              <div key={a.id} className="flex justify-between gap-2">
                                <span className="font-mono text-gray-600">{a.invoice_number || `#${a.invoice_id}`}</span>
                                <span className="text-gray-700">{fmt(a.amount_applied)}</span>
                              </div>
                            ))}
                            {unallocated > 0.01 && (
                              <div className="flex justify-between gap-2 text-amber-600">
                                <span>unallocated</span>
                                <span>{fmt(unallocated)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => handleDeletePayment(p.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Delete payment"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Receive Payment Modal */}
      {showReceive && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">Receive Payment</h2>
              <button onClick={() => { setShowReceive(false); setPayResult(null); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            {!payResult ? (
              <>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Customer</label>
                    <select
                      value={payForm.account_id}
                      onChange={(e) => setPayForm({ ...payForm, account_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Select invoice-mode customer…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {Number(a.outstanding_balance || 0) > 0 ? ` — owes ${fmt(a.outstanding_balance!)}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        value={payForm.amount}
                        onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                        placeholder="0.00"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                      <input
                        type="date"
                        value={payForm.payment_date}
                        onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
                      <select
                        value={payForm.payment_method}
                        onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="cash">Cash</option>
                        <option value="mpesa">M-Pesa</option>
                        <option value="bank">Bank transfer</option>
                        <option value="cheque">Cheque</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Reference (optional)</label>
                      <input
                        value={payForm.reference}
                        onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                        placeholder="Txn ID, cheque #…"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                    <textarea
                      value={payForm.notes}
                      onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                      rows={2}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
                    Payment will be auto-allocated FIFO across this customer's outstanding invoices, oldest first.
                  </p>
                  {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
                </div>
                <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
                  <button onClick={() => setShowReceive(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg">
                    Cancel
                  </button>
                  <button
                    onClick={submitPayment}
                    disabled={submittingPay}
                    className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    <DollarSign size={14} /> {submittingPay ? 'Recording…' : 'Record Payment'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-4 space-y-3">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                    <p className="font-semibold text-green-800">Payment recorded</p>
                    <p className="text-xs text-green-700 mt-0.5">
                      {fmt(payResult.payment.amount)} from {accounts.find(a => a.id === payResult.payment.account_id)?.name || 'customer'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1">Allocated to ({payResult.allocations.length})</p>
                    {payResult.allocations.length === 0 ? (
                      <p className="text-sm text-gray-500">Nothing allocated — no outstanding invoices.</p>
                    ) : (
                      <table className="w-full text-sm border border-gray-200 rounded-lg">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="text-left px-3 py-1.5">Invoice</th>
                            <th className="text-right px-3 py-1.5">Applied</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payResult.allocations.map((a: any) => (
                            <tr key={a.invoice_id} className="border-t border-gray-100">
                              <td className="px-3 py-1.5 font-mono text-xs">{a.invoice_number}</td>
                              <td className="px-3 py-1.5 text-right font-medium">{fmt(a.amount_applied)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  {Number(payResult.unallocated_amount) > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                      <p className="font-semibold text-amber-800">Unallocated: {fmt(payResult.unallocated_amount)}</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        The customer overpaid. The excess sits on the payment record and can be applied later when new invoices are issued.
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
                  <button
                    onClick={() => { setShowReceive(false); setPayResult(null); }}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Generate Invoice Modal */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">Generate Invoice</h2>
              <button onClick={() => setShowGenerate(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Customer</label>
                <select
                  value={genForm.account_id}
                  onChange={(e) => {
                    setGenForm({ ...genForm, account_id: e.target.value });
                    setPreview(null);
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select invoice-mode customer…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                  <input
                    type="date"
                    value={genForm.from_date}
                    onChange={(e) => {
                      setGenForm({ ...genForm, from_date: e.target.value });
                      setPreview(null);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                  <input
                    type="date"
                    value={genForm.to_date}
                    onChange={(e) => {
                      setGenForm({ ...genForm, to_date: e.target.value });
                      setPreview(null);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <button
                onClick={runPreview}
                disabled={previewing}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {previewing ? 'Scanning…' : 'Preview consumption'}
              </button>

              {preview && (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <p className="text-xs text-gray-500 mb-2">
                    Found {preview.entries} unbilled entries in range
                  </p>
                  {preview.lines.length === 0 ? (
                    <p className="text-sm text-gray-400">No unbilled consumption in this range.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left py-1">Fuel</th>
                          <th className="text-right py-1">Litres</th>
                          <th className="text-right py-1">Avg retail</th>
                          <th className="text-right py-1 w-24">Agreed price</th>
                          <th className="text-right py-1">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.lines.map((l: any) => {
                          const price = Number(agreedPrices[l.fuel_type as 'petrol' | 'diesel'] || l.suggested_agreed_price);
                          const lineTotal = l.total_litres * price;
                          return (
                            <tr key={l.fuel_type} className="border-t border-gray-200">
                              <td className="py-1 capitalize font-medium">{l.fuel_type}</td>
                              <td className="text-right">{Number(l.total_litres).toLocaleString()}</td>
                              <td className="text-right text-gray-500">{fmt(l.avg_retail_price)}</td>
                              <td className="text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={agreedPrices[l.fuel_type as 'petrol' | 'diesel'] ?? ''}
                                  onChange={(e) =>
                                    setAgreedPrices({ ...agreedPrices, [l.fuel_type]: e.target.value })
                                  }
                                  className="w-20 border border-gray-300 rounded px-1 py-0.5 text-right"
                                />
                              </td>
                              <td className="text-right font-medium">{fmt(lineTotal)}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-gray-300 font-bold">
                          <td colSpan={4} className="py-1 text-right">Total</td>
                          <td className="text-right">
                            {fmt(
                              preview.lines.reduce((s: number, l: any) => {
                                const p = Number(agreedPrices[l.fuel_type as 'petrol' | 'diesel'] || l.suggested_agreed_price);
                                return s + l.total_litres * p;
                              }, 0),
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                <textarea
                  value={genForm.notes}
                  onChange={(e) => setGenForm({ ...genForm, notes: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
              <button onClick={() => setShowGenerate(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg">
                Cancel
              </button>
              <button
                onClick={saveDraft}
                disabled={!preview || preview.lines.length === 0}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Save as Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-bold">
                  {detail.status === 'draft' ? 'Draft Invoice' : detail.invoice_number}
                </h2>
                <p className="text-xs text-gray-500">
                  {detail.account_name} · {detail.from_date} → {detail.to_date}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[detail.status] || 'bg-gray-100'}`}>
                  {detail.status}
                </span>
                <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {/* Lines */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Lines</p>
                <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2">Fuel</th>
                      <th className="text-right px-3 py-2">Litres</th>
                      <th className="text-right px-3 py-2">Agreed price</th>
                      <th className="text-right px-3 py-2">Line total</th>
                      {detail.status === 'draft' && <th className="w-10"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l: any) => (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 capitalize font-medium">{l.fuel_type}</td>
                        <td className="px-3 py-2 text-right">{Number(l.total_litres).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">
                          {editingLineId === l.id ? (
                            <input
                              type="number"
                              step="0.01"
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              className="w-20 border border-gray-300 rounded px-1 py-0.5 text-right"
                              autoFocus
                            />
                          ) : (
                            fmt(l.agreed_price)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{fmt(l.line_total)}</td>
                        {detail.status === 'draft' && (
                          <td className="px-2 py-2 text-center">
                            {editingLineId === l.id ? (
                              <button
                                onClick={() => saveLinePrice(detail.id, l.id)}
                                className="text-green-600 hover:bg-green-50 p-1 rounded"
                              >
                                <Check size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingLineId(l.id);
                                  setEditPrice(String(l.agreed_price));
                                }}
                                className="text-gray-400 hover:text-gray-700 p-1"
                              >
                                <Pencil size={13} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-200 font-bold bg-gray-50">
                      <td className="px-3 py-2" colSpan={3}>
                        Total
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(detail.total_amount)}</td>
                      {detail.status === 'draft' && <td></td>}
                    </tr>
                    {Number(detail.balance) !== Number(detail.total_amount) && detail.status !== 'draft' && (
                      <tr className="text-sm">
                        <td className="px-3 py-1" colSpan={3}>Balance</td>
                        <td className={`px-3 py-1 text-right font-semibold ${Number(detail.balance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {fmt(detail.balance)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Payment allocations */}
              {detail.allocations && detail.allocations.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Payments applied</p>
                  <table className="w-full text-xs border border-gray-200 rounded-lg">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-left px-2 py-1">Date</th>
                        <th className="text-left px-2 py-1">Method</th>
                        <th className="text-left px-2 py-1">Reference</th>
                        <th className="text-right px-2 py-1">Applied</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.allocations.map((a: any) => (
                        <tr key={a.id} className="border-t border-gray-100">
                          <td className="px-2 py-1">{a.payment_date}</td>
                          <td className="px-2 py-1 capitalize">{a.payment_method}</td>
                          <td className="px-2 py-1 text-gray-500">{a.reference || '—'}</td>
                          <td className="px-2 py-1 text-right font-medium">{fmt(a.amount_applied)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-gray-200 font-semibold bg-gray-50">
                        <td colSpan={3} className="px-2 py-1 text-right">Total paid</td>
                        <td className="px-2 py-1 text-right">
                          {fmt(detail.allocations.reduce((s: number, a: any) => s + Number(a.amount_applied), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Consumption detail */}
              {detail.consumption && detail.consumption.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-gray-600 font-medium">
                    Underlying shift entries ({detail.consumption.length})
                  </summary>
                  <table className="w-full text-xs mt-2 border border-gray-200 rounded-lg">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-left px-2 py-1">Date</th>
                        <th className="text-left px-2 py-1">Fuel</th>
                        <th className="text-right px-2 py-1">Litres</th>
                        <th className="text-right px-2 py-1">Retail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.consumption.map((c: any) => (
                        <tr key={c.id} className="border-t border-gray-100">
                          <td className="px-2 py-1">{c.shift_date}</td>
                          <td className="px-2 py-1 capitalize">{c.fuel_type}</td>
                          <td className="px-2 py-1 text-right">{Number(c.litres).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right text-gray-500">{fmt(c.retail_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              {detail.notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1">Notes</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded p-2">{detail.notes}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-2 p-4 border-t bg-gray-50">
              <div>
                {detail.status === 'draft' && (
                  <button
                    onClick={() => handleDeleteDraft(detail.id)}
                    className="inline-flex items-center gap-1 text-red-600 text-sm hover:bg-red-50 px-3 py-1.5 rounded-lg"
                  >
                    <Trash2 size={14} /> Delete draft
                  </button>
                )}
                {(detail.status === 'issued' || detail.status === 'partial') && (
                  <button
                    onClick={() => handleVoid(detail.id)}
                    className="inline-flex items-center gap-1 text-red-600 text-sm hover:bg-red-50 px-3 py-1.5 rounded-lg"
                  >
                    <Ban size={14} /> Void
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setDetail(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg">
                  Close
                </button>
                {detail.status === 'draft' && (
                  <button
                    onClick={() => handleIssue(detail.id)}
                    className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                  >
                    <Send size={14} /> Issue Invoice
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
