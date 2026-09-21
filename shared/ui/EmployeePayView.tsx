import { Link } from 'react-router-dom';
import { ReasonDialog } from './ReasonDialog';
import { newOperationKey } from './operationKey';
import { useEffect, useRef, useState } from 'react';
import { PayrollStatement, kes } from './PayrollStatement';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';

const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

// Money owed back to an employee after a closed-shift correction reduced a
// shortage they had already repaid. Settled in full: paid to them, or set off
// against what they owe now. Never through payroll, which carries earned wages.
function SettleRefund({ refund, approval, settle, onDone, onCancel }: {
  refund: any;
  approval?: ApprovalApi;
  settle: (id: number, body: Record<string, unknown>) => Promise<any>;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const approver = useApprover(approval);
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(kenyaToday());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm('refund_settlement', {
        adjustment_id: refund.id,
        method,
        amount: Number(refund.amount),
      });
      await settle(refund.id, {
        method,
        ...(method === 'offset' ? {} : { date }),
        reference: reference.trim() || undefined,
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
      await onDone();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border rounded-lg p-3 mt-2 space-y-2 bg-gray-50 print:hidden">
      <label className="block text-sm">
        How it was settled
        <select className="w-full border rounded-lg p-2 mt-1 bg-white" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Paid to them in cash</option>
          <option value="mpesa">Paid to them by M-Pesa</option>
          <option value="offset">Set off against what they owe now</option>
        </select>
      </label>
      {method !== 'offset' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="block text-sm">
            Date paid
            <input type="date" className="w-full border rounded-lg p-2 mt-1 bg-white" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block text-sm">
            Reference (optional)
            <input className="w-full border rounded-lg p-2 mt-1 bg-white" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>
      )}
      <ApproverFields state={approver} inputClassName="w-full border rounded-lg p-2 mt-1 bg-white" />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="px-3 py-2 rounded-lg text-gray-700" onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy || !approver.ready} onClick={() => void submit()} className="px-3 py-2 rounded-lg bg-blue-700 text-white disabled:opacity-50">
          {busy ? 'Saving…' : `Settle ${kes(refund.amount)}`}
        </button>
      </div>
    </div>
  );
}

export function EmployeePayView({ load, admin = false, actions, approval }: any) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState({
    amount: '',
    payment_method: 'cash',
    date: new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Nairobi',
    }),
    reference: '',
    shift_id: '',
    notes: '',
  });
  const receiptKey = useRef(newOperationKey());
  const [limit, setLimit] = useState('100');
  const [reviewAction, setReviewAction] = useState<any>(null);
  const [reviewStatus, setReviewStatus] = useState('confirmed');
  const [settling, setSettling] = useState<number | null>(null);
  async function refresh() {
    try {
      const r = await load();
      setData(r.data.data);
      setLimit(String(r.data.data.employee.recovery_limit_percent));
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.error || 'Unable to load pay statement.');
    }
  }
  useEffect(() => {
    void refresh();
  }, [load]);
  async function action(fn: () => Promise<any>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p role="status">{error || 'Loading pay statement…'}</p>;
  return (
    <main className="max-w-5xl mx-auto space-y-5 text-gray-800 p-2">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {admin ? data.employee.name : 'My Pay'}
          </h1>
          <p className="text-sm text-gray-500">
            {data.employee.name} · earnings, payments and debt
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="border rounded-lg px-4 py-2 bg-white print:hidden"
        >
          Print statement
        </button>
      </div>
      {error && (
        <p role="alert" className="bg-red-50 text-red-700 p-3">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="border bg-white rounded-xl p-4">
          <p className="text-sm text-gray-500">Approved wages due</p>
          <p className="text-xl font-semibold">
            {kes(
              data.runs
                .filter((r: any) => !['void', 'calculated'].includes(r.status))
                .reduce(
                  (s: number, r: any) =>
                    s +
                    r.lines.reduce(
                      (v: number, l: any) => v + Number(l.balance_due),
                      0,
                    ),
                  0,
                ),
            )}
          </p>
        </div>
        <div className="border bg-white rounded-xl p-4">
          <p className="text-sm text-gray-500">Outstanding debt</p>
          <p className="text-xl font-semibold">{kes(data.debt.outstanding)}</p>
        </div>
        {Number(data.debt.owed_to_employee || 0) > 0 && (
          <div className="border border-amber-300 bg-amber-50 rounded-xl p-4 col-span-2">
            <p className="text-sm text-amber-800">Owed back to {admin ? data.employee.name : 'you'} after a correction</p>
            <p className="text-xl font-semibold text-amber-900">{kes(data.debt.owed_to_employee)}</p>
          </div>
        )}
      </div>
      <details className="bg-white border rounded-xl p-4">
        <summary className="font-semibold cursor-pointer">
          Compensation plan history
        </summary>
        {data.plans.map((p: any) => (
          <div key={p.id} className="mt-3 text-sm border-t pt-2">
            <p>
              {p.effective_from} to {p.effective_to || 'present'} · {p.name} · v
              {p.version} · paid {p.pay_schedule}
            </p>
            {p.components.map((c: any) => (
              <p key={c.id} className="text-gray-600">
                {c.component_type === 'fixed_per_shift'
                  ? `${kes(c.amount)} per shift`
                  : c.component_type === 'fixed_periodic'
                    ? `${kes(c.amount)} per ${p.pay_schedule} period`
                    : c.component_type === 'sales_percentage'
                      ? `${c.rate}% of ${c.fuel_type || 'all'} sales`
                      : `${kes(c.rate)} per litre (${c.fuel_type || 'all fuels'})`}
              </p>
            ))}
          </div>
        ))}
      </details>
      <details className="bg-white border rounded-xl p-4">
        <summary className="font-semibold cursor-pointer">
          Earnings not yet included in payroll (
          {data.accrued_shift_details?.length || 0} entries)
        </summary>
        <p className="text-xs text-gray-500 my-2">
          Recorded shift payments and wage deductions are shown below. Remaining
          compensation can be included in the appropriate payroll period.
        </p>
        {data.accrued_shift_details?.map((row: any) => (
          <div key={row.key} className="border-t py-3 text-sm space-y-1">
            <p className="font-medium">
              {row.date} ·{' '}
              {row.shift_id ? `Shift #${row.shift_id}` : 'Period salary'} · plan
              v{row.plan?.version || '—'}
            </p>
            {row.components.map((e: any) => (
              <p key={e.id}>
                {e.description} · {kes(e.gross_amount)}
              </p>
            ))}
            <p>
              Earned {kes(row.gross)} · paid in shift {kes(row.paid)} · deducted{' '}
              {kes(row.deductions)} · remaining {kes(row.remaining)}
            </p>
            {row.shift_id && (
              <Link
                to={`/shifts/${row.shift_id}`}
                className="text-blue-700 underline print:hidden"
              >
                Open shift record
              </Link>
            )}
          </div>
        ))}
      </details>
      {data.runs.map((r: any) => (
        <details
          key={r.id}
          open={r.status !== 'void'}
          className="bg-white border rounded-xl p-4"
        >
          <summary className="font-semibold cursor-pointer mb-3">
            {r.name} · {r.status.replace(/_/g, ' ')}
          </summary>
          {r.lines.map((l: any) => (
            <PayrollStatement key={l.id} line={l} run={r} />
          ))}
        </details>
      ))}
      <section className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="text-lg font-semibold">Debt statement</h2>
        <p className="text-sm text-gray-500">
          Confirmed debt available for recovery: {kes(data.debt.recoverable)}.
          Pending or disputed shortages are excluded.
        </p>
        {data.debt.debts.map((d: any) => (
          <details key={d.id} className="border rounded-lg p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Shift #{d.shift_id} · {String(d.created_at).slice(0, 10)} ·
              remaining {kes(d.balance)} · {d.recovery_status}
            </summary>
            <p className="text-sm mt-2">
              Original shortage {kes(d.original_deficit)} · recovered at origin{' '}
              {kes(d.deducted_from_wage)}
            </p>
            <p className="text-sm mt-2">
              Carried forward {kes(d.carried_forward)} − allocated repayments{' '}
              {kes(d.allocated_repayments)}
              {Number(d.corrected || 0) > 0 && <> − corrections {kes(d.corrected)}</>}
              {' '}+ historical adjustments{' '}
              {kes(d.historical_adjustment)} = {kes(d.balance)}
            </p>
            {d.created_by_correction_id && (
              <p className="text-xs text-blue-800 mt-1">Added by correction #{d.created_by_correction_id} after the shift closed.</p>
            )}
            {(data.debt.corrections || [])
              .filter((a: any) => a.staff_debt_id === d.id && a.adjustment_type === 'decrease')
              .map((a: any) => (
                <p key={`correction:${a.id}`} className="text-sm mt-1">
                  {String(a.created_at || '').slice(0, 10)} · {a.reason} · −{kes(a.amount)}
                </p>
              ))}
            {Number(d.historical_adjustment) !== 0 && (
              <p className="text-xs text-amber-800">
                Historical adjustments include corrections or settlements
                recorded before allocation tracking. They are not new
                repayments.
              </p>
            )}
            {data.debt.history
              .filter((h: any) => h.staff_debt_id === d.id)
              .map((h: any) => (
                <p key={`${h.type}:${h.id}`} className="text-sm mt-1">
                  {String(h.created_at || '').slice(0, 10)} · {h.type} #
                  {h.source_id} · {kes(h.amount)}
                  {h.reversed_at ? ' · reversed' : ''}
                </p>
              ))}
            {data.debt.reviews
              ?.filter((r: any) => r.staff_debt_id === d.id)
              .map((r: any) => (
                <p className="text-xs text-gray-600 mt-1" key={r.id}>
                  {String(r.created_at).slice(0, 10)} · {r.status} · {r.reason}
                </p>
              ))}
            {admin && (
              <button
                disabled={busy}
                className="text-blue-700 underline text-sm mt-2 print:hidden"
                onClick={() => {
                  setReviewStatus(d.recovery_status);
                  setReviewAction({ type: 'debt', id: d.id });
                }}
              >
                Review debt status
              </button>
            )}
          </details>
        ))}
        {(data.debt.refunds || []).length > 0 && (
          <div className="border-t pt-3 space-y-2">
            <h3 className="font-semibold">Owed back after corrections</h3>
            {data.debt.refunds.map((r: any) => (
              <div key={r.id} className="text-sm border rounded-lg p-3">
                <p>
                  {String(r.created_at || '').slice(0, 10)} · shift #{r.shift_id} · {kes(r.amount)} ·{' '}
                  {r.status === 'review_required'
                    ? <span className="text-amber-700 font-medium">owed</span>
                    : <span className="text-green-700">settled {r.settlement_date} by {r.settlement_method === 'offset' ? 'set-off' : r.settlement_method === 'mpesa' ? 'M-Pesa' : 'cash'}{r.settled_by_name ? `, approved by ${r.settled_by_name}` : ''}</span>}
                </p>
                <p className="text-xs text-gray-600 mt-1">{r.reason}</p>
                {admin && r.status === 'review_required' && actions.settleRefund && settling !== r.id && (
                  <button disabled={busy} className="text-blue-700 underline text-sm mt-1 print:hidden" onClick={() => setSettling(r.id)}>
                    Settle
                  </button>
                )}
                {admin && settling === r.id && (
                  <SettleRefund
                    refund={r}
                    approval={approval}
                    settle={actions.settleRefund}
                    onCancel={() => setSettling(null)}
                    onDone={async () => { setSettling(null); await refresh(); }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {data.debt.receipts?.map((p: any) => (
          <div key={p.id} className="text-sm border-t pt-2">
            Receipt #{p.id} · {p.date} · {p.payment_method} · {kes(p.amount)} ·{' '}
            {p.notes} · {p.status}
            {admin && p.status === 'posted' && (
              <button
                disabled={busy}
                className="ml-3 text-red-700 underline print:hidden"
                onClick={() => setReviewAction({ type: 'receipt', id: p.id })}
              >
                Reverse
              </button>
            )}
          </div>
        ))}
      </section>
      {admin && (
        <section className="bg-white border rounded-xl p-4 space-y-3 print:hidden">
          <h2 className="text-lg font-semibold">
            Record a separate debt repayment
          </h2>
          <p className="text-sm text-gray-500">
            Use for money received from the employee. This does not deduct
            wages. For cash/M-Pesa received in an open shift, include that shift
            and include the receipt in its drawer collections.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(
              ['amount', 'date', 'reference', 'shift_id', 'notes'] as const
            ).map((key) => (
              <label key={key} className="text-sm">
                {
                  {
                    amount: 'Amount (KES)',
                    date: 'Date',
                    reference: 'Receipt reference',
                    shift_id: 'Receiving shift (optional)',
                    notes: 'Notes',
                  }[key]
                }
                <input
                  type={
                    key === 'date'
                      ? 'date'
                      : key === 'amount' || key === 'shift_id'
                        ? 'number'
                        : 'text'
                  }
                  className="w-full border rounded-lg p-2"
                  value={receipt[key]}
                  onChange={(e) =>
                    setReceipt({ ...receipt, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label className="text-sm">
              Payment method
              <select
                className="w-full border rounded-lg p-2"
                value={receipt.payment_method}
                onChange={(e) =>
                  setReceipt({ ...receipt, payment_method: e.target.value })
                }
              >
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>
          </div>
          <button
            disabled={busy || !receipt.amount || !receipt.reference}
            className="bg-blue-700 text-white rounded-lg p-2 disabled:opacity-50"
            onClick={() =>
              void action(async () => {
                await actions.receipt(
                  data.employee.id,
                  {
                    ...receipt,
                    amount: Number(receipt.amount),
                    shift_id: receipt.shift_id
                      ? Number(receipt.shift_id)
                      : null,
                  },
                  receiptKey.current,
                );
                receiptKey.current = newOperationKey();
                setReceipt({ ...receipt, amount: '', reference: '' });
              })
            }
          >
            Record repayment
          </button>
          <div className="border-t pt-3">
            <label className="text-sm">
              Recovery limit (% of available unpaid compensation)
              <input
                className="border rounded-lg p-2 mx-2 w-24"
                type="number"
                min="0"
                max="100"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void action(() =>
                  actions.limit(data.employee.id, Number(limit)),
                )
              }
              className="text-blue-700 underline"
            >
              Save limit
            </button>
          </div>
        </section>
      )}
      {admin && reviewAction && (
        <ReasonDialog
          title={
            reviewAction.type === 'debt'
              ? 'Review debt status'
              : 'Reverse debt repayment'
          }
          onCancel={() => setReviewAction(null)}
          onConfirm={async (reason: string) => {
            if (reviewAction.type === 'debt')
              await actions.review(reviewAction.id, {
                status: reviewStatus,
                reason,
              });
            else await actions.reverseReceipt(reviewAction.id, reason);
            await refresh();
          }}
        >
          {reviewAction.type === 'debt' && (
            <label className="block text-sm">
              Recovery status
              <select
                className="w-full border rounded-lg p-2 mt-1"
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value)}
              >
                <option value="confirmed">Confirmed</option>
                <option value="pending">Pending review</option>
                <option value="disputed">Disputed</option>
              </select>
            </label>
          )}
        </ReasonDialog>
      )}
    </main>
  );
}
