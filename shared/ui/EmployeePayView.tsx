import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { PayrollStatement, kes } from './PayrollStatement';
import type { ApprovalApi } from './ApproverConfirm';
import { VarianceStatementView, describeVarianceTotals, type VarianceActions } from './EmployeeVariances';

// An employee's pay: the same view on My Pay (the employee, read-only) and on
// the admin's employee page. Three figures on top, then recent shifts,
// payroll runs (details on tap) and shortages. Pay is never reduced for
// shortages; an administrator records repayments in the Shortages section.
const SHIFTS_SHOWN = 10;

function planText(plan: any): string {
  if (!plan) return 'No pay plan';
  const parts = (plan.components || []).map((c: any) => (
    c.component_type === 'fixed_per_shift' ? `${kes(c.amount)} per shift`
      : c.component_type === 'fixed_periodic' ? `${kes(c.amount)} per ${plan.pay_schedule} period`
        : c.component_type === 'sales_percentage' ? `${c.rate}% of ${c.fuel_type || 'all'} sales`
          : `${kes(c.rate)} per litre${c.fuel_type ? ` (${c.fuel_type})` : ''}`));
  return `${parts.join(' + ') || plan.name} · paid ${plan.pay_schedule}`;
}

function Tile({ label, value, tone }: { label: string; value: string; tone: 'teal' | 'blue' | 'red' | 'green' | 'grey' }) {
  const border = { teal: 'border-t-blue-600', blue: 'border-t-gray-900', red: 'border-t-red-500', green: 'border-t-green-600', grey: 'border-t-gray-300' }[tone];
  const text = tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-green-700' : 'text-gray-900';
  return (
    <div className={`bg-white border rounded-xl p-3 sm:p-4 border-t-4 ${border}`}>
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className={`text-lg sm:text-xl font-bold tabular-nums mt-1 ${text}`}>{value}</p>
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  partially_paid: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  calculated: 'bg-gray-100 text-gray-700',
  void: 'bg-gray-100 text-gray-500 line-through',
};

export function EmployeePayView({ load, admin = false, actions, approval, embedded = false, inRecord = false }: {
  load: () => Promise<any>;
  admin?: boolean;
  embedded?: boolean;
  /** Shown inside an employee's page, which already has the figures and a Shortages tab. */
  inRecord?: boolean;
  actions?: VarianceActions;
  approval?: ApprovalApi;
}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [allShifts, setAllShifts] = useState(false);
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
  if (!data) return <p role="status">{error || 'Loading…'}</p>;

  const runs: any[] = data.runs || [];
  const due = runs.filter((r) => !['void', 'calculated'].includes(r.status))
    .reduce((sum, r) => sum + r.lines.reduce((v: number, l: any) => v + Number(l.balance_due || 0), 0), 0);
  const shifts: any[] = [...(data.accrued_shift_details || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const unpaid = shifts.reduce((sum, row) => sum + Number(row.remaining || 0), 0);
  const shortages = describeVarianceTotals(data.variances?.totals);
  const plans: any[] = data.plans || [];
  const currentPlan = plans.find((p) => !p.effective_to) || plans[plans.length - 1];
  const shown = allShifts ? shifts : shifts.slice(0, SHIFTS_SHOWN);

  return (
    <main className="max-w-5xl mx-auto space-y-4 text-gray-800 p-1 sm:p-2">
      <div className={`flex flex-wrap items-center gap-3 ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded && <h1 className="text-2xl font-bold">{admin ? data.employee.name : 'My Pay'}</h1>}
        <button onClick={() => window.print()} className="border rounded-lg px-3 py-1.5 text-sm bg-white print:hidden">Print</button>
      </div>
      {error && <p role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg">{error}</p>}

      {!inRecord && <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile label="Earned, not yet paid" value={kes(unpaid)} tone="teal" />
        <Tile label="Pay due" value={kes(due)} tone="blue" />
        <Tile label="Shortages" value={shortages.tone === 'owes' ? shortages.text.replace(/^Owes /, '') : shortages.text}
          tone={shortages.tone === 'owes' ? 'red' : shortages.tone === 'favour' ? 'green' : 'grey'} />
      </div>}

      <section className="bg-white border rounded-xl p-3 sm:p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-gray-500">Pay plan</span>
          <span className="font-semibold text-right">{planText(currentPlan)}</span>
        </div>
        {plans.length > 1 && (
          <details className="mt-2">
            <summary className="text-xs text-blue-700 cursor-pointer">Earlier plans</summary>
            {plans.filter((p) => p !== currentPlan).map((p) => (
              <p key={p.id} className="text-xs text-gray-600 mt-1">{p.effective_from} to {p.effective_to || 'now'}: {planText(p)}</p>
            ))}
          </details>
        )}
      </section>

      <section className="bg-white border rounded-xl overflow-hidden">
        <p className="px-3 sm:px-4 pt-3 font-semibold">Shifts not yet in payroll</p>
        {shifts.length === 0 ? <p className="px-4 py-3 text-sm text-gray-400">None.</p> : (
          <table className="w-full text-sm mt-2">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <th className="text-left p-2 pl-3 sm:pl-4 font-medium">Date</th>
                <th className="text-right p-2 font-medium">Earned</th>
                <th className="text-right p-2 font-medium">Taken</th>
                <th className="text-right p-2 pr-3 sm:pr-4 font-medium">Left</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key} className="border-t border-gray-100">
                  <td className="p-2 pl-3 sm:pl-4">
                    {row.shift_id
                      ? <Link to={`/shifts/${row.shift_id}`} className="text-blue-700">{row.date} · #{row.shift_id}</Link>
                      : <span>{row.date} · salary</span>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{kes(row.gross)}</td>
                  <td className="p-2 text-right tabular-nums text-gray-600">{kes(row.paid)}</td>
                  <td className={`p-2 pr-3 sm:pr-4 text-right tabular-nums font-semibold ${Number(row.remaining) > 0 ? 'text-blue-700' : 'text-gray-400'}`}>{kes(row.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shifts.length > SHIFTS_SHOWN && (
          <button type="button" onClick={() => setAllShifts(!allShifts)} className="w-full py-2 text-sm text-blue-700 border-t border-gray-100 print:hidden">
            {allShifts ? 'Show fewer' : `Show all ${shifts.length}`}
          </button>
        )}
      </section>

      {runs.length > 0 && (
        <section className="space-y-2">
          <p className="font-semibold px-1">Payroll</p>
          {runs.map((r) => {
            const net = r.lines.reduce((v: number, l: any) => v + Number(l.net_pay || 0), 0);
            const paid = r.lines.reduce((v: number, l: any) => v + Number(l.paid_amount || 0), 0);
            const left = r.lines.reduce((v: number, l: any) => v + Number(l.balance_due || 0), 0);
            return (
              <details key={r.id} className="bg-white border rounded-xl">
                <summary className="cursor-pointer list-none p-3 sm:p-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold flex-1 min-w-[140px]">{r.name}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold capitalize ${STATUS_PILL[r.status] || 'bg-gray-100 text-gray-700'}`}>{String(r.status).replace(/_/g, ' ')}</span>
                  <span className="tabular-nums">Pay {kes(net)}</span>
                  <span className="tabular-nums text-green-700">Paid {kes(paid)}</span>
                  {left > 0 && r.status !== 'void' && <span className="tabular-nums font-semibold text-blue-700">Due {kes(left)}</span>}
                </summary>
                <div className="px-3 sm:px-4 pb-3">
                  {r.lines.map((l: any) => <PayrollStatement key={l.id} line={l} run={r} />)}
                </div>
              </details>
            );
          })}
        </section>
      )}

      {!inRecord && <VarianceStatementView
        statement={data.variances}
        earlier={data.debt}
        self={!admin}
        actions={admin ? actions : undefined}
        approval={approval}
        onChanged={refresh}
      />}
    </main>
  );
}
