import { useState } from 'react';
import {
  BarChart3, Calendar, TrendingUp, TrendingDown, Droplets,
  AlertTriangle, Phone, ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import {
  getDailyReport, getMonthlyReport, getStockReconciliation,
  getStockReconciliationByShift, getDebtorAging, getCashFlow,
} from '../services/api';

type Tab = 'daily' | 'monthly' | 'stock' | 'debtors' | 'cashflow';

export default function Reports() {
  const [tab, setTab] = useState<Tab>('daily');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<any>(null);
  const [stockByShift, setStockByShift] = useState<any>(null);
  const [expandedMobileTank, setExpandedMobileTank] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const kes = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const litres = (n: number) => `${Number(n || 0).toFixed(1)} L`;
  const pct = (n: number | null) => n !== null && n !== undefined ? `${Number(n).toFixed(1)}%` : '—';

  async function loadReport() {
    setLoading(true);
    setReport(null);
    try {
      let res;
      switch (tab) {
        case 'daily': res = await getDailyReport(date); break;
        case 'monthly': res = await getMonthlyReport(month); break;
        case 'stock': {
          const [stockRes, shiftRes] = await Promise.all([
            getStockReconciliation(date),
            getStockReconciliationByShift(date),
          ]);
          res = stockRes;
          setStockByShift(shiftRes?.data?.data || null);
          break;
        }
        case 'debtors': res = await getDebtorAging(); break;
        case 'cashflow': res = await getCashFlow({ from: month + '-01', to: date }); break;
      }
      setReport(res?.data?.data || res?.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  function handleTabChange(newTab: Tab) {
    setTab(newTab);
    setReport(null);
  }

  // Build P&L rows
  function buildPnlRows(r: any) {
    if (!r) return [];
    if (tab === 'daily') {
      return [
        { label: 'Revenue (Sales)', value: kes(r.total_sales), section: true },
        { label: 'Petrol Sold', value: litres(r.petrol_litres), sub: true },
        { label: 'Diesel Sold', value: litres(r.diesel_litres), sub: true },
        { label: 'Cost of Fuel (COGS)', value: kes(r.cogs), negative: true },
        { label: 'Gross Profit', value: kes(r.gross_profit), highlight: true, positive: r.gross_profit >= 0 },
        { label: 'Wages Paid', value: kes(r.total_wages_paid), negative: true },
        { label: 'Expenses', value: kes(r.total_expenses), negative: true },
        { label: 'Net Profit', value: kes(r.net_profit), bold: true, positive: r.net_profit >= 0, negative: r.net_profit < 0 },
        { label: '─────', value: '', divider: true },
        { label: 'Gross Margin', value: pct(r.total_sales > 0 ? (r.gross_profit / r.total_sales) * 100 : 0), sub: true },
        { label: 'Collection Rate', value: pct(r.collection_rate), sub: true },
        { label: '─────', value: '', divider: true },
        { label: 'Cash', value: kes(r.total_cash) },
        { label: 'M-Pesa', value: kes(r.total_mpesa) },
        { label: 'Credits', value: kes(r.total_credits), warn: true },
      ];
    } else {
      return [
        { label: 'Revenue (Sales)', value: kes(r.total_sales), section: true },
        { label: 'Total Litres', value: litres(r.total_litres), sub: true },
        { label: 'Cost of Goods Sold', value: kes(r.cogs), negative: true },
        { label: 'Gross Profit', value: kes(r.gross_profit), highlight: true, positive: r.gross_profit >= 0 },
        { label: 'Wages Paid', value: kes(r.total_wages_paid), negative: true },
        { label: 'Operating Expenses', value: kes(r.total_expenses), negative: true },
        { label: 'Net Profit', value: kes(r.net_profit), bold: true, positive: r.net_profit >= 0, negative: r.net_profit < 0 },
        { label: '─────', value: '', divider: true },
        { label: 'Cash', value: kes(r.total_cash) },
        { label: 'M-Pesa', value: kes(r.total_mpesa) },
        { label: 'Credits', value: kes(r.total_credits), warn: true },
      ];
    }
  }

  return (
    <div className="pb-6">
      <PageHeader title="Reports" back />

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-xl p-1 mb-4 overflow-x-auto">
        {([
          { key: 'daily' as Tab, label: 'Daily' },
          { key: 'monthly' as Tab, label: 'Monthly' },
          { key: 'stock' as Tab, label: 'Stock' },
          { key: 'debtors' as Tab, label: 'Debtors' },
          { key: 'cashflow' as Tab, label: 'Cash Flow' },
        ]).map(t => (
          <button key={t.key} onClick={() => handleTabChange(t.key)}
            className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap px-2 ${
              tab === t.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Date/Month Picker */}
      {(tab === 'daily' || tab === 'monthly' || tab === 'stock' || tab === 'cashflow') && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
          <div className="flex items-center gap-3">
            <Calendar size={18} className="text-gray-400" />
            {(tab === 'daily' || tab === 'stock') ? (
              <input type="date"
                className="flex-1 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={date} onChange={e => setDate(e.target.value)} />
            ) : tab === 'monthly' ? (
              <input type="month"
                className="flex-1 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={month} onChange={e => setMonth(e.target.value)} />
            ) : (
              <input type="month"
                className="flex-1 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={month} onChange={e => setMonth(e.target.value)} />
            )}
            <button onClick={loadReport} disabled={loading}
              className="bg-blue-600 text-white px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50">
              {loading ? '...' : 'Go'}
            </button>
          </div>
        </div>
      )}

      {/* Debtors: just a button */}
      {tab === 'debtors' && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
          <button onClick={loadReport} disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50">
            {loading ? 'Loading...' : 'Load Debtor Aging Report'}
          </button>
        </div>
      )}

      {loading && <div className="text-center text-gray-400 mt-10">Loading report...</div>}

      {/* ── DAILY / MONTHLY P&L ── */}
      {!loading && report && (tab === 'daily' || tab === 'monthly') && (
        <div className="space-y-4">
          {/* P&L Card */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center gap-2">
              <BarChart3 size={18} className="text-blue-600" />
              <span className="font-semibold text-gray-700">
                {tab === 'daily' ? 'Daily P&L' : 'Monthly P&L'}
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {buildPnlRows(report).map((row: any, i: number) => {
                if (row.divider) return <div key={i} className="px-4 py-1 text-gray-200 text-xs">────────────────</div>;
                return (
                  <div key={i} className={`flex items-center justify-between px-4 py-3 ${
                    row.bold ? 'bg-blue-50' : row.highlight ? 'bg-green-50' : ''
                  } ${row.sub ? 'pl-8' : ''}`}>
                    <span className={`text-sm ${row.bold || row.section ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                      {row.label}
                    </span>
                    <div className="flex items-center gap-1">
                      {row.positive && !row.sub && <TrendingUp size={13} className="text-green-500" />}
                      {row.negative && !row.sub && <TrendingDown size={13} className="text-red-400" />}
                      <span className={`text-sm font-semibold ${
                        row.bold ? row.positive ? 'text-blue-700 text-base' : 'text-red-700 text-base'
                        : row.highlight ? row.positive ? 'text-green-700' : 'text-red-700'
                        : row.negative ? 'text-red-600'
                        : row.warn ? 'text-amber-600'
                        : row.sub ? 'text-gray-500'
                        : 'text-gray-800'
                      }`}>{row.value}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Unrecovered losses warning */}
          {report.unrecovered_losses > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm text-amber-700 font-medium">
                Unrecovered losses: {kes(report.unrecovered_losses)}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">Outstanding staff debts not yet deducted</p>
            </div>
          )}

          {/* Margin per litre */}
          {report.margin_per_litre && Object.keys(report.margin_per_litre).length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <span className="font-semibold text-gray-700">Margin per Litre</span>
              </div>
              <div className="divide-y divide-gray-50">
                {Object.entries(report.margin_per_litre).map(([fuel, margin]: any) => (
                  <div key={fuel} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-medium text-gray-700 capitalize">{fuel}</span>
                    <span className={`text-sm font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {kes(margin)} / L
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly: COGS Breakdown */}
          {tab === 'monthly' && report.opening_stock_value !== undefined && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <span className="font-semibold text-gray-700">COGS Breakdown</span>
              </div>
              <div className="divide-y divide-gray-50">
                <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">Opening Stock</span><span className="text-sm font-semibold">{kes(report.opening_stock_value)}</span></div>
                <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">+ Purchases</span><span className="text-sm font-semibold text-blue-600">{kes(report.purchases)}</span></div>
                <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">- Closing Stock</span><span className="text-sm font-semibold text-red-600">{kes(report.closing_stock_value)}</span></div>
                <div className="flex justify-between px-4 py-3 bg-gray-50"><span className="text-sm font-semibold text-gray-800">= COGS</span><span className="text-sm font-bold">{kes(report.cogs)}</span></div>
              </div>
            </div>
          )}

          {/* Monthly: Receivables */}
          {tab === 'monthly' && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <span className="font-semibold text-gray-700">Receivables</span>
              </div>
              <div className="divide-y divide-gray-50">
                <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">Opening</span><span className="text-sm font-semibold">{kes(report.opening_receivables)}</span></div>
                <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">+ New Credits</span><span className="text-sm font-semibold text-amber-600">{kes(report.total_credits)}</span></div>
                <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">- Payments</span><span className="text-sm font-semibold text-green-600">{kes(report.credit_payments_received)}</span></div>
                <div className="flex justify-between px-4 py-3 bg-gray-50"><span className="text-sm font-semibold text-gray-800">Closing</span><span className="text-sm font-bold text-amber-600">{kes(report.closing_receivables)}</span></div>
              </div>
            </div>
          )}

          {/* Fuel breakdown (monthly) */}
          {tab === 'monthly' && report.fuel_sales && report.fuel_sales.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <span className="font-semibold text-gray-700">Fuel Breakdown</span>
              </div>
              <div className="divide-y divide-gray-50">
                {report.fuel_sales.map((f: any, i: number) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-medium text-gray-700 capitalize">{f.fuel_type}</span>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-gray-800">{kes(f.total_sales)}</div>
                      <div className="text-xs text-gray-400">{litres(f.total_litres)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily shifts summary */}
          {tab === 'daily' && report.shifts && report.shifts.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <span className="font-semibold text-gray-700">Shifts</span>
              </div>
              <div className="divide-y divide-gray-50">
                {report.shifts.map((s: any, i: number) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{s.employee_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {s.start_time ? new Date(s.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                          {s.end_time ? ` – ${new Date(s.end_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : ' (open)'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-800">{kes(s.total_sales)}</p>
                        <p className={`text-xs font-medium mt-0.5 ${s.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {s.variance >= 0 ? '+' : ''}{kes(s.variance)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                      <span>Wage: <span className="font-medium text-gray-700">{kes(s.actual_wage_paid)}</span></span>
                      {s.wage_deduction > 0 && (
                        <span className="text-red-500">Deducted: {kes(s.wage_deduction)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tank snapshot (daily) */}
          {tab === 'daily' && report.tank_snapshot && report.tank_snapshot.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                <Droplets size={16} className="text-blue-500" />
                <span className="font-semibold text-gray-700">Tank Stock</span>
              </div>
              <div className="divide-y divide-gray-50">
                {report.tank_snapshot.map((t: any, i: number) => (
                  <div key={i} className={`px-4 py-3 ${t.variance_alert ? 'bg-red-50' : ''}`}>
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-sm font-medium text-gray-800">{t.label}</span>
                        <span className="text-xs text-gray-400 ml-1 capitalize">({t.fuel_type})</span>
                      </div>
                      <span className="text-sm font-semibold">{litres(t.book_stock)}</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-gray-500">
                      <span>Sales: {litres(t.sales_litres)}</span>
                      {t.deliveries_litres > 0 && <span className="text-blue-600">+{litres(t.deliveries_litres)}</span>}
                      {t.dip_reading !== null && (
                        <span className={t.variance_alert ? 'text-red-600 font-medium' : ''}>
                          Dip: {litres(t.dip_reading)}
                          {t.dip_variance !== null && ` (${t.dip_variance >= 0 ? '+' : ''}${litres(t.dip_variance)})`}
                          {t.variance_alert && ' !!!'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly expense categories */}
          {tab === 'monthly' && report.expense_categories && report.expense_categories.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <span className="font-semibold text-gray-700">Expenses by Category</span>
              </div>
              <div className="divide-y divide-gray-50">
                {report.expense_categories.map((cat: any, i: number) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-700">{cat.category}</span>
                    <span className="text-sm font-semibold text-red-600">{kes(cat.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STOCK RECONCILIATION ── */}
      {!loading && report && tab === 'stock' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center gap-2">
              <Droplets size={16} className="text-blue-500" />
              <span className="font-semibold text-gray-700">Stock Reconciliation</span>
            </div>
            <div className="divide-y divide-gray-50">
              {(report.tanks || []).map((t: any, i: number) => {
                const shiftTank = stockByShift?.tanks?.find((st: any) => st.tank_id === t.tank_id);
                const isExp = expandedMobileTank === t.tank_id;
                return (
                  <div key={i} className={`px-4 py-4 ${t.variance_alert ? 'bg-red-50' : ''}`}>
                    <div className="flex justify-between items-center mb-2" onClick={() => setExpandedMobileTank(isExp ? null : t.tank_id)}>
                      <span className="font-semibold text-gray-800">
                        <span className="text-gray-400 mr-1">{isExp ? '▼' : '▶'}</span>
                        {t.label} <span className="text-xs text-gray-400 capitalize">({t.fuel_type})</span>
                      </span>
                      {t.variance_alert && <AlertTriangle size={16} className="text-red-500" />}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-gray-500">Opening:</span> <span className="font-medium">{t.opening_stock !== null ? litres(t.opening_stock) : '—'}</span></div>
                      <div><span className="text-gray-500">Deliveries:</span> <span className="font-medium text-blue-600">{litres(t.deliveries)}</span></div>
                      <div><span className="text-gray-500">Sales:</span> <span className="font-medium">{litres(t.sales)}</span></div>
                      <div><span className="text-gray-500">Book Stock:</span> <span className="font-medium">{t.closing_book_stock !== null ? litres(t.closing_book_stock) : '—'}</span></div>
                      <div><span className="text-gray-500">Dip:</span> <span className="font-medium">{t.dip_reading !== null ? litres(t.dip_reading) : '—'}</span></div>
                      <div>
                        <span className="text-gray-500">Variance:</span>{' '}
                        <span className={`font-medium ${t.variance_alert ? 'text-red-600' : ''}`}>
                          {t.variance !== null ? `${litres(t.variance)} (${pct(t.variance_pct)})` : '—'}
                        </span>
                      </div>
                    </div>
                    {isExp && shiftTank?.shifts?.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {shiftTank.shifts.map((s: any, si: number) => (
                          <div key={si} className="bg-blue-50/50 rounded-lg p-2 text-xs">
                            <p className="font-medium text-gray-700 mb-1">{s.employee_name} <span className={`px-1 py-0.5 rounded text-[10px] ${s.status === 'closed' ? 'bg-gray-100' : 'bg-green-100 text-green-700'}`}>{s.status}</span></p>
                            <div className="grid grid-cols-2 gap-1">
                              <div><span className="text-gray-400">Opening:</span> {s.opening_stock != null ? `${Number(s.opening_stock).toFixed(1)} L` : '—'}</div>
                              <div><span className="text-gray-400">Sales:</span> <span className="text-red-600">{s.sales != null && s.sales > 0 ? `-${Number(s.sales).toFixed(1)} L` : '—'}</span></div>
                              <div><span className="text-gray-400">Deliveries:</span> <span className="text-green-600">{s.deliveries > 0 ? `+${Number(s.deliveries).toFixed(1)} L` : '—'}</span></div>
                              <div><span className="text-gray-400">Closing:</span> <span className="font-medium">{s.closing_stock != null ? `${Number(s.closing_stock).toFixed(1)} L` : '—'}</span></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {isExp && (!shiftTank?.shifts || shiftTank.shifts.length === 0) && (
                      <p className="mt-2 text-xs text-gray-400">No shift snapshots for this date</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── DEBTOR AGING ── */}
      {!loading && report && tab === 'debtors' && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <p className="text-xs text-gray-500">Total Outstanding</p>
              <p className="text-lg font-bold text-red-600">{kes(report.summary?.total_outstanding)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4">
              <p className="text-xs text-gray-500">Over 90 Days</p>
              <p className="text-lg font-bold text-red-700">{kes(report.summary?.days_90_plus)}</p>
            </div>
          </div>

          {/* Accounts */}
          <div className="space-y-3">
            {(report.accounts || []).map((a: any, i: number) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{a.name}</p>
                    {a.phone && <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><Phone size={10} />{a.phone}</p>}
                  </div>
                  <p className="text-sm font-bold text-red-600">{kes(a.total_outstanding)}</p>
                </div>
                <div className="flex gap-2 text-xs">
                  {a.current_0_30 > 0 && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">0-30d: {kes(a.current_0_30)}</span>}
                  {a.days_31_60 > 0 && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">31-60d: {kes(a.days_31_60)}</span>}
                  {a.days_61_90 > 0 && <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">61-90d: {kes(a.days_61_90)}</span>}
                  {a.days_90_plus > 0 && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">90d+: {kes(a.days_90_plus)}</span>}
                </div>
              </div>
            ))}
            {(report.accounts || []).length === 0 && (
              <div className="text-center text-gray-400 mt-8">No outstanding debts.</div>
            )}
          </div>
        </div>
      )}

      {/* ── CASH FLOW ── */}
      {!loading && report && tab === 'cashflow' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-gray-500">Net Cash Flow</p>
            <p className={`text-2xl font-bold ${report.net_cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {kes(report.net_cash_flow)}
            </p>
          </div>

          {/* Inflows */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-green-100 flex items-center gap-2">
              <ArrowDownCircle size={16} className="text-green-500" />
              <span className="font-semibold text-green-700">Inflows: {kes(report.inflows?.total)}</span>
            </div>
            <div className="divide-y divide-gray-50">
              <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">Cash Sales</span><span className="text-sm font-semibold text-green-600">{kes(report.inflows?.cash_sales)}</span></div>
              <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">M-Pesa Sales</span><span className="text-sm font-semibold text-green-600">{kes(report.inflows?.mpesa_sales)}</span></div>
              <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">Credit Payments</span><span className="text-sm font-semibold text-green-600">{kes(report.inflows?.credit_payments_received)}</span></div>
            </div>
          </div>

          {/* Outflows */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-red-100 flex items-center gap-2">
              <ArrowUpCircle size={16} className="text-red-500" />
              <span className="font-semibold text-red-700">Outflows: {kes(report.outflows?.total)}</span>
            </div>
            <div className="divide-y divide-gray-50">
              <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">Fuel Purchases</span><span className="text-sm font-semibold text-red-600">{kes(report.outflows?.fuel_purchases)}</span></div>
              <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">Wages Paid</span><span className="text-sm font-semibold text-red-600">{kes(report.outflows?.wages_paid)}</span></div>
              <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">Shift Expenses</span><span className="text-sm font-semibold text-red-600">{kes(report.outflows?.shift_expenses)}</span></div>
              <div className="flex justify-between px-4 py-3"><span className="text-sm text-gray-600">General Expenses</span><span className="text-sm font-semibold text-red-600">{kes(report.outflows?.general_expenses)}</span></div>
            </div>
          </div>

          {/* Outstanding */}
          {report.outstanding_receivables > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm text-amber-700 font-medium">
                Outstanding Receivables: {kes(report.outstanding_receivables)}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">Not yet collected from credit customers</p>
            </div>
          )}
        </div>
      )}

      {!loading && !report && (
        <div className="text-center mt-10">
          <BarChart3 size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">
            {tab === 'debtors' ? 'Tap the button above to load' : `Select a ${tab === 'monthly' || tab === 'cashflow' ? 'month' : 'date'} and tap Go`}
          </p>
        </div>
      )}
    </div>
  );
}
