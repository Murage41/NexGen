import { useState, useEffect } from 'react';
import { getAuthEmployees, login as apiLogin } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Fuel } from 'lucide-react';

export default function Login() {
  const { setUser } = useAuth();
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuthEmployees()
      .then(res => setEmployees(res.data.data))
      .catch(() => setError('Cannot connect to server'))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogin() {
    if (!selectedId || pin.length !== 4) return;
    setError('');
    try {
      const res = await apiLogin(selectedId, pin);
      setUser(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    }
  }

  function handlePinPress(digit: string) {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4 && selectedId) {
        // Auto-submit on 4th digit
        setTimeout(() => {
          setError('');
          apiLogin(selectedId, newPin)
            .then(res => setUser(res.data.data))
            .catch((err: any) => {
              setError(err.response?.data?.error || 'Login failed');
              setPin('');
            });
        }, 100);
      }
    }
  }

  function handleBackspace() {
    setPin(pin.slice(0, -1));
    setError('');
  }

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
            {/* Employee Selection */}
            <label className="block text-sm font-medium text-gray-600 mb-2">Select your name</label>
            <div className="grid grid-cols-2 gap-2 mb-6">
              {employees.map(emp => (
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
                  <span className="block text-xs text-gray-400 mt-0.5">{emp.role}</span>
                </button>
              ))}
              {employees.length === 0 && (
                <p className="col-span-2 text-center text-gray-400 text-sm py-4">
                  No employees found. Add them from the desktop app first.
                </p>
              )}
            </div>

            {selectedId && (
              <>
                {/* PIN Display */}
                <label className="block text-sm font-medium text-gray-600 mb-2 text-center">Enter PIN</label>
                <div className="flex justify-center gap-3 mb-4">
                  {[0, 1, 2, 3].map(i => (
                    <div
                      key={i}
                      className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold ${
                        pin.length > i ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200'
                      }`}
                    >
                      {pin.length > i ? '●' : ''}
                    </div>
                  ))}
                </div>

                {error && <p className="text-red-500 text-sm text-center mb-3">{error}</p>}

                {/* Number Pad */}
                <div className="grid grid-cols-3 gap-2">
                  {['1','2','3','4','5','6','7','8','9','','0','⌫'].map(key => (
                    <button
                      key={key}
                      onClick={() => key === '⌫' ? handleBackspace() : key ? handlePinPress(key) : null}
                      disabled={!key}
                      className={`h-14 rounded-lg text-xl font-medium transition ${
                        key === '⌫'
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
