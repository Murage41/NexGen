import React from 'react';
import { Link } from 'react-router-dom';

export default function EmployeeDebtHistory({account}: {account: any}) {
  const format = (value: any) => `KES ${Number(value || 0).toLocaleString('en-KE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const debts = account.debts || [];
  const history = account.debt_history || [];
  const reviews = account.debt_reviews || [];
  return <section className="space-y-3">
    <div className="flex flex-wrap justify-between gap-2">
      <h4 className="text-sm font-semibold text-gray-700">Employee debt history</h4>
      <Link className="text-sm text-blue-600 hover:underline" to={`/employee-pay/${account.employee_id}`}>View full pay and debt statement</Link>
    </div>
    {debts.length === 0 ? <p className="text-sm text-gray-500">No staff debt entries recorded.</p> : <>
      <div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm">
        <thead className="bg-gray-100"><tr>
          <th className="p-2 text-left">Source</th><th className="p-2 text-right">Carried forward</th>
          <th className="p-2 text-right">Recorded repayments</th><th className="p-2 text-right">Historical adjustment</th>
          <th className="p-2 text-right">Remaining</th><th className="p-2 text-left">Status</th>
        </tr></thead>
        <tbody>{debts.map((debt: any) => <tr className="border-t" key={debt.id}>
          <td className="p-2"><Link className="text-blue-600 hover:underline" to={`/shifts/${debt.shift_id}`}>Shift #{debt.shift_id}</Link><div className="text-xs text-gray-500">Recorded {new Date(debt.created_at).toLocaleDateString('en-KE')}</div></td>
          <td className="p-2 text-right">{format(debt.carried_forward)}</td>
          <td className="p-2 text-right">{format(debt.allocated_repayments)}</td>
          <td className="p-2 text-right">{format(debt.historical_adjustment)}</td>
          <td className="p-2 text-right font-medium">{format(debt.balance)}</td>
          <td className="p-2 capitalize">{debt.status}{debt.recovery_status && debt.recovery_status !== 'confirmed' ? ` · ${debt.recovery_status}` : ''}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs text-gray-500">Historical adjustments include earlier settlements and corrections without a repayment allocation. They do not represent new cash received.</p>
    </>}
    {history.length > 0 && <div><h5 className="text-sm font-medium mb-2">Repayment and reversal history</h5><ul className="space-y-2 text-sm">{history.map((item: any) => <li key={`${item.type}:${item.id}`} className="border rounded p-2">
      {item.type} #{item.source_id} · Shift #{item.origin_shift_id} · {format(item.amount)}
      <span className="text-gray-500"> · {new Date(item.created_at).toLocaleDateString('en-KE')}{item.reversed_at ? ` · Reversed ${new Date(item.reversed_at).toLocaleDateString('en-KE')}` : ''}</span>
    </li>)}</ul></div>}
    {reviews.length > 0 && <div><h5 className="text-sm font-medium mb-2">Review and clearance notes</h5><ul className="space-y-2 text-sm">{reviews.map((review: any) => <li key={review.id} className="border rounded p-2">
      <span className="text-gray-500">Debt #{review.staff_debt_id} · {new Date(review.created_at).toLocaleDateString('en-KE')} · </span>{review.reason}
    </li>)}</ul></div>}
  </section>;
}
