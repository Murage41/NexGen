import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getShifts, getActiveEmployees, openShift } from '../services/api';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Eye,
  Plus,
  RotateCcw,
} from 'lucide-react';

type ShiftStatusFilter = '' | 'open' | 'closed';
type ShiftSort = 'newest' | 'oldest';

interface ShiftPagination {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  has_previous: boolean;
  has_next: boolean;
  range_start: number;
  range_end: number;
}

const EMPTY_PAGINATION: ShiftPagination = {
  total: 0,
  page: 1,
  limit: 25,
  total_pages: 0,
  has_previous: false,
  has_next: false,
  range_start: 0,
  range_end: 0,
};

export default function Shifts() {
  const [shifts, setShifts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState<ShiftStatusFilter>('');
  const [sort, setSort] = useState<ShiftSort>('newest');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<ShiftPagination>(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);
  const hasFilters = Boolean(fromDate || toDate || status || sort !== 'newest');

  useEffect(() => {
    getActiveEmployees()
      .then((response) => setEmployees(response.data.data))
      .catch((loadError) => console.error(loadError));
  }, []);

  useEffect(() => {
    if (invalidDateRange) {
      setError('From date cannot be after To date.');
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError('');
    getShifts({
      page,
      limit: 25,
      ...(fromDate ? { from: fromDate } : {}),
      ...(toDate ? { to: toDate } : {}),
      ...(status ? { status } : {}),
      sort,
    })
      .then((response) => {
        if (!active) return;
        const data = response.data.data;
        const total = Number(data.total || 0);
        const limit = Number(data.limit || 25);
        const responsePage = Number(data.page || page);
        const totalPages = data.total_pages === undefined
          ? Math.ceil(total / limit)
          : Number(data.total_pages);
        const rangeStart = data.range_start === undefined
          ? (total === 0 ? 0 : (responsePage - 1) * limit + 1)
          : Number(data.range_start);
        const rangeEnd = data.range_end === undefined
          ? (total === 0 ? 0 : Math.min(rangeStart + data.shifts.length - 1, total))
          : Number(data.range_end);
        setShifts(data.shifts);
        setPagination({
          total,
          page: responsePage,
          limit,
          total_pages: totalPages,
          has_previous: data.has_previous ?? responsePage > 1,
          has_next: data.has_next ?? responsePage < totalPages,
          range_start: rangeStart,
          range_end: rangeEnd,
        });
        if (responsePage !== page) setPage(responsePage);
      })
      .catch((loadError: any) => {
        if (!active) return;
        setError(loadError.response?.data?.error || 'Unable to load shifts.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fromDate, invalidDateRange, page, sort, status, toDate]);

  function updateFromDate(value: string) {
    setFromDate(value);
    setPage(1);
  }

  function updateToDate(value: string) {
    setToDate(value);
    setPage(1);
  }

  function updateStatus(value: ShiftStatusFilter) {
    setStatus(value);
    setPage(1);
  }

  function updateSort(value: ShiftSort) {
    setSort(value);
    setPage(1);
  }

  function clearFilters() {
    setFromDate('');
    setToDate('');
    setStatus('');
    setSort('newest');
    setPage(1);
  }

  async function handleOpenShift() {
    if (!selectedEmployee) return;
    try {
      const response = await openShift({ employee_id: parseInt(selectedEmployee, 10) });
      setShowNew(false);
      setSelectedEmployee('');
      navigate(`/shifts/${response.data.data.id}`);
    } catch (openError: any) {
      alert(openError.response?.data?.error || 'Failed to open shift');
    }
  }

  const formatDate = (value: string) => new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const formatTime = (value: string) => new Date(value).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const shiftDateValue = (shift: any) => shift.shift_date
    ? `${shift.shift_date}T12:00:00`
    : shift.start_time;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Shifts & Readings</h1>
          <p className="text-sm text-gray-500 mt-1">Browse the complete shift history or narrow it by date and status.</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition"
        >
          <Plus size={18} /> Open New Shift
        </button>
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold mb-4">Open New Shift</h2>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Employee</label>
            <select
              value={selectedEmployee}
              onChange={(event) => setSelectedEmployee(event.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 mb-4"
            >
              <option value="">-- Select --</option>
              {employees.map((employee: any) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
            {employees.length === 0 && (
              <p className="text-sm text-red-500 mb-4">No employees found. Add employees first.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNew(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleOpenShift}
                disabled={!selectedEmployee}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Open Shift
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-lg mb-4">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-xs font-medium text-gray-600">
            From
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => updateFromDate(event.target.value)}
              className="block mt-1 border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            To
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => updateToDate(event.target.value)}
              className="block mt-1 border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            Status
            <select
              value={status}
              onChange={(event) => updateStatus(event.target.value as ShiftStatusFilter)}
              className="block mt-1 border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800 min-w-32"
            >
              <option value="">All shifts</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Order</p>
            <div className="inline-flex border border-gray-300 rounded-md overflow-hidden" aria-label="Shift order">
              <button
                type="button"
                onClick={() => updateSort('newest')}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm ${sort === 'newest' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                <ArrowDown size={15} /> Newest
              </button>
              <button
                type="button"
                onClick={() => updateSort('oldest')}
                className={`flex items-center gap-1.5 border-l border-gray-300 px-3 py-2 text-sm ${sort === 'oldest' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                <ArrowUp size={15} /> Oldest
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasFilters}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-40"
          >
            <RotateCcw size={15} /> Clear
          </button>
          <div className="ml-auto text-right">
            <p className="text-sm font-semibold text-gray-800">{pagination.total.toLocaleString()} shifts</p>
            <p className="text-xs text-gray-500">
              {pagination.total
                ? `Showing ${pagination.range_start.toLocaleString()}-${pagination.range_end.toLocaleString()}`
                : 'No matching records'}
            </p>
          </div>
        </div>
        {error && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
      </section>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Shift ID</th>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Employee</th>
                <th className="text-left p-3 font-medium text-gray-600">Start</th>
                <th className="text-left p-3 font-medium text-gray-600">End</th>
                <th className="text-left p-3 font-medium text-gray-600">Status</th>
                <th className="text-right p-3 font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-60' : ''}>
              {shifts.map((shift: any) => (
                <tr key={shift.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3 text-gray-500">#{shift.id}</td>
                  <td className="p-3 whitespace-nowrap">{formatDate(shiftDateValue(shift))}</td>
                  <td className="p-3 font-medium text-gray-800">{shift.employee_name}</td>
                  <td className="p-3 whitespace-nowrap">{formatTime(shift.start_time)}</td>
                  <td className="p-3 whitespace-nowrap">{shift.end_time ? formatTime(shift.end_time) : '-'}</td>
                  <td className="p-3">
                    {shift.status === 'open' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                        <Clock size={12} /> Open
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                        <CheckCircle size={12} /> Closed
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => navigate(`/shifts/${shift.id}`)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                    >
                      <Eye size={15} /> View
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && shifts.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-gray-400">
                    {hasFilters ? 'No shifts match these filters.' : 'No shifts recorded yet.'}
                  </td>
                </tr>
              )}
              {loading && shifts.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-gray-500">Loading shifts...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
          <p className="text-sm text-gray-500">
            Page {pagination.total_pages === 0 ? 0 : pagination.page} of {pagination.total_pages}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="First page"
              aria-label="First page"
              disabled={!pagination.has_previous || loading}
              onClick={() => setPage(1)}
              className="p-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronsLeft size={17} />
            </button>
            <button
              type="button"
              title="Previous page"
              aria-label="Previous page"
              disabled={!pagination.has_previous || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="p-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              title="Next page"
              aria-label="Next page"
              disabled={!pagination.has_next || loading}
              onClick={() => setPage((current) => current + 1)}
              className="p-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronRight size={17} />
            </button>
            <button
              type="button"
              title="Last page"
              aria-label="Last page"
              disabled={!pagination.has_next || loading}
              onClick={() => setPage(pagination.total_pages)}
              className="p-2 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronsRight size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
