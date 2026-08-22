import fs from 'fs';
import path from 'path';
import type { Knex } from 'knex';
import db from '../src/database';
import { computeShiftAccountability } from '../src/routes/shifts';
import { getDataDirectory } from '../src/utils/dataDirectory';

const REPAIR_SOURCE = 'historical-repair-diwafa-shifts-27-28-43';
const REPAIR_REASON = 'Correct verified Diwafa fuel mix and historical retail prices for shifts 27, 28, and 43.';
const FROM_DATE = '2026-06-20';
const TO_DATE = '2026-07-18';
const EXPECTED_ACCOUNT_NAME = 'Diwafa Investments';

type FuelType = 'petrol' | 'diesel';

type ExpectedEntry = {
  fuelType: FuelType;
  litres: number;
  retailPrice: number;
  pumpId: number;
};

type ShiftRepair = {
  shiftId: number;
  shiftDate: string;
  before: Array<{ fuelType: FuelType; litres: number; retailPrice: number }>;
  after: ExpectedEntry[];
};

const REPAIRS: ShiftRepair[] = [
  {
    shiftId: 27,
    shiftDate: '2026-06-20',
    before: [{ fuelType: 'diesel', litres: 300, retailPrice: 230.8 }],
    after: [
      { fuelType: 'diesel', litres: 300, retailPrice: 229, pumpId: 2 },
      { fuelType: 'petrol', litres: 2.5, retailPrice: 216, pumpId: 1 },
    ],
  },
  {
    shiftId: 28,
    shiftDate: '2026-06-29',
    before: [{ fuelType: 'diesel', litres: 198.44, retailPrice: 230.8 }],
    after: [{ fuelType: 'diesel', litres: 200, retailPrice: 229, pumpId: 2 }],
  },
  {
    shiftId: 43,
    shiftDate: '2026-07-17',
    before: [
      { fuelType: 'diesel', litres: 140, retailPrice: 229 },
      { fuelType: 'petrol', litres: 2, retailPrice: 216 },
    ],
    after: [
      { fuelType: 'diesel', litres: 110, retailPrice: 229, pumpId: 3 },
      { fuelType: 'petrol', litres: 32, retailPrice: 216, pumpId: 1 },
    ],
  },
];

function roundMoney(value: unknown): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function closeEnough(left: unknown, right: unknown): boolean {
  return Math.abs(Number(left) - Number(right)) < 0.005;
}

function parseActorId(): number | null {
  const argument = process.argv.find((value) => value.startsWith('--actor-id='));
  if (!argument) return null;
  const actorId = Number(argument.split('=')[1]);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw new Error('--actor-id must be a positive integer.');
  }
  return actorId;
}

function entryMatches(
  row: any,
  expected: { fuelType: FuelType; litres: number; retailPrice: number },
): boolean {
  return String(row.fuel_type) === expected.fuelType
    && closeEnough(row.litres, expected.litres)
    && closeEnough(row.retail_price_at_time, expected.retailPrice)
    && closeEnough(row.retail_amount, expected.litres * expected.retailPrice);
}

function entriesMatch(rows: any[], expected: Array<{ fuelType: FuelType; litres: number; retailPrice: number }>): boolean {
  if (rows.length !== expected.length) return false;
  const remaining = [...rows];
  for (const item of expected) {
    const index = remaining.findIndex((row) => entryMatches(row, item));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

async function getActorId(conn: Knex | Knex.Transaction): Promise<number> {
  const requested = parseActorId();
  if (requested) {
    const actor = await conn('employees').where({ id: requested, role: 'admin', active: true }).first();
    if (!actor) throw new Error(`Employee ${requested} is not an active administrator.`);
    return requested;
  }
  const actor = await conn('employees')
    .where({ role: 'admin', active: true })
    .orderBy('id', 'asc')
    .first();
  if (!actor) throw new Error('No active administrator exists to attribute this repair to.');
  return Number(actor.id);
}

async function getActiveEntries(conn: Knex | Knex.Transaction, accountId: number, shiftId: number) {
  return conn('invoice_consumption')
    .where({ account_id: accountId, shift_id: shiftId })
    .whereNull('deleted_at')
    .where((query) => query.whereNull('entry_status').orWhere('entry_status', 'active'))
    .orderBy('id', 'asc');
}

async function loadAccountabilityContext(conn: Knex | Knex.Transaction, shiftId: number) {
  const shift = await conn('shifts').where({ id: shiftId }).first();
  const readings = await conn('pump_readings')
    .join('pumps', 'pump_readings.pump_id', 'pumps.id')
    .where('pump_readings.shift_id', shiftId)
    .select('pump_readings.*', 'pumps.fuel_type');
  const collections = await conn('shift_collections').where({ shift_id: shiftId }).first();
  const expenses = await conn('shift_expenses').where({ shift_id: shiftId }).whereNull('deleted_at');
  const shiftCredits = await conn('shift_credits').where({ shift_id: shiftId }).whereNull('deleted_at');
  const creditReceipts = await conn('credit_payments')
    .where({ shift_id: shiftId, status: 'posted' })
    .whereNull('deleted_at');
  const payrollPayments = await conn('payroll_payments')
    .where({ shift_id: shiftId, status: 'posted' })
    .where((query) => query.whereNull('reference').orWhere('reference', 'not like', 'SHIFT-WAGE:%'));
  return { shift, readings, collections, expenses, shiftCredits, creditReceipts, payrollPayments };
}

function calculateAccountability(context: any, invoiceConsumption: any[]) {
  return computeShiftAccountability({
    readings: context.readings,
    collections: context.collections,
    shiftCredits: context.shiftCredits,
    creditReceipts: context.creditReceipts,
    invoiceConsumption,
    expenses: context.expenses,
    employee_wage: Number(context.shift.wage_paid || 0),
    payrollPayments: context.payrollPayments,
  });
}

function deficitChange(before: any, after: any): number {
  const beforeDeficit = Math.max(0, roundMoney(-Number(before.variance || 0)));
  const afterDeficit = Math.max(0, roundMoney(-Number(after.variance || 0)));
  return roundMoney(afterDeficit - beforeDeficit);
}

async function recomputeEmployeeDebtAccount(employeeId: number, conn: Knex.Transaction) {
  const row = await conn('staff_debts')
    .where({ employee_id: employeeId })
    .where('balance', '>', 0)
    .sum({ total: 'balance' })
    .first();
  const balance = roundMoney((row as any)?.total || 0);
  const account = await conn('credit_accounts')
    .where({ employee_id: employeeId, type: 'employee' })
    .first();
  if (account) {
    await conn('credit_accounts').where({ id: account.id }).update({ balance });
  } else if (balance > 0) {
    const employee = await conn('employees').where({ id: employeeId }).first();
    await conn('credit_accounts').insert({
      name: employee?.name || `Employee ${employeeId}`,
      type: 'employee',
      employee_id: employeeId,
      balance,
    });
  }
  return balance;
}

async function postDebtEffect(
  conn: Knex.Transaction,
  shift: any,
  change: number,
  accountabilityAdjustmentId: number,
  actorId: number,
) {
  const employeeId = Number(shift.employee_id);
  const adjustments: any[] = [];
  let reviewRequired = 0;

  if (change > 0) {
    const [debtId] = await conn('staff_debts').insert({
      employee_id: employeeId,
      shift_id: shift.id,
      original_deficit: change,
      deducted_from_wage: 0,
      carried_forward: change,
      balance: change,
      status: 'outstanding',
    });
    const [adjustmentId] = await conn('staff_debt_adjustments').insert({
      shift_id: shift.id,
      staff_debt_id: debtId,
      accountability_adjustment_id: accountabilityAdjustmentId,
      adjustment_type: 'increase',
      amount: change,
      balance_before: 0,
      balance_after: change,
      status: 'posted',
      reason: REPAIR_REASON,
      created_by_employee_id: actorId,
    });
    adjustments.push(await conn('staff_debt_adjustments').where({ id: adjustmentId }).first());
  } else if (change < 0) {
    let relief = Math.abs(change);
    const debts = await conn('staff_debts')
      .where({ shift_id: shift.id, employee_id: employeeId })
      .where('balance', '>', 0)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');
    for (const debt of debts) {
      if (relief <= 0) break;
      const balanceBefore = roundMoney(debt.balance);
      const applied = Math.min(relief, balanceBefore);
      const balanceAfter = roundMoney(balanceBefore - applied);
      await conn('staff_debts').where({ id: debt.id }).update({
        balance: balanceAfter,
        status: balanceAfter === 0 ? 'cleared' : 'outstanding',
      });
      const [adjustmentId] = await conn('staff_debt_adjustments').insert({
        shift_id: shift.id,
        staff_debt_id: debt.id,
        accountability_adjustment_id: accountabilityAdjustmentId,
        adjustment_type: 'decrease',
        amount: applied,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        status: 'posted',
        reason: REPAIR_REASON,
        created_by_employee_id: actorId,
      });
      adjustments.push(await conn('staff_debt_adjustments').where({ id: adjustmentId }).first());
      relief = roundMoney(relief - applied);
    }
    if (relief > 0) {
      reviewRequired = relief;
      const [adjustmentId] = await conn('staff_debt_adjustments').insert({
        shift_id: shift.id,
        staff_debt_id: null,
        accountability_adjustment_id: accountabilityAdjustmentId,
        adjustment_type: 'employee_credit_review',
        amount: relief,
        balance_before: null,
        balance_after: null,
        status: 'review_required',
        reason: `${REPAIR_REASON} The original debt is already settled; review employee reimbursement.`,
        created_by_employee_id: actorId,
      });
      adjustments.push(await conn('staff_debt_adjustments').where({ id: adjustmentId }).first());
    }
  }

  return {
    adjustments,
    employeeDebtBalance: await recomputeEmployeeDebtAccount(employeeId, conn),
    reviewRequired,
  };
}

async function periodTotals(conn: Knex | Knex.Transaction, accountId: number) {
  const rows = await conn('invoice_consumption as ic')
    .join('shifts as s', 'ic.shift_id', 's.id')
    .where('ic.account_id', accountId)
    .where('s.shift_date', '>=', FROM_DATE)
    .where('s.shift_date', '<=', TO_DATE)
    .whereNull('ic.deleted_at')
    .where((query) => query.whereNull('ic.entry_status').orWhere('ic.entry_status', 'active'))
    .select('ic.fuel_type')
    .sum({ litres: 'ic.litres', retailAmount: 'ic.retail_amount' })
    .count({ entries: 'ic.id' })
    .groupBy('ic.fuel_type')
    .orderBy('ic.fuel_type');
  return rows.map((row: any) => ({
    fuelType: row.fuel_type,
    litres: roundMoney(row.litres),
    retailAmount: roundMoney(row.retailAmount),
    entries: Number(row.entries),
  }));
}

async function validateState(conn: Knex | Knex.Transaction, accountId: number) {
  const states = [];
  for (const repair of REPAIRS) {
    const shift = await conn('shifts').where({ id: repair.shiftId }).first();
    if (!shift || shift.status !== 'closed' || shift.shift_date !== repair.shiftDate) {
      throw new Error(
        `Shift ${repair.shiftId} must be closed with shift_date ${repair.shiftDate}; found ${JSON.stringify(shift || null)}.`,
      );
    }
    const entries = await getActiveEntries(conn, accountId, repair.shiftId);
    const reserved = entries.filter((entry: any) => entry.invoice_line_id !== null);
    if (reserved.length > 0) {
      throw new Error(
        `Shift ${repair.shiftId} has reserved or invoiced Diwafa consumption. Release/void the invoice draft before running this repair.`,
      );
    }
    states.push({
      repair,
      entries,
      isBefore: entriesMatch(entries, repair.before),
      isAfter: entriesMatch(entries, repair.after),
    });
  }
  const allBefore = states.every((state) => state.isBefore);
  const allAfter = states.every((state) => state.isAfter);
  if (!allBefore && !allAfter) {
    throw new Error(
      `Database does not match the expected before-state or completed-state. Refusing a partial repair.\n${JSON.stringify(
        states.map((state) => ({
          shiftId: state.repair.shiftId,
          isBefore: state.isBefore,
          isAfter: state.isAfter,
          activeEntries: state.entries.map((entry: any) => ({
            id: entry.id,
            fuelType: entry.fuel_type,
            litres: entry.litres,
            retailPrice: entry.retail_price_at_time,
            retailAmount: entry.retail_amount,
          })),
        })),
        null,
        2,
      )}`,
    );
  }
  return { states, allBefore, allAfter };
}

async function buildPreview(conn: Knex | Knex.Transaction, accountId: number) {
  const validation = await validateState(conn, accountId);
  const shifts = [];
  for (const state of validation.states) {
    const context = await loadAccountabilityContext(conn, state.repair.shiftId);
    const beforeAccountability = calculateAccountability(context, state.entries);
    const afterRows = state.repair.after.map((entry) => ({
      account_id: accountId,
      shift_id: state.repair.shiftId,
      fuel_type: entry.fuelType,
      litres: entry.litres,
      retail_price_at_time: entry.retailPrice,
      retail_amount: roundMoney(entry.litres * entry.retailPrice),
      pump_id: entry.pumpId,
    }));
    const afterAccountability = calculateAccountability(context, afterRows);
    const soldByFuel = new Map<FuelType, number>();
    for (const reading of context.readings) {
      const fuel = String(reading.fuel_type) as FuelType;
      soldByFuel.set(fuel, Number(soldByFuel.get(fuel) || 0) + Number(reading.litres_sold || 0));
    }
    for (const entry of afterRows) {
      const desired = afterRows
        .filter((row) => row.fuel_type === entry.fuel_type)
        .reduce((sum, row) => sum + Number(row.litres), 0);
      const sold = Number(soldByFuel.get(entry.fuel_type as FuelType) || 0);
      if (desired - sold > 0.01) {
        throw new Error(
          `Shift ${state.repair.shiftId} corrected ${entry.fuel_type} consumption ${desired.toFixed(2)} L exceeds ${sold.toFixed(2)} L sold.`,
        );
      }
    }
    shifts.push({
      shiftId: state.repair.shiftId,
      employeeId: Number(context.shift.employee_id),
      beforeEntries: state.entries.map((entry: any) => ({
        id: Number(entry.id),
        fuelType: entry.fuel_type,
        litres: Number(entry.litres),
        retailPrice: Number(entry.retail_price_at_time),
        retailAmount: Number(entry.retail_amount),
      })),
      afterEntries: afterRows.map((entry) => ({
        fuelType: entry.fuel_type,
        litres: entry.litres,
        retailPrice: entry.retail_price_at_time,
        retailAmount: entry.retail_amount,
        pumpId: entry.pump_id,
      })),
      amountDelta: roundMoney(afterRows.reduce((sum, row) => sum + row.retail_amount, 0)
        - state.entries.reduce((sum: number, row: any) => sum + Number(row.retail_amount || 0), 0)),
      varianceBefore: roundMoney(beforeAccountability.variance),
      varianceAfter: roundMoney(afterAccountability.variance),
      deficitChange: deficitChange(beforeAccountability, afterAccountability),
    });
  }
  return {
    status: validation.allAfter ? 'already_applied' : 'ready',
    currentPeriodTotals: await periodTotals(conn, accountId),
    shifts,
  };
}

function backupFilename() {
  return `nexgen-before-diwafa-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
}

async function createBackup() {
  const backupDirectory = path.join(getDataDirectory(), 'backups', 'manual-repairs');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, backupFilename());
  await db.raw('PRAGMA wal_checkpoint(FULL)');
  await db.raw('VACUUM INTO ?', [backupPath]);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error(`Backup was not created successfully at ${backupPath}.`);
  }
  return backupPath;
}

async function applyRepair(accountId: number, actorId: number) {
  return db.transaction(async (trx) => {
    const validation = await validateState(trx, accountId);
    if (validation.allAfter) {
      return { status: 'already_applied', shifts: [], periodTotals: await periodTotals(trx, accountId) };
    }

    const results = [];
    const now = new Date().toISOString();
    for (const state of validation.states) {
      const context = await loadAccountabilityContext(trx, state.repair.shiftId);
      const beforeAccountability = calculateAccountability(context, state.entries);
      const originalByFuel = new Map(
        state.entries.map((entry: any) => [String(entry.fuel_type), entry]),
      );
      const replacements = [];
      for (const desired of state.repair.after) {
        const pump = await trx('pumps').where({ id: desired.pumpId }).first();
        if (!pump || pump.fuel_type !== desired.fuelType || !pump.tank_id) {
          throw new Error(
            `Pump ${desired.pumpId} is not a tank-linked ${desired.fuelType} source for shift ${state.repair.shiftId}.`,
          );
        }
        const original = originalByFuel.get(desired.fuelType);
        const [replacementId] = await trx('invoice_consumption').insert({
          account_id: accountId,
          shift_id: state.repair.shiftId,
          pump_id: desired.pumpId,
          tank_id: Number(pump.tank_id),
          fuel_type: desired.fuelType,
          litres: desired.litres,
          retail_price_at_time: desired.retailPrice,
          retail_amount: roundMoney(desired.litres * desired.retailPrice),
          invoice_line_id: null,
          correction_of_id: original ? Number(original.id) : null,
          entry_status: 'active',
          correction_reason: REPAIR_REASON,
          created_by_employee_id: actorId,
          created_at: now,
          updated_at: now,
        });
        replacements.push(await trx('invoice_consumption').where({ id: replacementId }).first());
      }

      for (const original of state.entries) {
        await trx('invoice_consumption').where({ id: original.id }).update({
          entry_status: 'reversed',
          reversed_at: now,
          reversed_by_employee_id: actorId,
          correction_reason: REPAIR_REASON,
          updated_at: now,
          deleted_at: now,
        });
      }

      const activeAfter = await getActiveEntries(trx, accountId, state.repair.shiftId);
      if (!entriesMatch(activeAfter, state.repair.after)) {
        throw new Error(`Shift ${state.repair.shiftId} failed post-insert consumption verification.`);
      }
      const afterAccountability = calculateAccountability(context, activeAfter);
      const change = deficitChange(beforeAccountability, afterAccountability);
      const amountDelta = roundMoney(
        activeAfter.reduce((sum: number, row: any) => sum + Number(row.retail_amount || 0), 0)
        - state.entries.reduce((sum: number, row: any) => sum + Number(row.retail_amount || 0), 0),
      );
      const [accountabilityAdjustmentId] = await trx('shift_accountability_adjustments').insert({
        shift_id: state.repair.shiftId,
        adjustment_type: 'historical_invoice_consumption_repair',
        reference_id: Number(replacements[0].id),
        amount_delta: amountDelta,
        variance_before: roundMoney(beforeAccountability.variance),
        variance_after: roundMoney(afterAccountability.variance),
        reason: REPAIR_REASON,
        created_by_employee_id: actorId,
      });
      const debtEffect = await postDebtEffect(
        trx,
        context.shift,
        change,
        Number(accountabilityAdjustmentId),
        actorId,
      );
      results.push({
        shiftId: state.repair.shiftId,
        reversedEntryIds: state.entries.map((entry: any) => Number(entry.id)),
        replacementEntryIds: replacements.map((entry: any) => Number(entry.id)),
        amountDelta,
        varianceBefore: roundMoney(beforeAccountability.variance),
        varianceAfter: roundMoney(afterAccountability.variance),
        deficitChange: change,
        accountabilityAdjustmentId: Number(accountabilityAdjustmentId),
        debtEffect,
      });
    }

    for (const correction of [
      { fuel_type: 'diesel', price_per_litre: 229 },
      { fuel_type: 'petrol', price_per_litre: 216 },
    ]) {
      const existing = await trx('fuel_prices')
        .where({
          fuel_type: correction.fuel_type,
          price_per_litre: correction.price_per_litre,
          effective_date: '2026-06-16',
          source: REPAIR_SOURCE,
        })
        .first();
      if (!existing) {
        await trx('fuel_prices').insert({
          ...correction,
          effective_date: '2026-06-16',
          source: REPAIR_SOURCE,
        });
      }
    }

    const totals = await periodTotals(trx, accountId);
    const diesel = totals.find((row) => row.fuelType === 'diesel');
    const petrol = totals.find((row) => row.fuelType === 'petrol');
    if (!diesel || !petrol || !closeEnough(diesel.litres, 7199.13) || !closeEnough(petrol.litres, 172)) {
      throw new Error(`Post-repair period totals failed verification: ${JSON.stringify(totals)}.`);
    }
    return { status: 'applied', shifts: results, periodTotals: totals };
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const account = await db('credit_accounts')
    .where({ name: EXPECTED_ACCOUNT_NAME, type: 'customer', billing_mode: 'invoice' })
    .whereNull('deleted_at')
    .first();
  if (!account) throw new Error(`Active invoice account "${EXPECTED_ACCOUNT_NAME}" was not found.`);
  const actorId = await getActorId(db);
  const preview = await buildPreview(db, Number(account.id));

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    database: path.join(getDataDirectory(), 'nexgen.db'),
    account: { id: Number(account.id), name: account.name },
    actorId,
    ...preview,
  }, null, 2));

  if (!apply) {
    console.log('\nDRY RUN ONLY: no data was changed. Re-run with --apply after reviewing this output and stopping the station stack.');
    return;
  }
  if (preview.status === 'already_applied') {
    console.log('\nNO-OP: the corrected active entries are already present.');
    return;
  }

  const backupPath = await createBackup();
  console.log(`\nBackup created: ${backupPath}`);
  const result = await applyRepair(Number(account.id), actorId);
  console.log('\nREPAIR RESULT');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nPASS: Diwafa shifts 27, 28, and 43 were repaired and downstream accountability effects were posted.');
}

main()
  .catch((error) => {
    console.error('\nREPAIR ABORTED');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
