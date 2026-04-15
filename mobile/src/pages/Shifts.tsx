import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getShifts, getActiveEmployees, openShift } from '../services/api';
import { getKenyaDate } from '../utils/timezone';
import PageHeader from '../components/PageHeader';
import { Plus, Clock, CheckCircle } from 'lucide-react';

export default function Shifts() {
  const [shifts, setShifts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState('');
  const [shiftDate, setShiftDate] = useState(getKenyaDate());
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [s, e] = await Promise.all([getShifts(), getActiveEmployees()]);
    setShifts(s.data.data.shifts);
    setEmployees(e.data.data);
  }

  async function handleOpen() {
    if (!selectedEmp) return;
    try {
      const res = await openShift({ employee_id: parseInt(selectedEmp), shift_date: shiftDate });
      setShowNew(false);
      navigate(`/shifts/${res.data.data.id}`);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed');
    }
  }

  return (
    <div className="pb-6">
      <PageHeader title="Shifts" right={
        <button onClick={() => setShowNew(true)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1">
          <Plus size={16} /> New
        </button>
      } />

      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white w-full rounded-t-2xl p-5">
            <h2 className="text-lg font-semibold mb-3">Open New Shift</h2>
            <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-3 mb-3 text-base">
              <option value="">Select Employee</option>
              {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <label className="block text-sm text-gray-600 mb-1">Shift Date</label>
            <input type="date" value={shiftDate} max={getKenyaDate()}
              onChange={e => setShiftDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-3 mb-3 text-base" />
            <div className="flex gap-2">
              <button onClick={() => setShowNew(false)} className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-600 font-medium">Cancel</button>
              <button onClick={handleOpen} disabled={!selectedEmp} className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">Open Shift</button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {shifts.map((s: any) => (
          <button key={s.id} onClick={() => navigate(`/shifts/${s.id}`)}
            className="w-full bg-white rounded-xl p-4 shadow-sm text-left flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-800">{s.employee_name}</p>
              <p className="text-xs text-gray-400">
                {s.shift_date
                  ? new Date(s.shift_date + 'T12:00:00').toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })
                  : new Date(s.start_time).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}
                {' '}{new Date(s.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {s.status === 'open'
              ? <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full"><Clock size={12}/> Open</span>
              : <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full"><CheckCircle size={12}/> Closed</span>
            }
          </button>
        ))}
        {shifts.length === 0 && <p className="text-center text-gray-400 mt-10">No shifts yet</p>}
      </div>
    </div>
  );
}
