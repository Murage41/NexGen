import { useState } from 'react';
import {
  getDailyReport, getMonthlyReport, getStockReconciliation,
  getDebtorAging, getCashFlow,
} from '../services/api';
import {
  BarChart3, Calendar, TrendingUp, TrendingDown, Minus,
  Droplets, AlertTriangle, Phone, ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';

type Tab = 'daily' | 'monthly' | 'stock' | 'debtors' | 'cashflow';

export default function Reports() {
  const [activeTab, setActiveTab] = useState<Tab>('daily');
  const [loading, setLoading] = useState(false);

  // Daily
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [dailyData, setDailyData] = useState<any>(null);

  // Monthly
  const [monthlyMonth, setMonthlyMonth] = useState(new Date().toISOString().slice(0, 7));
  const [monthlyData, setMonthlyData] = useState<any>(null);

  // Stock Reconciliation
  const [stockDate, setStockDate] = useState(new Date().toISOString().split('T')[0]);
  const [stockData, setStockData] = useState<any>(null);

  // Debtor Aging
  const [debtorData, setDebtorData] = useState<any>(null);

  // Cash Flow
  const [cfFrom, setCfFrom] = useState(new Date().toISOString().slice(0, 7) + '-01');
  const [cfTo, setCfTo] = useState(new Date().toISOString().split('T')[0]);
  const [cfData, setCfData] = useState<any>(null);

  async function loadDailyReport() {
    setLoading(true);
    try { const res = await getDailyReport(dailyDate); setDailyData(res.data.data); }
    catch { setDailyData(null); }
    finally { setLoading(false); }
  }
  async function loadMonthlyReport() {
    setLoading(true);
    try { const res = await getMonthlyReport(monthlyMonth); setMonthlyData(res.data.data); }
    catch { setMonthlyData(null); }
    finally { setLoading(false); }
  }
  async function loadStockReport() {
    setLoading(true);
    try { const res = await getStockReconciliation(stockDate); setStockData(res.data.data); }
    catch { setStockData(null); }
    finally { setLoading(false); }
  }
  async function loadDebtorReport() {
    setLoading(true);
    try { const res = await getDebtorAging(); setDebtorData(res.data.data); }
    catch { setDebtorData(null); }
    finally { setLoading(false); }
  }
  async function loadCashFlow() {
    setLoading(true);
    try { const res = await getCashFlow({ from: cfFrom, to: cfTo }); setCfData(res.data.data); }
    catch { setCfData(null); }
    finally { setLoading(false); }
  }

  const kes = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const litres = (n: number) => `${Number(n || 0).toFixed(1)} L`;
  const pct = (n: number | null) => n !== null && n !== undefined ? `${Number(n).toFixed(1)}%` : '—';

  function PnLRow({ label, value, indent = false, bold = false, color = '', border = false }: {
    label: string; value: string | number; indent?: boolean; bold?: boolean; color?: string; border?: boolean;
  }) {
    return (
      <div className={`flex items-center justify-between py-2 px-4 ${border ? 'border-t border-gray-200 mt-1' : ''} ${indent ? 'pl-8' : ''}`}>
        <span className={`text-sm ${bold ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{label}</span>
        <span className={`text-sm font-mono ${bold ? 'font-bold' : 'font-medium'} ${color || 'text-gray-800'}`}>
          {typeof value === 'number' ? kes(value) : value}
        </span>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'daily', label: 'Daily Report' },
    { key: 'monthly', label: 'Monthly Report' },
    { key: 'stock', label: 'Stock Reconciliation' },
    { key: 'debtors', label: 'Debtor Aging' },
    { key: 'cashflow', label: 'Cash Flow' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mb-6">
        <BarChart3 size={24} /> Reports
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── DAILY ─────────────────────────────────────────────────── */}
      {activeTab === 'daily' && (
        <div>
          <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4">
            <Calendar size={18} className="text-gray-400" />
            <input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)}
              className="border border-gray-300 rounded-lg p-2 text-sm" />
            <button onClick={loadDailyReport} disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
              {loading ? 'Loading...' : 'Generate Report'}
            </button>
          </div>

          {dailyData && (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-5 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Total Sales</p>
                  <p className="text-xl font-bold text-gray-800">{kes(dailyData.total_sales)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Petrol Sold</p>
                  <p className="text-xl font-bold text-gray-800">{litres(dailyData.petrol_litres)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Diesel Sold</p>
                  <p className="text-xl font-bold text-gray-800">{litres(dailyData.diesel_litres)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Gross Margin</p>
                  <p className={`text-xl font-bold ${dailyData.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {pct(dailyData.total_sales > 0 ? (dailyData.gross_profit / dailyData.total_sales) * 100 : 0)}
                  </p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Net Profit</p>
                  <p className={`text-xl font-bold ${dailyData.net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kes(dailyData.net_profit)}
                  </p>
                </div>
              </div>

              {/* Margin per litre */}
              {dailyData.margin_per_litre && Object.keys(dailyData.margin_per_litre).length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(dailyData.margin_per_litre).map(([fuel, margin]: any) => (
                    <div key={fuel} className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500 mb-1 capitalize">{fuel} Margin/Litre</p>
                        <p className={`text-lg font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {kes(margin)}
                        </p>
                      </div>
                      <div className="text-xs text-gray-400">
                        Cost: {kes(dailyData.avg_cost_per_litre?.[fuel] || 0)}/L
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                {/* P&L Statement */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Profit & Loss</h2>
                  </div>
                  <div className="py-2">
                    <PnLRow label="Revenue (Sales)" value={dailyData.total_sales} bold color="text-gray-800" />
                    <PnLRow label="Cost of Fuel (COGS)" value={-dailyData.cogs} indent color="text-red-600" />
                    <PnLRow label="Gross Profit" value={dailyData.gross_profit} bold border
                      color={dailyData.gross_profit >= 0 ? 'text-green-700' : 'text-red-600'} />
                    <PnLRow label="Wages Paid" value={-dailyData.total_wages_paid} indent color="text-red-600" />
                    <PnLRow label="Shift Expenses" value={-dailyData.total_shift_expenses} indent color="text-red-600" />
                    <PnLRow label="General Expenses" value={-dailyData.total_day_expenses} indent color="text-red-600" />
                    <PnLRow label="Net Profit" value={dailyData.net_profit} bold border
                      color={dailyData.net_profit >= 0 ? 'text-green-700' : 'text-red-600'} />
                    {dailyData.unrecovered_losses > 0 && (
                      <div className="mx-4 mt-3 p-2 bg-amber-50 rounded border border-amber-200">
                        <p className="text-xs text-amber-700 font-medium">
                          Unrecovered losses: {kes(dailyData.unrecovered_losses)} (outstanding staff debts)
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Collections Breakdown */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Collections</h2>
                  </div>
                  <div className="py-2">
                    <PnLRow label="Cash" value={dailyData.total_cash} />
                    <PnLRow label="M-Pesa" value={dailyData.total_mpesa} />
                    <PnLRow label="Credits (on account)" value={dailyData.total_credits} color="text-amber-600" />
                    <PnLRow label="Total Collected"
                      value={dailyData.total_cash + dailyData.total_mpesa + dailyData.total_credits}
                      bold border />
                    <div className="px-4 py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Collection Rate</span>
                        <span className={`font-semibold ${dailyData.collection_rate >= 99 ? 'text-green-600' : dailyData.collection_rate >= 95 ? 'text-amber-600' : 'text-red-600'}`}>
                          {pct(dailyData.collection_rate)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Shifts Table */}
              {dailyData.shifts && dailyData.shifts.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Shifts</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-3 font-medium text-gray-600">Employee</th>
                        <th className="text-left p-3 font-medium text-gray-600">Time</th>
                        <th className="text-right p-3 font-medium text-gray-600">Petrol</th>
                        <th className="text-right p-3 font-medium text-gray-600">Diesel</th>
                        <th className="text-right p-3 font-medium text-gray-600">Sales</th>
                        <th className="text-right p-3 font-medium text-gray-600">Collections</th>
                        <th className="text-right p-3 font-medium text-gray-600">Variance</th>
                        <th className="text-right p-3 font-medium text-gray-600">Wage Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyData.shifts.map((s: any, i: number) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="p-3 font-medium">{s.employee_name}</td>
                          <td className="p-3 text-gray-500 text-xs">
                            {s.start_time ? new Date(s.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '-'}
                            {s.end_time ? ` – ${new Date(s.end_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : ' (open)'}
                          </td>
                          <td className="p-3 text-right text-gray-600">{litres(s.petrol_litres)}</td>
                          <td className="p-3 text-right text-gray-600">{litres(s.diesel_litres)}</td>
                          <td className="p-3 text-right">{kes(s.total_sales)}</td>
                          <td className="p-3 text-right">{kes(s.total_collections)}</td>
                          <td className={`p-3 text-right font-medium ${s.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {s.variance >= 0
                              ? <span className="flex items-center justify-end gap-1"><TrendingUp size={12} />{kes(s.variance)}</span>
                              : <span className="flex items-center justify-end gap-1"><TrendingDown size={12} />{kes(s.variance)}</span>
                            }
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {kes(s.actual_wage_paid)}
                            {s.wage_deduction > 0 && (
                              <span className="block text-xs text-red-500">-{kes(s.wage_deduction)} deducted</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tank Stock Snapshot */}
              {dailyData.tank_snapshot && dailyData.tank_snapshot.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                      <Droplets size={16} /> Tank Stock Snapshot
                    </h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-3 font-medium text-gray-600">Tank</th>
                        <th className="text-left p-3 font-medium text-gray-600">Fuel</th>
                        <th className="text-right p-3 font-medium text-gray-600">Sales (L)</th>
                        <th className="text-right p-3 font-medium text-gray-600">Deliveries (L)</th>
                        <th className="text-right p-3 font-medium text-gray-600">Book Stock</th>
                        <th className="text-right p-3 font-medium text-gray-600">Dip Reading</th>
                        <th className="text-right p-3 font-medium text-gray-600">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyData.tank_snapshot.map((t: any, i: number) => (
                        <tr key={i} className={`border-t hover:bg-gray-50 ${t.variance_alert ? 'bg-red-50' : ''}`}>
                          <td className="p-3 font-medium">{t.label}</td>
                          <td className="p-3 capitalize text-gray-600">{t.fuel_type}</td>
                          <td className="p-3 text-right">{litres(t.sales_litres)}</td>
                          <td className="p-3 text-right">{litres(t.deliveries_litres)}</td>
                          <td className="p-3 text-right font-medium">{litres(t.book_stock)}</td>
                          <td className="p-3 text-right">{t.dip_reading !== null ? litres(t.dip_reading) : '—'}</td>
                          <td className={`p-3 text-right font-medium ${t.variance_alert ? 'text-red-600' : t.dip_variance !== null ? 'text-gray-600' : 'text-gray-300'}`}>
                            {t.dip_variance !== null ? (
                              <span className="flex items-center justify-end gap-1">
                                {t.variance_alert && <AlertTriangle size={12} />}
                                {litres(t.dip_variance)} ({pct(t.variance_pct)})
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* General Expenses */}
              {dailyData.expenses && dailyData.expenses.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">General Expenses</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-3 font-medium text-gray-600">Category</th>
                        <th className="text-left p-3 font-medium text-gray-600">Description</th>
                        <th className="text-right p-3 font-medium text-gray-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyData.expenses.map((exp: any, i: number) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="p-3 font-medium">{exp.category}</td>
                          <td className="p-3 text-gray-500">{exp.description || '—'}</td>
                          <td className="p-3 text-right text-red-600">{kes(exp.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!dailyData && !loading && (
            <div className="bg-white rounded-lg shadow p-10 text-center text-gray-400">
              Select a date and click "Generate Report".
            </div>
          )}
        </div>
      )}

      {/* ── MONTHLY ───────────────────────────────────────────────── */}
      {activeTab === 'monthly' && (
        <div>
          <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4">
            <Calendar size={18} className="text-gray-400" />
            <input type="month" value={monthlyMonth} onChange={e => setMonthlyMonth(e.target.value)}
              className="border border-gray-300 rounded-lg p-2 text-sm" />
            <button onClick={loadMonthlyReport} disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
              {loading ? 'Loading...' : 'Generate Report'}
            </button>
          </div>

          {monthlyData && (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-5 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
                  <p className="text-xl font-bold text-gray-800">{kes(monthlyData.total_sales)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Total Litres Sold</p>
                  <p className="text-xl font-bold text-gray-800">{litres(monthlyData.total_litres)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Gross Profit</p>
                  <p className={`text-xl font-bold ${monthlyData.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kes(monthlyData.gross_profit)}
                  </p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Net Profit</p>
                  <p className={`text-xl font-bold ${monthlyData.net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kes(monthlyData.net_profit)}
                  </p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Gross Margin</p>
                  <p className={`text-xl font-bold ${monthlyData.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {pct(monthlyData.total_sales > 0 ? (monthlyData.gross_profit / monthlyData.total_sales) * 100 : 0)}
                  </p>
                </div>
              </div>

              {/* Margin per litre */}
              {monthlyData.margin_per_litre && Object.keys(monthlyData.margin_per_litre).length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(monthlyData.margin_per_litre).map(([fuel, margin]: any) => (
                    <div key={fuel} className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500 mb-1 capitalize">{fuel} Margin/Litre</p>
                        <p className={`text-lg font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {kes(margin)}
                        </p>
                      </div>
                      <div className="text-xs text-gray-400">
                        Avg Cost: {kes(monthlyData.avg_cost_per_litre?.[fuel] || 0)}/L
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                {/* Income Statement */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Income Statement</h2>
                    <p className="text-xs text-gray-400 mt-0.5">{monthlyData.month}</p>
                  </div>
                  <div className="py-2">
                    <PnLRow label="Revenue" value={monthlyData.total_sales} bold color="text-gray-800" />
                    <PnLRow label="Cost of Goods Sold (COGS)" value={-monthlyData.cogs} indent color="text-red-600" />
                    <PnLRow label="Gross Profit" value={monthlyData.gross_profit} bold border
                      color={monthlyData.gross_profit >= 0 ? 'text-green-700' : 'text-red-600'} />
                    <PnLRow label="Wages Paid" value={-monthlyData.total_wages_paid} indent color="text-red-600" />
                    <PnLRow label="Operating Expenses" value={-monthlyData.total_expenses} indent color="text-red-600" />
                    <PnLRow label="Net Profit" value={monthlyData.net_profit} bold border
                      color={monthlyData.net_profit >= 0 ? 'text-green-700' : 'text-red-600'} />
                    {monthlyData.unrecovered_losses > 0 && (
                      <div className="mx-4 mt-3 p-2 bg-amber-50 rounded border border-amber-200">
                        <p className="text-xs text-amber-700 font-medium">
                          Unrecovered staff deficits: {kes(monthlyData.unrecovered_losses)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* COGS Breakdown + Fuel + Collections */}
                <div className="space-y-6">
                  {/* COGS Breakdown */}
                  <div className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="p-4 border-b bg-gray-50">
                      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">COGS Breakdown</h2>
                    </div>
                    <div className="py-2">
                      <PnLRow label="Opening Stock Value" value={monthlyData.opening_stock_value} />
                      <PnLRow label="+ Fuel Purchases" value={monthlyData.purchases} color="text-blue-600" />
                      <PnLRow label="- Closing Stock Value" value={-monthlyData.closing_stock_value} color="text-red-600" />
                      <PnLRow label="= Cost of Goods Sold" value={monthlyData.cogs} bold border />
                    </div>
                  </div>

                  {/* Fuel Breakdown */}
                  <div className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="p-4 border-b bg-gray-50">
                      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Fuel Breakdown</h2>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left p-3 font-medium text-gray-600">Fuel Type</th>
                          <th className="text-right p-3 font-medium text-gray-600">Litres Sold</th>
                          <th className="text-right p-3 font-medium text-gray-600">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(monthlyData.fuel_sales || []).map((row: any, i: number) => (
                          <tr key={i} className="border-t hover:bg-gray-50">
                            <td className="p-3 font-medium capitalize">{row.fuel_type}</td>
                            <td className="p-3 text-right">{litres(row.total_litres)}</td>
                            <td className="p-3 text-right">{kes(row.total_sales)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Receivables Movement + Collections */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Receivables Movement</h2>
                  </div>
                  <div className="py-2">
                    <PnLRow label="Opening Receivables" value={monthlyData.opening_receivables} />
                    <PnLRow label="+ New Credits Issued" value={monthlyData.total_credits} color="text-amber-600" indent />
                    <PnLRow label="- Payments Received" value={-monthlyData.credit_payments_received} color="text-green-600" indent />
                    <PnLRow label="Closing Receivables" value={monthlyData.closing_receivables} bold border
                      color={monthlyData.closing_receivables > 0 ? 'text-amber-600' : 'text-green-600'} />
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Collections</h2>
                  </div>
                  <div className="py-2">
                    <PnLRow label="Cash" value={monthlyData.total_cash} />
                    <PnLRow label="M-Pesa" value={monthlyData.total_mpesa} />
                    <PnLRow label="Credits (on account)" value={monthlyData.total_credits} color="text-amber-600" />
                    <PnLRow label="Total"
                      value={(monthlyData.total_cash || 0) + (monthlyData.total_mpesa || 0) + (monthlyData.total_credits || 0)}
                      bold border />
                  </div>
                </div>
              </div>

              {/* Expense Categories */}
              {monthlyData.expense_categories && monthlyData.expense_categories.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Expenses by Category</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-3 font-medium text-gray-600">Category</th>
                        <th className="text-right p-3 font-medium text-gray-600">Total</th>
                        <th className="text-right p-3 font-medium text-gray-600">% of Expenses</th>
                        <th className="p-3 font-medium text-gray-600" style={{ width: '30%' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.expense_categories.map((cat: any, i: number) => {
                        const catPct = monthlyData.total_expenses > 0
                          ? (cat.total / monthlyData.total_expenses) * 100 : 0;
                        return (
                          <tr key={i} className="border-t hover:bg-gray-50">
                            <td className="p-3 font-medium">{cat.category}</td>
                            <td className="p-3 text-right text-red-600">{kes(cat.total)}</td>
                            <td className="p-3 text-right text-gray-500">{pct(catPct)}</td>
                            <td className="p-3">
                              <div className="w-full bg-gray-100 rounded-full h-2">
                                <div className="bg-red-400 h-2 rounded-full" style={{ width: `${Math.min(catPct, 100)}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Daily Breakdown */}
              {monthlyData.daily_breakdown && monthlyData.daily_breakdown.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-gray-50">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Daily Breakdown</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-3 font-medium text-gray-600">Date</th>
                        <th className="text-right p-3 font-medium text-gray-600">Sales</th>
                        <th className="text-right p-3 font-medium text-gray-600">COGS</th>
                        <th className="text-right p-3 font-medium text-gray-600">Gross</th>
                        <th className="text-right p-3 font-medium text-gray-600">Wages</th>
                        <th className="text-right p-3 font-medium text-gray-600">Expenses</th>
                        <th className="text-right p-3 font-medium text-gray-600">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.daily_breakdown.map((day: any, i: number) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="p-3 font-medium">
                            {new Date(day.date + 'T12:00:00').toLocaleDateString('en-KE', { day: '2-digit', month: 'short', weekday: 'short' })}
                          </td>
                          <td className="p-3 text-right">{kes(day.sales)}</td>
                          <td className="p-3 text-right text-red-500">{kes(day.cogs)}</td>
                          <td className={`p-3 text-right ${day.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {kes(day.gross_profit)}
                          </td>
                          <td className="p-3 text-right text-red-500">{kes(day.wages)}</td>
                          <td className="p-3 text-right text-red-500">{kes(day.expenses)}</td>
                          <td className={`p-3 text-right font-semibold ${day.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {kes(day.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                      <tr>
                        <td className="p-3 font-semibold">Total</td>
                        <td className="p-3 text-right font-semibold">{kes(monthlyData.total_sales)}</td>
                        <td className="p-3 text-right font-semibold text-red-600">{kes(monthlyData.cogs)}</td>
                        <td className={`p-3 text-right font-semibold ${monthlyData.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {kes(monthlyData.gross_profit)}
                        </td>
                        <td className="p-3 text-right font-semibold text-red-600">{kes(monthlyData.total_wages_paid)}</td>
                        <td className="p-3 text-right font-semibold text-red-600">{kes(monthlyData.total_expenses)}</td>
                        <td className={`p-3 text-right font-bold ${monthlyData.net_profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {kes(monthlyData.net_profit)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {!monthlyData && !loading && (
            <div className="bg-white rounded-lg shadow p-10 text-center text-gray-400">
              Select a month and click "Generate Report".
            </div>
          )}
        </div>
      )}

      {/* ── STOCK RECONCILIATION ───────────────────────────────── */}
      {activeTab === 'stock' && (
        <div>
          <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4">
            <Calendar size={18} className="text-gray-400" />
            <input type="date" value={stockDate} onChange={e => setStockDate(e.target.value)}
              className="border border-gray-300 rounded-lg p-2 text-sm" />
            <button onClick={loadStockReport} disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
              {loading ? 'Loading...' : 'Generate Report'}
            </button>
          </div>

          {stockData && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="p-4 border-b bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                  <Droplets size={16} /> Stock Reconciliation — {stockData.date}
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-3 font-medium text-gray-600">Tank</th>
                    <th className="text-left p-3 font-medium text-gray-600">Fuel</th>
                    <th className="text-right p-3 font-medium text-gray-600">Opening (L)</th>
                    <th className="text-right p-3 font-medium text-gray-600">Deliveries (L)</th>
                    <th className="text-right p-3 font-medium text-gray-600">Sales (L)</th>
                    <th className="text-right p-3 font-medium text-gray-600">Book Stock (L)</th>
                    <th className="text-right p-3 font-medium text-gray-600">Dip Reading (L)</th>
                    <th className="text-right p-3 font-medium text-gray-600">Variance (L)</th>
                    <th className="text-right p-3 font-medium text-gray-600">Variance %</th>
                  </tr>
                </thead>
                <tbody>
                  {stockData.tanks.map((t: any, i: number) => (
                    <tr key={i} className={`border-t hover:bg-gray-50 ${t.variance_alert ? 'bg-red-50' : ''}`}>
                      <td className="p-3 font-medium">{t.label}</td>
                      <td className="p-3 capitalize text-gray-600">{t.fuel_type}</td>
                      <td className="p-3 text-right">{t.opening_stock !== null ? litres(t.opening_stock) : '—'}</td>
                      <td className="p-3 text-right text-blue-600">{litres(t.deliveries)}</td>
                      <td className="p-3 text-right text-gray-600">{litres(t.sales)}</td>
                      <td className="p-3 text-right font-medium">{t.closing_book_stock !== null ? litres(t.closing_book_stock) : '—'}</td>
                      <td className="p-3 text-right">{t.dip_reading !== null ? litres(t.dip_reading) : '—'}</td>
                      <td className={`p-3 text-right font-medium ${t.variance_alert ? 'text-red-600' : 'text-gray-600'}`}>
                        {t.variance !== null ? (
                          <span className="flex items-center justify-end gap-1">
                            {t.variance_alert && <AlertTriangle size={12} />}
                            {litres(t.variance)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`p-3 text-right ${t.variance_alert ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                        {pct(t.variance_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-4 bg-gray-50 border-t text-xs text-gray-500">
                <AlertTriangle size={12} className="inline text-amber-500" /> Variance &gt; 0.5% is flagged. Possible causes: leaks, metering errors, delivery shortages, or theft.
              </div>
            </div>
          )}

          {!stockData && !loading && (
            <div className="bg-white rounded-lg shadow p-10 text-center text-gray-400">
              Select a date and click "Generate Report".
            </div>
          )}
        </div>
      )}

      {/* ── DEBTOR AGING ───────────────────────────────────────── */}
      {activeTab === 'debtors' && (
        <div>
          <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4">
            <button onClick={loadDebtorReport} disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
              {loading ? 'Loading...' : 'Load Debtor Aging Report'}
            </button>
          </div>

          {debtorData && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="grid grid-cols-5 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Total Outstanding</p>
                  <p className="text-xl font-bold text-red-600">{kes(debtorData.summary.total_outstanding)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Current (0-30d)</p>
                  <p className="text-xl font-bold text-gray-800">{kes(debtorData.summary.current_0_30)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">31-60 Days</p>
                  <p className="text-xl font-bold text-amber-600">{kes(debtorData.summary.days_31_60)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">61-90 Days</p>
                  <p className="text-xl font-bold text-orange-600">{kes(debtorData.summary.days_61_90)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Over 90 Days</p>
                  <p className="text-xl font-bold text-red-700">{kes(debtorData.summary.days_90_plus)}</p>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left p-3 font-medium text-gray-600">Customer</th>
                      <th className="text-left p-3 font-medium text-gray-600">Phone</th>
                      <th className="text-right p-3 font-medium text-gray-600">Total</th>
                      <th className="text-right p-3 font-medium text-gray-600">0-30d</th>
                      <th className="text-right p-3 font-medium text-gray-600">31-60d</th>
                      <th className="text-right p-3 font-medium text-gray-600">61-90d</th>
                      <th className="text-right p-3 font-medium text-gray-600">90d+</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtorData.accounts.map((a: any, i: number) => (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="p-3 font-medium">{a.name}</td>
                        <td className="p-3 text-gray-500">
                          {a.phone ? (
                            <span className="flex items-center gap-1"><Phone size={12} />{a.phone}</span>
                          ) : '—'}
                        </td>
                        <td className="p-3 text-right font-bold text-red-600">{kes(a.total_outstanding)}</td>
                        <td className="p-3 text-right">{a.current_0_30 > 0 ? kes(a.current_0_30) : '—'}</td>
                        <td className="p-3 text-right text-amber-600">{a.days_31_60 > 0 ? kes(a.days_31_60) : '—'}</td>
                        <td className="p-3 text-right text-orange-600">{a.days_61_90 > 0 ? kes(a.days_61_90) : '—'}</td>
                        <td className="p-3 text-right text-red-700 font-medium">{a.days_90_plus > 0 ? kes(a.days_90_plus) : '—'}</td>
                      </tr>
                    ))}
                    {debtorData.accounts.length === 0 && (
                      <tr><td colSpan={7} className="p-8 text-center text-gray-400">No outstanding debts.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!debtorData && !loading && (
            <div className="bg-white rounded-lg shadow p-10 text-center text-gray-400">
              Click "Load Debtor Aging Report" to view outstanding credit accounts.
            </div>
          )}
        </div>
      )}

      {/* ── CASH FLOW ─────────────────────────────────────────── */}
      {activeTab === 'cashflow' && (
        <div>
          <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4 flex-wrap">
            <Calendar size={18} className="text-gray-400" />
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={cfFrom} onChange={e => setCfFrom(e.target.value)}
                className="border border-gray-300 rounded-lg p-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={cfTo} onChange={e => setCfTo(e.target.value)}
                className="border border-gray-300 rounded-lg p-2 text-sm" />
            </div>
            <button onClick={loadCashFlow} disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm mt-4">
              {loading ? 'Loading...' : 'Generate Report'}
            </button>
          </div>

          {cfData && (
            <div className="space-y-6">
              {/* Net cash flow card */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><ArrowDownCircle size={14} className="text-green-500" /> Total Inflows</p>
                  <p className="text-xl font-bold text-green-600">{kes(cfData.inflows.total)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><ArrowUpCircle size={14} className="text-red-500" /> Total Outflows</p>
                  <p className="text-xl font-bold text-red-600">{kes(cfData.outflows.total)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500 mb-1">Net Cash Flow</p>
                  <p className={`text-xl font-bold ${cfData.net_cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {kes(cfData.net_cash_flow)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Inflows */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-green-50">
                    <h2 className="text-sm font-semibold text-green-700 uppercase tracking-wide">Cash Inflows</h2>
                  </div>
                  <div className="py-2">
                    <PnLRow label="Cash Sales" value={cfData.inflows.cash_sales} color="text-green-600" />
                    <PnLRow label="M-Pesa Sales" value={cfData.inflows.mpesa_sales} color="text-green-600" />
                    <PnLRow label="Credit Payments Received" value={cfData.inflows.credit_payments_received} color="text-green-600" />
                    <PnLRow label="Total Inflows" value={cfData.inflows.total} bold border color="text-green-700" />
                  </div>
                </div>

                {/* Outflows */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b bg-red-50">
                    <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide">Cash Outflows</h2>
                  </div>
                  <div className="py-2">
                    <PnLRow label="Fuel Purchases" value={cfData.outflows.fuel_purchases} color="text-red-600" />
                    <PnLRow label="Wages Paid" value={cfData.outflows.wages_paid} color="text-red-600" />
                    <PnLRow label="Shift Expenses" value={cfData.outflows.shift_expenses} color="text-red-600" />
                    <PnLRow label="General Expenses" value={cfData.outflows.general_expenses} color="text-red-600" />
                    <PnLRow label="Total Outflows" value={cfData.outflows.total} bold border color="text-red-700" />
                  </div>
                </div>
              </div>

              {/* Outstanding Receivables */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-700 font-medium">
                  Outstanding Receivables (not yet collected): {kes(cfData.outstanding_receivables)}
                </p>
                <p className="text-xs text-amber-600 mt-0.5">This amount is owed by credit customers and not included in cash inflows above.</p>
              </div>
            </div>
          )}

          {!cfData && !loading && (
            <div className="bg-white rounded-lg shadow p-10 text-center text-gray-400">
              Select a date range and click "Generate Report".
            </div>
          )}
        </div>
      )}
    </div>
  );
}
