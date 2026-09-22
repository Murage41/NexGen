import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { EmployeePayView } from '../../../shared/ui/EmployeePayView';
import { getMyPay, getEmployeePay, varianceActions } from '../services/api';
export default function EmployeePay() {
  const { id } = useParams();
  const load = useCallback(
    () => (id ? getEmployeePay(Number(id)) : getMyPay()),
    [id],
  );
  return (
    <EmployeePayView
      key={id || 'me'}
      load={load}
      admin={Boolean(id)}
      actions={varianceActions}
    />
  );
}
