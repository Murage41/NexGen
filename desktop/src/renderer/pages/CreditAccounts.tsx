import { useState, useEffect, Fragment } from 'react';
import { getCreditAccounts, getCreditAccount, deleteCreditAccount, addAccountPayment } from '../services/api';
import { Users, X, Banknote, Trash2, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { getKenyaDate } from '../utils/timezone';

type FilterTab = 'all' | 'customer' | 'employee';

export default function CreditAccounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedAccount, setExpandedAccount] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<any>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_method: 'cash',
    payment_date: getKenyaDate(),
    notes: '',
  });

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    try {
      const res = await getCreditAccounts();
      setAccounts(res.data.data || res.data);
    } catch (err) {
      console.error('Failed to load credit accounts:', err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(account: any) {
    if (expandedId === account.id) {
      setExpandedId(null);
      setExpandedAccount(null);
      return;
    }
    setExpandedId(account.id);
    setLoadingDetail(true);
    try {
      const res = await getCreditAccount(account.id);
      setExpandedAccount(res.data.data || res.data);
    } catch (err) {
      console.error('Failed to load account detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  }

  function openPayment(account: any) {
    setPaymentTarget(account);
    setPaymentForm({
      amount: '',
      payment_method: 'cash',
      payment_date: getKenyaDate(),
      notes: '',
    });
    setShowPaymentModal(true);
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentTarget) return;
    const payload = {
      amount: parseFloat(paymentForm.amount),
      payment_method: paymentForm.payment_method,
      date: paymentForm.payment_date,
      notes: paymentForm.notes || null,
    };
    try {
      await addAccountPayment(paymentTarget.id, payload);
      setShowPaymentModal(false);
      await loadAccounts();
      // Refresh expanded detail if this account is expanded
      if (expandedId) {
        try {
          const res = await getCreditAccount(expandedId);
          setExpandedAccount(res.data.data || res.data);
        } catch {
          setExpandedId(null);
          setExpandedAccount(null);
        }
      }
    } catch (err: any) {
      console.error('Failed to add payment:', err);
      alert(err.response?.data?.error || 'Failed to record payment');
    }
  }

  async function handleDelete(account: any) {
    if (!confirm(`Remove credit account for "${account.name}"? This cannot be undone.`)) return;
    try {
      await deleteCreditAccount(account.id);
      if (expandedId === account.id) {
        setExpandedId(null);
        setExpandedAccount(null);
      }
      await loadAccounts();
    } catch (err: any) {
      console.error('Failed to delete account:', err);
      alert(err.response?.data?.error || 'Failed to remove account');
    }
  }

  const formatKES = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  const filtered = accounts.filter(a => {
    if (filter === 'customer' && a.type !== 'customer') return false;
    if (filter === 'employee' && a.type !== 'employee') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return a.name?.toLowerCase().includes(q) || a.phone?.toLowerCase().includes(q);
    }
    return true;
  });

  const totalOutstanding = accounts.reduce((s: number, a: any) => s + (parseFloat(a.outstanding_balance) || 0), 0);
  const customerCount = accounts.filter(a => a.type === 'customer').length;
  const employeeCount = accounts.filter(a => a.type === 'employee').length;

  function typeBadge(type: string) {
    if (type === 'employee') {
      return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-medium">Employee</span>;
    }
    return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Customer</span>;
  }

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Users size={24} /> Credit Accounts
        </h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold">Total Outstanding</p>
          <p className={`text-2xl font-bold mt-1 ${totalOutstanding > 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {formatKES(totalOutstanding)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold">Customer Accounts</p>
          <p className="text-2xl font-bold mt-1 text-blue-600">{customerCount}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold">Employee Accounts</p>
          <p className="text-2xl font-bold mt-1 text-orange-600">{employeeCount}</p>
        </div>
      </div>

      {/* Filter Tabs + Search */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {([['all', 'All'], ['customer', 'Customers'], ['employee', 'Employees']] as [FilterTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                filter === key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search accounts..."
            className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm w-64"
          />
        </div>
      </div>

      {/* Accounts Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium text-gray-600">Name</th>
              <th className="text-left p-3 font-medium text-gray-600">Phone</th>
              <th className="text-left p-3 font-medium text-gray-600">Type</th>
              <th className="text-right p-3 font-medium text-gray-600">Outstanding Balance</th>
              <th className="text-left p-3 font-medium text-gray-600">Created</th>
              <th className="p-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((account: any) => {
              const balance = parseFloat(account.outstanding_balance) || 0;
              const isExpanded = expandedId === account.id;
              return (
                <Fragment key={account.id}>
                  <tr
                    className="border-t hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleExpand(account)}
                  >
                    <td className="p-3 font-medium flex items-center gap-2">
                      {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                      {account.name}
                    </td>
                    <td className="p-3 text-gray-600">{account.phone || '-'}</td>
                    <td className="p-3">{typeBadge(account.type)}</td>
                    <td className={`p-3 text-right font-medium ${balance > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                      {formatKES(balance)}
                    </td>
                    <td className="p-3 text-gray-500">
                      {account.created_at ? new Date(account.created_at).toLocaleDateString('en-KE') : '-'}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {account.type === 'customer' && balance > 0 && (
                          <button
                            onClick={() => openPayment(account)}
                            className="text-green-600 hover:text-green-800 flex items-center gap-1 text-xs font-medium"
                            title="Record Payment"
                          >
                            <Banknote size={14} /> Pay
                          </button>
                        )}
                        {account.type === 'customer' && balance === 0 && (
                          <button
                            onClick={() => handleDelete(account)}
                            className="text-red-500 hover:text-red-700"
                            title="Remove Account"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Expanded Detail Row */}
                  {isExpanded && (
                    <tr className="border-t bg-gray-50">
                      <td colSpan={6} className="p-4">
                        {loadingDetail ? (
                          <p className="text-gray-400 text-sm">Loading details...</p>
                        ) : expandedAccount ? (
                          <div className="space-y-4">
                            {/* Credits (line items) */}
                            {expandedAccount.credits && expandedAccount.credits.length > 0 && (
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-2">Credit Line Items</h4>
                                <div className="border rounded-lg overflow-hidden">
                                  <table className="w-full text-sm">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="text-left p-2 text-gray-600 font-medium">Date</th>
                                        <th className="text-left p-2 text-gray-600 font-medium">Description</th>
                                        <th className="text-right p-2 text-gray-600 font-medium">Amount</th>
                                        <th className="text-right p-2 text-gray-600 font-medium">Paid</th>
                                        <th className="text-right p-2 text-gray-600 font-medium">Balance</th>
                                        <th className="text-left p-2 text-gray-600 font-medium">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {expandedAccount.credits.map((c: any) => (
                                        <tr key={c.id} className="border-t">
                                          <td className="p-2 text-gray-500">{new Date(c.created_at).toLocaleDateString('en-KE')}</td>
                                          <td className="p-2">{c.description || '-'}</td>
                                          <td className="p-2 text-right">{formatKES(c.amount)}</td>
                                          <td className="p-2 text-right text-green-600">{formatKES(c.total_paid || 0)}</td>
                                          <td className="p-2 text-right font-medium text-red-600">{formatKES(c.balance || 0)}</td>
                                          <td className="p-2">
                                            {c.status === 'paid' ? (
                                              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Paid</span>
                                            ) : c.status === 'partial' ? (
                                              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">Partial</span>
                                            ) : (
                                              <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">Outstanding</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* Payments */}
                            {expandedAccount.payments && expandedAccount.payments.length > 0 && (
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-2">Payment History</h4>
                                <div className="border rounded-lg overflow-hidden">
                                  <table className="w-full text-sm">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="text-left p-2 text-gray-600 font-medium">Date</th>
                                        <th className="text-right p-2 text-gray-600 font-medium">Amount</th>
                                        <th className="text-left p-2 text-gray-600 font-medium">Method</th>
                                        <th className="text-left p-2 text-gray-600 font-medium">Notes</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {expandedAccount.payments.map((p: any, i: number) => (
                                        <tr key={i} className="border-t">
                                          <td className="p-2 text-gray-500">{new Date(p.date || p.payment_date || p.created_at).toLocaleDateString('en-KE')}</td>
                                          <td className="p-2 text-right font-medium text-green-600">{formatKES(p.amount)}</td>
                                          <td className="p-2">
                                            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                              {p.payment_method === 'mpesa' ? 'M-Pesa' : p.payment_method === 'bank_transfer' ? 'Bank' : p.payment_method === 'cheque' ? 'Cheque' : 'Cash'}
                                            </span>
                                          </td>
                                          <td className="p-2 text-gray-500">{p.notes || '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {(!expandedAccount.credits || expandedAccount.credits.length === 0) &&
                             (!expandedAccount.payments || expandedAccount.payments.length === 0) && (
                              <p className="text-sm text-gray-400">No credit history for this account.</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-gray-400 text-sm">Failed to load details.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  {searchQuery ? 'No accounts match your search.' : 'No credit accounts found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && paymentTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Record Payment</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Account: <span className="font-medium text-gray-700">{paymentTarget.name}</span>
              {paymentTarget.phone ? ` (${paymentTarget.phone})` : ''}
              {' — '}Balance: <span className="font-medium text-red-600">{formatKES(parseFloat(paymentTarget.outstanding_balance) || 0)}</span>
            </p>
            <form onSubmit={handlePayment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KES) *</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0.01"
                  value={paymentForm.amount}
                  onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date *</label>
                <input
                  type="date"
                  required
                  value={paymentForm.payment_date}
                  onChange={e => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method *</label>
                <select
                  required
                  value={paymentForm.payment_method}
                  onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                >
                  <option value="cash">Cash</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={paymentForm.notes}
                  onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  placeholder="Optional notes"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowPaymentModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                  Record Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

