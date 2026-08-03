import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cancelShift,
  getShifts,
  getActiveEmployees,
  openShift,
  previewShiftCancellation,
} from '../services/api';
import { clearShiftDraft } from '../utils/shiftDraft';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Ban,
  Eye,
  Plus,
  RotateCcw,
} from 'lucide-react';

type ShiftStatusFilter = '' | 'open' | 'closed' | 'cancelled';
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
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  const [cancelPreview, setCancelPreview] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const navigate = useNavigate();

  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);
  const hasFilters = Boolean(fromDate || toDate || status || sort !== 'newest');
  const selectedEmployeeRecord = employees.find((employee: any) => String(employee.id) === selectedEmployee);
  const selectedPlan = selectedEmployeeRecord?.compensation_plan;

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
    if (!selectedEmployee || !selectedPlan) return;
    try {
      const response = await openShift({
        employee_id: parseInt(selectedEmployee, 10),
        compensation_plan_id: Number(selectedPlan.id),
      });
      setShowNew(false);
      setSelectedEmployee('');
      navigate(`/shifts/${response.data.data.id}`);
    } catch (openError: any) {
      alert(openError.response?.data?.error || 'Failed to open shift');
    }
  }

  async function openCancellation(shift: any) {
    setCancelTarget(shift);
    setCancelPreview(null);
    setCancelReason('');
    try {
      const response = await previewShiftCancellation(Number(shift.id));
      setCancelPreview(response.data.data);
    } catch (cancelError: any) {
      alert(cancelError.response?.data?.error || 'Unable to prepare shift cancellation');
      setCancelTarget(null);
    }
  }

  async function confirmCancellation() {
    if (!cancelTarget || cancelReason.trim().length < 3) return;
    setCancelling(true);
    try {
      await cancelShift(Number(cancelTarget.id), cancelReason.trim());
      clearShiftDraft(Number(cancelTarget.id));
      setCancelTarget(null);
      await getShifts({ page, limit: 25, ...(fromDate ? { from: fromDate } : {}), ...(toDate ? { to: toDate } : {}), ...(status ? { status } : {}), sort })
        .then((response) => {
          const data = response.data.data;
          setShifts(data.shifts || []);
          setPagination((current) => ({ ...current, ...data }));
        });
    } catch (cancelError: any) {
      alert(cancelError.response?.data?.error || 'Failed to cancel shift');
    } finally {
      setCancelling(false);
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
              className="w-full border border-gray-300 rounded-md p-2 mb-3"
            >
              <option value="">-- Select --</option>
              {employees.map((employee: any) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
            {selectedEmployee && selectedPlan && (
              <div className="mb-4 border border-blue-200 bg-blue-50 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-800">{selectedPlan.name}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{selectedEmployeeRecord.compensation_summary}</p>
                  </div>
                  <span className="capitalize text-xs font-medium text-blue-700">{selectedPlan.pay_schedule}</span>
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  {selectedPlan.pay_schedule === 'daily'
                    ? 'Shift earnings are finalized at close and may be paid directly from this shift.'
                    : `Shift earnings accrue to ${selectedPlan.pay_schedule} payroll; no wage is taken from this shift drawer.`}
                </p>
                <p className="mt-1 text-xs text-gray-500">Effective from {selectedPlan.effective_from} · Plan v{selectedPlan.version}</p>
              </div>
            )}
            {selectedEmployee && !selectedPlan && (
              <p className="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                This employee has no compensation plan for today.
              </p>
            )}
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
                disabled={!selectedEmployee || !selectedPlan}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Open Shift
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center gap-2 mb-2">
              <Ban size={20} className="text-red-600" />
              <h2 className="text-lg font-semibold">Cancel Shift #{cancelTarget.id}</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Credits, debt payments, expenses and invoice consumption entered in this open shift will be reversed.
            </p>
            {cancelPreview && (
              <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 border border-gray-200 rounded-md p-3 mb-4">
                <span>Credits</span><strong className="text-right">{cancelPreview.credit_entries_to_void}</strong>
                <span>Debt payments</span><strong className="text-right">{cancelPreview.credit_payments_to_reverse}</strong>
                <span>Expenses</span><strong className="text-right">{cancelPreview.expenses_to_void}</strong>
                <span>Invoice entries</span><strong className="text-right">{cancelPreview.invoice_consumption_to_release}</strong>
              </div>
            )}
            <label className="block text-sm font-medium text-gray-700">
              Cancellation reason
              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                rows={3}
                className="mt-1 w-full border border-gray-300 rounded-md p-2"
                placeholder="Why was this shift cancelled?"
              />
            </label>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setCancelTarget(null)} disabled={cancelling} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">
                Keep Shift
              </button>
              <button onClick={confirmCancellation} disabled={cancelling || cancelReason.trim().length < 3 || !cancelPreview} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                {cancelling ? 'Cancelling...' : 'Cancel Shift'}
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
              <option value="cancelled">Cancelled</option>
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      {shift.status === 'open' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                          <Clock size={12} /> Open
                        </span>
                      ) : shift.status === 'cancelled' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 rounded text-xs font-medium">
                          <Ban size={12} /> Cancelled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                          <CheckCircle size={12} /> Closed
                        </span>
                      )}
                      {shift.status === 'closed' && (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${shift.review_status === 'flagged' ? 'bg-red-50 text-red-700' : shift.review_status === 'reviewed' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                          {shift.review_status === 'flagged' ? 'Flagged' : shift.review_status === 'reviewed' ? 'Reviewed' : 'Pending review'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    {shift.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => openCancellation(shift)}
                        className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 mr-4"
                      >
                        <Ban size={15} /> Cancel
                      </button>
                    )}
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
