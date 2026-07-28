import type { Knex } from 'knex';
import db from '../database';

export const PAY_SCHEDULES = ['daily', 'weekly', 'biweekly', 'monthly'] as const;
export const COMPENSATION_COMPONENT_TYPES = [
  'fixed_per_shift',
  'fixed_periodic',
  'sales_percentage',
  'litre_rate',
] as const;

export type PaySchedule = typeof PAY_SCHEDULES[number];
export type CompensationComponentType = typeof COMPENSATION_COMPONENT_TYPES[number];

export interface CompensationComponent {
  id?: number;
  component_type: CompensationComponentType;
  amount?: number | null;
  rate?: number | null;
  fuel_type?: 'petrol' | 'diesel' | null;
  minimum_amount?: number | null;
  maximum_amount?: number | null;
}

export interface CompensationPlan {
  id: number;
  employee_id: number;
  name: string;
  pay_schedule: PaySchedule;
  effective_from: string;
  effective_to?: string | null;
  status: string;
  version: number;
  currency: string;
  notes?: string | null;
  components: CompensationComponent[];
}

function connection(trx?: Knex.Transaction | Knex): Knex.Transaction | Knex {
  return trx || db;
}

export function previousCalendarDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export async function getCompensationPlan(
  employeeId: number,
  effectiveDate: string,
  trx?: Knex.Transaction | Knex,
): Promise<CompensationPlan | null> {
  const cxn = connection(trx);
  const plan = await cxn('employee_compensation_plans')
    .where({ employee_id: employeeId })
    .where('effective_from', '<=', effectiveDate)
    .where((query) => {
      query.whereNull('effective_to').orWhere('effective_to', '>=', effectiveDate);
    })
    .orderBy('effective_from', 'desc')
    .orderBy('version', 'desc')
    .first();

  if (!plan) return null;
  const components = await cxn('employee_compensation_components')
    .where({ plan_id: plan.id })
    .orderBy('id');

  return {
    ...plan,
    employee_id: Number(plan.employee_id),
    version: Number(plan.version),
    components: components.map((component: any) => ({
      ...component,
      amount: component.amount == null ? null : Number(component.amount),
      rate: component.rate == null ? null : Number(component.rate),
      minimum_amount: component.minimum_amount == null ? null : Number(component.minimum_amount),
      maximum_amount: component.maximum_amount == null ? null : Number(component.maximum_amount),
    })),
  };
}

export async function listCompensationPlans(
  employeeId: number,
  trx?: Knex.Transaction | Knex,
): Promise<CompensationPlan[]> {
  const cxn = connection(trx);
  const plans = await cxn('employee_compensation_plans')
    .where({ employee_id: employeeId })
    .orderBy('effective_from', 'desc')
    .orderBy('version', 'desc');
  if (plans.length === 0) return [];

  const components = await cxn('employee_compensation_components')
    .whereIn('plan_id', plans.map((plan: any) => plan.id))
    .orderBy('id');
  const componentsByPlan = new Map<number, CompensationComponent[]>();
  for (const component of components) {
    const planId = Number(component.plan_id);
    const rows = componentsByPlan.get(planId) || [];
    rows.push({
      ...component,
      amount: component.amount == null ? null : Number(component.amount),
      rate: component.rate == null ? null : Number(component.rate),
      minimum_amount: component.minimum_amount == null ? null : Number(component.minimum_amount),
      maximum_amount: component.maximum_amount == null ? null : Number(component.maximum_amount),
    });
    componentsByPlan.set(planId, rows);
  }

  return plans.map((plan: any) => ({
    ...plan,
    employee_id: Number(plan.employee_id),
    version: Number(plan.version),
    components: componentsByPlan.get(Number(plan.id)) || [],
  }));
}

export function describeCompensationPlan(plan: CompensationPlan | null): string {
  if (!plan) return 'No compensation plan';
  const parts = plan.components.map((component) => {
    if (component.component_type === 'fixed_per_shift') {
      return `KES ${Number(component.amount || 0).toLocaleString('en-KE')}/shift`;
    }
    if (component.component_type === 'fixed_periodic') {
      return `KES ${Number(component.amount || 0).toLocaleString('en-KE')}/${plan.pay_schedule}`;
    }
    if (component.component_type === 'sales_percentage') {
      const scope = component.fuel_type ? ` ${component.fuel_type}` : '';
      return `${Number(component.rate || 0)}%${scope} sales`;
    }
    const scope = component.fuel_type ? ` ${component.fuel_type}` : '';
    return `KES ${Number(component.rate || 0).toLocaleString('en-KE')}/${scope} L`;
  });
  return parts.join(' + ');
}
