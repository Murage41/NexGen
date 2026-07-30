import { getKenyaDate } from '../utils/timezone';

export type PaySchedule = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface PayrollPeriodInput {
  pay_schedule: PaySchedule;
  period_start: string;
  period_end: string;
}

export class PayrollPeriodError extends Error {
  code: string;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus = 409) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function inclusiveDays(start: string, end: string): number {
  return Math.floor((parseDate(end).getTime() - parseDate(start).getTime()) / 86400000) + 1;
}

function monthBounds(value: string): { start: string; end: string } {
  const [year, month] = value.slice(0, 7).split('-').map(Number);
  return {
    start: `${value.slice(0, 7)}-01`,
    end: formatDate(new Date(Date.UTC(year, month, 0))),
  };
}

export function suggestedPayrollPeriod(
  paySchedule: PaySchedule,
  anchorDate = getKenyaDate(),
): { start: string; end: string } {
  if (paySchedule === 'daily') {
    return { start: anchorDate, end: anchorDate };
  }
  if (paySchedule === 'weekly') {
    return { start: addDays(anchorDate, -6), end: anchorDate };
  }
  if (paySchedule === 'biweekly') {
    return { start: addDays(anchorDate, -13), end: anchorDate };
  }

  const current = monthBounds(anchorDate);
  if (anchorDate === current.end) return current;
  const previousDate = addDays(current.start, -1);
  return monthBounds(previousDate);
}

export function validatePayrollPeriod(
  input: PayrollPeriodInput,
  asOfDate = getKenyaDate(),
): void {
  const { pay_schedule: schedule, period_start: start, period_end: end } = input;
  if (start > end) {
    throw new PayrollPeriodError(
      'PAYROLL_PERIOD_ORDER',
      'Payroll period end must be on or after its start date.',
      400,
    );
  }
  if (end > asOfDate) {
    throw new PayrollPeriodError(
      'PAYROLL_PERIOD_INCOMPLETE',
      `Payroll cannot be calculated through ${end} before that work date is complete.`,
    );
  }

  const days = inclusiveDays(start, end);
  if (schedule === 'daily' && days !== 1) {
    throw new PayrollPeriodError(
      'PAYROLL_DAILY_PERIOD',
      'A daily payroll period must contain exactly one work date.',
      400,
    );
  }
  if (schedule === 'weekly' && days !== 7) {
    throw new PayrollPeriodError(
      'PAYROLL_WEEKLY_PERIOD',
      'A weekly payroll period must contain exactly 7 calendar days.',
      400,
    );
  }
  if (schedule === 'biweekly' && days !== 14) {
    throw new PayrollPeriodError(
      'PAYROLL_BIWEEKLY_PERIOD',
      'A 14-day payroll period must contain exactly 14 calendar days.',
      400,
    );
  }
  if (schedule === 'monthly') {
    const expected = monthBounds(start);
    if (start !== expected.start || end !== expected.end) {
      throw new PayrollPeriodError(
        'PAYROLL_MONTHLY_PERIOD',
        'A monthly payroll period must cover one complete calendar month.',
        400,
      );
    }
  }
}
