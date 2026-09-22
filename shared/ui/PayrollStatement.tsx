import { Link } from 'react-router-dom';

export const kes = (value: any) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Pay is never reduced for variances: employees repay them separately
// (Employees, Variances). Recovery decisions saved before that show as history.
export function PayrollStatement({ line, run }: any) {
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
