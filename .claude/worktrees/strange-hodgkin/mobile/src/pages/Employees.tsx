import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Users, Shield, UserCheck } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from '../services/api';

export default function Employees() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', daily_wage: '', pin: '', role: 'attendant' });

  const fmt = (n: number) => `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const res = await getEmployees();
      setEmployees(res.data.data || res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setForm({ name: '', phone: '', daily_wage: '', pin: '', role: 'attendant' });
    setShowModal(true);
  }

  function openEdit(emp: any) {
    setEditing(emp);
    setForm({
      name: emp.name,
      phone: emp.phone || '',
      daily_wage: String(emp.daily_wage),
      pin: '',
      role: emp.role,
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name || !form.daily_wage) return;
    if (!editing && (!form.pin || form.pin.length !== 4)) return;
    setSubmitting(true);
    try {
      const payload: any = {
        name: form.name,
        phone: form.phone,
        daily_wage: parseFloat(form.daily_wage),
        role: form.role,
      };
      if (form.pin) payload.pin = form.pin;

      if (editing) {
        await updateEmployee(editing.id, payload);
      } else {
        await createEmployee(payload);
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this employee?')) return;
    try {
      await deleteEmployee(id);
      loadData();
    } catch (err) {
      console.error(err);
    }
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader
        title="Employees"
        back
        right={
          <button onClick={openAdd} className="p-2 bg-blue-600 text-white rounded-xl">
            <Plus size={20} />
          </button>
        }
      />

      {employees.length === 0 ? (
        <div className="text-center mt-20">
          <Users size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No employees added</p>
        </div>
      ) : (
        <div className="space-y-3">
          {employees.map((emp: any) => (
            <div key={emp.id} className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-800">{emp.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                    emp.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {emp.role === 'admin' ? <Shield size={10} /> : <UserCheck size={10} />}
                    {emp.role}
                  </span>
                </div>
                {emp.phone && <p className="text-xs text-gray-400">{emp.phone}</p>}
                <p className="text-sm text-gray-600 mt-1">Wage: {fmt(emp.daily_wage)}/day</p>
              </div>
              <div className="flex items-center gap-1 ml-3">
                <button onClick={() => openEdit(emp)} className="p-2 text-gray-400 hover:text-blue-500">
                  <Pencil size={18} />
                </button>
                <button onClick={() => handleDelete(emp.id)} className="p-2 text-gray-400 hover:text-red-500">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Employee Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowModal(false)}>
          <div className="bg-white w-full rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-4">
              {editing ? 'Edit Employee' : 'Add Employee'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Name</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Employee name"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Phone</label>
                <input
                  type="tel"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="07XX XXX XXX"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Daily Wage (KES)</label>
                <input
                  type="number"
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                  value={form.daily_wage}
                  onChange={e => setForm({ ...form, daily_wage: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">
                  PIN (4 digits){editing ? ' - leave blank to keep current' : ''}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="****"
                  value={form.pin}
                  onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Role</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                >
                  <option value="attendant">Attendant</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                onClick={handleSave}
                disabled={submitting || !form.name || !form.daily_wage || (!editing && form.pin.length !== 4)}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium disabled:opacity-50 mt-2"
              >
                {submitting ? 'Saving...' : editing ? 'Update Employee' : 'Add Employee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
