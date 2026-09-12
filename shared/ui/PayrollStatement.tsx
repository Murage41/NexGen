import { newOperationKey } from './operationKey';
import { useRef, useState } from 'react';
import { ApproverFields, useApprover } from './ApproverConfirm';
import { Link } from 'react-router-dom';

export const kes = (value: any) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field =
  'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';

export function RecoveryEditor({
  preview,
  saved,
  onSave,
  onDirty,
  approval,
  label = 'Save recovery decision',
  savedMessage = 'Recovery decision saved. It takes effect when compensation is approved.',
}: any) {
  const [amount, setAmount] = useState(
    String(
      saved?.version === preview.version ? saved.amount : preview.proposed,
    ),
  );
  const approver = useApprover(approval);
  const [confirmedBy, setConfirmedBy] = useState('');
  const [busy, setBusy] = useState(false);
  const operationKey = useRef(newOperationKey());
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm('recovery', {
        version: preview.version,
        amount: Number(amount),
      });
      await onSave(
        {
          version: preview.version,
          amount: Number(amount),
          ...(approved.approval_token
            ? { approval_token: approved.approval_token }
            : {}),
        },
        operationKey.current,
      );
      setConfirmedBy(approved.name || '');
      operationKey.current = newOperationKey();
    } catch (e: any) {
      setError(
        e.response?.data?.error || e.message || 'Recovery could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }
  const valid =
    amount !== '' &&
    Number(amount) >= 0 &&
    Number(amount) <= preview.proposed &&
    approver.ready;
  const approvedBy = saved?.approved_by_name || confirmedBy;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 print:hidden">
      <p className="font-semibold text-gray-900">Review debt recovery</p>
      <p className="text-sm">
        Outstanding {kes(preview.outstanding)}
        {preview.shortage > 0 && (
          <span className="text-gray-600">
            {' '}— including {kes(preview.shortage)} short on this shift
          </span>
        )}
      </p>
      <p className="text-sm text-gray-600">
        Settles oldest debt first. Proposed: {kes(preview.proposed)}.
        {preview.limit_percent < 100
          ? ` Capped at ${preview.limit_percent}% of ${preview.gross != null ? 'what is owed' : 'available compensation'}.`
          : ''}
      </p>
      {preview.available === 0 && (
        <p className="text-sm text-amber-800">
          No further recovery is available against this period right now.
        </p>
      )}
      <div className="space-y-1 text-sm">
        {preview.debts
          ?.filter((d: any) => Number(d.balance) > 0)
          .map((d: any) => (
            <div key={d.id} className="flex justify-between gap-3">
              <span>
                Shift #{d.shift_id} ·{' '}
                {String(d.created_at || 'Current shift').slice(0, 10)} ·{' '}
                {d.recovery_status || 'confirmed'}
              </span>
              <span>{kes(d.balance)}</span>
            </div>
          ))}
      </div>
      <label className="block text-sm">
        Recover now (KES)
        <input
          className={field}
          type="number"
          min="0"
          max={preview.proposed}
          step="0.01"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); onDirty?.(); }}
        />
      </label>
      <ApproverFields
        state={approver}
        inputClassName={field}
        onApproverChange={() => onDirty?.()}
      />
      {preview.gross != null && (
        <p className="text-sm text-gray-600">
          This shift's earnings: {kes(preview.gross)}, paid in full. Anything
          recovered here is cash handed back separately — it never reduces the
          wage or changes this shift's variance.
        </p>
      )}
      <p className="text-sm">
        Remaining debt:{' '}
        {kes(Math.max(0, preview.outstanding - Number(amount || 0)))}
      </p>
      {saved?.version === preview.version && Number(amount) === Number(saved.amount) && (
        <p className="text-sm text-green-800">
          {savedMessage}
          {approvedBy ? ` Approved by ${approvedBy}.` : ''}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !valid}
        onClick={save}
        className="bg-blue-700 text-white rounded-lg px-4 py-2 disabled:opacity-50"
      >
        {busy ? 'Saving…' : label}
      </button>
    </section>
  );
}

export function PayrollStatement({ line, run, onRecovery, approval }: any) {
  const provisional = run.status === 'calculated';
  return (
    <section className="space-y-4 text-gray-800">
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-semibold">
          {line.shift_count ?? 0} shifts · {line.earnings?.length || 0} earning
          components
        </p>
        <span className="text-sm">
          {provisional
            ? 'Draft — provisional'
            : run.status === 'void'
              ? 'Voided payroll'
              : 'Approved payroll'}
        </span>
      </div>
      {line.warnings?.map((w: string) => (
        <p
          key={w}
          role="note"
          className="text-sm bg-amber-50 text-amber-900 p-3 rounded-lg"
        >
          {w}
        </p>
      ))}
      <div className="space-y-3">
        {line.shift_details?.map((row: any) => (
          <details
            key={row.key}
            className="rounded-xl border border-gray-200 p-3"
            open
          >
            <summary className="cursor-pointer font-medium">
              {row.shift_id ? `Shift #${row.shift_id}` : 'Periodic salary'} ·{' '}
              {row.date} <span className="float-right">{kes(row.gross)}</span>
            </summary>
            <p className="text-xs text-gray-500 mt-2">
              {row.plan?.name || 'Historical plan'} · version{' '}
              {row.plan?.version || '—'} · effective{' '}
              {row.plan?.effective_from || '—'} · paid{' '}
              {row.plan?.pay_schedule || run.pay_schedule}
            </p>
            {row.shift_id && (
              <Link
                className="text-sm text-blue-700 underline print:hidden"
                to={`/shifts/${row.shift_id}`}
              >
                Open shift record
              </Link>
            )}
            <div className="mt-2 space-y-1">
              {row.components.map((c: any) => (
                <div key={c.id} className="text-sm flex justify-between gap-3">
                  <span>
                    {c.description}
                    {c.component?.component_type === 'fixed_per_shift'
                      ? ` · ${kes(c.component.amount)} per shift`
                      : c.component?.component_type === 'fixed_periodic'
                        ? ` · full period ${kes(c.rate)}`
                        : ''}
                    {c.component?.minimum_amount != null
                      ? ` · minimum ${kes(c.component.minimum_amount)}`
                      : ''}
                    {c.component?.maximum_amount != null
                      ? ` · maximum ${kes(c.component.maximum_amount)}`
                      : ''}
                    {c.component?.component_type === 'sales_percentage'
                      ? ` · ${kes(c.basis_amount)} × ${c.rate}%`
                      : c.component?.component_type === 'litre_rate'
                        ? ` · ${c.basis_quantity} L × ${kes(c.rate)}/L`
                        : ''}
                  </span>
                  <span className="whitespace-nowrap">
                    {kes(c.gross_amount)}
                  </span>
                </div>
              ))}
            </div>
            {!row.legacy && (
              <p className="mt-2 pt-2 border-t text-xs text-gray-600">
                Allocated payments {kes(row.paid)} · deductions{' '}
                {kes(row.deductions)} · unsettled {kes(row.remaining)}
                {provisional ? ' (before draft deductions)' : ''}
              </p>
            )}
          </details>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        Payment allocations show which earnings a payment settles. Payment dates
        below show when money was recorded as paid.
      </p>
      {provisional && onRecovery && line.recovery && (
        <RecoveryEditor
          key={line.recovery.version}
          preview={line.recovery}
          saved={line.recovery_review}
          onSave={onRecovery}
          approval={approval}
        />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="font-semibold mb-2">Deductions and debt origins</p>
          {line.deductions?.map((d: any) => (
            <p
              key={d.id}
              className={`text-sm mb-1 ${d.status === 'reversed' ? 'line-through text-gray-400' : ''}`}
            >
              {String(d.deduction_type).replace(/_/g, ' ')} · {kes(d.amount)} ·{' '}
              {d.authorization_reference || d.notes || d.status}
            </p>
          ))}
          {line.debt_allocations?.map((a: any) => (
            <p key={a.id} className="text-xs text-gray-600">
              {a.reversed_at ? 'Reversed recovery' : 'Recovered'}{' '}
              {kes(a.amount)} from debt on shift #{a.shift_id} (
              {String(a.debt_date).slice(0, 10)})
            </p>
          ))}
          {line.recovery_review && (
            <p className="text-xs mt-2 text-gray-600">
              Recovery decision: {kes(line.recovery_review.amount)}.{' '}
              {line.recovery_review.approved_by_name
                ? `Approved by ${line.recovery_review.approved_by_name}. `
                : ''}
              {line.recovery_review.reason}
            </p>
          )}
        </div>
        <div>
          <p className="font-semibold mb-2">Payment history</p>
          {line.payments?.map((p: any) => (
            <p
              key={p.id}
              className={`text-sm mb-1 ${p.status === 'reversed' ? 'line-through text-gray-400' : ''}`}
            >
              {p.payment_date} · {String(p.payment_method).replace(/_/g, ' ')} ·{' '}
              {kes(p.amount)}
              {p.shift_id ? ` · drawer shift #${p.shift_id}` : ''}
              {p.reference ? ` · ${p.reference}` : ''}
            </p>
          ))}
        </div>
      </div>
      <p className="border-t pt-3 font-medium">
        Gross {kes(line.gross_earnings)} − deductions{' '}
        {kes(line.total_deductions)} = net {kes(line.net_pay)} · paid{' '}
        {kes(line.paid_amount)} · due {kes(line.balance_due)}
      </p>
    </section>
  );
}
