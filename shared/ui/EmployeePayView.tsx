import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { PayrollStatement, kes } from './PayrollStatement';
import type { ApprovalApi } from './ApproverConfirm';
import { VarianceStatementView, describeVarianceTotals, type VarianceActions } from './EmployeeVariances';

// An employee's pay and variances. Pay is never reduced for variances; the
// Variances section (shared/ui/EmployeeVariances.tsx) is where an
// administrator records repayments, write-offs and pay-backs. Employees see
// their own, read-only.
export function EmployeePayView({ load, admin = false, actions, approval }: {
  load: () => Promise<any>;
  admin?: boolean;
  actions?: VarianceActions;
  approval?: ApprovalApi;
}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  async function refresh() {
    try {
      const r = await load();
      setData(r.data.data);
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.error || 'Unable to load pay statement.');
    }
  }
  useEffect(() => {
    void refresh();
  }, [load]);
  if (!data) return <p role="status">{error || 'Loading pay statement…'}</p>;
  return (
    <main className="max-w-5xl mx-auto space-y-5 text-gray-800 p-2">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {admin ? data.employee.name : 'My Pay'}
          </h1>
          <p className="text-sm text-gray-500">
            {data.employee.name} · earnings, payments and variances
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
          <p className="text-sm text-gray-500">Shortages</p>
          <p className="text-xl font-semibold">{describeVarianceTotals(data.variances?.totals).text}</p>
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
      <VarianceStatementView
        statement={data.variances}
        earlier={data.debt}
        self={!admin}
        actions={admin ? actions : undefined}
        approval={approval}
        onChanged={refresh}
      />
    </main>
  );
}
