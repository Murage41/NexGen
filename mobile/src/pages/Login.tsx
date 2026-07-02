import { useEffect, useState } from 'react';
import { Fuel } from 'lucide-react';
import { getAuthEmployees, getConfiguredApiUrl, login as apiLogin, setConfiguredApiUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { setSession } = useAuth();
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [useUsername, setUseUsername] = useState(false);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [serverUrl, setServerUrl] = useState(() => getConfiguredApiUrl());
  const [loading, setLoading] = useState(true);

  function loadEmployees() {
    setLoading(true);
    getAuthEmployees()
      .then((res) => setEmployees(res.data.data))
      .catch(() => setError('Cannot connect to server'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  function storeSession(data: any, token?: string, expiresAt?: string) {
    if (!token || !expiresAt) {
      setError('Login response did not include a valid session. Please update the server and try again.');
      return;
    }
    setSession(data, token, expiresAt);
  }

  async function handleLogin(pinValue = pin) {
    const typedUsername = username.trim();
    if ((!selectedId && (!useUsername || !typedUsername)) || pinValue.length !== 4) return;

    setError('');
    try {
      const res = await apiLogin(
        useUsername ? null : selectedId,
        pinValue,
        useUsername ? typedUsername : undefined,
      );
      storeSession(res.data.data, res.data.token, res.data.session?.expires_at);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
      setPin('');
    }
  }

  function handlePinPress(digit: string) {
    if (pin.length >= 4) return;

    const newPin = pin + digit;
    setPin(newPin);
    if (newPin.length === 4 && (selectedId || (useUsername && username.trim()))) {
      window.setTimeout(() => handleLogin(newPin), 100);
    }
  }

  function handleBackspace() {
    setPin(pin.slice(0, -1));
    setError('');
  }

  function switchMode(nextUseUsername: boolean) {
    setUseUsername(nextUseUsername);
    setSelectedId(null);
    setPin('');
    setError('');
  }

  function saveServerUrl() {
    setConfiguredApiUrl(serverUrl);
    setSelectedId(null);
    setPin('');
    setError('');
    loadEmployees();
  }

  const canEnterPin = selectedId || (useUsername && username.trim());

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-700 flex flex-col items-center justify-center px-6">
      <div className="text-center mb-8">
        <Fuel size={48} className="text-blue-300 mx-auto mb-2" />
        <h1 className="text-3xl font-bold text-white">NexGen</h1>
        <p className="text-blue-200 text-sm">Petrol Station Manager</p>
      </div>

      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        {loading ? (
          <p className="text-center text-gray-500">Connecting...</p>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">Station server</label>
              <div className="flex gap-2">
                <input
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                  placeholder="http://nexgen-station:3001"
                  className="min-w-0 flex-1 rounded-lg border-2 border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-600"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <button
                  onClick={saveServerUrl}
                  className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 active:bg-gray-200"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={() => switchMode(false)}
                className={`p-2 rounded-lg text-sm font-medium border-2 transition ${
                  !useUsername ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700'
                }`}
              >
                Select name
              </button>
              <button
                onClick={() => switchMode(true)}
                className={`p-2 rounded-lg text-sm font-medium border-2 transition ${
                  useUsername ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700'
                }`}
              >
                Staff code
              </button>
            </div>

            {!useUsername ? (
              <>
                <label className="block text-sm font-medium text-gray-600 mb-2">Select your name</label>
                <div className="grid grid-cols-2 gap-2 mb-6">
                  {employees.map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => { setSelectedId(emp.id); setPin(''); setError(''); }}
                      className={`p-3 rounded-lg text-sm font-medium border-2 transition ${
                        selectedId === emp.id
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {emp.name}
                      {emp.role && <span className="block text-xs text-gray-400 mt-0.5">{emp.role}</span>}
                    </button>
                  ))}
                  {employees.length === 0 && (
                    <p className="col-span-2 text-center text-gray-400 text-sm py-4">
                      No employees found. Add them from the desktop app first.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-600 mb-2">Staff code or username</label>
                <input
                  value={username}
                  onChange={(event) => { setUsername(event.target.value); setPin(''); setError(''); }}
                  className="w-full rounded-lg border-2 border-gray-200 px-3 py-3 text-gray-800 outline-none focus:border-blue-600"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            )}

            {canEnterPin && (
              <>
                <label className="block text-sm font-medium text-gray-600 mb-2 text-center">Enter PIN</label>
                <div className="flex justify-center gap-3 mb-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold ${
                        pin.length > i ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200'
                      }`}
                    >
                      {pin.length > i ? '*' : ''}
                    </div>
                  ))}
                </div>

                {error && <p className="text-red-500 text-sm text-center mb-3">{error}</p>}

                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'Del'].map((key) => (
                    <button
                      key={key}
                      onClick={() => key === 'Del' ? handleBackspace() : key ? handlePinPress(key) : null}
                      disabled={!key}
                      className={`h-14 rounded-lg text-xl font-medium transition ${
                        key === 'Del'
                          ? 'bg-gray-100 text-gray-600 active:bg-gray-200'
                          : key
                            ? 'bg-gray-50 text-gray-800 active:bg-blue-100'
                            : ''
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
