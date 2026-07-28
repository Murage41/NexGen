import type { Knex } from 'knex';
import Decimal, { Numeric } from 'decimal.js-light';
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

export interface ShiftEarningCalculation {
  component_id: number | null;
  component_type: CompensationComponentType;
  basis_amount: number | null;
  basis_quantity: number | null;
  rate: number | null;
  gross_amount: number;
  description: string;
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

export async function getCompensationPlanById(
  planId: number,
  trx?: Knex.Transaction | Knex,
): Promise<CompensationPlan | null> {
  const cxn = connection(trx);
  const plan = await cxn('employee_compensation_plans').where({ id: planId }).first();
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

function money(value: Numeric): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function clampComponentAmount(amount: Decimal, component: CompensationComponent): Decimal {
  let result = amount;
  if (component.minimum_amount != null) {
    const minimum = new Decimal(component.minimum_amount);
    if (result.lt(minimum)) result = minimum;
  }
  if (component.maximum_amount != null) {
    const maximum = new Decimal(component.maximum_amount);
    if (result.gt(maximum)) result = maximum;
  }
  return result;
}

export function calculateShiftEarnings(
  plan: CompensationPlan,
  readings: Array<{ amount_sold?: number; litres_sold?: number; fuel_type?: string | null }>,
): ShiftEarningCalculation[] {
  const calculations: ShiftEarningCalculation[] = [];

  for (const component of plan.components) {
    if (component.component_type === 'fixed_periodic') continue;
    const scopedReadings = component.fuel_type
      ? readings.filter((reading) => reading.fuel_type === component.fuel_type)
      : readings;

    if (component.component_type === 'fixed_per_shift') {
      const gross = clampComponentAmount(new Decimal(component.amount || 0), component);
      calculations.push({
        component_id: component.id || null,
        component_type: component.component_type,
        basis_amount: null,
        basis_quantity: null,
        rate: null,
        gross_amount: money(gross),
        description: 'Fixed earning for completed shift',
      });
      continue;
    }

    if (component.component_type === 'sales_percentage') {
      const basis = scopedReadings.reduce(
        (sum, reading) => sum.plus(reading.amount_sold || 0),
        new Decimal(0),
      );
      const rate = new Decimal(component.rate || 0);
      const gross = clampComponentAmount(basis.mul(rate).div(100), component);
      calculations.push({
        component_id: component.id || null,
        component_type: component.component_type,
        basis_amount: money(basis),
        basis_quantity: null,
        rate: rate.toNumber(),
        gross_amount: money(gross),
        description: `${component.fuel_type || 'All fuel'} sales commission`,
      });
      continue;
    }

    const basis = scopedReadings.reduce(
      (sum, reading) => sum.plus(reading.litres_sold || 0),
      new Decimal(0),
    );
    const rate = new Decimal(component.rate || 0);
    const gross = clampComponentAmount(basis.mul(rate), component);
    calculations.push({
      component_id: component.id || null,
      component_type: component.component_type,
      basis_amount: null,
      basis_quantity: basis.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber(),
      rate: rate.toNumber(),
      gross_amount: money(gross),
      description: `${component.fuel_type || 'All fuel'} volume commission`,
    });
  }

  return calculations;
}

export async function generateShiftEarnings(
  shift: {
    id: number;
    employee_id: number;
    compensation_plan_id?: number | null;
    shift_date?: string | null;
    start_time: string;
  },
  readings: Array<{ amount_sold?: number; litres_sold?: number; fuel_type?: string | null }>,
  approvedAt: string,
  trx: Knex.Transaction,
): Promise<any[]> {
  const effectiveDate = shift.shift_date || String(shift.start_time).slice(0, 10);
  const plan = shift.compensation_plan_id
    ? await getCompensationPlanById(Number(shift.compensation_plan_id), trx)
    : await getCompensationPlan(Number(shift.employee_id), effectiveDate, trx);
  if (!plan) throw new Error(`No compensation plan is configured for employee ${shift.employee_id}`);

  const calculations = calculateShiftEarnings(plan, readings);
  for (const calculation of calculations) {
    const sourceKey = `shift:${shift.id}:component:${calculation.component_id || calculation.component_type}`;
    const existing = await trx('employee_earnings').where({ source_key: sourceKey }).first();
    if (existing) continue;
    await trx('employee_earnings').insert({
      employee_id: shift.employee_id,
      shift_id: shift.id,
      plan_id: plan.id,
      component_id: calculation.component_id,
      source_type: 'shift',
      source_key: sourceKey,
      earning_date: effectiveDate,
      basis_amount: calculation.basis_amount,
      basis_quantity: calculation.basis_quantity,
      rate: calculation.rate,
      gross_amount: calculation.gross_amount,
      status: 'approved',
      description: calculation.description,
      approved_at: approvedAt,
    });
  }
  await trx('shifts').where({ id: shift.id }).update({ earnings_generated_at: approvedAt });
  return trx('employee_earnings').where({ shift_id: shift.id }).whereNull('reversed_at').orderBy('id');
}
