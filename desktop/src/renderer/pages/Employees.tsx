import { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CirclePlus,
  Pencil,
  Plus,
  Trash2,
  UserX,
  Users,
  X,
} from 'lucide-react';
import {
  createCompensationPlan,
  createEmployee,
  deleteEmployee,
  getCompensationPlans,
  getEmployees,
  updateEmployee,
} from '../services/api';

type CompensationComponent = {
  component_type: 'fixed_per_shift' | 'fixed_periodic' | 'sales_percentage' | 'litre_rate';
  amount: string;
  rate: string;
  fuel_type: '' | 'petrol' | 'diesel';
  minimum_amount: string;
  maximum_amount: string;
};

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const tomorrow = () => {
  const date = new Date(`${today()}T00:00:00+03:00`);
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
};

const emptyComponent = (component_type: CompensationComponent['component_type'] = 'fixed_per_shift'): CompensationComponent => ({
  component_type,
  amount: '',
  rate: '',
  fuel_type: '',
  minimum_amount: '',
  maximum_amount: '',
});

const emptyProfile = () => ({
  name: '',
  phone: '',
  job_title: '',
  employment_type: 'permanent',
  employment_start_date: today(),
  employment_end_date: '',
  pin: '',
  role: 'attendant',
  active: true,
});

const emptyPlan = (effectiveFrom = today()) => ({
  name: 'Standard compensation',
  pay_schedule: 'daily',
  proration_method: 'calendar_days',
  effective_from: effectiveFrom,
  notes: '',
  components: [emptyComponent()],
});

function formatKES(value: number) {
  return `KES ${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizePlan(plan: ReturnType<typeof emptyPlan>) {
  return {
    name: plan.name.trim(),
    pay_schedule: plan.pay_schedule,
    proration_method: plan.proration_method,
    effective_from: plan.effective_from,
    notes: plan.notes.trim() || null,
    components: plan.components.map((component) => ({
      component_type: component.component_type,
      amount: component.component_type.startsWith('fixed') ? Number(component.amount) : null,
      rate: component.component_type === 'sales_percentage' || component.component_type === 'litre_rate'
        ? Number(component.rate)
        : null,
      fuel_type: component.fuel_type || null,
      minimum_amount: component.minimum_amount === '' ? null : Number(component.minimum_amount),
      maximum_amount: component.maximum_amount === '' ? null : Number(component.maximum_amount),
    })),
  };
}

export default function Employees() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [planModal, setPlanModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [profile, setProfile] = useState(emptyProfile());
  const [plan, setPlan] = useState(emptyPlan());
  const [planHistory, setPlanHistory] = useState<any[]>([]);

  useEffect(() => { loadEmployees(); }, []);

  async function loadEmployees() {
    try {
      const response = await getEmployees();
      setEmployees(response.data.data || []);
    } catch (error) {
      console.error('Failed to load employees', error);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setProfile(emptyProfile());
    setPlan(emptyPlan());
    setProfileModal(true);
  }

  function openEdit(employee: any) {
    setEditing(employee);
    setProfile({
      name: employee.name || '',
      phone: employee.phone || '',
      job_title: employee.job_title || '',
      employment_type: employee.employment_type || 'permanent',
      employment_start_date: employee.employment_start_date || '',
      employment_end_date: employee.employment_end_date || '',
      pin: '',
      role: employee.role || 'attendant',
      active: Boolean(employee.active),
    });
    setProfileModal(true);
  }

  async function openCompensation(employee: any) {
    setSelectedEmployee(employee);
    const active = employee.compensation_plan;
    setPlan({
      name: `${employee.name} compensation`,
      pay_schedule: active?.pay_schedule || 'monthly',
      proration_method: active?.proration_method || 'calendar_days',
      effective_from: tomorrow(),
      notes: '',
      components: active?.components?.length
        ? active.components.map((component: any) => ({
          component_type: component.component_type,
          amount: component.amount == null ? '' : String(component.amount),
          rate: component.rate == null ? '' : String(component.rate),
          fuel_type: component.fuel_type || '',
          minimum_amount: component.minimum_amount == null ? '' : String(component.minimum_amount),
          maximum_amount: component.maximum_amount == null ? '' : String(component.maximum_amount),
        }))
        : [emptyComponent()],
    });
    try {
      const response = await getCompensationPlans(employee.id);
      setPlanHistory(response.data.data?.plans || []);
    } catch {
      setPlanHistory([]);
    }
    setPlanModal(true);
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        const payload: any = {
          name: profile.name.trim(),
          phone: profile.phone.trim() || null,
          job_title: profile.job_title.trim() || null,
          employment_type: profile.employment_type,
          employment_start_date: profile.employment_start_date || null,
          employment_end_date: profile.employment_end_date || null,
          role: profile.role,
          active: profile.active,
        };
        if (profile.pin) payload.pin = profile.pin;
        await updateEmployee(editing.id, payload);
      } else {
        const normalizedPlan = normalizePlan(plan);
        const fixed = normalizedPlan.components.find((component) => component.component_type === 'fixed_per_shift');
        await createEmployee({
          name: profile.name.trim(),
          phone: profile.phone.trim() || null,
          job_title: profile.job_title.trim() || null,
          employment_type: profile.employment_type,
          employment_start_date: profile.employment_start_date || null,
          role: profile.role,
          pin: profile.pin,
          daily_wage: Number(fixed?.amount || 0),
          initial_compensation_plan: normalizedPlan,
        });
      }
      setProfileModal(false);
      await loadEmployees();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to save employee');
    } finally {
      setSaving(false);
    }
  }

  async function saveCompensation(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedEmployee) return;
    setSaving(true);
    try {
      await createCompensationPlan(selectedEmployee.id, normalizePlan(plan));
      setPlanModal(false);
      await loadEmployees();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to save compensation plan');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(employee: any) {
    if (!confirm(`Deactivate ${employee.name}? Historical shifts and payroll records will remain available.`)) return;
    try {
      await deleteEmployee(employee.id);
      await loadEmployees();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to deactivate employee');
    }
  }

  function updateComponent(index: number, field: keyof CompensationComponent, value: string) {
    setPlan((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) => (
        componentIndex === index ? { ...component, [field]: value } : component
      )),
    }));
  }

  const totals = useMemo(() => ({
    active: employees.filter((employee) => Boolean(employee.active)).length,
    earnings: employees.reduce((sum, employee) => sum + Number(employee.current_period_earnings || 0), 0),
    due: employees.reduce((sum, employee) => sum + Number(employee.payroll_balance_due || 0), 0),
    debt: employees.reduce((sum, employee) => sum + Number(employee.outstanding_staff_debt || 0), 0),
  }), [employees]);

  if (loading) return <div className="text-gray-500">Loading employees...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Users size={24} /> Employees
          </h1>
          <p className="text-sm text-gray-500 mt-1">Employment, access, compensation, and payroll position</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          <Plus size={18} /> Add Employee
        </button>
      </div>

      <div className="grid grid-cols-4 gap-5 border-y border-gray-200 py-4 mb-5">
        <Metric label="Active employees" value={String(totals.active)} />
        <Metric label="Earnings this month" value={formatKES(totals.earnings)} />
        <Metric label="Payroll due" value={formatKES(totals.due)} />
        <Metric label="Staff debt" value={formatKES(totals.debt)} />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left p-3 font-medium">Employee</th>
              <th className="text-left p-3 font-medium">Employment</th>
              <th className="text-left p-3 font-medium">Compensation</th>
              <th className="text-right p-3 font-medium">Month earnings</th>
              <th className="text-right p-3 font-medium">Payroll due</th>
              <th className="text-right p-3 font-medium">Staff debt</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="p-3">
                  <p className="font-medium text-gray-900">{employee.name}</p>
                  <p className="text-xs text-gray-500">{employee.job_title || 'No job title'} - {employee.role}</p>
                </td>
                <td className="p-3 text-gray-600 capitalize">
                  {employee.employment_type || 'Not specified'}
                  {employee.employment_start_date && (
                    <p className="text-xs text-gray-400 mt-0.5">Since {employee.employment_start_date}</p>
                  )}
                </td>
                <td className="p-3 max-w-xs">
                  <p className="font-medium text-gray-800">{employee.compensation_summary}</p>
                  <p className="text-xs text-gray-400 capitalize">{employee.compensation_plan?.pay_schedule || 'No schedule'} pay</p>
                </td>
                <td className="p-3 text-right tabular-nums">{formatKES(employee.current_period_earnings)}</td>
                <td className="p-3 text-right tabular-nums">{formatKES(employee.payroll_balance_due)}</td>
                <td className={`p-3 text-right tabular-nums ${Number(employee.outstanding_staff_debt) > 0 ? 'text-red-600' : ''}`}>
                  {formatKES(employee.outstanding_staff_debt)}
                </td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${employee.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {employee.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex justify-end gap-1">
                    <IconButton title="Edit profile" onClick={() => openEdit(employee)}><Pencil size={16} /></IconButton>
                    <IconButton title="Change compensation" onClick={() => openCompensation(employee)}><BadgeDollarSign size={17} /></IconButton>
                    {Boolean(employee.active) && (
                      <IconButton title="Deactivate" danger onClick={() => deactivate(employee)}><UserX size={17} /></IconButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr><td colSpan={8} className="p-10 text-center text-gray-400">No employees have been added.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {profileModal && (
        <Modal title={editing ? 'Edit Employee' : 'Add Employee'} onClose={() => setProfileModal(false)} wide={!editing}>
          <form onSubmit={saveProfile}>
            <div className={`grid gap-6 ${editing ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <section>
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Employment Profile</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name *" span>
                    <input required value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} className="input" />
                  </Field>
                  <Field label="Phone">
                    <input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} className="input" />
                  </Field>
                  <Field label="Job title">
                    <input value={profile.job_title} onChange={(event) => setProfile({ ...profile, job_title: event.target.value })} className="input" placeholder="Station attendant" />
                  </Field>
                  <Field label="Employment type">
                    <select value={profile.employment_type} onChange={(event) => setProfile({ ...profile, employment_type: event.target.value })} className="input">
                      <option value="permanent">Permanent</option>
                      <option value="contract">Contract</option>
                      <option value="casual">Casual</option>
                      <option value="temporary">Temporary</option>
                    </select>
                  </Field>
                  <Field label="Start date">
                    <input type="date" value={profile.employment_start_date} onChange={(event) => setProfile({ ...profile, employment_start_date: event.target.value })} className="input" />
                  </Field>
                  {editing && (
                    <Field label="End date">
                      <input type="date" value={profile.employment_end_date} onChange={(event) => setProfile({ ...profile, employment_end_date: event.target.value })} className="input" />
                    </Field>
                  )}
                  <Field label="System role">
                    <select value={profile.role} onChange={(event) => setProfile({ ...profile, role: event.target.value })} className="input">
                      <option value="attendant">Attendant</option>
                      <option value="admin">Admin</option>
                    </select>
                  </Field>
                  <Field label={editing ? 'New PIN' : 'PIN *'}>
                    <input type="password" inputMode="numeric" required={!editing} pattern="\d{4}" maxLength={4}
                      value={profile.pin}
                      onChange={(event) => setProfile({ ...profile, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                      className="input" placeholder={editing ? 'Leave blank to keep current' : '4 digits'} />
                  </Field>
                </div>
              </section>
              {!editing && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Starting Compensation</h3>
                  <PlanEditor plan={plan} setPlan={setPlan} updateComponent={updateComponent} allowEffectiveDate />
                </section>
              )}
            </div>
            <ModalActions saving={saving} onCancel={() => setProfileModal(false)} submitLabel={editing ? 'Update Employee' : 'Create Employee'} />
          </form>
        </Modal>
      )}

      {planModal && selectedEmployee && (
        <Modal title={`Compensation - ${selectedEmployee.name}`} onClose={() => setPlanModal(false)} wide>
          <form onSubmit={saveCompensation}>
            <div className="grid grid-cols-[1fr_300px] gap-6">
              <section>
                <PlanEditor plan={plan} setPlan={setPlan} updateComponent={updateComponent} allowEffectiveDate />
              </section>
              <aside className="border-l border-gray-200 pl-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Plan History</h3>
                <div className="space-y-3 max-h-[420px] overflow-y-auto">
                  {planHistory.map((history) => (
                    <div key={history.id} className="border-b border-gray-100 pb-3">
                      <p className="text-sm font-medium text-gray-800">{history.name}</p>
                      <p className="text-xs text-gray-500 capitalize">{history.pay_schedule} - version {history.version}</p>
                      <p className="text-xs text-gray-400 mt-1">{history.effective_from} to {history.effective_to || 'current'}</p>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
            <ModalActions saving={saving} onCancel={() => setPlanModal(false)} submitLabel="Activate New Plan" />
          </form>
        </Modal>
      )}
    </div>
  );
}

function PlanEditor({ plan, setPlan, updateComponent, allowEffectiveDate }: any) {
  const hasFixedSalary = plan.components.some(
    (component: CompensationComponent) => component.component_type === 'fixed_periodic',
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Plan name">
          <input required value={plan.name} onChange={(event) => setPlan({ ...plan, name: event.target.value })} className="input" />
        </Field>
        <Field label="Payroll schedule">
          <select value={plan.pay_schedule} onChange={(event) => setPlan({ ...plan, pay_schedule: event.target.value })} className="input">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 14 days</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        {allowEffectiveDate && (
          <Field label="Effective from">
            <input required type="date" value={plan.effective_from} onChange={(event) => setPlan({ ...plan, effective_from: event.target.value })} className="input" />
          </Field>
        )}
        {hasFixedSalary && (
          <Field label="Salary proration">
            <select value={plan.proration_method} onChange={(event) => setPlan({ ...plan, proration_method: event.target.value })} className="input">
              <option value="calendar_days">Calendar days</option>
              <option value="none">No proration</option>
            </select>
          </Field>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <h4 className="text-sm font-semibold text-gray-700">Earning Components</h4>
        <button type="button" onClick={() => setPlan({ ...plan, components: [...plan.components, emptyComponent('sales_percentage')] })}
          className="text-blue-600 hover:text-blue-800 p-1" title="Add earning component">
          <CirclePlus size={19} />
        </button>
      </div>

      <div className="space-y-2">
        {plan.components.map((component: CompensationComponent, index: number) => {
          const fixed = component.component_type.startsWith('fixed');
          return (
            <div key={index} className="grid grid-cols-[1.5fr_1fr_1fr_72px_32px] gap-2 items-end border border-gray-200 rounded-lg p-3">
              <Field label="Method">
                <select value={component.component_type}
                  onChange={(event) => updateComponent(index, 'component_type', event.target.value)}
                  className="input">
                  <option value="fixed_per_shift">Fixed per shift</option>
                  <option value="fixed_periodic">Fixed salary</option>
                  <option value="sales_percentage">% of sales</option>
                  <option value="litre_rate">KES per litre</option>
                </select>
              </Field>
              <Field label={fixed ? 'Amount (KES)' : component.component_type === 'sales_percentage' ? 'Rate (%)' : 'KES / litre'}>
                <input required type="number" min="0" step="0.01"
                  value={fixed ? component.amount : component.rate}
                  onChange={(event) => updateComponent(index, fixed ? 'amount' : 'rate', event.target.value)}
                  className="input" />
              </Field>
              <Field label="Fuel scope">
                <select disabled={fixed} value={component.fuel_type}
                  onChange={(event) => updateComponent(index, 'fuel_type', event.target.value)}
                  className="input disabled:bg-gray-100">
                  <option value="">All fuel</option>
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </Field>
              <Field label="Cap">
                <input type="number" min="0" step="0.01" value={component.maximum_amount}
                  onChange={(event) => updateComponent(index, 'maximum_amount', event.target.value)}
                  className="input" placeholder="None" />
              </Field>
              <button type="button" disabled={plan.components.length === 1}
                onClick={() => setPlan({ ...plan, components: plan.components.filter((_: any, row: number) => row !== index) })}
                className="h-10 flex items-center justify-center text-gray-400 hover:text-red-600 disabled:opacity-30" title="Remove component">
                <Trash2 size={17} />
              </button>
            </div>
          );
        })}
      </div>
      <Field label="Notes">
        <textarea rows={2} value={plan.notes} onChange={(event) => setPlan({ ...plan, notes: event.target.value })} className="input" />
      </Field>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase font-medium text-gray-400">{label}</p>
      <p className="text-lg font-semibold text-gray-800 mt-1">{value}</p>
    </div>
  );
}

function Field({ label, children, span = false }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <label className={span ? 'col-span-2' : ''}>
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function IconButton({ title, onClick, children, danger = false }: any) {
  return (
    <button type="button" title={title} onClick={onClick}
      className={`p-2 rounded hover:bg-gray-100 ${danger ? 'text-red-500' : 'text-gray-500 hover:text-blue-700'}`}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide = false }: any) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className={`bg-white rounded-lg w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} max-h-[92vh] overflow-y-auto`}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" title="Close">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({ saving, onCancel, submitLabel }: any) {
  return (
    <div className="flex justify-end gap-2 border-t border-gray-200 mt-6 pt-4">
      <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
      <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Saving...' : submitLabel}
      </button>
    </div>
  );
}
