import { useState } from 'react';
import { BarChart3, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getDailyReport, getMonthlyReport } from '../services/api';

export default function Reports() {
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fmt = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  async function loadDaily() {
    setLoading(true);
    setReport(null);
    try {
      const res = await getDailyReport(date);
      setReport(res.data.data || res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadMonthly() {
    setLoading(true);
    setReport(null);
    try {
      const res = await getMonthlyReport(month);
      setReport(res.data.data || res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleTabChange(newTab: 'daily' | 'monthly') {
    setTab(newTab);
    setReport(null);
  }

  const rows = report ? [
    { label: 'Total Sales', value: fmt(report.total_sales || report.sales), positive: true },
    { label: 'Cash Collections', value: fmt(report.cash || report.cash_collections) },
    { label: 'M-Pesa Collections', value: fmt(report.mpesa || report.mpesa_collections) },
    { label: 'Credits', value: fmt(report.credits || report.total_credits), warn: true },
    { label: 'Wages', value: fmt(report.wages || report.total_wages), negative: true },
    { label: 'Expenses', value: fmt(report.expenses || report.total_expenses), negative: true },
    { label: 'Net', value: fmt(report.net || report.net_income), highlight: true },
  ] : [];

  return (
    <div className="pb-6">
      <PageHeader title="Reports" back />

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
        <button
          onClick={() => handleTabChange('daily')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'daily' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
          }`}
        >
          Daily
        </button>
        <button
          onClick={() => handleTabChange('monthly')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'monthly' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
          }`}
        >
          Monthly
        </button>
      </div>

      {/* Date Picker */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-gray-400" />
          {tab === 'daily' ? (
            <input
              type="date"
              className="flex-1 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          ) : (
            <input
              type="month"
              className="flex-1 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={month}
              onChange={e => setMonth(e.target.value)}
            />
          )}
          <button
            onClick={tab === 'daily' ? loadDaily : loadMonthly}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50"
          >
            {loading ? '...' : 'Go'}
          </button>
        </div>
      </div>

      {/* Report Results */}
      {loading && <div className="text-center text-gray-400 mt-10">Loading report...</div>}

      {!loading && report && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-blue-600" />
              <span className="font-semibold text-gray-700">
                {tab === 'daily' ? 'Daily Summary' : 'Monthly Summary'}
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {rows.map((row, i) => (
              <div key={i} className={`flex items-center justify-between px-4 py-3 ${row.highlight ? 'bg-blue-50' : ''}`}>
                <span className={`text-sm ${row.highlight ? 'font-bold text-gray-800' : 'text-gray-600'}`}>
                  {row.label}
                </span>
                <div className="flex items-center gap-1">
                  {row.positive && <TrendingUp size={14} className="text-green-500" />}
                  {row.negative && <TrendingDown size={14} className="text-red-400" />}
                  <span className={`text-sm font-semibold ${
                    row.highlight ? 'text-blue-700 text-base' :
                    row.negative ? 'text-red-600' :
                    row.warn ? 'text-amber-600' :
                    'text-gray-800'
                  }`}>
                    {row.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !report && (
        <div className="text-center mt-10">
          <BarChart3 size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">Select a {tab === 'daily' ? 'date' : 'month'} and tap Go</p>
        </div>
      )}
    </div>
  );
}
