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
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import {
  Ban,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Plus,
  RotateCcw,
} from 'lucide-react';

type ShiftStatusFilter = '' | 'open' | 'closed' | 'cancelled';
type ShiftSort = 'newest' | 'oldest';

interface ShiftPagination {
  total: number;
  page: number;
  total_pages: number;
  has_previous: boolean;
  has_next: boolean;
  range_start: number;
  range_end: number;
}

const EMPTY_PAGINATION: ShiftPagination = {
  total: 0,
  page: 1,
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
  const { isAdmin } = useAuth();

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
      limit: 15,
      ...(fromDate ? { from: fromDate } : {}),
      ...(toDate ? { to: toDate } : {}),
      ...(status ? { status } : {}),
      sort,
    })
      .then((response) => {
        if (!active) return;
        const data = response.data.data;
        const total = Number(data.total || 0);
        const limit = Number(data.limit || 15);
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

  function clearFilters() {
    setFromDate('');
    setToDate('');
    setStatus('');
    setSort('newest');
    setPage(1);
  }

  async function handleOpen() {
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
      setPage(1);
      const response = await getShifts({ limit: 15, ...(status ? { status } : {}), sort });
      const data = response.data.data;
      setShifts(data.shifts || []);
      setPagination((current) => ({ ...current, ...data }));
    } catch (cancelError: any) {
      alert(cancelError.response?.data?.error || 'Failed to cancel shift');
    } finally {
      setCancelling(false);
    }
  }

  const formatDate = (shift: any) => {
    const value = shift.shift_date ? `${shift.shift_date}T12:00:00` : shift.start_time;
    return new Date(value).toLocaleDateString('en-KE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };
  const formatTime = (value: string) => new Date(value).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="pb-6">
      <PageHeader title="Shifts" right={(
        <button
          onClick={() => setShowNew(true)}
          className="bg-blue-600 text-white px-3 py-2 rounded-md text-sm flex items-center gap-1"
        >
          <Plus size={16} /> New
        </button>
      )} />

      {showNew && (
        <div className="mobile-modal-overlay flex items-end">
          <div className="mobile-bottom-sheet rounded-t-2xl p-5">
            <h2 className="text-lg font-semibold mb-3">Open New Shift</h2>
            <select
              value={selectedEmployee}
              onChange={(event) => setSelectedEmployee(event.target.value)}
              className="w-full border border-gray-300 rounded-md p-3 mb-3 text-base"
            >
              <option value="">Select Employee</option>
              {employees.map((employee: any) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setShowNew(false)}
                className="flex-1 py-3 rounded-md bg-gray-100 text-gray-600 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleOpen}
                disabled={!selectedEmployee}
                className="flex-1 py-3 rounded-md bg-blue-600 text-white font-medium disabled:opacity-50"
              >
                Open Shift
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="mobile-modal-overlay flex items-end">
          <div className="mobile-bottom-sheet rounded-t-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Ban size={20} className="text-red-600" />
              <h2 className="text-lg font-semibold">Cancel Shift #{cancelTarget.id}</h2>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Entries and shift-linked payments will be reversed.
            </p>
            {cancelPreview && (
              <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 border border-gray-200 rounded-md p-3 mb-3">
                <span>Credits</span><strong className="text-right">{cancelPreview.credit_entries_to_void}</strong>
                <span>Debt payments</span><strong className="text-right">{cancelPreview.credit_payments_to_reverse}</strong>
                <span>Expenses</span><strong className="text-right">{cancelPreview.expenses_to_void}</strong>
                <span>Invoice entries</span><strong className="text-right">{cancelPreview.invoice_consumption_to_release}</strong>
              </div>
            )}
            <textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-md p-3 text-base"
              placeholder="Cancellation reason"
            />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => setCancelTarget(null)} disabled={cancelling} className="py-3 rounded-md bg-gray-100 text-gray-600 font-medium">
                Keep Shift
              </button>
              <button onClick={confirmCancellation} disabled={cancelling || cancelReason.trim().length < 3 || !cancelPreview} className="py-3 rounded-md bg-red-600 text-white font-medium disabled:opacity-50">
                {cancelling ? 'Cancelling...' : 'Cancel Shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="bg-white border-y border-gray-200 -mx-4 px-4 py-3 mb-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-xs font-medium text-gray-600">
            From
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => updateFromDate(event.target.value)}
              className="block w-full min-w-0 mt-1 border border-gray-300 rounded-md px-2 py-2 text-sm text-gray-800"
            />
          </label>
          <label className="min-w-0 text-xs font-medium text-gray-600">
            To
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => updateToDate(event.target.value)}
              className="block w-full min-w-0 mt-1 border border-gray-300 rounded-md px-2 py-2 text-sm text-gray-800"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <div className="grid grid-cols-4 flex-1 border border-gray-300 rounded-md overflow-hidden">
            {([
              ['', 'All'],
              ['open', 'Open'],
              ['closed', 'Closed'],
              ['cancelled', 'Cancelled'],
            ] as [ShiftStatusFilter, string][]).map(([value, label], index) => (
              <button
                key={value || 'all'}
                type="button"
                onClick={() => updateStatus(value)}
                className={`py-2 text-xs font-medium ${index > 0 ? 'border-l border-gray-300' : ''} ${status === value ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label="Shift order"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as ShiftSort);
              setPage(1);
            }}
            className="border border-gray-300 rounded-md px-2 py-2 text-xs text-gray-700"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <button
            type="button"
            title="Clear filters"
            aria-label="Clear filters"
            onClick={clearFilters}
            disabled={!hasFilters}
            className="p-2 border border-gray-300 rounded-md text-gray-600 disabled:opacity-40"
          >
            <RotateCcw size={16} />
          </button>
        </div>

        <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
          <span>{pagination.total.toLocaleString()} shifts</span>
          <span>
            {pagination.total
              ? `${pagination.range_start.toLocaleString()}-${pagination.range_end.toLocaleString()} shown`
              : 'No matching shifts'}
          </span>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      <div className={`space-y-2 ${loading ? 'opacity-60' : ''}`}>
        {shifts.map((shift: any) => (
          <div key={shift.id} className="w-full bg-white border border-gray-200 rounded-lg p-3">
            <button onClick={() => navigate(`/shifts/${shift.id}`)} className="w-full text-left">
              <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-800 truncate">{shift.employee_name}</p>
                  <span className="text-xs text-gray-400">#{shift.id}</span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{formatDate(shift)}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatTime(shift.start_time)}
                  {' - '}
                  {shift.end_time ? formatTime(shift.end_time) : 'Still open'}
                </p>
              </div>
              {shift.status === 'open' ? (
                <span className="shrink-0 flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                  <Clock size={12} /> Open
                </span>
              ) : shift.status === 'cancelled' ? (
                <span className="shrink-0 flex items-center gap-1 text-xs bg-red-50 text-red-700 px-2 py-1 rounded">
                  <Ban size={12} /> Cancelled
                </span>
              ) : (
                <span className="shrink-0 flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                  <CheckCircle size={12} /> Closed
                </span>
              )}
              </div>
            </button>
            {shift.status === 'open' && isAdmin && (
              <button
                type="button"
                onClick={() => openCancellation(shift)}
                className="mt-3 w-full border-t border-gray-100 pt-2 flex items-center justify-center gap-1 text-sm text-red-600"
              >
                <Ban size={15} /> Cancel Shift
              </button>
            )}
          </div>
        ))}
        {!loading && shifts.length === 0 && (
          <p className="text-center text-gray-400 py-10">
            {hasFilters ? 'No shifts match these filters.' : 'No shifts recorded yet.'}
          </p>
        )}
        {loading && shifts.length === 0 && (
          <p className="text-center text-gray-500 py-10">Loading shifts...</p>
        )}
      </div>

      <div className="flex items-center justify-between mt-4 border-t border-gray-200 pt-3">
        <p className="text-xs text-gray-500">
          Page {pagination.total_pages === 0 ? 0 : pagination.page} of {pagination.total_pages}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="First page"
            aria-label="First page"
            disabled={!pagination.has_previous || loading}
            onClick={() => setPage(1)}
            className="p-2 border border-gray-300 rounded-md text-gray-600 disabled:opacity-40"
          >
            <ChevronsLeft size={17} />
          </button>
          <button
            type="button"
            title="Previous page"
            aria-label="Previous page"
            disabled={!pagination.has_previous || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="p-2 border border-gray-300 rounded-md text-gray-600 disabled:opacity-40"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            title="Next page"
            aria-label="Next page"
            disabled={!pagination.has_next || loading}
            onClick={() => setPage((current) => current + 1)}
            className="p-2 border border-gray-300 rounded-md text-gray-600 disabled:opacity-40"
          >
            <ChevronRight size={17} />
          </button>
          <button
            type="button"
            title="Last page"
            aria-label="Last page"
            disabled={!pagination.has_next || loading}
            onClick={() => setPage(pagination.total_pages)}
            className="p-2 border border-gray-300 rounded-md text-gray-600 disabled:opacity-40"
          >
            <ChevronsRight size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
