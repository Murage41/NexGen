import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../services/api';
import { LowStockNotice } from '../../../../shared/ui/TankLowStock';
import { AlertCircle, ChevronRight } from 'lucide-react';

const formatKES = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const litres = (n: number) => `${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L`;
const sinceLabel = (iso: string) => new Date(iso).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Tile({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad'; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="bg-white rounded-lg shadow p-4 text-left hover:ring-2 hover:ring-blue-100 disabled:hover:ring-0"
    >
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">{title}</h2>
      <div className="grid grid-cols-4 gap-4">{children}</div>
    </section>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getDashboard()
      .then((res) => setData(res.data.data))
      .catch((err) => console.error('Failed to load dashboard:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!data) return <div className="text-red-500">No connection to the station server.</div>;

  const drift = data.drift_check as { ok: boolean } | undefined;
  const stale = data.stale_open_shifts as { count: number; shifts: any[] } | undefined;
  const shift = data.current_shift;
  const lowIds = new Set((data.low_stock || []).map((t: any) => t.id));
  const todayLabel = new Date().toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-4">
        Today <span className="text-base font-medium text-gray-500">{todayLabel}</span>
      </h1>

      {drift && !drift.ok && (
        <button type="button" onClick={() => navigate('/settings')}
          className="mb-4 flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-left text-sm text-red-800">
          <AlertCircle size={18} className="shrink-0" />
          <span><strong>Some stored balances disagree with the records.</strong> Run System check in Settings.</span>
        </button>
      )}

      {stale && stale.count > 0 && stale.shifts.map((s: any) => (
        <button key={s.id} type="button" onClick={() => navigate(`/shifts/${s.id}`)}
          className="mb-4 flex w-full items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900 hover:bg-amber-100">
          <span><strong>Shift #{s.id} open since {sinceLabel(s.start_time)}</strong>{s.employee_name ? ` · ${s.employee_name}` : ''}</span>
          <ChevronRight size={16} />
        </button>
      ))}

      <LowStockNotice tanks={data.low_stock} onOpen={() => navigate('/tank-stock')} />

      <Section title="Today">
        <Tile label="Sales so far" value={formatKES(data.today_net_sales ?? data.today_sales)}
          sub={`Petrol ${litres(data.today_litres_petrol)} · Diesel ${litres(data.today_litres_diesel)}`} onClick={() => navigate('/shifts')} />
        <Tile label="On credit" value={formatKES(data.today_collections?.credits)} onClick={() => navigate('/customers')} />
        <Tile label="Profit (closed shifts)" value={formatKES(data.today_net_profit)} tone={data.today_net_profit < 0 ? 'bad' : undefined} onClick={() => navigate('/reports')} />
        {shift ? (
          <Tile label="Open shift" value={`#${shift.id} ${shift.employee_name || ''}`} sub={`Since ${sinceLabel(shift.start_time)}`} onClick={() => navigate(`/shifts/${shift.id}`)} />
        ) : (
          <Tile label="Open shift" value="None" onClick={() => navigate('/shifts')} />
        )}
      </Section>

      <Section title="This month">
        <Tile label="Sales" value={formatKES(data.mtd_net_sales ?? data.mtd_sales)} sub={litres(data.mtd_litres)} onClick={() => navigate('/reports?tab=monthly')} />
        <Tile label="Profit" value={formatKES(data.mtd_net_profit)} tone={data.mtd_net_profit < 0 ? 'bad' : 'good'} onClick={() => navigate('/reports?tab=monthly')} />
        <Tile label="Expenses" value={formatKES(data.mtd_expenses)} sub={`Wages ${formatKES(data.mtd_wages_paid)}`} onClick={() => navigate('/expenses')} />
        <Tile label="Shortages owed" value={formatKES(data.total_outstanding_staff_debts)} tone={data.total_outstanding_staff_debts > 0 ? 'bad' : undefined} onClick={() => navigate('/employees')} />
      </Section>

      <Section title="Money owed">
        <Tile label="Customers owe us" value={formatKES(data.total_outstanding_credits)} onClick={() => navigate('/customers')} />
        <Tile label="We owe suppliers" value={formatKES(data.total_supplier_payables)} tone={data.total_supplier_payables > 0 ? 'bad' : undefined} onClick={() => navigate('/suppliers')} />
        <button type="button" onClick={() => navigate('/tank-stock')} className="col-span-2 bg-white rounded-lg shadow p-4 text-left hover:ring-2 hover:ring-blue-100">
          <p className="text-xs font-semibold text-gray-500 mb-2">Tanks</p>
          <div className="grid grid-cols-[9rem_1fr_5rem] gap-x-3 gap-y-2 items-center text-sm">
            {(data.tank_stock_summary || []).map((t: any) => {
              const pct = Math.max(0, Math.min(Number(t.pct_full) || 0, 100));
              return [
                <span key={`l${t.id}`} className="truncate">{t.label}</span>,
                <span key={`b${t.id}`} className="h-2 rounded bg-gray-100 overflow-hidden"><span className={`block h-full ${lowIds.has(t.id) ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${pct}%` }} /></span>,
                <span key={`v${t.id}`} className={`text-right tabular-nums ${lowIds.has(t.id) ? 'text-red-600 font-semibold' : ''}`}>{litres(t.current_stock)}</span>,
              ];
            })}
          </div>
        </button>
      </Section>
    </div>
  );
}
