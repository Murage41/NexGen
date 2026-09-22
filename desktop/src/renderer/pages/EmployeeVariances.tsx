import { useParams } from 'react-router-dom';
import { EmployeeVariancesPage } from '../../../../shared/ui/EmployeeVariances';
import { getEmployeeVariances, varianceActions, desktopApproval } from '../services/api';

// Employees, then an employee's Variances: every shift's over/short, what
// recovered it, repayments, write-offs and pay-backs.
export default function EmployeeVariances() {
  const { id } = useParams();
  return (
    <EmployeeVariancesPage
      key={id}
      employeeId={Number(id)}
      load={getEmployeeVariances}
      actions={varianceActions}
      approval={desktopApproval}
    />
  );
}
