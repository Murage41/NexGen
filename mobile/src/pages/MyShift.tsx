import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentShift, getShifts } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import { Clock, Edit3 } from 'lucide-react';

export default function MyShift() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<any>(null);
  const [myShifts, setMyShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [curRes, allRes] = await Promise.all([getCurrentShift(), getShifts()]);
      setCurrent(curRes.data.data);
      // Filter to this employee's shifts
      setMyShifts((allRes.data.data.shifts || []).filter((s: any) => s.employee_id === user?.id));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader title="My Shift" />

      {/* Current shift */}
      {current && current.employee_id === user?.id ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-green-600" />
            <span className="text-sm font-medium text-green-700">Active Shift</span>
          </div>
          <p className="text-xs text-gray-500">
            Started {new Date(current.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => navigate(`/shifts/${current.id}/record`)}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1">
              <Edit3 size={16} /> Record
            </button>
            <button onClick={() => navigate(`/shifts/${current.id}`)}
              className="flex-1 bg-white border border-gray-300 py-2.5 rounded-lg text-sm font-medium text-gray-700">
              View Details
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 text-center">
          <p className="text-sm text-gray-400">No active shift assigned to you</p>
        </div>
      )}

      {/* Past shifts */}
      <p className="text-sm font-semibold text-gray-600 mb-2">My Past Shifts</p>
      <div className="space-y-2">
        {myShifts.filter(s => s.status === 'closed').slice(0, 10).map(s => (
          <button key={s.id} onClick={() => navigate(`/shifts/${s.id}`)}
            className="w-full bg-white rounded-xl p-3 shadow-sm text-left flex justify-between items-center">
            <div>
              <p className="text-sm font-medium">{new Date(s.start_time).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              <p className="text-xs text-gray-400">{new Date(s.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">Closed</span>
          </button>
        ))}
        {myShifts.filter(s => s.status === 'closed').length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-4">No past shifts</p>
        )}
      </div>
    </div>
  );
}
