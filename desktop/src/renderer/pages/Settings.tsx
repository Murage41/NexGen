import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings2, Users, Fuel, Database, DollarSign, Save, HardDrive, ChevronRight, Gauge, ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react';
import { backupDatabase, getCurrentShift, getActivePumps, getOperationalSettings, runOperationalIntegrity, setOpeningReadings, updateOperationalSettings, getMpesaFeeConfigs, getCurrentMpesaFeeConfig, createMpesaFeeConfig } from '../services/api';
import { getKenyaDate } from '../utils/timezone';

const numVal = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === '' || Number(v) === 0) return '';
  return String(v);
};
const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

export default function Settings() {
  const navigate = useNavigate();
  const [stationName, setStationName] = useState('');
  const [stationAddress, setStationAddress] = useState('');
  const [saved, setSaved] = useState(false);

  // Opening readings state
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [readings, setReadings] = useState<any[]>([]);
  const [pumps, setPumps] = useState<any[]>([]);
  const [loadingReadings, setLoadingReadings] = useState(true);
  const [savingReadings, setSavingReadings] = useState(false);
  const [readingsSaved, setReadingsSaved] = useState(false);
  const [staleShiftHours, setStaleShiftHours] = useState('30');
  const [operationsSaved, setOperationsSaved] = useState(false);
  const [operationsError, setOperationsError] = useState('');
  const [integrityReport, setIntegrityReport] = useState<any>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);
  const [integrityError, setIntegrityError] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [readingsError, setReadingsError] = useState('');

  // M-Pesa fee configuration
  const [mpesaCurrent, setMpesaCurrent] = useState<any>(null);
  const [mpesaHistory, setMpesaHistory] = useState<any[]>([]);
  const [mpesaForm, setMpesaForm] = useState({ fee_type: 'percentage', fee_value: '', effective_date: getKenyaDate(), notes: '' });
  const [mpesaSaving, setMpesaSaving] = useState(false);
  const [mpesaError, setMpesaError] = useState('');
  const [mpesaSaved, setMpesaSaved] = useState(false);
  const [showMpesaHistory, setShowMpesaHistory] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem('station_name') || '';
    const address = localStorage.getItem('station_address') || '';
    setStationName(name);
    setStationAddress(address);
    loadOpenShift();
    getOperationalSettings()
      .then((response) => setStaleShiftHours(String(response.data.data.stale_shift_hours || 30)))
      .catch(() => undefined);
    loadMpesaFeeConfig();
  }, []);

  async function loadMpesaFeeConfig() {
    try {
      const [currentRes, historyRes] = await Promise.all([getCurrentMpesaFeeConfig(), getMpesaFeeConfigs()]);
      setMpesaCurrent(currentRes.data.data);
      setMpesaHistory(historyRes.data.data);
    } catch (err) {
      // Leave as-is; the section below shows its own state.
    }
  }

  async function saveMpesaFeeConfig(e: React.FormEvent) {
    e.preventDefault();
    setMpesaError('');
    setMpesaSaving(true);
    try {
      await createMpesaFeeConfig({
        fee_type: mpesaForm.fee_type as 'percentage' | 'fixed',
        fee_value: Number(mpesaForm.fee_value),
        effective_date: mpesaForm.effective_date,
        notes: mpesaForm.notes || undefined,
      });
      setMpesaForm({ fee_type: 'percentage', fee_value: '', effective_date: getKenyaDate(), notes: '' });
      setMpesaSaved(true);
      window.setTimeout(() => setMpesaSaved(false), 2500);
      await loadMpesaFeeConfig();
    } catch (err: any) {
      setMpesaError(err.response?.data?.error || 'Unable to save the fee rate.');
    } finally {
      setMpesaSaving(false);
    }
  }

  async function loadOpenShift() {
    try {
      setLoadingReadings(true);
      const [shiftRes, pumpsRes] = await Promise.all([getCurrentShift(), getActivePumps()]);
      const shift = shiftRes.data?.data;
      const activePumps = pumpsRes.data?.data || [];
      setPumps(activePumps);
      if (shift) {
        setCurrentShift(shift);
        // Get the readings from the shift
        const shiftReadings = shift.readings || [];
        setReadings(shiftReadings);
      }
    } catch (err) {
      // No open shift — that's fine
    } finally {
      setLoadingReadings(false);
    }
  }

  function updateReading(pumpId: number, field: string, value: string) {
    setReadings(prev =>
      prev.map(r =>
        r.pump_id === pumpId ? { ...r, [field]: value === '' ? 0 : parseFloat(value) } : r
      )
    );
  }

  async function saveOpeningReadings() {
    if (!currentShift) return;
    setReadingsError('');
    try {
      setSavingReadings(true);
      const payload = readings.map(r => ({
        pump_id: r.pump_id,
        opening_litres: r.opening_litres || 0,
        opening_amount: r.opening_amount || 0,
      }));
      await setOpeningReadings(currentShift.id, payload);
      setReadingsSaved(true);
      setTimeout(() => setReadingsSaved(false), 3000);
      // Reload to get updated calculated values
      await loadOpenShift();
    } catch (err: any) {
      setReadingsError(err.response?.data?.error || 'Failed to save opening readings');
    } finally {
      setSavingReadings(false);
    }
  }

  function saveStationInfo() {
    localStorage.setItem('station_name', stationName);
    localStorage.setItem('station_address', stationAddress);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveOperationalSettings() {
    setOperationsError('');
    try {
      const hours = Number(staleShiftHours);
      const response = await updateOperationalSettings({ stale_shift_hours: hours });
      setStaleShiftHours(String(response.data.data.stale_shift_hours));
      setOperationsSaved(true);
      window.setTimeout(() => setOperationsSaved(false), 2500);
    } catch (err: any) {
      setOperationsError(err.response?.data?.error || 'Unable to save the warning threshold.');
    }
  }

  async function handleIntegrityCheck() {
    setCheckingIntegrity(true);
    setIntegrityError('');
    try {
      const response = await runOperationalIntegrity();
      setIntegrityReport(response.data.data);
    } catch (err: any) {
      if (err.response?.data?.data) setIntegrityReport(err.response.data.data);
      else setIntegrityError(err.response?.data?.error || 'Unable to complete the system check.');
    } finally {
      setCheckingIntegrity(false);
    }
  }

  async function handleBackup() {
    setBackingUp(true);
    setBackupMessage('');
    setBackupError('');
    try {
      const response = await backupDatabase();
      setBackupMessage(`Backup created: ${response.data.file}`);
    } catch (err: any) {
      setBackupError(err.response?.data?.error || 'Unable to create the backup.');
    } finally {
      setBackingUp(false);
    }
  }

  const navItems = [
    { label: 'Manage Pumps', icon: Fuel, path: '/pumps', description: 'Configure fuel pumps and nozzles' },
    { label: 'Manage Tanks', icon: Database, path: '/tank-stock', description: 'Tank configuration and stock levels' },
    { label: 'Manage Employees', icon: Users, path: '/employees', description: 'Employee details and wages' },
    { label: 'Fuel Prices', icon: DollarSign, path: '/fuel-pricing', description: 'Set and manage fuel pricing' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mb-6">
        <Settings2 size={24} /> Settings
      </h1>

      {/* Set Opening Readings — Admin Only */}
      {!loadingReadings && currentShift && readings.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6 border-l-4 border-orange-400">
          <h2 className="text-lg font-semibold text-gray-700 mb-1 flex items-center gap-2">
            <Gauge size={20} className="text-orange-500" /> Set Opening Readings
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Set initial meter readings for the current open shift. Use this when the system is fresh and needs starting values.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Pump</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Opening Litres</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Opening KES</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600 text-orange-600">Current Closing Litres</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600 text-orange-600">Current Closing KES</th>
                </tr>
              </thead>
              <tbody>
                {readings.map(r => {
                  const pump = pumps.find((p: any) => p.id === r.pump_id);
                  return (
                    <tr key={r.pump_id} className="border-b border-gray-100">
                      <td className="py-2 px-3 font-medium text-gray-800">
                        {pump ? `${pump.name} (${pump.fuel_type})` : `Pump ${r.pump_id}`}
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={numVal(r.opening_litres)}
                          onChange={e => updateReading(r.pump_id, 'opening_litres', e.target.value)}
                          onFocus={selectOnFocus}
                          className="w-32 border border-gray-300 rounded px-2 py-1 text-right"
                          placeholder="0"
                          step="0.01"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={numVal(r.opening_amount)}
                          onChange={e => updateReading(r.pump_id, 'opening_amount', e.target.value)}
                          onFocus={selectOnFocus}
                          className="w-32 border border-gray-300 rounded px-2 py-1 text-right"
                          placeholder="0"
                          step="0.01"
                        />
                      </td>
                      <td className="py-2 px-3 text-right text-gray-500">
                        {r.closing_litres?.toLocaleString() || '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-500">
                        {r.closing_amount?.toLocaleString() || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={saveOpeningReadings}
              disabled={savingReadings}
              className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 transition disabled:opacity-50"
            >
              <Save size={18} /> {savingReadings ? 'Saving...' : 'Save Opening Readings'}
            </button>
            {readingsSaved && (
              <span className="text-green-600 text-sm font-medium">✓ Opening readings saved!</span>
            )}
          </div>
          {readingsError && <p className="text-sm text-red-600 mt-2">{readingsError}</p>}
        </div>
      )}

      {/* Station Info */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">Station Information</h2>
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Station Name</label>
            <input
              type="text"
              value={stationName}
              onChange={e => setStationName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2"
              placeholder="Enter station name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea
              value={stationAddress}
              onChange={e => setStationAddress(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2"
              rows={2}
              placeholder="Station address"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveStationInfo}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              <Save size={18} /> Save
            </button>
            {saved && (
              <span className="text-green-600 text-sm font-medium">Saved successfully!</span>
            )}
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">Configuration</h2>
        <div className="grid grid-cols-2 gap-3">
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-300 transition text-left group"
            >
              <item.icon size={20} className="text-blue-600" />
              <div className="flex-1">
                <p className="font-medium text-gray-800">{item.label}</p>
                <p className="text-sm text-gray-500">{item.description}</p>
              </div>
              <ChevronRight size={18} className="text-gray-300 group-hover:text-blue-500 transition" />
            </button>
          ))}
        </div>
      </div>

      {/* Data Management */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">Data Management</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Open Shift Warning</p>
            <div className="flex items-center gap-2">
              <input type="number" min="1" max="720" step="1" value={staleShiftHours} onChange={(event) => setStaleShiftHours(event.target.value)} className="w-24 border border-gray-300 rounded-md px-3 py-2" aria-label="Open shift warning hours" />
              <span className="text-sm text-gray-500">hours</span>
              <button type="button" onClick={saveOperationalSettings} className="p-2 rounded-md bg-blue-600 text-white" title="Save warning threshold" aria-label="Save warning threshold"><Save size={17} /></button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Open shifts older than this are highlighted for review.</p>
            {operationsSaved && <p className="text-xs text-green-700 mt-1">Threshold saved.</p>}
            {operationsError && <p className="text-xs text-red-600 mt-1">{operationsError}</p>}
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">System Check</p>
            <button type="button" onClick={handleIntegrityCheck} disabled={checkingIntegrity} className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 disabled:opacity-50">
              <ShieldCheck size={18} /> {checkingIntegrity ? 'Checking...' : 'Run Check'}
            </button>
            {integrityReport && (
              <div className={`mt-2 flex items-start gap-2 text-xs ${integrityReport.ok ? 'text-green-700' : 'text-red-700'}`}>
                {integrityReport.ok ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                <span>
                  {integrityReport.ok
                    ? `Checks passed${integrityReport.counts.stale_open_shifts ? `; ${integrityReport.counts.stale_open_shifts} stale open shift warning` : ''}.`
                    : `${integrityReport.counts.foreign_key_issues + integrityReport.counts.receivable_issues + integrityReport.counts.negative_shift_revisions + integrityReport.counts.incomplete_operations} integrity issue(s) require review.`}
                </span>
              </div>
            )}
            {integrityError && <p className="text-xs text-red-600 mt-2">{integrityError}</p>}
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Database Backup</p>
            <button
              onClick={handleBackup}
              disabled={backingUp}
              className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 transition disabled:opacity-50"
            >
              <HardDrive size={18} /> {backingUp ? 'Creating...' : 'Create Backup'}
            </button>
            <p className="text-xs text-gray-500 mt-2">Creates a consistent local copy in the server backup folder.</p>
            {backupMessage && <p className="text-xs text-green-700 mt-1 break-all">{backupMessage}</p>}
            {backupError && <p className="text-xs text-red-600 mt-1">{backupError}</p>}
          </div>
        </div>
      </div>

      {/* M-Pesa Fee Configuration */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">M-Pesa Fee Configuration</h2>
        <p className="text-sm text-gray-600 mb-4">
          The fee rate applied to M-Pesa collections when computing net receipts. Effective-dated: a
          new rate applies from its date forward and does not change past shifts.
        </p>
        {mpesaCurrent ? (
          <p className="text-sm mb-4">
            Current rate: <span className="font-semibold">
              {mpesaCurrent.fee_type === 'percentage' ? `${Number(mpesaCurrent.fee_value)}%` : `KES ${Number(mpesaCurrent.fee_value).toFixed(2)} flat`}
            </span>{' '}
            <span className="text-gray-500">(effective {mpesaCurrent.effective_date})</span>
          </p>
        ) : (
          <p className="text-sm text-gray-500 mb-4">No fee rate configured yet.</p>
        )}
        <form onSubmit={saveMpesaFeeConfig} className="grid grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
            <select value={mpesaForm.fee_type} onChange={(e) => setMpesaForm({ ...mpesaForm, fee_type: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed (KES per transaction)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {mpesaForm.fee_type === 'percentage' ? 'Rate (%)' : 'Amount (KES)'}
            </label>
            <input type="number" min="0" max={mpesaForm.fee_type === 'percentage' ? 100 : undefined} step="0.01" required
              value={mpesaForm.fee_value} onChange={(e) => setMpesaForm({ ...mpesaForm, fee_value: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Effective From</label>
            <input type="date" required value={mpesaForm.effective_date}
              onChange={(e) => setMpesaForm({ ...mpesaForm, effective_date: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={mpesaSaving || !mpesaForm.fee_value}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md disabled:opacity-50">
            <Save size={16} /> {mpesaSaving ? 'Saving...' : 'Save Rate'}
          </button>
          <div className="col-span-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input type="text" value={mpesaForm.notes} onChange={(e) => setMpesaForm({ ...mpesaForm, notes: e.target.value })}
              placeholder="e.g. Safaricom Lipa na M-Pesa rate change notice"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </div>
        </form>
        {mpesaError && <p className="text-xs text-red-700 mt-2">{mpesaError}</p>}
        {mpesaSaved && <p className="text-xs text-green-700 mt-2">Fee rate saved.</p>}
        {mpesaHistory.length > 1 && (
          <div className="mt-4">
            <button type="button" onClick={() => setShowMpesaHistory((v) => !v)} className="text-sm text-blue-600 hover:underline">
              {showMpesaHistory ? 'Hide' : 'Show'} rate history ({mpesaHistory.length})
            </button>
            {showMpesaHistory && (
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1 pr-4">Effective</th>
                    <th className="py-1 pr-4">Rate</th>
                    <th className="py-1">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {mpesaHistory.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-1 pr-4">{row.effective_date}</td>
                      <td className="py-1 pr-4">{row.fee_type === 'percentage' ? `${Number(row.fee_value)}%` : `KES ${Number(row.fee_value).toFixed(2)} flat`}</td>
                      <td className="py-1 text-gray-500">{row.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
