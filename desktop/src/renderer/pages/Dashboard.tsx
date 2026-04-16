import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Fuel, DollarSign, TrendingUp, TrendingDown, AlertCircle, Gauge, Droplets, CreditCard, Users, BarChart3 } from 'lucide-react';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { loadDashboard(); }, []);

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

  const formatKES = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const drift = data.drift_check as
    | { ok: boolean; dip_drift_count: number; account_drift_count: number }
    | undefined;
  const hasDrift = drift && !drift.ok;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h1>

      {/* Phase 11: Reconciliation drift banner. Category C caches (dip book
          stock, credit-account balance) disagree with their recomputed truth
          — usually indicates a new mutation path that skipped the recompute
          helper. Hit /api/health/drift-check for per-row detail. */}
      {hasDrift && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 flex-shrink-0" size={20} />
          <div>
            <p className="font-semibold">
              Reconciliation drift detected
            </p>
            <p>
              {drift.dip_drift_count} tank dip{drift.dip_drift_count === 1 ? '' : 's'}
              {' and '}
              {drift.account_drift_count} credit account{drift.account_drift_count === 1 ? '' : 's'}
              {' '}have cached values that disagree with the computed truth. Run{' '}
              <code className="rounded bg-red-100 px-1">/api/health/drift-check</code>{' '}
              for details, then <code className="rounded bg-red-100 px-1">/api/health/phase1-backfill</code> to repair.
            </p>
          </div>
        </div>
      )}

      {/* Row 1: Today's Summary */}
      <div className="grid grid-cols-4 gap-4 mb-4">
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
              <p className="text-sm text-gray-500">Today's Net Profit</p>
              <p className={`text-2xl font-bold ${data.today_net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatKES(data.today_net_profit)}
              </p>
            </div>
            {data.today_net_profit >= 0 ? (
              <TrendingUp className="text-green-500" size={32} />
            ) : (
              <TrendingDown className="text-red-500" size={32} />
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Business Health */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Month-to-Date Sales</p>
              <p className="text-2xl font-bold text-gray-800">{formatKES(data.mtd_sales)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{Number(data.mtd_litres || 0).toFixed(0)} L sold</p>
            </div>
            <BarChart3 className="text-blue-400" size={28} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">MTD Net Profit</p>
              <p className={`text-2xl font-bold ${data.mtd_net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatKES(data.mtd_net_profit)}
              </p>
            </div>
            {data.mtd_net_profit >= 0 ? (
              <TrendingUp className="text-green-400" size={28} />
            ) : (
              <TrendingDown className="text-red-400" size={28} />
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Outstanding Credits</p>
              <p className={`text-2xl font-bold ${data.total_outstanding_credits > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {formatKES(data.total_outstanding_credits)}
              </p>
            </div>
            <CreditCard className="text-amber-400" size={28} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Unrecovered Losses</p>
              <p className={`text-2xl font-bold ${data.total_outstanding_staff_debts > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {formatKES(data.total_outstanding_staff_debts)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Outstanding staff debts</p>
            </div>
            <Users className="text-red-400" size={28} />
          </div>
        </div>
      </div>

      {/* Row 3: Current Shift + Weekly Chart */}
      <div className="grid grid-cols-3 gap-4 mb-4">
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
              <button onClick={() => navigate(`/shifts/${data.current_shift.id}`)}
                className="mt-3 text-blue-600 hover:underline text-sm">
                View Shift Details &rarr;
              </button>
            </div>
          ) : (
            <div className="text-gray-400 flex items-center gap-2">
              <AlertCircle size={16} /> No active shift
            </div>
          )}

          {/* Today's Collections mini-summary */}
          {data.today_collections && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 font-medium mb-2">Today's Collections</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Cash</span>
                  <span className="font-medium">{formatKES(data.today_collections.cash)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">M-Pesa</span>
                  <span className="font-medium">{formatKES(data.today_collections.mpesa)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-600">Credits</span>
                  <span className="font-medium text-amber-600">{formatKES(data.today_collections.credits)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="col-span-2 bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Weekly Sales</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.weekly_sales}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date"
                tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-KE', { weekday: 'short' })} />
              <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => [formatKES(value), 'Sales']}
                labelFormatter={(d: string) => new Date(d).toLocaleDateString('en-KE', { weekday: 'long', month: 'short', day: 'numeric' })} />
              <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 4: Tank Stock Levels */}
      {data.tank_stock_summary && data.tank_stock_summary.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Droplets size={20} /> Tank Stock Levels
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {data.tank_stock_summary.map((tank: any) => {
              const pctFull = Math.min(tank.pct_full, 100);
              const barColor = pctFull < 15 ? 'bg-red-500' : pctFull < 30 ? 'bg-amber-500' : 'bg-blue-500';
              return (
                <div key={tank.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-medium text-gray-800">{tank.label}</span>
                      <span className="text-xs text-gray-400 ml-2 capitalize">({tank.fuel_type})</span>
                    </div>
                    <span className={`text-sm font-bold ${pctFull < 15 ? 'text-red-600' : pctFull < 30 ? 'text-amber-600' : 'text-blue-600'}`}>
                      {pctFull.toFixed(0)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className={`${barColor} h-3 rounded-full transition-all`}
                      style={{ width: `${pctFull}%` }} />
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-gray-400">
                    <span>{Number(tank.current_stock).toFixed(0)} L</span>
                    <span>/ {Number(tank.capacity).toFixed(0)} L</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Margin per litre */}
      {data.margin_per_litre && Object.keys(data.margin_per_litre).length > 0 && (
        <div className="grid grid-cols-2 gap-4 mt-4">
          {Object.entries(data.margin_per_litre).map(([fuel, margin]: any) => (
            <div key={fuel} className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 capitalize">{fuel} Margin per Litre</p>
                <p className={`text-lg font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatKES(margin)}
                </p>
              </div>
              <Fuel className={margin >= 0 ? 'text-green-400' : 'text-red-400'} size={24} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
