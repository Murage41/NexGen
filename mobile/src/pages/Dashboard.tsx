import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard, getTanks } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { LowStockNotice, TankLevels } from '../../../shared/ui/TankLowStock';
import { Gauge, LogOut, AlertTriangle, ChevronRight } from 'lucide-react';

const since = (iso: string) => new Date(iso).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Dashboard() {
  const { user, isAdmin, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [tanks, setTanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const res = await getDashboard();
      setData(res.data.data);
      // Tank levels for everyone (attendants see levels only).
      getTanks().then((tankRes) => setTanks(tankRes.data.data || [])).catch(() => {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const fmt = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="flex items-center justify-between -mx-4 -mt-4 mb-4 px-4 py-3.5 bg-gray-900 text-white">
        <div>
          <p className="text-xs text-gray-300">Welcome back,</p>
          <h1 className="text-lg font-bold text-white">{user?.name}</h1>
        </div>
        <button onClick={logout} className="p-2 text-gray-300 hover:text-white" aria-label="Sign out">
          <LogOut size={20} />
        </button>
      </div>

      {/* Tanks below their order level: everyone sees it (M7). */}
      <LowStockNotice tanks={data?.low_stock} onOpen={() => navigate('/tanks')} />

      {data?.stale_open_shifts?.shifts?.map((s: any) => (
        <button key={s.id} type="button" onClick={() => navigate(isAdmin ? `/shifts/${s.id}` : '/my-shift')} className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900">
          <AlertTriangle size={18} className="shrink-0" />
          <span className="flex-1"><strong>Shift #{s.id} open since {since(s.start_time)}</strong>{isAdmin && s.employee_name ? ` · ${s.employee_name}` : ''}</span>
          <ChevronRight size={16} />
        </button>
      ))}

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
              Since {since(data.current_shift.start_time)}
            </p>
            {/* Attendants open only their own shift. */}
            {(isAdmin || Number(data.current_shift.employee_id) === Number(user?.id)) && (
              // The attendant's own shift opens straight on recording (readings first).
              <button
                onClick={() => navigate(isAdmin ? `/shifts/${data.current_shift.id}` : `/shifts/${data.current_shift.id}/record`)}
                className="mt-2 w-full bg-blue-600 text-white py-3 rounded-lg text-base font-semibold"
              >
                {isAdmin ? 'Open shift' : 'Record my shift'}
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No active shift</p>
        )}
      </div>

      <TankLevels tanks={tanks} onOpen={() => navigate('/tanks')} />

      {/* Today's figures are the owner's; attendants get the shift status only. */}
      {isAdmin && data && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {([
            ['Sales today', fmt(data.today_net_sales ?? data.today_sales), '', '/shifts'],
            ['Profit this month', fmt(data.mtd_net_profit), data.mtd_net_profit < 0 ? 'text-red-600' : 'text-green-700', '/reports'],
            ['Customers owe', fmt(data.total_outstanding_credits), '', '/credits'],
            ['We owe suppliers', fmt(data.total_supplier_payables), data.total_supplier_payables > 0 ? 'text-red-600' : '', '/suppliers'],
          ] as Array<[string, string, string, string]>).map(([label, value, tone, to]) => (
            <button key={label} type="button" onClick={() => navigate(to)} className="bg-white rounded-xl p-3 shadow-sm text-left active:bg-gray-50">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-lg font-bold tabular-nums ${tone || 'text-gray-800'}`}>{value}</p>
            </button>
          ))}
        </div>
      )}

      {/* Weekly mini chart (simplified for mobile) */}
      {isAdmin && data?.weekly_sales && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">Last 7 days</p>
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
