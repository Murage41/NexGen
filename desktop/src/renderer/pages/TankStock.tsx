import { useState, useEffect } from 'react';
import { getTanks, createTank, getFuelDeliveries, createFuelDelivery, getTankDips, createTankDip } from '../services/api';
import { Plus, Database, X, Truck, Droplets } from 'lucide-react';

export default function TankStock() {
  const [tanks, setTanks] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [dips, setDips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tanks' | 'deliveries' | 'dips'>('tanks');
  const [showTankModal, setShowTankModal] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [showDipModal, setShowDipModal] = useState(false);
  const [tankForm, setTankForm] = useState({ label: '', fuel_type: 'petrol', capacity_litres: '' });
  const [deliveryForm, setDeliveryForm] = useState({ tank_id: '', litres: '', cost: '', delivery_date: '', supplier: '' });
  const [dipForm, setDipForm] = useState({ tank_id: '', dip_litres: '', dip_date: '' });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [tanksRes, deliveriesRes, dipsRes] = await Promise.all([
        getTanks(),
        getFuelDeliveries(),
        getTankDips(),
      ]);
      setTanks(tanksRes.data.data);
      setDeliveries(deliveriesRes.data.data);
      setDips(dipsRes.data.data);
    } catch (err) {
      console.error('Failed to load tank data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Tank handlers
  function openCreateTank() {
    setTankForm({ label: '', fuel_type: 'petrol', capacity_litres: '' });
    setShowTankModal(true);
  }

  async function handleCreateTank(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      label: tankForm.label,
      fuel_type: tankForm.fuel_type,
      capacity_litres: parseFloat(tankForm.capacity_litres),
    };
    try {
      await createTank(payload);
      setShowTankModal(false);
      loadData();
    } catch (err: any) {
      console.error('Failed to create tank:', err);
      alert(err.response?.data?.error || 'Failed to create tank');
    }
  }

  // Delivery handlers
  function openCreateDelivery() {
    setDeliveryForm({
      tank_id: '',
      litres: '',
      cost: '',
      delivery_date: new Date().toISOString().split('T')[0],
      supplier: '',
    });
    setShowDeliveryModal(true);
  }

  async function handleCreateDelivery(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      tank_id: parseInt(deliveryForm.tank_id),
      litres: parseFloat(deliveryForm.litres),
      cost: deliveryForm.cost ? parseFloat(deliveryForm.cost) : null,
      delivery_date: deliveryForm.delivery_date,
      supplier: deliveryForm.supplier || null,
    };
    try {
      await createFuelDelivery(payload);
      setShowDeliveryModal(false);
      loadData();
    } catch (err: any) {
      console.error('Failed to record delivery:', err);
      alert(err.response?.data?.error || 'Failed to record delivery');
    }
  }

  // Dip handlers
  function openCreateDip() {
    setDipForm({
      tank_id: '',
      dip_litres: '',
      dip_date: new Date().toISOString().split('T')[0],
    });
    setShowDipModal(true);
  }

  async function handleCreateDip(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      tank_id: parseInt(dipForm.tank_id),
      dip_litres: parseFloat(dipForm.dip_litres),
      dip_date: dipForm.dip_date,
    };
    try {
      await createTankDip(payload);
      setShowDipModal(false);
      loadData();
    } catch (err: any) {
      console.error('Failed to record dip:', err);
      alert(err.response?.data?.error || 'Failed to record dip');
    }
  }

  const formatKES = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  if (loading) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Database size={24} /> Tank Stock Management
        </h1>
      </div>

      {/* Stock Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {tanks.map((tank: any) => (
          <div key={tank.id} className={`bg-white rounded-lg shadow p-4 border-l-4 ${
            tank.fuel_type === 'petrol' ? 'border-blue-500' : 'border-amber-500'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-800">{tank.label}</h3>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                tank.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {tank.fuel_type.charAt(0).toUpperCase() + tank.fuel_type.slice(1)}
              </span>
            </div>
            <p className="text-sm text-gray-500">Capacity: {tank.capacity_litres?.toLocaleString('en-KE')} L</p>
            {tank.current_stock !== undefined && (
              <div className="mt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Current Stock:</span>
                  <span className="font-medium">{Number(tank.current_stock || 0).toLocaleString('en-KE')} L</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                  <div
                    className={`h-2 rounded-full ${tank.fuel_type === 'petrol' ? 'bg-blue-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(100, ((tank.current_stock || 0) / (tank.capacity_litres || 1)) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        {tanks.length === 0 && (
          <div className="col-span-3 bg-white rounded-lg shadow p-6 text-gray-400 text-center">
            No tanks configured. Add a tank to get started.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => setActiveTab('tanks')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'tanks' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Tanks
        </button>
        <button
          onClick={() => setActiveTab('deliveries')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'deliveries' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Deliveries
        </button>
        <button
          onClick={() => setActiveTab('dips')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            activeTab === 'dips' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Tank Dips
        </button>
      </div>

      {/* Tab Actions */}
      <div className="flex justify-end mb-4">
        {activeTab === 'tanks' && (
          <button onClick={openCreateTank} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            <Plus size={18} /> Add Tank
          </button>
        )}
        {activeTab === 'deliveries' && (
          <button onClick={openCreateDelivery} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            <Truck size={18} /> Record Delivery
          </button>
        )}
        {activeTab === 'dips' && (
          <button onClick={openCreateDip} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
            <Droplets size={18} /> Record Dip
          </button>
        )}
      </div>

      {/* Tank Modal */}
      {showTankModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Tank</h2>
              <button onClick={() => setShowTankModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateTank} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
                <input type="text" required value={tankForm.label} onChange={e => setTankForm({ ...tankForm, label: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="e.g. Tank 1" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fuel Type *</label>
                <select value={tankForm.fuel_type} onChange={e => setTankForm({ ...tankForm, fuel_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Capacity (Litres) *</label>
                <input type="number" required min="1" value={tankForm.capacity_litres} onChange={e => setTankForm({ ...tankForm, capacity_litres: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="e.g. 10000" />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowTankModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delivery Modal */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Record Fuel Delivery</h2>
              <button onClick={() => setShowDeliveryModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateDelivery} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tank *</label>
                <select required value={deliveryForm.tank_id} onChange={e => setDeliveryForm({ ...deliveryForm, tank_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  <option value="">-- Select Tank --</option>
                  {tanks.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.label} ({t.fuel_type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Litres Delivered *</label>
                <input type="number" required step="0.01" min="0" value={deliveryForm.litres} onChange={e => setDeliveryForm({ ...deliveryForm, litres: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost (KES)</label>
                <input type="number" step="0.01" min="0" value={deliveryForm.cost} onChange={e => setDeliveryForm({ ...deliveryForm, cost: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Date *</label>
                <input type="date" required value={deliveryForm.delivery_date} onChange={e => setDeliveryForm({ ...deliveryForm, delivery_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <input type="text" value={deliveryForm.supplier} onChange={e => setDeliveryForm({ ...deliveryForm, supplier: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="Supplier name" />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowDeliveryModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Record</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dip Modal */}
      {showDipModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Record Tank Dip</h2>
              <button onClick={() => setShowDipModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateDip} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tank *</label>
                <select required value={dipForm.tank_id} onChange={e => setDipForm({ ...dipForm, tank_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2">
                  <option value="">-- Select Tank --</option>
                  {tanks.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.label} ({t.fuel_type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dip Reading (Litres) *</label>
                <input type="number" required step="0.01" min="0" value={dipForm.dip_litres} onChange={e => setDipForm({ ...dipForm, dip_litres: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dip Date *</label>
                <input type="date" required value={dipForm.dip_date} onChange={e => setDipForm({ ...dipForm, dip_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2" />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowDipModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Record</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'tanks' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">#</th>
                <th className="text-left p-3 font-medium text-gray-600">Label</th>
                <th className="text-left p-3 font-medium text-gray-600">Fuel Type</th>
                <th className="text-right p-3 font-medium text-gray-600">Capacity (L)</th>
                <th className="text-right p-3 font-medium text-gray-600">Current Stock (L)</th>
              </tr>
            </thead>
            <tbody>
              {tanks.map((tank: any) => (
                <tr key={tank.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-gray-500">{tank.id}</td>
                  <td className="p-3 font-medium">{tank.label}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      tank.fuel_type === 'petrol' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {tank.fuel_type.charAt(0).toUpperCase() + tank.fuel_type.slice(1)}
                    </span>
                  </td>
                  <td className="p-3 text-right">{tank.capacity_litres?.toLocaleString('en-KE')}</td>
                  <td className="p-3 text-right font-medium">{Number(tank.current_stock || 0).toLocaleString('en-KE')}</td>
                </tr>
              ))}
              {tanks.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">No tanks configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'deliveries' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">#</th>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Tank</th>
                <th className="text-right p-3 font-medium text-gray-600">Litres</th>
                <th className="text-right p-3 font-medium text-gray-600">Cost</th>
                <th className="text-left p-3 font-medium text-gray-600">Supplier</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d: any) => (
                <tr key={d.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-gray-500">{d.id}</td>
                  <td className="p-3">{d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('en-KE') : '-'}</td>
                  <td className="p-3 font-medium">{d.tank_label || `Tank #${d.tank_id}`}</td>
                  <td className="p-3 text-right">{Number(d.litres).toLocaleString('en-KE')}</td>
                  <td className="p-3 text-right">{d.cost ? formatKES(d.cost) : '-'}</td>
                  <td className="p-3 text-gray-600">{d.supplier || '-'}</td>
                </tr>
              ))}
              {deliveries.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">No deliveries recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'dips' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">#</th>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Tank</th>
                <th className="text-right p-3 font-medium text-gray-600">Dip Reading (L)</th>
              </tr>
            </thead>
            <tbody>
              {dips.map((d: any) => (
                <tr key={d.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-gray-500">{d.id}</td>
                  <td className="p-3">{d.dip_date ? new Date(d.dip_date).toLocaleDateString('en-KE') : '-'}</td>
                  <td className="p-3 font-medium">{d.tank_label || `Tank #${d.tank_id}`}</td>
                  <td className="p-3 text-right font-medium">{Number(d.dip_litres).toLocaleString('en-KE')}</td>
                </tr>
              ))}
              {dips.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-gray-400">No dip readings recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
