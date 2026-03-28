import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Fuel, DollarSign, TrendingUp, TrendingDown, AlertCircle, Gauge } from 'lucide-react';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      const res = await getDashboard();
      setData(res.data.data);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!data) return <div className="text-red-500">Failed to load dashboard. Is the backend running?</div>;

  const formatKES = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Today's Sales</p>
              <p className="text-2xl font-bold text-gray-800">{formatKES(data.today_sales)}</p>
            </div>
            <DollarSign className="text-green-500" size={32} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Petrol Sold</p>
              <p className="text-2xl font-bold text-gray-800">{data.today_litres_petrol.toFixed(1)} L</p>
            </div>
            <Fuel className="text-blue-500" size={32} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Diesel Sold</p>
              <p className="text-2xl font-bold text-gray-800">{data.today_litres_diesel.toFixed(1)} L</p>
            </div>
            <Fuel className="text-amber-500" size={32} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Variance</p>
              <p className={`text-2xl font-bold ${data.today_variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatKES(data.today_variance)}
              </p>
            </div>
            {data.today_variance >= 0 ? (
              <TrendingUp className="text-green-500" size={32} />
            ) : (
              <TrendingDown className="text-red-500" size={32} />
            )}
          </div>
        </div>
      </div>

      {/* Current Shift + Weekly Chart */}
      <div className="grid grid-cols-3 gap-4">
        {/* Current Shift */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Gauge size={20} /> Current Shift
          </h2>
          {data.current_shift ? (
            <div>
              <p className="text-gray-600">Employee: <strong>{data.current_shift.employee_name}</strong></p>
              <p className="text-gray-600">Started: <strong>{new Date(data.current_shift.start_time).toLocaleTimeString()}</strong></p>
              <p className="mt-2">
                <span className="inline-block px-2 py-1 bg-green-100 text-green-700 rounded text-sm font-medium">
                  Open
                </span>
              </p>
              <button
                onClick={() => navigate(`/shifts/${data.current_shift.id}`)}
                className="mt-3 text-blue-600 hover:underline text-sm"
              >
                View Shift Details &rarr;
              </button>
            </div>
          ) : (
            <div className="text-gray-400 flex items-center gap-2">
              <AlertCircle size={16} /> No active shift
            </div>
          )}
        </div>

        {/* Weekly Sales Chart */}
        <div className="col-span-2 bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Weekly Sales</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.weekly_sales}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-KE', { weekday: 'short' })}
              />
              <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => [formatKES(value), 'Sales']}
                labelFormatter={(d: string) => new Date(d).toLocaleDateString('en-KE', { weekday: 'long', month: 'short', day: 'numeric' })}
              />
              <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
