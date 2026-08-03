import assert from 'node:assert/strict';
import { computeShiftAccountability } from '../src/routes/shifts';
import { closeShiftSchema, createEmployeeSchema, updateEmployeeSchema } from '../src/schemas';

const baseInput = {
  readings: [{ amount_sold: 1000 }],
  collections: { cash_amount: 900, mpesa_amount: 0 },
  shiftCredits: [],
  invoiceConsumption: [],
  creditReceipts: [],
  expenses: [],
};

const paidFromShift = computeShiftAccountability({
  ...baseInput,
  employee_wage: 100,
});
assert.equal(paidFromShift.variance, 0);

const notPaidFromShift = computeShiftAccountability({
  ...baseInput,
  employee_wage: 0,
});
assert.equal(notPaidFromShift.variance, -100);

const payrollPaidFromDrawer = computeShiftAccountability({
  ...baseInput,
  collections: { cash_amount: 850, mpesa_amount: 0 },
  employee_wage: 100,
  payrollPayments: [{ amount: 50 }],
});
assert.equal(payrollPaidFromDrawer.variance, 0);
assert.equal(payrollPaidFromDrawer.total_payroll_payments, 50);

assert.equal(createEmployeeSchema.safeParse({
  name: 'Attendant',
  daily_wage: -1,
  pin: '1234',
  role: 'attendant',
}).success, false);

const updateWithoutPin = updateEmployeeSchema.parse({
  name: 'Updated Attendant',
  daily_wage: 750,
});
assert.equal('pin' in updateWithoutPin, false);

assert.equal(updateEmployeeSchema.safeParse({ pin: '000' }).success, false);

assert.equal(closeShiftSchema.safeParse({ wage_paid: 0 }).success, false);
assert.equal(closeShiftSchema.safeParse({
  wage_paid: 0,
  reconciliation: {
    readings_reviewed: true,
    collections_reviewed: true,
    entries_reviewed: true,
  },
}).success, true);
assert.equal(closeShiftSchema.safeParse({
  wage_paid: 0,
  reconciliation: {
    readings_reviewed: true,
    collections_reviewed: false,
    entries_reviewed: true,
  },
}).success, false);

console.log('Employee and shift wage safety checks passed');
