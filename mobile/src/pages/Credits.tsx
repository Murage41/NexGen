import { useState, useEffect } from 'react';
import { CreditCard, Phone, ChevronRight, ChevronLeft, Trash2, Users, Briefcase, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import { getCreditAccounts, getCreditAccount, deleteCreditAccount, addCreditPayment } from '../services/api';

type FilterTab = 'all' | 'customer' | 'employee';

export default function Credits() {
  const { isAdmin } = useAuth();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentCredit, setPaymentCredit] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'cash', notes: '' });

  const fmt = (n: number) => `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  useEffect(() => { loadAccounts(); }, []);

  async function loadAccounts() {
    try {
      const res = await getCreditAccounts();
      setAccounts(res.data.data || res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function openAccount(account: any) {
    setLoadingDetail(true);
    try {
      const res = await getCreditAccount(account.id);
      setSelectedAccount(res.data.data || res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetail(false);
    }
  }

  function openCreditPayment(credit: any) {
    setPaymentCredit(credit);
    setPaymentForm({ amount: '', payment_method: 'cash', notes: '' });
    setShowPayment(true);
  }

  async function handlePayment() {
    if (!paymentForm.amount || !paymentCredit) return;
    setSubmitting(true);
    try {
      await addCreditPayment(paymentCredit.id, {
        amount: parseFloat(paymentForm.amount),
        payment_method: paymentForm.payment_method,
        date: new Date().toISOString().split('T')[0],
        notes: paymentForm.notes || undefined,
      });
      setShowPayment(false);
      setPaymentCredit(null);
      setPaymentForm({ amount: '', payment_method: 'cash', notes: '' });
      // Reload account detail and list
      try {
        await openAccount(selectedAccount);
      } catch {
        // Account may have been auto-deleted after full payment
        setSelectedAccount(null);
      }
      loadAccounts();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveAccount(account: any) {
    if (!confirm(`Remove account "${account.name}"? This cannot be undone.`)) return;
    try {
      await deleteCreditAccount(account.id);
      setSelectedAccount(null);
      loadAccounts();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to remove account');
    }
  }

  const filtered = filter === 'all' ? accounts : accounts.filter(a => a.type === filter);

  const typeBadge = (type: string) => {
    if (type === 'customer') return 'bg-blue-100 text-blue-700';
    if (type === 'employee') return 'bg-purple-100 text-purple-700';
    return 'bg-gray-100 text-gray-700';
  };

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  // Account detail view
  if (selectedAccount) {
    const acct = selectedAccount;
    const isCustomer = acct.type === 'customer';
    const items = isCustomer ? (acct.credits || []) : (acct.debts || []);

    return (
      <div className="pb-6">
        <PageHeader
          title={acct.name}
          back
          onBack={() => setSelectedAccount(null)}
        />

        {/* Account summary card */}
        <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadge(acct.type)}`}>
              {acct.type}
            </span>
            {acct.phone && (
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <Phone size={12} />
                <span>{acct.phone}</span>
              </div>
            )}
          </div>
          <div className="text-center py-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Outstanding Balance</p>
            <p className={`text-2xl font-bold ${acct.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {fmt(acct.outstanding_balance)}
            </p>
          </div>
          <div className="flex gap-2 mt-2">
            {isAdmin && isCustomer && Number(acct.outstanding_balance) === 0 && (
              <button
                onClick={() => handleRemoveAccount(acct)}
                className="flex-1 bg-red-50 text-red-600 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1"
              >
                <Trash2 size={14} /> Remove Account
              </button>
            )}
          </div>
        </div>

        {loadingDetail && <div className="text-center text-gray-400 my-4">Loading details...</div>}

        {/* Credits / Debts list */}
        {isCustomer ? (
          <>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Credits</h3>
            {(acct.credits || []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No credits</p>
            ) : (
              <div className="space-y-2 mb-4">
                {acct.credits.map((c: any) => (
                  <div key={c.id} className="bg-white rounded-xl p-3 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <ArrowUpCircle size={14} className="text-red-500 shrink-0" />
                          <span className="text-sm font-medium text-gray-800">{fmt(c.amount)}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            c.status === 'paid' ? 'bg-green-100 text-green-700' :
                            c.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>{c.status}</span>
                        </div>
                        {c.description && <p className="text-xs text-gray-400 mt-1 ml-5">{c.description}</p>}
                      </div>
                      <div className="text-right text-xs text-gray-400">
                        {new Date(c.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                    {c.balance > 0 && (
                      <div className="flex items-center justify-between mt-2 ml-5">
                        <p className="text-xs text-gray-500">Balance: {fmt(c.balance)}</p>
                        {isAdmin && (
                          <button
                            onClick={() => openCreditPayment(c)}
                            className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg font-medium"
                          >
                            Pay
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Payments</h3>
            {(acct.payments || []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No payments</p>
            ) : (
              <div className="space-y-2">
                {acct.payments.map((p: any, i: number) => (
                  <div key={i} className="bg-white rounded-xl p-3 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <ArrowDownCircle size={14} className="text-green-500 shrink-0" />
                        <span className="text-sm font-medium text-green-700">{fmt(p.amount)}</span>
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{p.payment_method}</span>
                      </div>
                      <div className="text-xs text-gray-400">
                        {new Date(p.date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                    {p.notes && <p className="text-xs text-gray-400 mt-1 ml-5">{p.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Staff Debts</h3>
            {items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No debts</p>
            ) : (
              <div className="space-y-2">
                {items.map((d: any, i: number) => (
                  <div key={i} className="bg-white rounded-xl p-3 shadow-sm">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{fmt(d.original_deficit || d.balance)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {d.status === 'outstanding' ? 'Outstanding' : 'Settled'}
                          {d.deducted_from_wage > 0 && ` | Wage deduction: ${fmt(d.deducted_from_wage)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          d.status === 'outstanding' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}>{d.status}</span>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(d.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Record Payment Modal */}
        {showPayment && paymentCredit && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => { setShowPayment(false); setPaymentCredit(null); }}>
            <div className="bg-white w-full rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <h2 className="text-lg font-bold text-gray-800 mb-1">Record Payment</h2>
              <p className="text-sm text-gray-500 mb-4">
                Credit #{paymentCredit.id}
                {paymentCredit.description ? ` - ${paymentCredit.description}` : ''}
                {paymentCredit.shift_id ? ` from Shift #${paymentCredit.shift_id}` : ''}
                {' \u2014 '}Balance: {fmt(paymentCredit.balance)}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Payment Amount (KES)</label>
                  <input
                    type="number"
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                    value={paymentForm.amount}
                    onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Payment Method</label>
                  <select
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={paymentForm.payment_method}
                    onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                  >
                    <option value="cash">Cash</option>
                    <option value="mpesa">M-Pesa</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Notes (optional)</label>
                  <input
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Payment notes"
                    value={paymentForm.notes}
                    onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  />
                </div>
                <button
                  onClick={handlePayment}
                  disabled={submitting || !paymentForm.amount}
                  className="w-full bg-green-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
                >
                  {submitting ? 'Processing...' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Accounts list view
  const filterTabs: { key: FilterTab; label: string; icon: any }[] = [
    { key: 'all', label: 'All', icon: CreditCard },
    { key: 'customer', label: 'Customers', icon: Users },
    { key: 'employee', label: 'Employees', icon: Briefcase },
  ];

  const totalOutstanding = filtered.reduce((s: number, a: any) => s + Number(a.outstanding_balance || 0), 0);

  return (
    <div className="pb-6">
      <PageHeader title="Credits" back />

      {/* Summary card */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <p className="text-xs text-gray-400 uppercase tracking-wide">Total Outstanding</p>
        <p className="text-2xl font-bold text-red-600">{fmt(totalOutstanding)}</p>
        <p className="text-xs text-gray-400 mt-1">{filtered.length} account{filtered.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Filter tabs */}
      <div className="flex bg-gray-100 rounded-lg p-1 mb-4">
        {filterTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition flex items-center justify-center gap-1 ${
              filter === t.key ? 'bg-white shadow text-blue-600' : 'text-gray-500'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Accounts list */}
      {filtered.length === 0 ? (
        <div className="text-center mt-16">
          <CreditCard size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No credit accounts</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a: any) => (
            <button
              key={a.id}
              onClick={() => openAccount(a)}
              className="bg-white rounded-xl p-4 shadow-sm w-full text-left flex items-center justify-between"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-800">{a.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadge(a.type)}`}>
                    {a.type}
                  </span>
                </div>
                {a.phone && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Phone size={12} />
                    <span>{a.phone}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 ml-3">
                <p className={`text-base font-bold ${Number(a.outstanding_balance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmt(a.outstanding_balance)}
                </p>
                <ChevronRight size={18} className="text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
