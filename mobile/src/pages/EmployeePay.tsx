import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { EmployeePayView } from '../../../shared/ui/EmployeePayView';
import { getMyPay, getEmployeePay, varianceActions } from '../services/api';

// My Pay for the signed-in employee (or an employee's pay for an admin), with
// the same navy header as every other phone page.
export default function EmployeePay() {
  const { id } = useParams();
  const load = useCallback(
    () => (id ? getEmployeePay(Number(id)) : getMyPay()),
    [id],
  );
  return (
    <div className="pb-6">
      <PageHeader title={id ? 'Pay' : 'My Pay'} back={Boolean(id)} />
      <EmployeePayView
        key={id || 'me'}
        load={load}
        admin={Boolean(id)}
        embedded
        actions={varianceActions}
      />
    </div>
  );
}
