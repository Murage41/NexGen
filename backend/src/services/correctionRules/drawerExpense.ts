import type { Knex } from 'knex';
import type { ApplyContext, CorrectionRequest, CorrectionRule, Plan, PlanLine, RulePlan } from '../corrections';
import { roundMoney } from '../receivablePayments';
import {
  cents, closedShift, earliest, httpError, kes, laterCorrection, positiveAmount, type Conn, type ShiftRef,
} from './common';

// Corrections of a drawer expense (paid from a closed shift's drawer). An
// expense counts towards what the drawer accounted for, so a missing one found
// later makes the shift better (the attendant owes less), and one that never
// happened makes it worse. A wrong category moves the expense between
// categories without changing the shift.

const ERROR_KINDS = ['wrong_amount', 'wrong_category', 'duplicate', 'missing'];
// Wages are paid through payroll, never as a drawer expense (routes/expenses.ts).
const PAYROLL = ['wage', 'wages', 'salary', 'salaries', 'payroll'];

async function liveExpense(conn: Conn, expenseId: number) {
  const expense = await conn('shift_expenses').where({ id: expenseId }).first();
  if (!expense) throw httpError('Expense not found.', 404, 'EXPENSE_NOT_FOUND');
  if (expense.deleted_at) throw httpError('This expense was already removed or corrected.', 409, 'EXPENSE_NOT_ACTIVE');
  return expense;
}

function category(value: unknown) {
  const name = String(value || '').trim();
  if (!name) throw httpError('Choose the category.', 400, 'CATEGORY_REQUIRED');
  if (PAYROLL.includes(name.toLowerCase())) throw httpError('Wages are paid through Payroll, not as a drawer expense.', 400, 'PAYROLL_CATEGORY');
  return name;
}

async function plan(conn: Conn, req: CorrectionRequest): Promise<RulePlan> {
  const lines: PlanLine[] = [];
  const effects: string[] = [];
  let target: any = null;
  let from: ShiftRef | null = null;
  if (req.error_kind !== 'missing') {
    if (!req.target_id) throw httpError('Choose the expense to correct.', 400, 'TARGET_REQUIRED');
    target = await liveExpense(conn, req.target_id);
    from = await closedShift(conn, target.shift_id, 'change or delete the expense');
  }

  let add: null | { shift: ShiftRef; amount: number; category: string; description: string | null } = null;
  switch (req.error_kind) {
    case 'wrong_amount': {
      const amount = positiveAmount(req.amount, 'Enter the amount paid.');
      if (cents(amount) === cents(target.amount)) throw httpError('Nothing would change: enter the amount paid.', 400, 'NO_CHANGE');
      add = { shift: from!, amount, category: target.category, description: target.description || null };
      break;
    }
    case 'wrong_category': {
      const right = category(req.category);
      if (right === target.category) throw httpError('Choose the right category.', 400, 'NO_CHANGE');
      add = { shift: from!, amount: roundMoney(Number(target.amount)), category: right, description: target.description || null };
      break;
    }
    case 'missing':
      add = {
        shift: await closedShift(conn, req.shift_id, 'record the expense'),
        amount: positiveAmount(req.amount, 'Enter the amount paid.'),
        category: category(req.category),
        description: req.description || null,
      };
      break;
    default:
      break;
  }

  if (target) {
    lines.push({
      seq: 1, action: 'reverse', record_type: 'drawer_expense', target_id: Number(target.id), shift_id: from!.id, shift_open: false,
      party_type: null, party_id: null, party_name: null, fuel_type: null, litres: null, unit_price: null,
      amount: roundMoney(Number(target.amount)), stage: null, invoice_id: null, invoice_number: null,
      shift_effect: -roundMoney(Number(target.amount)), category: target.category,
    });
    effects.push(`Reversed: drawer expense of ${kes(target.amount)} (${target.category}${target.description ? `: ${target.description}` : ''}) in shift #${from!.id}.`);
  }
  if (add) {
    lines.push({
      seq: 2, action: 'add', record_type: 'drawer_expense', target_id: target ? Number(target.id) : null, shift_id: add.shift.id,
      shift_open: false, party_type: null, party_id: null, party_name: null, fuel_type: null, litres: null, unit_price: null,
      amount: add.amount, stage: null, invoice_id: null, invoice_number: null, shift_effect: add.amount, category: add.category,
    });
    effects.push(`Added: drawer expense of ${kes(add.amount)} (${add.category}${add.description ? `: ${add.description}` : ''}) in shift #${add.shift.id}.`);
  }
  if (req.error_kind === 'wrong_category') {
    effects.push(`The expense moves from ${target.category} to ${add!.category} in the expense reports; the shift's result does not change.`);
  }
  return {
    effective_date: earliest(...[from?.date, add?.shift.date].filter(Boolean) as string[]),
    lines,
    documents: [],
    drafts: [],
    effects,
  };
}

async function apply(trx: Knex.Transaction, planned: Plan, ctx: ApplyContext) {
  const out: Record<number, { created_record_id?: number }> = {};
  const now = new Date().toISOString();
  const reverse = planned.lines.find((l) => l.action === 'reverse');
  const add = planned.lines.find((l) => l.action === 'add');
  const target = reverse ? await trx('shift_expenses').where({ id: reverse.target_id }).first() : null;
  if (reverse) {
    await trx('shift_expenses').where({ id: reverse.target_id }).update({ deleted_at: now, reversed_by_record_correction_id: ctx.correctionId });
  }
  if (add) {
    const [expenseId] = await trx('shift_expenses').insert({
      shift_id: add.shift_id,
      category: add.category,
      description: planned.request.error_kind === 'missing' ? planned.request.description || '' : target?.description || '',
      amount: add.amount,
      created_by_record_correction_id: ctx.correctionId,
    });
    out[add.seq] = { created_record_id: Number(expenseId) };
  }
  return out;
}

async function undoBlocker(conn: Conn, correction: any, lines: any[]): Promise<string | null> {
  for (const line of lines.filter((l) => l.action === 'add')) {
    const created = await conn('shift_expenses').where({ id: line.created_record_id }).first();
    if (!created) return 'Its expense is missing.';
    if (created.deleted_at) return `Its expense was corrected again${await laterCorrection(conn, created.reversed_by_record_correction_id)}. Undo that first.`;
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    const original = await conn('shift_expenses').where({ id: line.target_id }).first();
    if (!original || Number(original.reversed_by_record_correction_id) !== Number(correction.id)) return 'The expense it reversed has changed since.';
  }
  return null;
}

async function undo(trx: Knex.Transaction, _correction: any, lines: any[], ctx: ApplyContext) {
  const now = new Date().toISOString();
  for (const line of lines.filter((l) => l.action === 'add')) {
    await trx('shift_expenses').where({ id: line.created_record_id }).update({ deleted_at: now, reversed_by_record_correction_id: ctx.correctionId });
  }
  for (const line of lines.filter((l) => l.action === 'reverse')) {
    await trx('shift_expenses').where({ id: line.target_id }).update({ deleted_at: null, reversed_by_record_correction_id: null });
  }
  return [];
}

export const drawerExpenseRule: CorrectionRule = {
  recordType: 'drawer_expense',
  errorKinds: ERROR_KINDS,
  unchanged: 'Fuel sales and tank stock: no change.',
  plan,
  apply,
  undoBlocker,
  undo,
};
