import { useEffect, useRef, useState } from 'react';
import { Save, Upload, RotateCcw } from 'lucide-react';
import { clearStationLogo, getStationProfile, stationLogoUrl, updateStationProfile, uploadStationLogo } from '../services/api';

// The station profile (M8): what every document's header and footer shows.
// Administrators only (the desktop is the admin terminal). Replaces the name
// and address this computer used to keep in its browser storage: those are
// carried into the form the first time, and cleared once saved.

const FIELDS: Array<{ key: string; label: string; placeholder?: string; wide?: boolean; multiline?: boolean }> = [
  { key: 'trading_name', label: 'Station name (on documents) *', placeholder: 'e.g. NexGen Filling Station' },
  { key: 'registered_name', label: 'Registered business name', placeholder: 'If different from the station name' },
  { key: 'physical_address', label: 'Location', placeholder: 'Road, town', wide: true },
  { key: 'postal_address', label: 'Postal address', placeholder: 'P.O. Box ...' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'kra_pin', label: 'KRA PIN', placeholder: 'A012345678Z' },
  { key: 'vat_number', label: 'VAT number', placeholder: 'If VAT registered' },
  { key: 'mpesa_details', label: 'M-Pesa payment details', placeholder: 'e.g. Buy Goods Till 123456' },
  { key: 'bank_details', label: 'Bank payment details', placeholder: 'Bank, branch, account name and number', wide: true },
  { key: 'document_footer', label: 'Note at the end of documents', placeholder: 'e.g. Thank you for your business.', wide: true, multiline: true },
];

const LEGACY_KEYS = ['station_name', 'station_address'];

export default function StationProfileSettings() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [customLogo, setCustomLogo] = useState(false);
  const [logoVersion, setLogoVersion] = useState(Date.now());
  const [carried, setCarried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getStationProfile()
      .then((res) => {
        const profile = res.data.data;
        const values: Record<string, string> = {};
        for (const { key } of FIELDS) values[key] = profile[key] || '';
        let legacyName = '';
        let legacyAddress = '';
        try {
          legacyName = localStorage.getItem('station_name') || '';
          legacyAddress = localStorage.getItem('station_address') || '';
        } catch { /* storage unavailable */ }
        if (!values.trading_name && (legacyName || legacyAddress)) {
          values.trading_name = legacyName;
          values.physical_address = values.physical_address || legacyAddress;
          setCarried(true);
        }
        setForm(values);
        setCustomLogo(Boolean(profile.has_custom_logo));
      })
      .catch((err) => {
        console.error('[StationProfileSettings:load]', err.response?.data || err.message);
        setError(err.response?.data?.error || err.message || 'Could not load the station profile.');
      });
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await updateStationProfile(form);
      // Show what was stored (e.g. the KRA PIN in capitals).
      const saved: Record<string, string> = {};
      for (const { key } of FIELDS) saved[key] = res.data.data[key] || '';
      setForm(saved);
      try { LEGACY_KEYS.forEach((key) => localStorage.removeItem(key)); } catch { /* storage unavailable */ }
      setCarried(false);
      setMessage('Saved. New documents will show these details.');
    } catch (err: any) {
      console.error('[StationProfileSettings:save]', err.response?.data || err.message);
      const details = err.response?.data?.details;
      setError(
        Array.isArray(details) && details.length
          ? details.map((d: any) => d.message).join('. ')
          : err.response?.data?.error || err.message || 'Could not save the station profile.',
      );
    } finally {
      setSaving(false);
    }
  }

  function chooseLogo(file: File | undefined) {
    if (!file) return;
    setError('');
    setMessage('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await uploadStationLogo(String(reader.result));
        setCustomLogo(true);
        setLogoVersion(Date.now());
        setMessage('Logo saved. New documents will use it.');
      } catch (err: any) {
        console.error('[StationProfileSettings:logo]', err.response?.data || err.message);
        setError(err.response?.data?.error || err.message || 'Could not save the logo.');
      }
    };
    reader.readAsDataURL(file);
  }

  async function useDefaultLogo() {
    try {
      await clearStationLogo();
      setCustomLogo(false);
      setLogoVersion(Date.now());
      setMessage('Back to the NexGen logo.');
    } catch (err: any) {
      console.error('[StationProfileSettings:logo:clear]', err.response?.data || err.message);
      setError(err.response?.data?.error || err.message || 'Could not change the logo.');
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-700 mb-1">Station profile</h2>
      <p className="text-sm text-gray-500 mb-4">
        Shown at the top and bottom of invoices, debit notes and credit notes. A document keeps the details it was
        issued with; changes here apply to documents issued from now on.
      </p>
      {carried && (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
          The station name and address saved on this computer were carried into the form. Check them and press Save.
        </p>
      )}

      <div className="flex items-center gap-4 mb-5">
        <div className="h-20 w-64 flex items-center justify-center rounded border border-gray-200 bg-white p-2">
          <img src={stationLogoUrl(logoVersion)} alt="Station logo" className="max-h-full max-w-full" />
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => chooseLogo(e.target.files?.[0])} />
          <button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-2 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            <Upload size={15} /> Upload a logo (PNG or JPEG, under 2 MB)
          </button>
          {customLogo && (
            <button type="button" onClick={useDefaultLogo} className="flex items-center gap-2 rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
              <RotateCcw size={15} /> Use the NexGen logo
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-3xl">
        {FIELDS.map(({ key, label, placeholder, wide, multiline }) => (
          <div key={key} className={wide ? 'col-span-2' : ''}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            {multiline ? (
              <textarea
                value={form[key] || ''}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2"
                rows={2}
                placeholder={placeholder}
              />
            ) : (
              <input
                type="text"
                value={form[key] || ''}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2"
                placeholder={placeholder}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
          <Save size={18} /> {saving ? 'Saving...' : 'Save'}
        </button>
        {message && <span className="text-green-600 text-sm font-medium">{message}</span>}
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </div>
    </div>
  );
}
