import { useParams } from 'react-router-dom';
import { EmployeeVariancesPage } from '../../../shared/ui/EmployeeVariances';
import { getEmployeeVariances, varianceActions } from '../services/api';

// Employees, then an employee's Variances. The signed-in administrator
// approves write-offs and pay-backs as themselves.
export default function EmployeeVariances() {
  const { id } = useParams();
  return (
    <EmployeeVariancesPage
      key={id}
      employeeId={Number(id)}
      load={getEmployeeVariances}
      actions={varianceActions}
      inputClassName="w-full border border-gray-300 rounded-xl px-3 py-3 bg-white text-gray-900 text-base"
    />
  );
}
