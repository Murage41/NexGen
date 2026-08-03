import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getShift, closeShift, getStaffDebts, repayDebt, getShiftTankSummary, addShiftCreditReceipt, getCreditAccounts, updateShiftReview, getShiftNeighbors } from '../services/api';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import { AlertTriangle, Lock, Edit3, X, DollarSign, CreditCard, Droplets, Plus, CheckCircle, Flag, ShieldCheck, Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { clearShiftDraft, hasPendingShiftDraft } from '../utils/shiftDraft';

function compensationComponentLabel(component: any, schedule: string) {
  if (component.component_type === 'fixed_per_shift') return `KES ${Number(component.amount || 0).toLocaleString('en-KE')} per shift`;
  if (component.component_type === 'fixed_periodic') return `KES ${Number(component.amount || 0).toLocaleString('en-KE')} per ${schedule}`;
  if (component.component_type === 'sales_percentage') return `${Number(component.rate || 0)}% of ${component.fuel_type || 'all fuel'} sales`;
  return `KES ${Number(component.rate || 0).toLocaleString('en-KE')} per ${component.fuel_type || 'all fuel'} litre`;
}

export default function ShiftDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const [shift, setShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeReview, setCloseReview] = useState({ readings: false, collections: false, entries: false });
  const [varianceReason, setVarianceReason] = useState('');
  const [reviewAction, setReviewAction] = useState<'reviewed' | 'flagged' | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [neighbors, setNeighbors] = useState<{ previous: any | null; next: any | null }>({ previous: null, next: null });
  const [deductOption, setDeductOption] = useState<'full' | 'partial' | 'none'>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closing, setClosing] = useState(false);

  // Debt repay state
  const [debts, setDebts] = useState<any[]>([]);
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [repayAmount, setRepayAmount] = useState('');
  const [repaying, setRepaying] = useState(false);
  const [tankSummary, setTankSummary] = useState<any[]>([]);
  const [wagePaid, setWagePaid] = useState('');
  // Credit receipt state
  const [creditReceipts, setCreditReceipts] = useState<any[]>([]);
  const [creditAccounts, setCreditAccounts] = useState<any[]>([]);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptForm, setReceiptForm] = useState({ account_id: '', amount: '', payment_method: 'cash', notes: '' });
  const [collectingReceipt, setCollectingReceipt] = useState(false);

  useEffect(() => { loadShift(); loadCreditAccounts(); }, [id]);

  useEffect(() => {
    const params = Object.fromEntries(new URLSearchParams(location.search));
    getShiftNeighbors(parseInt(id!), params)
      .then((response) => setNeighbors(response.data.data || { previous: null, next: null }))
      .catch(() => setNeighbors({ previous: null, next: null }));
  }, [id, location.search]);

  async function loadCreditAccounts() {
    try {
      const res = await getCreditAccounts({ billing_mode: 'money' });
      const rows = res.data.data || res.data || [];
      setCreditAccounts(rows.filter((a: any) =>
        a.type === 'customer' && Number(a.outstanding_balance ?? a.balance ?? 0) > 0
      ));
    } catch { setCreditAccounts([]); }
  }

  async function loadShift() {
    try {
      const res = await getShift(parseInt(id!));
      const d = res.data.data;
      setShift(d);
      setCreditReceipts(d.credit_receipts || []);
      setWagePaid(String(d.default_direct_wage_payment || 0));
      // Use outstanding_debts from shift response, or fetch separately
      if (d.outstanding_debts) {
        setDebts(d.outstanding_debts);
      } else if (d.employee_id) {
        try {
          const debtRes = await getStaffDebts(d.employee_id);
          setDebts(debtRes.data.data?.debts || []);
        } catch { setDebts([]); }
      }
      // Load tank stock summary
      try {
        const tankRes = await getShiftTankSummary(parseInt(id!));
        setTankSummary(tankRes.data.data?.tanks || []);
      } catch { setTankSummary([]); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleClose() {
    if (!closeReviewComplete) {
      alert('Complete the reconciliation review and record a variance reason when required.');
      return;
    }
    if (hasPendingShiftDraft(id!)) {
      alert('Readings or collections are still waiting to sync. Return to Record Shift and use Sync Now before closing.');
      return;
    }
    setClosing(true);
    try {
      let deduct_amount: number | null = null;
      if (closeVariance < 0 && shift.compensation_plan?.pay_schedule === 'daily') {
        const deficit = Math.abs(closeVariance);
        const wage = enteredWagePaid;
        if (deductOption === 'full') {
          deduct_amount = Math.min(deficit, wage);
        } else if (deductOption === 'partial') {
          const amt = parseFloat(partialAmount) || 0;
          deduct_amount = Math.min(amt, wage, deficit);
        } else {
          deduct_amount = 0;
        }
      }
      const res = await closeShift(parseInt(id!), {
        notes: closeNotes || undefined,
        deduct_amount,
        wage_paid: parseFloat(wagePaid) || 0,
        variance_reason: varianceReason.trim() || undefined,
        reconciliation: {
          readings_reviewed: true,
          collections_reviewed: true,
          entries_reviewed: true,
        },
      });
      clearShiftDraft(id!);
      setShowCloseModal(false);
      if (res.data?.warnings?.length) {
        alert('Shift closed with warnings:\n\n' + res.data.warnings.join('\n'));
      }
      await loadShift();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to close shift');
    } finally { setClosing(false); }
  }

  function openCloseReview() {
    setCloseReview({ readings: false, collections: false, entries: false });
    setVarianceReason('');
    setShowCloseModal(true);
  }

  async function saveShiftReview(status: 'reviewed' | 'flagged', reviewNote?: string) {
    setReviewSaving(true);
    try {
      await updateShiftReview(parseInt(id!), {
        review_status: status,
        notes: reviewNote?.trim() || undefined,
      });
      setReviewAction(null);
      setReviewNotes('');
      await loadShift();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Unable to update the shift review.');
    } finally {
      setReviewSaving(false);
    }
  }

  function openReviewAction(status: 'reviewed' | 'flagged') {
    setReviewNotes('');
    setReviewAction(status);
  }

  async function handleRepayDebt() {
    const amt = parseFloat(repayAmount);
    if (!amt || amt <= 0) return;
    setRepaying(true);
    try {
      await repayDebt(parseInt(id!), amt);
      setShowDebtModal(false);
      setRepayAmount('');
      await loadShift();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to repay debt');
    } finally { setRepaying(false); }
  }

  async function handleCollectReceipt() {
    const amount = parseFloat(receiptForm.amount);
    if (!receiptForm.account_id || !amount || amount <= 0) return;
    setCollectingReceipt(true);
    try {
      await addShiftCreditReceipt(parseInt(id!), {
        account_id: parseInt(receiptForm.account_id),
        amount,
        payment_method: receiptForm.payment_method,
        notes: receiptForm.notes || undefined,
      });
      setShowReceiptModal(false);
      setReceiptForm({ account_id: '', amount: '', payment_method: 'cash', notes: '' });
      await loadShift();
    } catch (err: any) {
      if (err?.code === 'ECONNABORTED') {
        await loadShift();
      }
      alert(err?.code === 'ECONNABORTED'
        ? 'Payment request timed out. The shift has been refreshed; check the debt payments list before trying again.'
        : err.response?.data?.error || 'Failed to record payment');
    } finally {
      setCollectingReceipt(false);
    }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;
  if (!shift) return <div className="text-center text-red-500 mt-20">Shift not found</div>;

  const fmt = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isOpen = shift.status === 'open';
  const isCancelled = shift.status === 'cancelled';
  const expected = shift.expected_sales || 0;
  const totalCash = shift.total_cash || 0;
  const totalMpesa = shift.total_mpesa || 0;
  const totalCredits = shift.total_credits || 0;
  const totalInvoiceConsumption = shift.total_invoice_consumption || 0;
  const totalExpenses = shift.total_expenses || 0;
  const totalPayrollPayments = Number(shift.total_payroll_payments || 0);
  const employeeWage = Number(shift.employee_wage || 0);
  const enteredWagePaid = Math.max(0, Number(wagePaid) || 0);
  const compensationPlan = shift.compensation_plan;
  const grossShiftEarnings = Number(isOpen ? shift.gross_earning_preview : shift.total_gross_earnings) || 0;
  const earningBreakdown = (isOpen ? shift.earning_preview : shift.earnings) || [];
  const directDrawerPayment = isOpen ? enteredWagePaid : Number(shift.wage_paid ?? shift.employee_wage ?? 0);

  const totalDebt = debts.reduce((s: number, d: any) => s + (d.balance || 0), 0);
  const totalCreditReceipts = Number(
    shift.total_credit_receipts ?? creditReceipts.reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
  );
  const creditReceiptsCash = Number(
    shift.credit_receipts_cash ?? creditReceipts
      .filter((r: any) => (r.payment_method || 'cash') !== 'mpesa')
      .reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
  );
  const creditReceiptsMpesa = Number(
    shift.credit_receipts_mpesa ?? creditReceipts
      .filter((r: any) => r.payment_method === 'mpesa')
      .reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
  );
  const salesCash = Number(shift.sales_cash ?? (totalCash - creditReceiptsCash));
  const salesMpesa = Number(shift.sales_mpesa ?? (totalMpesa - creditReceiptsMpesa));
  const drawerCash = Number(shift.drawer_cash ?? totalCash);
  const drawerMpesa = Number(shift.drawer_mpesa ?? totalMpesa);
  const drawerTotal = Number(shift.drawer_total ?? (drawerCash + drawerMpesa));
  const expectedShiftTotal = Number(shift.expected_shift_total ?? (expected + totalCreditReceipts));
  const totalAccounted = Number(
    shift.total_accounted
      ?? (drawerTotal + totalCredits + totalInvoiceConsumption + totalExpenses + employeeWage + totalPayrollPayments),
  );
  const variance = Number(shift.variance ?? (totalAccounted - expectedShiftTotal));
  const closeTotalAccounted = drawerTotal
    + totalCredits
    + totalInvoiceConsumption
    + totalExpenses
    + enteredWagePaid
    + totalPayrollPayments;
  const closeVariance = Math.round((closeTotalAccounted - expectedShiftTotal) * 100) / 100;
  const requiresVarianceReason = Math.abs(closeVariance) >= 0.01;
  const closeReviewComplete = closeReview.readings
    && closeReview.collections
    && closeReview.entries
    && (!requiresVarianceReason || varianceReason.trim().length >= 3);

  return (
    <div className="pb-6">
      <PageHeader title={`Shift #${shift.id}`} back onBack={() => navigate(`/shifts${location.search}`)} />
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button type="button" onClick={() => neighbors.previous && navigate(`/shifts/${neighbors.previous.id}${location.search}`)} disabled={!neighbors.previous} className="flex items-center justify-center gap-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 disabled:opacity-40">
          <ChevronLeft size={16} /> Previous
        </button>
        <button type="button" onClick={() => neighbors.next && navigate(`/shifts/${neighbors.next.id}${location.search}`)} disabled={!neighbors.next} className="flex items-center justify-center gap-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 disabled:opacity-40">
          Next <ChevronRight size={16} />
        </button>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-800">{shift.employee_name}</p>
          <p className="text-xs text-gray-400">
            {shift.shift_date || new Date(shift.start_time).toLocaleDateString('en-KE')}
            {' · '}{new Date(shift.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {isOpen ? 'Open' : isCancelled ? 'Cancelled' : 'Closed'}
        </span>
      </div>

      {isCancelled && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <p className="text-sm font-semibold text-red-800">Cancelled shift</p>
          <p className="text-sm text-red-700 mt-1">{shift.cancellation_reason || 'No cancellation reason recorded.'}</p>
        </div>
      )}

      {!isOpen && !isCancelled && shift.review && (
        <section className="bg-white border border-gray-200 p-4 mb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-800 flex items-center gap-1.5"><ShieldCheck size={16} className="text-blue-600" /> Administrative Review</p>
              <p className="text-xs text-gray-400 mt-1">Separate from the locked financial close.</p>
            </div>
            <span className={`shrink-0 px-2 py-1 text-[11px] font-semibold ${shift.review.review_status === 'flagged' ? 'bg-red-50 text-red-700' : shift.review.review_status === 'reviewed' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {shift.review.review_status === 'flagged' ? 'Flagged' : shift.review.review_status === 'reviewed' ? 'Reviewed' : 'Pending review'}
            </span>
          </div>
          {shift.review.reviewed_at && (
            <p className="text-xs text-gray-400 mt-3">
              {new Date(shift.review.reviewed_at).toLocaleString('en-KE')} · {shift.review.reviewed_by_name || shift.review.reviewed_by_role || 'admin'}
            </p>
          )}
          {shift.review.notes && <p className="mt-2 text-sm text-gray-700 border-l-2 border-gray-300 pl-3">{shift.review.notes}</p>}
          {isAdmin && (
            <div className="grid grid-cols-1 gap-2 mt-3">
              {shift.review.review_status === 'pending_review' && (
                <button type="button" onClick={() => saveShiftReview('reviewed')} disabled={reviewSaving} className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  <CheckCircle size={16} /> Mark Reviewed
                </button>
              )}
              {shift.review.review_status === 'flagged' && (
                <button type="button" onClick={() => openReviewAction('reviewed')} className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg">
                  <CheckCircle size={16} /> Resolve & Mark Reviewed
                </button>
              )}
              {shift.review.review_status !== 'flagged' && (
                <button type="button" onClick={() => openReviewAction('flagged')} className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-red-300 text-red-700 text-sm font-medium rounded-lg">
                  <Flag size={16} /> Flag for Follow-up
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {!isOpen && shift.close_reconciliation && (
        <div className="bg-white border border-gray-200 p-4 mb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-800 flex items-center gap-1"><CheckCircle size={15} className="text-green-600" /> Close Reconciliation</p>
              <p className="text-xs text-gray-400 mt-1">{new Date(shift.close_reconciliation.approved_at).toLocaleString('en-KE')}</p>
            </div>
            <span className={`capitalize text-xs font-semibold ${Number(shift.close_reconciliation.variance) < 0 ? 'text-red-600' : Number(shift.close_reconciliation.variance) > 0 ? 'text-amber-700' : 'text-green-700'}`}>
              {shift.close_reconciliation.variance_type} · {fmt(Number(shift.close_reconciliation.variance))}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px] text-gray-500">
            <span>Readings reviewed</span>
            <span>Collections reviewed</span>
            <span>Entries reviewed</span>
          </div>
          {shift.close_reconciliation.variance_reason && (
            <p className="mt-3 border-t pt-2 text-sm text-gray-700">{shift.close_reconciliation.variance_reason}</p>
          )}
        </div>
      )}

      {shift.activity_timeline?.length > 0 && (
        <section className="bg-white border border-gray-200 p-4 mb-3">
          <p className="font-semibold text-gray-800 flex items-center gap-1.5"><Activity size={16} className="text-blue-600" /> Activity Timeline</p>
          <div className="mt-4 border-l border-gray-200 ml-2 space-y-4">
            {shift.activity_timeline.map((event: any) => (
              <div key={event.id} className="relative pl-4">
                <span className={`absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-white ${event.type === 'shift_flagged' || event.type === 'shift_cancelled' ? 'bg-red-500' : event.type === 'shift_reviewed' || event.type === 'shift_closed' ? 'bg-green-500' : 'bg-blue-500'}`} />
                <p className="text-sm font-medium text-gray-800">{event.title}</p>
                {event.description && <p className="text-xs text-gray-500 mt-0.5">{event.description}</p>}
                <div className="flex items-end justify-between gap-2 mt-1">
                  <div>
                    <p className="text-[11px] text-gray-400">
                      {event.precision === 'date'
                        ? new Date(event.occurred_at).toLocaleDateString('en-KE')
                        : new Date(event.occurred_at).toLocaleString('en-KE')}
                    </p>
                    {event.precision === 'date' && <p className="text-[10px] text-gray-400">Exact time unavailable</p>}
                  </div>
                  {event.amount !== undefined && (
                    <p className="text-xs font-semibold text-gray-700 text-right">
                      {event.type === 'shift_closed' ? 'Variance ' : ''}{fmt(Number(event.amount))}
                      {event.litres !== undefined ? ` · ${Number(event.litres).toLocaleString('en-KE')} L` : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Outstanding Debt Banner (admin only) */}
      {isAdmin && isOpen && totalDebt > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-orange-600" />
            <div>
              <p className="text-sm font-semibold text-orange-800">Outstanding Debt</p>
              <p className="text-xs text-orange-600">{debts.length} unpaid shift deficit{debts.length > 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-orange-700">{fmt(totalDebt)}</p>
            {compensationPlan?.pay_schedule === 'daily' ? (
              <button onClick={() => { setRepayAmount(String(Math.min(totalDebt, employeeWage))); setShowDebtModal(true); }}
                className="text-xs text-orange-600 underline mt-0.5">Repay from Wage</button>
            ) : (
              <p className="text-xs text-orange-700 mt-0.5">Recover through payroll</p>
            )}
          </div>
        </div>
      )}

      {/* Accountability Card */}
      <div className={`rounded-xl p-4 mb-4 ${variance >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <p className="text-[10px] text-gray-500 uppercase font-semibold mb-2">Accountability</p>

        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">Expected (Pump Sales)</span>
          <span className="font-bold">{fmt(expected)}</span>
        </div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">Expected Shift Total</span>
          <span className="font-bold">{fmt(expectedShiftTotal)}</span>
        </div>

        <div className="border-t border-gray-200 pt-1 mt-1 space-y-0.5 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Cash Received</span>
            <span>{fmt(totalCash)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">M-Pesa Received</span>
            <span>{fmt(totalMpesa)}</span>
          </div>
          {shift.collections && Number(shift.collections.mpesa_fee) > 0 && (
            <div className="flex justify-between text-xs text-gray-400 -mt-0.5">
              <span className="pl-3">↳ fee {fmt(Number(shift.collections.mpesa_fee))} · net {fmt(Number(shift.collections.mpesa_net))}</span>
              <span></span>
            </div>
          )}
          {totalCreditReceipts > 0 && (
            <div className="rounded-lg border border-green-100 bg-white/70 p-2 text-xs space-y-1">
              <div className="flex justify-between text-green-700">
                <span>Debt receipts in shift</span>
                <span>{fmt(totalCreditReceipts)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Included in received total</span>
                <span>{fmt(drawerTotal)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Sales cash after debt</span>
                <span>{fmt(salesCash)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Sales M-Pesa after debt</span>
                <span>{fmt(salesMpesa)}</span>
              </div>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-400">Credits</span>
            <span>{fmt(totalCredits)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Expenses</span>
            <span>{fmt(totalExpenses)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Wage</span>
            <span>{fmt(employeeWage)}</span>
          </div>
          {totalPayrollPayments > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-400">Payroll from drawer</span>
              <span>{fmt(totalPayrollPayments)}</span>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 pt-1 mt-1 flex justify-between text-sm">
          <span className="font-semibold text-gray-700">Shift Accounted</span>
          <span className="font-bold">{fmt(totalAccounted)}</span>
        </div>

        <div className="border-t border-gray-300 pt-2 mt-2 flex justify-between items-center">
          <span className="text-xs text-gray-500 uppercase font-semibold">Variance</span>
          <span className={`text-lg font-bold ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {variance >= 0 ? '+' : ''}{fmt(variance)}
          </span>
        </div>
        {variance < 0 && (
          <div className="flex items-center gap-1 justify-end mt-0.5">
            <AlertTriangle size={12} className="text-red-500" />
            <span className="text-xs text-red-500">Shortage</span>
          </div>
        )}
      </div>

      {/* Tank Stock Movement */}
      {tankSummary.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
          <p className="font-semibold text-gray-700 mb-2 flex items-center gap-1"><Droplets size={14} /> Tank Stock</p>
          <div className="space-y-2">
            {tankSummary.map((t: any) => (
              <div key={t.tank_id} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{t.tank_label}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${t.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{t.fuel_type}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-400">Opening</span><span>{Number(t.opening_stock_litres || 0).toFixed(1)} L</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Sales</span><span className="text-red-600">-{Number(t.sales_litres || 0).toFixed(1)} L</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Deliveries</span><span className="text-green-600">{Number(t.deliveries_litres || 0) > 0 ? `+${Number(t.deliveries_litres).toFixed(1)}` : '0.0'} L</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Closing</span><span className="font-semibold">{Number(t.closing_stock_litres || 0).toFixed(1)} L</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wage & Deduction */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <p className="font-semibold text-gray-700">Compensation</p>
            <p className="text-xs text-gray-400">{compensationPlan?.name || 'Plan unavailable'} · v{compensationPlan?.version || '?'}</p>
          </div>
          <span className="capitalize text-xs font-medium text-blue-700">{compensationPlan?.pay_schedule || 'unknown'}</span>
        </div>
        <div className="text-sm space-y-1.5">
          {(compensationPlan?.components || []).map((component: any) => (
            <div key={component.id || component.component_type} className="flex justify-between text-xs text-gray-500 gap-3">
              <span className="capitalize">{String(component.component_type).replace(/_/g, ' ')}</span>
              <span className="text-right">{compensationComponentLabel(component, compensationPlan.pay_schedule)}</span>
            </div>
          ))}
          <div className="flex justify-between">
            <span className="text-gray-600">Earned by this shift</span>
            <span className="font-semibold">{fmt(grossShiftEarnings)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">{isOpen ? 'Planned drawer payment' : 'Paid from shift drawer'}</span>
            <span className="font-medium">{fmt(directDrawerPayment)}</span>
          </div>
          {compensationPlan?.pay_schedule !== 'daily' && (
            <p className="border-t pt-2 text-xs text-gray-500">
              Shift earnings accrue to {compensationPlan?.pay_schedule} payroll. Periodic salary is added by the payroll run.
            </p>
          )}
          {earningBreakdown.map((earning: any) => (
            <div key={earning.id || `${earning.component_id}-${earning.description}`} className="flex justify-between text-xs text-gray-500 gap-3">
              <span>{earning.description}</span>
              <span>{fmt(Number(earning.gross_amount || 0))}</span>
            </div>
          ))}
          {shift.wage_deduction && (
            <>
              <div className="flex justify-between text-red-600">
                <span className="text-xs">{shift.wage_deduction.reason}</span>
                <span className="font-medium">-{fmt(shift.wage_deduction.deduction_amount)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold">
                <span className="text-gray-700">Final Wage</span>
                <span>{fmt(shift.wage_deduction.final_wage)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Readings */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
        <p className="font-semibold text-gray-700 mb-2">Pump Readings</p>
        {shift.readings?.map((r: any) => (
          <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
            <div>
              <p className="text-sm font-medium">{r.pump_label} {r.nozzle_label}</p>
              <p className="text-xs text-gray-400">{r.fuel_type} · {parseFloat(r.litres_sold).toFixed(1)} L</p>
            </div>
            <p className="font-semibold text-sm">{fmt(parseFloat(r.amount_sold) || 0)}</p>
          </div>
        ))}
        {(!shift.readings || shift.readings.length === 0) && <p className="text-sm text-gray-400">No readings</p>}
      </div>

      {/* Collections */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
        <p className="font-semibold text-gray-700 mb-2">Sales Collections</p>
        {shift.collections ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Cash Received</span><span>{fmt(shift.collections.cash_amount)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">M-Pesa Received</span><span>{fmt(shift.collections.mpesa_amount)}</span></div>
            {Number(shift.collections.mpesa_fee) > 0 && (
              <div className="flex justify-between text-xs text-gray-400">
                <span className="pl-3">↳ fee {fmt(Number(shift.collections.mpesa_fee))} · net {fmt(Number(shift.collections.mpesa_net))}</span>
                <span></span>
              </div>
            )}
            {totalCreditReceipts > 0 && (
              <>
                <div className="flex justify-between text-xs text-green-700">
                  <span>Debt receipts in shift</span><span>{fmt(totalCreditReceipts)}</span>
                </div>
                <div className="flex justify-between text-xs font-medium text-gray-700">
                  <span>Included in received total</span><span>{fmt(drawerTotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Sales cash after debt</span><span>{fmt(salesCash)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Sales M-Pesa after debt</span><span>{fmt(salesMpesa)}</span>
                </div>
              </>
            )}
          </div>
        ) : <p className="text-sm text-gray-400">Not recorded yet</p>}
      </div>

      {/* Credits */}
      {shift.shift_credits?.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
          <p className="font-semibold text-gray-700 mb-2">Credits Given</p>
          {shift.shift_credits.map((c: any) => (
            <div key={c.id} className="flex justify-between py-1 text-sm">
              <div>
                <span className="text-gray-600 font-medium">{c.customer_name}</span>
                {c.description && <span className="text-gray-400 ml-1 text-xs">({c.description})</span>}
              </div>
              <span>{fmt(c.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 mt-1 text-sm font-bold">
            <span>Total Credits</span>
            <span>{fmt(totalCredits)}</span>
          </div>
        </div>
      )}

      {/* Phase 3B: Invoice consumption (litre ledger for invoice-mode customers) */}
      {shift.invoice_consumption?.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-3 border-l-4 border-purple-400">
          <p className="font-semibold text-gray-700 mb-2">Invoice Consumption (litres)</p>
          {shift.invoice_consumption.map((c: any) => (
            <div key={c.id} className="flex justify-between py-1 text-sm">
              <div>
                <span className="text-gray-600 font-medium">{c.account_name}</span>
                <span className="text-gray-400 ml-1 text-xs">
                  ({Number(c.litres).toLocaleString()} L {c.fuel_type} @ {fmt(Number(c.retail_price_at_time))})
                </span>
              </div>
              <span>{fmt(Number(c.retail_amount))}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 mt-1 text-sm font-bold">
            <span>Total (at retail)</span>
            <span>{fmt(totalInvoiceConsumption)}</span>
          </div>
        </div>
      )}

      {/* Expenses */}
      {shift.expenses?.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
          <p className="font-semibold text-gray-700 mb-2">Shift Expenses</p>
          {shift.expenses.map((e: any) => (
            <div key={e.id} className="flex justify-between py-1 text-sm">
              <div>
                <span className="text-gray-600">{e.category}</span>
                {e.description && <span className="text-gray-400 ml-1 text-xs">({e.description})</span>}
              </div>
              <span>{fmt(e.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 mt-1 text-sm font-bold">
            <span>Total Expenses</span>
            <span>{fmt(totalExpenses)}</span>
          </div>
        </div>
      )}

      {/* Staff Debts Detail (admin only, when debts exist) */}
      {isAdmin && debts.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
          <p className="font-semibold text-gray-700 mb-2">Staff Debt History</p>
          {debts.map((d: any) => (
            <div key={d.id} className="flex justify-between py-1.5 border-b border-gray-100 last:border-0 text-sm">
              <div>
                <p className="text-gray-600">Shift #{d.shift_id}</p>
                <p className="text-xs text-gray-400">
                  Deficit: {fmt(d.original_deficit)} · Deducted: {fmt(d.deducted_from_wage)}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-semibold ${d.status === 'cleared' ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(d.balance)}
                </p>
                <p className={`text-xs ${d.status === 'cleared' ? 'text-green-500' : 'text-orange-500'}`}>
                  {d.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Debt Collections */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-semibold text-gray-700">Debt Collections</p>
          {isOpen && (
            <button onClick={() => setShowReceiptModal(true)}
              className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
              <Plus size={13} /> Collect
            </button>
          )}
        </div>
        {creditReceipts.length > 0 ? (
          <div className="space-y-2">
            {creditReceipts.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-700">{r.account_name}</p>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${r.payment_method === 'mpesa' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {r.payment_method}
                  </span>
                </div>
                <p className="font-semibold text-sm">{fmt(Number(r.amount))}</p>
              </div>
            ))}
            <div className="flex justify-between pt-1 text-sm font-bold border-t">
              <span>Total</span>
              <span className="text-green-700">{fmt(totalCreditReceipts)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No debt collections this shift</p>
        )}
      </div>

      {/* Actions */}
      {isOpen && (
        <div className="space-y-2 mt-4">
          <button onClick={() => navigate(`/shifts/${id}/record`)}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2">
            <Edit3 size={18} /> Record Readings & Collections
          </button>
          {isAdmin && (
            <button onClick={openCloseReview}
              className="w-full bg-red-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2">
              <Lock size={18} /> Close & Lock Shift
            </button>
          )}
        </div>
      )}

      {reviewAction && (
        <div className="mobile-modal-overlay flex items-end justify-center">
          <div className="mobile-bottom-sheet max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                {reviewAction === 'flagged' ? <Flag size={19} className="text-red-600" /> : <CheckCircle size={19} className="text-green-600" />}
                {reviewAction === 'flagged' ? 'Flag Shift' : 'Resolve Flag'}
              </h3>
              <button type="button" onClick={() => setReviewAction(null)} className="p-1 text-gray-400"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {reviewAction === 'flagged'
                ? 'Record the discrepancy or follow-up required. The financial close remains unchanged.'
                : 'Record how the flagged issue was resolved.'}
            </p>
            <label className="text-sm font-medium text-gray-700 block mb-4">
              {reviewAction === 'flagged' ? 'Flag reason' : 'Resolution note'}
              <textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} rows={4} className="mt-1 w-full border border-gray-300 rounded-lg p-3" />
            </label>
            <button type="button" onClick={() => saveShiftReview(reviewAction, reviewNotes)} disabled={reviewSaving || reviewNotes.trim().length < 3} className={`w-full py-3 text-white font-semibold rounded-xl disabled:opacity-50 ${reviewAction === 'flagged' ? 'bg-red-600' : 'bg-green-600'}`}>
              {reviewSaving ? 'Saving...' : reviewAction === 'flagged' ? 'Flag Shift' : 'Mark Reviewed'}
            </button>
          </div>
        </div>
      )}

      {/* Close Shift Modal */}
      {showCloseModal && (
        <div className="mobile-modal-overlay flex items-end justify-center">
          <div className="mobile-bottom-sheet max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">Close Shift #{shift.id}</h3>
              <button onClick={() => setShowCloseModal(false)} className="p-1 text-gray-400">
                <X size={20} />
              </button>
            </div>

            <div className="mb-4 border border-blue-200 bg-blue-50 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-800">{compensationPlan?.name || 'Compensation plan unavailable'}</p>
                  <p className="text-xs text-gray-500">Effective {compensationPlan?.effective_from} · Plan v{compensationPlan?.version}</p>
                </div>
                <span className="capitalize text-xs font-medium text-blue-700">{compensationPlan?.pay_schedule}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-blue-100 pt-2">
                <span className="text-gray-600">Earned by this shift</span>
                <span className="font-semibold">{fmt(grossShiftEarnings)}</span>
              </div>
            </div>

            {/* Wages paid input */}
            {shift.compensation_plan?.pay_schedule === 'daily' ? (
              <div className="mb-4">
                <label className="text-sm font-medium text-gray-700 mb-1 block">Direct Wage Paid From This Shift (KES)</label>
                <input type="number" step="0.01" min="0" value={wagePaid}
                  onChange={e => setWagePaid(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-3 text-base" />
              </div>
            ) : (
              <div className="mb-4 border-y border-gray-200 py-3 flex items-center justify-between">
                <span className="text-sm text-gray-600 capitalize">{shift.compensation_plan?.pay_schedule} payroll accrual</span>
                <span className="font-semibold text-gray-800">{fmt(Number(shift.gross_earning_preview || 0))}</span>
              </div>
            )}

            {/* Summary in modal */}
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Expected Sales</span>
                <span className="font-semibold">{fmt(expected)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Expected Shift Total</span>
                <span className="font-semibold">{fmt(expectedShiftTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Shift Accounted</span>
                <span className="font-semibold">{fmt(closeTotalAccounted)}</span>
              </div>
              {totalCreditReceipts > 0 && (
                <div className="flex justify-between text-xs text-green-700">
                  <span>Debt receipts included</span>
                  <span>{fmt(totalCreditReceipts)}</span>
                </div>
              )}
              <div className={`flex justify-between font-bold ${closeVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                <span>Variance</span>
                <span>{closeVariance >= 0 ? '+' : ''}{fmt(closeVariance)}</span>
              </div>
            </div>

            {/* Deduction options — only when deficit */}
            {closeVariance < 0 && shift.compensation_plan?.pay_schedule === 'daily' && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Deficit: {fmt(Math.abs(closeVariance))} - Paid from shift: {fmt(enteredWagePaid)}
                </p>

                {/* Option: Full deduct */}
                <label className="flex items-start gap-3 p-3 rounded-lg border mb-2 cursor-pointer"
                  style={{ borderColor: deductOption === 'full' ? '#2563eb' : '#e5e7eb', background: deductOption === 'full' ? '#eff6ff' : 'white' }}>
                  <input type="radio" name="deduct" checked={deductOption === 'full'} onChange={() => setDeductOption('full')} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Deduct Full</p>
                    <p className="text-xs text-gray-500">
                      Deduct {fmt(Math.min(Math.abs(closeVariance), enteredWagePaid))} from wage
                      {Math.abs(closeVariance) > enteredWagePaid && (
                        <span className="text-orange-600"> · {fmt(Math.abs(closeVariance) - enteredWagePaid)} carried as debt</span>
                      )}
                    </p>
                  </div>
                </label>

                {/* Option: Partial deduct */}
                <label className="flex items-start gap-3 p-3 rounded-lg border mb-2 cursor-pointer"
                  style={{ borderColor: deductOption === 'partial' ? '#2563eb' : '#e5e7eb', background: deductOption === 'partial' ? '#eff6ff' : 'white' }}>
                  <input type="radio" name="deduct" checked={deductOption === 'partial'} onChange={() => setDeductOption('partial')} className="mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Deduct Partial</p>
                    {deductOption === 'partial' && (
                      <div className="mt-2">
                        <input type="number" step="0.01" value={partialAmount}
                          onChange={e => setPartialAmount(e.target.value)}
                          placeholder={`Max ${Math.min(Math.abs(closeVariance), enteredWagePaid).toFixed(2)}`}
                          className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
                        {partialAmount && (
                          <p className="text-xs text-orange-600 mt-1">
                            {fmt(Math.abs(closeVariance) - Math.min(parseFloat(partialAmount) || 0, enteredWagePaid, Math.abs(closeVariance)))} carried as debt
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </label>

                {/* Option: Don't deduct */}
                <label className="flex items-start gap-3 p-3 rounded-lg border mb-2 cursor-pointer"
                  style={{ borderColor: deductOption === 'none' ? '#2563eb' : '#e5e7eb', background: deductOption === 'none' ? '#eff6ff' : 'white' }}>
                  <input type="radio" name="deduct" checked={deductOption === 'none'} onChange={() => setDeductOption('none')} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Don't Deduct</p>
                    <p className="text-xs text-orange-600">
                      Full {fmt(Math.abs(closeVariance))} carried as debt
                    </p>
                  </div>
                </label>
              </div>
            )}
            {closeVariance < 0 && shift.compensation_plan?.pay_schedule !== 'daily' && (
              <div className="mb-4 border border-red-200 bg-red-50 rounded-lg p-3">
                <p className="text-sm font-semibold text-red-800">Deficit: {fmt(Math.abs(closeVariance))}</p>
                <p className="text-xs text-red-600 mt-1">
                  Recorded as staff debt. Recovery is handled through payroll.
                </p>
              </div>
            )}

            <div className="mb-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">Reconciliation review</p>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={closeReview.readings} onChange={(event) => setCloseReview({ ...closeReview, readings: event.target.checked })} className="mt-0.5" />
                  <span>Pump closing readings match the physical displays.</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={closeReview.collections} onChange={(event) => setCloseReview({ ...closeReview, collections: event.target.checked })} className="mt-0.5" />
                  <span>Cash and M-Pesa totals match the counted cash and payment records.</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={closeReview.entries} onChange={(event) => setCloseReview({ ...closeReview, entries: event.target.checked })} className="mt-0.5" />
                  <span>Credits, invoice litres, debt receipts, expenses, and wage treatment have been reviewed.</span>
                </label>
              </div>
            </div>

            {requiresVarianceReason && (
              <div className="mb-4">
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  {closeVariance < 0 ? 'Deficit' : 'Surplus'} reason
                </label>
                <textarea value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} rows={2}
                  placeholder="Record the verified cause or follow-up action"
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm" />
              </div>
            )}

            {/* Notes */}
            <div className="mb-4">
              <label className="text-sm text-gray-600 mb-1 block">Notes (optional)</label>
              <input value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
                placeholder="e.g. Pump 2 had issues..."
                className="w-full border border-gray-300 rounded-lg p-3 text-sm" />
            </div>

            {/* Confirm */}
            <button onClick={handleClose} disabled={closing || !closeReviewComplete}
              className="w-full bg-red-600 text-white py-3 rounded-xl font-semibold disabled:opacity-50">
              {closing ? 'Closing...' : 'Confirm Close & Lock'}
            </button>
          </div>
        </div>
      )}

      {/* Collect Receipt Modal */}
      {showReceiptModal && (
        <div className="mobile-modal-overlay flex items-end justify-center">
          <div className="mobile-bottom-sheet max-w-lg rounded-t-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">Collect Debt Payment</h3>
              <button onClick={() => { setShowReceiptModal(false); setReceiptForm({ account_id: '', amount: '', payment_method: 'cash', notes: '' }); }}
                className="p-1 text-gray-400"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Record cash or M-Pesa received for an outstanding balance.</p>

            <div className="mb-3">
              <label className="text-sm font-medium text-gray-700 mb-1 block">Customer Account</label>
              <select value={receiptForm.account_id}
                onChange={e => setReceiptForm({ ...receiptForm, account_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-3 text-base bg-white">
                <option value="">Select account...</option>
                {creditAccounts.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (Bal: KES {Number(a.outstanding_balance ?? a.balance ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })})
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="text-sm font-medium text-gray-700 mb-1 block">Amount (KES)</label>
              <input type="number" step="0.01" value={receiptForm.amount}
                onChange={e => setReceiptForm({ ...receiptForm, amount: e.target.value })}
                placeholder="0.00" className="w-full border border-gray-300 rounded-lg p-3 text-base" />
            </div>

            <div className="mb-3">
              <label className="text-sm font-medium text-gray-700 mb-1 block">Payment Method</label>
              <div className="grid grid-cols-2 gap-2">
                {['cash', 'mpesa'].map(m => (
                  <button key={m} type="button"
                    onClick={() => setReceiptForm({ ...receiptForm, payment_method: m })}
                    className={`py-2.5 rounded-lg text-sm font-medium capitalize border ${receiptForm.payment_method === m ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                    {m === 'mpesa' ? 'M-Pesa' : 'Cash'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <label className="text-sm text-gray-600 mb-1 block">Notes (optional)</label>
              <input value={receiptForm.notes}
                onChange={e => setReceiptForm({ ...receiptForm, notes: e.target.value })}
                placeholder="e.g. Partial settlement"
                className="w-full border border-gray-300 rounded-lg p-3 text-sm" />
            </div>

            <button onClick={handleCollectReceipt}
              disabled={collectingReceipt || !receiptForm.account_id || !receiptForm.amount}
              className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold disabled:opacity-50">
              {collectingReceipt ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </div>
      )}

      {/* Debt Repay Modal */}
      {showDebtModal && (
        <div className="mobile-modal-overlay flex items-end justify-center">
          <div className="mobile-bottom-sheet max-w-lg rounded-t-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">Repay Staff Debt</h3>
              <button onClick={() => setShowDebtModal(false)} className="p-1 text-gray-400">
                <X size={20} />
              </button>
            </div>

            <div className="bg-orange-50 rounded-lg p-3 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Outstanding</span>
                <span className="font-bold text-orange-700">{fmt(totalDebt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Today's Wage</span>
                <span className="font-semibold">{fmt(employeeWage)}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm text-gray-600 mb-1 block">Amount to Deduct from Wage</label>
              <input type="number" step="0.01" value={repayAmount}
                onChange={e => setRepayAmount(e.target.value)}
                placeholder={`Max ${Math.min(totalDebt, employeeWage).toFixed(2)}`}
                className="w-full border border-gray-300 rounded-lg p-3 text-sm" />
              <p className="text-xs text-gray-400 mt-1">
                Clears oldest debts first. Max: {fmt(Math.min(totalDebt, employeeWage))}
              </p>
            </div>

            <button onClick={handleRepayDebt} disabled={repaying}
              className="w-full bg-orange-600 text-white py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
              <DollarSign size={18} />
              {repaying ? 'Processing...' : 'Confirm Repayment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
