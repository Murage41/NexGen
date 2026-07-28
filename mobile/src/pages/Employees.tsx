import { useEffect, useState } from 'react';
import {
  BadgeDollarSign,
  CirclePlus,
  Pencil,
  Plus,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import {
  createCompensationPlan,
  createEmployee,
  deleteEmployee,
  getEmployees,
  updateEmployee,
} from '../services/api';

type Component = {
  component_type: 'fixed_per_shift' | 'fixed_periodic' | 'sales_percentage' | 'litre_rate';
  amount: string;
  rate: string;
  fuel_type: string;
};

const kenyaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const nextDay = () => {
  const date = new Date(`${kenyaToday()}T00:00:00+03:00`);
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
};
const blankComponent = (): Component => ({
  component_type: 'fixed_per_shift',
  amount: '',
  rate: '',
  fuel_type: '',
});
const blankProfile = () => ({
  name: '',
  phone: '',
  job_title: '',
  employment_type: 'permanent',
  employment_start_date: kenyaToday(),
  pin: '',
  role: 'attendant',
});
const blankPlan = (effectiveFrom = kenyaToday()) => ({
  name: 'Standard compensation',
  pay_schedule: 'daily',
  proration_method: 'calendar_days',
  effective_from: effectiveFrom,
  components: [blankComponent()],
});
const kes = (value: number) => `KES ${Number(value || 0).toLocaleString('en-KE', {
  maximumFractionDigits: 2,
})}`;

function normalizePlan(plan: ReturnType<typeof blankPlan>) {
  return {
    ...plan,
    components: plan.components.map((component) => ({
      component_type: component.component_type,
      amount: component.component_type.startsWith('fixed') ? Number(component.amount) : null,
      rate: component.component_type === 'sales_percentage' || component.component_type === 'litre_rate'
        ? Number(component.rate)
        : null,
      fuel_type: component.fuel_type || null,
    })),
  };
}

export default function Employees() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileSheet, setProfileSheet] = useState(false);
  const [planSheet, setPlanSheet] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [profile, setProfile] = useState(blankProfile());
  const [plan, setPlan] = useState(blankPlan());

  useEffect(() => { loadEmployees(); }, []);

  async function loadEmployees() {
    try {
      const response = await getEmployees();
      setEmployees(response.data.data || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setProfile(blankProfile());
    setPlan(blankPlan());
    setProfileSheet(true);
  }

  function openEdit(employee: any) {
    setEditing(employee);
    setProfile({
      name: employee.name || '',
      phone: employee.phone || '',
      job_title: employee.job_title || '',
      employment_type: employee.employment_type || 'permanent',
      employment_start_date: employee.employment_start_date || '',
      pin: '',
      role: employee.role || 'attendant',
    });
    setProfileSheet(true);
  }

  function openPlan(employee: any) {
    setSelectedEmployee(employee);
    const active = employee.compensation_plan;
    setPlan({
      name: `${employee.name} compensation`,
      pay_schedule: active?.pay_schedule || 'monthly',
      proration_method: active?.proration_method || 'calendar_days',
      effective_from: nextDay(),
      components: active?.components?.length
        ? active.components.map((component: any) => ({
          component_type: component.component_type,
          amount: component.amount == null ? '' : String(component.amount),
          rate: component.rate == null ? '' : String(component.rate),
          fuel_type: component.fuel_type || '',
        }))
        : [blankComponent()],
    });
    setPlanSheet(true);
  }

  async function saveProfile() {
    if (!profile.name.trim() || (!editing && profile.pin.length !== 4)) return;
    setSaving(true);
    try {
      if (editing) {
        const payload: any = {
          name: profile.name.trim(),
          phone: profile.phone.trim() || null,
          job_title: profile.job_title.trim() || null,
          employment_type: profile.employment_type,
          employment_start_date: profile.employment_start_date || null,
          role: profile.role,
        };
        if (profile.pin) payload.pin = profile.pin;
        await updateEmployee(editing.id, payload);
      } else {
        const normalizedPlan = normalizePlan(plan);
        const fixed = normalizedPlan.components.find((component) => component.component_type === 'fixed_per_shift');
        await createEmployee({
          ...profile,
          name: profile.name.trim(),
          phone: profile.phone.trim() || null,
          job_title: profile.job_title.trim() || null,
          daily_wage: Number(fixed?.amount || 0),
          initial_compensation_plan: normalizedPlan,
        });
      }
      setProfileSheet(false);
      await loadEmployees();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to save employee');
    } finally {
      setSaving(false);
    }
  }

  async function savePlan() {
    if (!selectedEmployee) return;
    setSaving(true);
    try {
      await createCompensationPlan(selectedEmployee.id, normalizePlan(plan));
      setPlanSheet(false);
      await loadEmployees();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to save compensation plan');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(employee: any) {
    if (!confirm(`Deactivate ${employee.name}? Historical records will remain available.`)) return;
    try {
      await deleteEmployee(employee.id);
      await loadEmployees();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to deactivate employee');
    }
  }

  function updateComponent(index: number, field: keyof Component, value: string) {
    setPlan({
      ...plan,
      components: plan.components.map((component, componentIndex) => (
        componentIndex === index ? { ...component, [field]: value } : component
      )),
    });
  }

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader title="Employees" back right={
        <button onClick={openAdd} className="p-2 bg-blue-600 text-white rounded-xl" title="Add employee"><Plus size={20} /></button>
      } />

      {employees.length === 0 ? (
        <div className="text-center mt-20">
          <Users size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400">No employees added</p>
        </div>
      ) : (
        <div className="space-y-3">
          {employees.map((employee) => (
            <div key={employee.id} className={`bg-white border rounded-xl p-4 ${employee.active ? 'border-gray-100' : 'border-gray-200 opacity-70'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 truncate">{employee.name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${
                      employee.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {employee.role === 'admin' ? <Shield size={9} /> : <UserCheck size={9} />}{employee.role}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{employee.job_title || employee.employment_type || 'Employment details not set'}</p>
                </div>
                <div className="flex">
                  <button onClick={() => openEdit(employee)} className="p-2 text-gray-400 hover:text-blue-600" title="Edit profile"><Pencil size={17} /></button>
                  <button onClick={() => openPlan(employee)} className="p-2 text-gray-400 hover:text-blue-600" title="Change compensation"><BadgeDollarSign size={18} /></button>
                  {Boolean(employee.active) && <button onClick={() => deactivate(employee)} className="p-2 text-gray-400 hover:text-red-600" title="Deactivate"><UserX size={18} /></button>}
                </div>
              </div>

              <div className="border-t border-gray-100 mt-3 pt-3">
                <p className="text-sm font-medium text-gray-700">{employee.compensation_summary}</p>
                <p className="text-xs text-gray-400 capitalize mt-0.5">{employee.compensation_plan?.pay_schedule || 'No'} payment schedule</p>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <Metric label="Earned" value={kes(employee.current_period_earnings)} />
                <Metric label="Due" value={kes(employee.payroll_balance_due)} />
                <Metric label="Debt" value={kes(employee.outstanding_staff_debt)} alert={Number(employee.outstanding_staff_debt) > 0} />
              </div>
            </div>
          ))}
        </div>
      )}

      {profileSheet && (
        <Sheet title={editing ? 'Edit Employee' : 'Add Employee'} onClose={() => setProfileSheet(false)}>
          <div className="space-y-3">
            <Input label="Name *" value={profile.name} onChange={(value) => setProfile({ ...profile, name: value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Phone" value={profile.phone} onChange={(value) => setProfile({ ...profile, phone: value })} type="tel" />
              <Input label="Job title" value={profile.job_title} onChange={(value) => setProfile({ ...profile, job_title: value })} />
              <Select label="Employment" value={profile.employment_type} onChange={(value) => setProfile({ ...profile, employment_type: value })}
                options={[['permanent', 'Permanent'], ['contract', 'Contract'], ['casual', 'Casual'], ['temporary', 'Temporary']]} />
              <Input label="Start date" value={profile.employment_start_date} onChange={(value) => setProfile({ ...profile, employment_start_date: value })} type="date" />
              <Select label="System role" value={profile.role} onChange={(value) => setProfile({ ...profile, role: value })}
                options={[['attendant', 'Attendant'], ['admin', 'Admin']]} />
              <Input label={editing ? 'New PIN' : 'PIN *'} value={profile.pin}
                onChange={(value) => setProfile({ ...profile, pin: value.replace(/\D/g, '').slice(0, 4) })}
                type="password" inputMode="numeric" placeholder={editing ? 'Keep current' : '4 digits'} />
            </div>
            {!editing && (
              <>
                <p className="text-sm font-semibold text-gray-700 border-t pt-4">Starting compensation</p>
                <CompactPlanEditor plan={plan} setPlan={setPlan} updateComponent={updateComponent} />
              </>
            )}
            <button onClick={saveProfile} disabled={saving || !profile.name.trim() || (!editing && profile.pin.length !== 4)}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-50">
              {saving ? 'Saving...' : editing ? 'Update Employee' : 'Create Employee'}
            </button>
          </div>
        </Sheet>
      )}

      {planSheet && selectedEmployee && (
        <Sheet title={`Compensation - ${selectedEmployee.name}`} onClose={() => setPlanSheet(false)}>
          <CompactPlanEditor plan={plan} setPlan={setPlan} updateComponent={updateComponent} />
          <button onClick={savePlan} disabled={saving}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium disabled:opacity-50 mt-4">
            {saving ? 'Saving...' : 'Activate New Plan'}
          </button>
        </Sheet>
      )}
    </div>
  );
}

function CompactPlanEditor({ plan, setPlan, updateComponent }: any) {
  return (
    <div className="space-y-3">
      <Input label="Plan name" value={plan.name} onChange={(value) => setPlan({ ...plan, name: value })} />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Payment schedule" value={plan.pay_schedule} onChange={(value) => setPlan({ ...plan, pay_schedule: value })}
          options={[['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 14 days'], ['monthly', 'Monthly']]} />
        <Input label="Effective from" value={plan.effective_from} onChange={(value) => setPlan({ ...plan, effective_from: value })} type="date" />
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <p className="text-sm font-semibold text-gray-700">Earning components</p>
        <button onClick={() => setPlan({ ...plan, components: [...plan.components, blankComponent()] })}
          className="p-2 text-blue-600" title="Add earning component"><CirclePlus size={19} /></button>
      </div>
      {plan.components.map((component: Component, index: number) => {
        const fixed = component.component_type.startsWith('fixed');
        return (
          <div key={index} className="border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Select label="Method" value={component.component_type}
                  onChange={(value) => updateComponent(index, 'component_type', value)}
                  options={[
                    ['fixed_per_shift', 'Fixed per shift'],
                    ['fixed_periodic', 'Fixed salary'],
                    ['sales_percentage', '% of sales'],
                    ['litre_rate', 'KES per litre'],
                  ]} />
              </div>
              <button disabled={plan.components.length === 1}
                onClick={() => setPlan({ ...plan, components: plan.components.filter((_: any, row: number) => row !== index) })}
                className="p-3 text-gray-400 hover:text-red-600 disabled:opacity-30" title="Remove component"><Trash2 size={17} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input label={fixed ? 'Amount (KES)' : component.component_type === 'sales_percentage' ? 'Rate (%)' : 'KES / litre'}
                value={fixed ? component.amount : component.rate}
                onChange={(value) => updateComponent(index, fixed ? 'amount' : 'rate', value)}
                type="number" />
              <Select label="Fuel scope" disabled={fixed} value={component.fuel_type}
                onChange={(value) => updateComponent(index, 'fuel_type', value)}
                options={[['', 'All fuel'], ['petrol', 'Petrol'], ['diesel', 'Diesel']]} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Sheet({ title, onClose, children }: any) {
  return (
    <div className="mobile-modal-overlay flex items-end" onClick={onClose}>
      <div className="mobile-bottom-sheet rounded-t-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400" title="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

type InputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  [key: string]: any;
};

function Input({ label, value, onChange, type = 'text', ...props }: InputProps) {
  return (
    <label>
      <span className="text-xs font-medium text-gray-600 mb-1 block">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)}
        className="w-full h-11 border border-gray-200 rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" {...props} />
    </label>
  );
}

function Select({ label, value, onChange, options, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[][];
  disabled?: boolean;
}) {
  return (
    <label>
      <span className="text-xs font-medium text-gray-600 mb-1 block">{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}
        className="w-full h-11 border border-gray-200 rounded-xl px-3 text-sm bg-white disabled:bg-gray-100">
        {options.map(([optionValue, text]: string[]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
    </label>
  );
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-gray-400">{label}</p>
      <p className={`text-xs font-semibold mt-1 truncate ${alert ? 'text-red-600' : 'text-gray-700'}`}>{value}</p>
    </div>
  );
}
