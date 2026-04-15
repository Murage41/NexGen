import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getShifts, getActiveEmployees, openShift } from '../services/api';
import { Plus, Eye, Clock, CheckCircle } from 'lucide-react';
import { getKenyaDate } from '../utils/timezone';

export default function Shifts() {
  const [shifts, setShifts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [shiftDate, setShiftDate] = useState(getKenyaDate());
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [shiftsRes, empRes] = await Promise.all([getShifts(), getActiveEmployees()]);
      setShifts(shiftsRes.data.data.shifts);
      setEmployees(empRes.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenShift() {
    if (!selectedEmployee) return;
    try {
      const res = await openShift({ employee_id: parseInt(selectedEmployee), shift_date: shiftDate });
      setShowNew(false);
      setSelectedEmployee('');
      navigate(`/shifts/${res.data.data.id}`);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to open shift');
    }
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatTime = (d: string) => new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Shifts & Readings</h1>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={18} /> Open New Shift
        </button>
      </div>

      {/* New Shift Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold mb-4">Open New Shift</h2>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Employee</label>
            <select
              value={selectedEmployee}
              onChange={e => setSelectedEmployee(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 mb-4"
            >
              <option value="">-- Select --</option>
              {employees.map((emp: any) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shift Date</label>
            <input
              type="date"
              value={shiftDate}
              max={getKenyaDate()}
              onChange={e => setShiftDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 mb-4"
            />
            {employees.length === 0 && (
              <p className="text-sm text-red-500 mb-4">No employees found. Add employees in the Employees page first.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleOpenShift}
                disabled={!selectedEmployee}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Open Shift
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shifts Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium text-gray-600">#</th>
              <th className="text-left p-3 font-medium text-gray-600">Date</th>
              <th className="text-left p-3 font-medium text-gray-600">Employee</th>
              <th className="text-left p-3 font-medium text-gray-600">Start</th>
              <th className="text-left p-3 font-medium text-gray-600">End</th>
              <th className="text-left p-3 font-medium text-gray-600">Status</th>
              <th className="text-left p-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift: any) => (
              <tr key={shift.id} className="border-t hover:bg-gray-50">
                <td className="p-3 text-gray-500">{shift.id}</td>
                <td className="p-3">{shift.shift_date ? formatDate(shift.shift_date + 'T12:00:00') : formatDate(shift.start_time)}</td>
                <td className="p-3 font-medium">{shift.employee_name}</td>
                <td className="p-3">{formatTime(shift.start_time)}</td>
                <td className="p-3">{shift.end_time ? formatTime(shift.end_time) : '-'}</td>
                <td className="p-3">
                  {shift.status === 'open' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                      <Clock size={12} /> Open
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                      <CheckCircle size={12} /> Closed
                    </span>
                  )}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => navigate(`/shifts/${shift.id}`)}
                    className="text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Eye size={14} /> View
                  </button>
                </td>
              </tr>
            ))}
            {shifts.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-gray-400">No shifts recorded yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
