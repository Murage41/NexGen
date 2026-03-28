import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Fuel, DollarSign, TrendingUp, TrendingDown, Gauge, LogOut } from 'lucide-react';

export default function Dashboard() {
  const { user, isAdmin, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const res = await getDashboard();
      setData(res.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const fmt = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-gray-500">Welcome back,</p>
          <h1 className="text-xl font-bold text-gray-800">{user?.name}</h1>
        </div>
        <button onClick={logout} className="p-2 text-gray-400 hover:text-red-500">
          <LogOut size={20} />
        </button>
      </div>

      {/* Current Shift */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Gauge size={18} className="text-blue-600" />
          <span className="font-semibold text-gray-700">Current Shift</span>
        </div>
        {data?.current_shift ? (
          <div>
            <p className="text-sm text-gray-600">{data.current_shift.employee_name}</p>
            <p className="text-xs text-gray-400">
              Started {new Date(data.current_shift.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <button
              onClick={() => navigate(`/shifts/${data.current_shift.id}`)}
              className="mt-2 w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium"
            >
              View Shift Details
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No active shift</p>
        )}
      </div>

      {/* Today's Summary */}
      {data && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white rounded-xl p-3 shadow-sm">
            <DollarSign size={20} className="text-green-500 mb-1" />
            <p className="text-xs text-gray-500">Today's Sales</p>
            <p className="text-lg font-bold text-gray-800">{fmt(data.today_sales)}</p>
          </div>
          <div className="bg-white rounded-xl p-3 shadow-sm">
            {data.today_variance >= 0
              ? <TrendingUp size={20} className="text-green-500 mb-1" />
              : <TrendingDown size={20} className="text-red-500 mb-1" />
            }
            <p className="text-xs text-gray-500">Variance</p>
            <p className={`text-lg font-bold ${data.today_variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {data.today_variance >= 0 ? '+' : ''}{fmt(data.today_variance)}
            </p>
          </div>
          <div className="bg-white rounded-xl p-3 shadow-sm">
            <Fuel size={20} className="text-blue-500 mb-1" />
            <p className="text-xs text-gray-500">Petrol</p>
            <p className="text-lg font-bold text-gray-800">{data.today_litres_petrol.toFixed(0)} L</p>
          </div>
          <div className="bg-white rounded-xl p-3 shadow-sm">
            <Fuel size={20} className="text-amber-500 mb-1" />
            <p className="text-xs text-gray-500">Diesel</p>
            <p className="text-lg font-bold text-gray-800">{data.today_litres_diesel.toFixed(0)} L</p>
          </div>
        </div>
      )}

      {/* Weekly mini chart (simplified for mobile) */}
      {data?.weekly_sales && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">This Week</p>
          <div className="flex items-end gap-1 h-24">
            {data.weekly_sales.map((d: any, i: number) => {
              const max = Math.max(...data.weekly_sales.map((s: any) => s.amount), 1);
              const h = (d.amount / max) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-blue-500 rounded-t"
                    style={{ height: `${Math.max(h, 4)}%` }}
                  />
                  <span className="text-[10px] text-gray-400 mt-1">
                    {new Date(d.date).toLocaleDateString('en-KE', { weekday: 'narrow' })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
