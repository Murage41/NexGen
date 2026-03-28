import { useState } from 'react';
import { getDailyReport, getMonthlyReport } from '../services/api';
import { BarChart3, Calendar } from 'lucide-react';

export default function Reports() {
  const [activeTab, setActiveTab] = useState<'daily' | 'monthly'>('daily');
  const [loading, setLoading] = useState(false);
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyMonth, setMonthlyMonth] = useState(new Date().toISOString().slice(0, 7));
  const [dailyData, setDailyData] = useState<any>(null);
  const [monthlyData, setMonthlyData] = useState<any>(null);

  async function loadDailyReport() {
    setLoading(true);
    try {
      const res = await getDailyReport(dailyDate);
      setDailyData(res.data.data);
    } catch (err) {
      console.error('Failed to load daily report:', err);
      setDailyData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMonthlyReport() {
    setLoading(true);
    try {
      const res = await getMonthlyReport(monthlyMonth);
      setMonthlyData(res.data.data);
    } catch (err) {
      console.error('Failed to load monthly report:', err);
      setMonthlyData(null);
    } finally {
      setLoading(false);
    }
  }

  const formatKES = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mb-6">
        <BarChart3 size={24} /> Reports
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('daily')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'daily' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Daily Report
        </button>
        <button
          onClick={() => setActiveTab('monthly')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'monthly' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Monthly Report
        </button>
      </div>

      {/* Daily Report */}
      {activeTab === 'daily' && (
        <div>
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex items-center gap-4">
              <Calendar size={18} className="text-gray-400" />
              <input
                type="date"
                value={dailyDate}
                onChange={e => setDailyDate(e.target.value)}
                className="border border-gray-300 rounded-lg p-2 text-sm"
              />
              <button
                onClick={loadDailyReport}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {loading ? 'Loading...' : 'Generate Report'}
              </button>
            </div>
          </div>

          {dailyData && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-sm text-gray-500">Total Sales</p>
                  <p className="text-xl font-bold text-gray-800">{formatKES(dailyData.total_sales || 0)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-sm text-gray-500">Petrol Sold</p>
                  <p className="text-xl font-bold text-gray-800">{Number(dailyData.petrol_litres || 0).toFixed(1)} L</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-sm text-gray-500">Diesel Sold</p>
                  <p className="text-xl font-bold text-gray-800">{Number(dailyData.diesel_litres || 0).toFixed(1)} L</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-sm text-gray-500">Total Expenses</p>
                  <p className="text-xl font-bold text-red-600">{formatKES(dailyData.total_expenses || 0)}</p>
                </div>
              </div>

              {/* Shifts Table */}
              {dailyData.shifts && dailyData.shifts.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-700">Shifts</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 font-medium text-gray-600">Employee</th>
                        <th className="text-left p-3 font-medium text-gray-600">Start</th>
                        <th className="text-left p-3 font-medium text-gray-600">End</th>
                        <th className="text-right p-3 font-medium text-gray-600">Sales</th>
                        <th className="text-right p-3 font-medium text-gray-600">Collections</th>
                        <th className="text-right p-3 font-medium text-gray-600">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyData.shifts.map((s: any, i: number) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="p-3 font-medium">{s.employee_name}</td>
                          <td className="p-3">{s.start_time ? new Date(s.start_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                          <td className="p-3">{s.end_time ? new Date(s.end_time).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                          <td className="p-3 text-right">{formatKES(s.total_sales || 0)}</td>
                          <td className="p-3 text-right">{formatKES(s.total_collections || 0)}</td>
                          <td className={`p-3 text-right font-medium ${(s.variance || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatKES(s.variance || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Expenses Table */}
              {dailyData.expenses && dailyData.expenses.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-700">Expenses</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
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
                          <td className="p-3 text-gray-600">{exp.description || '-'}</td>
                          <td className="p-3 text-right">{formatKES(exp.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!dailyData && !loading && (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
              Select a date and click "Generate Report" to view the daily report.
            </div>
          )}
        </div>
      )}

      {/* Monthly Report */}
      {activeTab === 'monthly' && (
        <div>
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex items-center gap-4">
              <Calendar size={18} className="text-gray-400" />
              <input
                type="month"
                value={monthlyMonth}
                onChange={e => setMonthlyMonth(e.target.value)}
                className="border border-gray-300 rounded-lg p-2 text-sm"
              />
              <button
                onClick={loadMonthlyReport}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {loading ? 'Loading...' : 'Generate Report'}
              </button>
            </div>
          </div>

          {monthlyData && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-sm text-gray-500">Total Sales</p>
                  <p className="text-xl font-bold text-gray-800">{formatKES(monthlyData.total_sales || 0)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-sm text-gray-500">Total Litres Sold</p>
                  <p className="text-xl font-bold text-gray-800">{Number(monthlyData.total_litres || 0).toFixed(1)} L</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-sm text-gray-500">Total Expenses</p>
                  <p className="text-xl font-bold text-red-600">{formatKES(monthlyData.total_expenses || 0)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                  <p className="text-sm text-gray-500">Net Income</p>
                  <p className={`text-xl font-bold ${(monthlyData.net_income || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatKES(monthlyData.net_income || 0)}
                  </p>
                </div>
              </div>

              {/* Daily Breakdown */}
              {monthlyData.daily_breakdown && monthlyData.daily_breakdown.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-700">Daily Breakdown</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 font-medium text-gray-600">Date</th>
                        <th className="text-right p-3 font-medium text-gray-600">Sales</th>
                        <th className="text-right p-3 font-medium text-gray-600">Petrol (L)</th>
                        <th className="text-right p-3 font-medium text-gray-600">Diesel (L)</th>
                        <th className="text-right p-3 font-medium text-gray-600">Expenses</th>
                        <th className="text-right p-3 font-medium text-gray-600">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.daily_breakdown.map((day: any, i: number) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="p-3">{new Date(day.date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}</td>
                          <td className="p-3 text-right">{formatKES(day.sales || 0)}</td>
                          <td className="p-3 text-right">{Number(day.petrol_litres || 0).toFixed(1)}</td>
                          <td className="p-3 text-right">{Number(day.diesel_litres || 0).toFixed(1)}</td>
                          <td className="p-3 text-right text-red-600">{formatKES(day.expenses || 0)}</td>
                          <td className={`p-3 text-right font-medium ${(day.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatKES(day.net || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Expense Categories */}
              {monthlyData.expense_categories && monthlyData.expense_categories.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-700">Expenses by Category</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 font-medium text-gray-600">Category</th>
                        <th className="text-right p-3 font-medium text-gray-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.expense_categories.map((cat: any, i: number) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="p-3 font-medium">{cat.category}</td>
                          <td className="p-3 text-right">{formatKES(cat.amount || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!monthlyData && !loading && (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
              Select a month and click "Generate Report" to view the monthly report.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
