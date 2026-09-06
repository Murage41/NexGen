import { Link } from 'react-router-dom';
import { ReasonDialog } from './ReasonDialog';
import { newOperationKey } from './operationKey';
import { useEffect, useRef, useState } from 'react';
import { PayrollStatement, kes } from './PayrollStatement';

export function EmployeePayView({ load, admin = false, actions }: any) {
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
              {kes(d.allocated_repayments)} + historical adjustments{' '}
              {kes(d.historical_adjustment)} = {kes(d.balance)}
            </p>
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
