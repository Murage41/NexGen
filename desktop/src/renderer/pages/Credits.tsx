import { useState, useEffect } from 'react';
import { getCredits, createCredit, getCredit, addCreditPayment } from '../services/api';
import { Plus, CreditCard, X, Eye, Banknote } from 'lucide-react';

export default function Credits() {
  const [credits, setCredits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedCredit, setSelectedCredit] = useState<any>(null);
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', amount: '', description: '' });
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'cash', payment_date: '', notes: '' });

  useEffect(() => {
    loadCredits();
  }, []);

  async function loadCredits() {
    try {
      const res = await getCredits();
      setCredits(res.data.data);
    } catch (err) {
      console.error('Failed to load credits:', err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm({ customer_name: '', customer_phone: '', amount: '', description: '' });
    setShowCreateModal(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      customer_name: form.customer_name,
      customer_phone: form.customer_phone || null,
      amount: parseFloat(form.amount),
      description: form.description || null,
    };
    try {
      await createCredit(payload);
      setShowCreateModal(false);
      loadCredits();
    } catch (err: any) {
      console.error('Failed to create credit:', err);
      alert(err.response?.data?.error || 'Failed to create credit');
    }
  }

  async function viewDetail(id: number) {
    try {
      const res = await getCredit(id);
      setSelectedCredit(res.data.data);
      setShowDetailModal(true);
    } catch (err) {
      console.error('Failed to load credit detail:', err);
    }
  }

  function openPayment(credit: any) {
    setSelectedCredit(credit);
    setPaymentForm({
      amount: '',
      payment_method: 'cash',
      payment_date: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setShowPaymentModal(true);
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCredit) return;
    const payload = {
      amount: parseFloat(paymentForm.amount),
      payment_method: paymentForm.payment_method,
      date: paymentForm.payment_date,
      notes: paymentForm.notes || null,
    };
    try {
      await addCreditPayment(selectedCredit.id, payload);
      setShowPaymentModal(false);
      loadCredits();
    } catch (err: any) {
      console.error('Failed to add payment:', err);
      alert(err.response?.data?.error || 'Failed to add payment');
    }
  }

  const formatKES = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  function statusBadge(status: string) {
    switch (status) {
      case 'outstanding':
        return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">Outstanding</span>;
      case 'partial':
        return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">Partial</span>;
      case 'paid':
        return <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Paid</span>;
      default:
        return <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">{status}</span>;
    }
  }

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <CreditCard size={24} /> Credits
        </h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={18} /> New Credit
        </button>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">New Credit</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  value={form.customer_name}
                  onChange={e => setForm({ ...form, customer_name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  placeholder="Customer name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer Phone</label>
                <input
                  type="text"
                  value={form.customer_phone}
                  onChange={e => setForm({ ...form, customer_phone: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  placeholder="07XX XXX XXX"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KES) *</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2"
                  rows={2}
                  placeholder="Optional details"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedCredit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Credit Details</h2>
              <button onClick={() => setShowDetailModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 mb-4">
              <div className="flex justify-between">
                <span className="text-gray-500">Customer:</span>
                <span className="font-medium">{selectedCredit.customer_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Phone:</span>
                <span>{selectedCredit.customer_phone || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount:</span>
                <span className="font-medium">{formatKES(selectedCredit.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Paid:</span>
                <span className="font-medium text-green-600">{formatKES(selectedCredit.total_paid || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Balance:</span>
                <span className="font-medium text-red-600">{formatKES(selectedCredit.balance || selectedCredit.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Status:</span>
                {statusBadge(selectedCredit.status)}
              </div>
            </div>
            {selectedCredit.payments && selectedCredit.payments.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Payment History</h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-2 text-gray-600">Date</th>
                        <th className="text-right p-2 text-gray-600">Amount</th>
                        <th className="text-left p-2 text-gray-600">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCredit.payments.map((p: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{new Date(p.payment_date).toLocaleDateString('en-KE')}</td>
                          <td className="p-2 text-right font-medium text-green-600">{formatKES(p.amount)}</td>
                          <td className="p-2 text-gray-500">{p.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowDetailModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedCredit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Record Payment</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {selectedCredit.customer_name} - Balance: {formatKES(selectedCredit.balance || selectedCredit.amount)}
            </p>
            <form onSubmit={handlePayment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Amount (KES) *</label>
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

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium text-gray-600">#</th>
              <th className="text-left p-3 font-medium text-gray-600">Customer</th>
              <th className="text-left p-3 font-medium text-gray-600">Phone</th>
              <th className="text-right p-3 font-medium text-gray-600">Amount</th>
              <th className="text-right p-3 font-medium text-gray-600">Paid</th>
              <th className="text-right p-3 font-medium text-gray-600">Balance</th>
              <th className="text-left p-3 font-medium text-gray-600">Status</th>
              <th className="text-left p-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {credits.map((credit: any) => (
              <tr key={credit.id} className="border-t hover:bg-gray-50">
                <td className="p-3 text-gray-500">{credit.id}</td>
                <td className="p-3 font-medium">{credit.customer_name}</td>
                <td className="p-3 text-gray-600">{credit.customer_phone || '-'}</td>
                <td className="p-3 text-right">{formatKES(credit.amount)}</td>
                <td className="p-3 text-right text-green-600">{formatKES(credit.total_paid || 0)}</td>
                <td className="p-3 text-right font-medium text-red-600">{formatKES(credit.balance || credit.amount)}</td>
                <td className="p-3">{statusBadge(credit.status)}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => viewDetail(credit.id)} className="text-blue-600 hover:text-blue-800" title="View Details">
                      <Eye size={16} />
                    </button>
                    {credit.status !== 'paid' && (
                      <button onClick={() => openPayment(credit)} className="text-green-600 hover:text-green-800" title="Record Payment">
                        <Banknote size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {credits.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-gray-400">No credits recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
