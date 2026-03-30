import { Router } from 'express';
import db from '../database';

const router = Router();

// GET all shifts (with pagination)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;

    let query = db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name');

    if (status) query = query.where('shifts.status', status);

    const shifts = await query.orderBy('shifts.start_time', 'desc').limit(limit).offset(offset);
    const [{ count }] = await db('shifts').count('* as count');
    res.json({ success: true, data: { shifts, total: count, page, limit } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET current open shift
router.get('/current', async (_req, res) => {
  try {
    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name')
      .where('shifts.status', 'open')
      .orderBy('shifts.start_time', 'desc')
      .first();
    res.json({ success: true, data: shift || null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET shift with full details
router.get('/:id', async (req, res) => {
  try {
    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name', 'employees.daily_wage as employee_wage')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    // Sync pump readings with active pumps for open shifts
    if (shift.status === 'open') {
      const activePumps = await db('pumps').where({ active: true });
      const activePumpIds = activePumps.map((p: any) => p.id);
      const existingReadings = await db('pump_readings').where({ shift_id: shift.id }).select('pump_id');
      const existingPumpIds = existingReadings.map((r: any) => r.pump_id);

      // Remove readings for deactivated pumps
      for (const pumpId of existingPumpIds) {
        if (!activePumpIds.includes(pumpId)) {
          await db('pump_readings').where({ shift_id: shift.id, pump_id: pumpId }).delete();
        }
      }

      // Add readings for newly added pumps
      for (const pump of activePumps) {
        if (!existingPumpIds.includes(pump.id)) {
          const lastReading = await db('pump_readings')
            .join('shifts', 'pump_readings.shift_id', 'shifts.id')
            .where('pump_readings.pump_id', pump.id)
            .where('shifts.status', 'closed')
            .orderBy('shifts.end_time', 'desc')
            .select('pump_readings.closing_litres', 'pump_readings.closing_amount')
            .first();
          const openLitres = lastReading ? lastReading.closing_litres : (pump.initial_litres || 0);
          const openAmount = lastReading ? lastReading.closing_amount : (pump.initial_amount || 0);
          await db('pump_readings').insert({
            shift_id: shift.id, pump_id: pump.id,
            opening_litres: openLitres, opening_amount: openAmount,
            closing_litres: openLitres, closing_amount: openAmount,
            litres_sold: 0, amount_sold: 0,
          });
        }
      }
    }

    const readings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.nozzle_label', 'pumps.fuel_type')
      .where('pump_readings.shift_id', shift.id)
      .where('pumps.active', true);

    const collections = await db('shift_collections').where({ shift_id: shift.id }).first();
    const expenses = await db('shift_expenses').where({ shift_id: shift.id });
    const shiftCredits = await db('shift_credits').where({ shift_id: shift.id });
    const wageDeduction = await db('wage_deductions').where({ shift_id: shift.id }).first();

    // Get employee's outstanding debt
    const outstandingDebts = await db('staff_debts')
      .where({ employee_id: shift.employee_id, status: 'outstanding' })
      .orderBy('created_at', 'asc');
    const total_outstanding_debt = outstandingDebts.reduce((sum: number, d: any) => sum + d.balance, 0);

    const expected_sales = readings.reduce((sum: number, r: any) => sum + r.amount_sold, 0);
    const total_cash = collections ? collections.cash_amount : 0;
    const total_mpesa = collections ? collections.mpesa_amount : 0;
    const total_credits = shiftCredits.reduce((sum: number, c: any) => sum + c.amount, 0);
    const total_expenses = expenses.reduce((sum: number, e: any) => sum + e.amount, 0);
    const employee_wage = shift.employee_wage || 0;
    // Accounted = everything the attendant used the sales money for (including wages taken from drawer)
    const total_accounted = total_cash + total_mpesa + total_credits + total_expenses + employee_wage;
    const variance = total_accounted - expected_sales;

    res.json({
      success: true,
      data: {
        ...shift,
        readings,
        collections: collections || null,
        expenses,
        shift_credits: shiftCredits,
        wage_deduction: wageDeduction || null,
        outstanding_debts: outstandingDebts,
        total_outstanding_debt,
        expected_sales,
        total_cash,
        total_mpesa,
        total_credits,
        total_expenses,
        employee_wage,
        total_accounted,
        variance,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST open a new shift
router.post('/', async (req, res) => {
  try {
    const { employee_id } = req.body;

    // Check for existing open shift
    const openShift = await db('shifts').where({ status: 'open' }).first();
    if (openShift) {
      return res.status(400).json({ success: false, error: 'There is already an open shift. Close it first.' });
    }

    const [id] = await db('shifts').insert({ employee_id, start_time: new Date().toISOString(), status: 'open' });

    // Auto-populate opening readings from last closed shift (or pump's initial readings)
    const pumps = await db('pumps').where({ active: true });
    for (const pump of pumps) {
      const lastReading = await db('pump_readings')
        .join('shifts', 'pump_readings.shift_id', 'shifts.id')
        .where('pump_readings.pump_id', pump.id)
        .where('shifts.status', 'closed')
        .orderBy('shifts.end_time', 'desc')
        .select('pump_readings.closing_litres', 'pump_readings.closing_amount')
        .first();

      const openLitres = lastReading ? lastReading.closing_litres : (pump.initial_litres || 0);
      const openAmount = lastReading ? lastReading.closing_amount : (pump.initial_amount || 0);

      await db('pump_readings').insert({
        shift_id: id,
        pump_id: pump.id,
        opening_litres: openLitres,
        opening_amount: openAmount,
        closing_litres: openLitres,
        closing_amount: openAmount,
        litres_sold: 0,
        amount_sold: 0,
      });
    }

    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.name as employee_name')
      .where('shifts.id', id)
      .first();

    res.status(201).json({ success: true, data: shift });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT set opening readings (admin only, for initial setup)
router.put('/:id/opening-readings', async (req, res) => {
  try {
    const { readings } = req.body; // Array of { pump_id, opening_litres, opening_amount }
    for (const r of readings) {
      const existing = await db('pump_readings')
        .where({ shift_id: req.params.id, pump_id: r.pump_id })
        .first();
      if (existing) {
        const litres_sold = existing.closing_litres - r.opening_litres;
        const amount_sold = existing.closing_amount - r.opening_amount;
        await db('pump_readings')
          .where({ shift_id: req.params.id, pump_id: r.pump_id })
          .update({
            opening_litres: r.opening_litres,
            opening_amount: r.opening_amount,
            litres_sold: Math.max(0, litres_sold),
            amount_sold: Math.max(0, amount_sold),
          });
      }
    }
    const updatedReadings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.nozzle_label', 'pumps.fuel_type')
      .where('pump_readings.shift_id', req.params.id);
    res.json({ success: true, data: updatedReadings });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update pump readings for a shift
router.put('/:id/readings', async (req, res) => {
  try {
    const { readings } = req.body; // Array of { pump_id, closing_litres, closing_amount }

    for (const r of readings) {
      const existing = await db('pump_readings')
        .where({ shift_id: req.params.id, pump_id: r.pump_id })
        .first();

      if (existing) {
        const litres_sold = r.closing_litres - existing.opening_litres;
        const amount_sold = r.closing_amount - existing.opening_amount;
        await db('pump_readings')
          .where({ shift_id: req.params.id, pump_id: r.pump_id })
          .update({
            closing_litres: r.closing_litres,
            closing_amount: r.closing_amount,
            litres_sold,
            amount_sold,
          });
      }
    }

    const updatedReadings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .select('pump_readings.*', 'pumps.label as pump_label', 'pumps.nozzle_label', 'pumps.fuel_type')
      .where('pump_readings.shift_id', req.params.id);

    res.json({ success: true, data: updatedReadings });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update collections for a shift
router.put('/:id/collections', async (req, res) => {
  try {
    const { cash_amount, mpesa_amount, credits_amount } = req.body;
    const total_collected = (cash_amount || 0) + (mpesa_amount || 0) + (credits_amount || 0);

    const existing = await db('shift_collections').where({ shift_id: req.params.id }).first();
    if (existing) {
      await db('shift_collections').where({ shift_id: req.params.id }).update({
        cash_amount, mpesa_amount, credits_amount, total_collected,
      });
    } else {
      await db('shift_collections').insert({
        shift_id: req.params.id, cash_amount, mpesa_amount, credits_amount, total_collected,
      });
    }

    const collections = await db('shift_collections').where({ shift_id: req.params.id }).first();
    res.json({ success: true, data: collections });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add shift expense
router.post('/:id/expenses', async (req, res) => {
  try {
    const { category, description, amount } = req.body;
    const [expId] = await db('shift_expenses').insert({
      shift_id: req.params.id, category, description, amount,
    });
    const expense = await db('shift_expenses').where({ id: expId }).first();
    res.status(201).json({ success: true, data: expense });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE shift expense
router.delete('/:id/expenses/:expenseId', async (req, res) => {
  try {
    await db('shift_expenses').where({ id: req.params.expenseId, shift_id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add shift credit — also creates entry in main credits ledger
router.post('/:id/credits', async (req, res) => {
  try {
    const { customer_name, customer_phone, amount, description } = req.body;
    const shiftId = req.params.id;

    // Look up or auto-create credit_account for this customer
    let account = await db('credit_accounts')
      .whereRaw('LOWER(name) = ?', [customer_name.toLowerCase()])
      .first();

    if (!account) {
      const [accountId] = await db('credit_accounts').insert({
        name: customer_name,
        phone: customer_phone || null,
        type: 'customer',
      });
      account = { id: accountId };
    }

    // 1. Create record in main credits ledger (for long-term tracking & payments)
    const [mainCreditId] = await db('credits').insert({
      customer_name,
      customer_phone: customer_phone || null,
      amount,
      balance: amount,
      shift_id: shiftId,
      description: description || null,
      status: 'outstanding',
      account_id: account.id,
    });

    // 2. Create shift credit entry (for shift accountability)
    const [shiftCreditId] = await db('shift_credits').insert({
      shift_id: shiftId,
      customer_name,
      customer_phone: customer_phone || null,
      amount,
      description: description || null,
      credit_id: mainCreditId,
    });

    // 3. Update credits_amount in shift_collections (auto-sum)
    const totalCredits = await db('shift_credits').where({ shift_id: shiftId }).sum('amount as total').first();
    const existing = await db('shift_collections').where({ shift_id: shiftId }).first();
    if (existing) {
      await db('shift_collections').where({ shift_id: shiftId }).update({
        credits_amount: (totalCredits as any)?.total || 0,
        total_collected: existing.cash_amount + existing.mpesa_amount + ((totalCredits as any)?.total || 0),
      });
    } else {
      await db('shift_collections').insert({
        shift_id: shiftId, cash_amount: 0, mpesa_amount: 0,
        credits_amount: (totalCredits as any)?.total || 0,
        total_collected: (totalCredits as any)?.total || 0,
      });
    }

    const credit = await db('shift_credits').where({ id: shiftCreditId }).first();
    res.status(201).json({ success: true, data: credit });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE shift credit — also removes from main credits ledger (if no payments made)
router.delete('/:id/credits/:creditId', async (req, res) => {
  try {
    const shiftId = req.params.id;
    const shiftCredit = await db('shift_credits')
      .where({ id: req.params.creditId, shift_id: shiftId })
      .first();

    let deletedAccountId: number | null = null;

    if (shiftCredit) {
      // Capture the account_id from the credit before deletion
      if (shiftCredit.credit_id) {
        const mainCredit = await db('credits').where({ id: shiftCredit.credit_id }).first();
        if (mainCredit) deletedAccountId = mainCredit.account_id || null;

        const payments = await db('credit_payments').where({ credit_id: shiftCredit.credit_id });
        if (payments.length === 0) {
          await db('credits').where({ id: shiftCredit.credit_id }).delete();
        }
      }
      await db('shift_credits').where({ id: req.params.creditId }).delete();
    }

    // Clean up orphan customer account if no remaining balance
    if (deletedAccountId) {
      const account = await db('credit_accounts').where({ id: deletedAccountId }).first();
      if (account && account.type === 'customer') {
        const remainingBalance = await db('credits')
          .where({ account_id: deletedAccountId })
          .where('balance', '>', 0)
          .first();
        if (!remainingBalance) {
          // Delete zero-balance credits and their payments, then the account
          const zeroCredits = await db('credits').where({ account_id: deletedAccountId }).select('id');
          const zeroCreditIds = zeroCredits.map((c: any) => c.id);
          if (zeroCreditIds.length > 0) {
            await db('credit_payments').whereIn('credit_id', zeroCreditIds).delete();
            await db('credits').where({ account_id: deletedAccountId }).delete();
          }
          await db('credit_accounts').where({ id: deletedAccountId }).delete();
        }
      }
    }

    // Update credits_amount total
    const totalCredits = await db('shift_credits').where({ shift_id: shiftId }).sum('amount as total').first();
    const existing = await db('shift_collections').where({ shift_id: shiftId }).first();
    if (existing) {
      await db('shift_collections').where({ shift_id: shiftId }).update({
        credits_amount: (totalCredits as any)?.total || 0,
        total_collected: existing.cash_amount + existing.mpesa_amount + ((totalCredits as any)?.total || 0),
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST/PUT wage deduction for shift
router.put('/:id/wage-deduction', async (req, res) => {
  try {
    const { deduction_amount, reason } = req.body;
    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.employee_id', 'employees.daily_wage')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    const original_wage = shift.daily_wage;
    const final_wage = original_wage - deduction_amount;

    const existing = await db('wage_deductions').where({ shift_id: req.params.id }).first();
    if (existing) {
      await db('wage_deductions').where({ shift_id: req.params.id }).update({
        deduction_amount, original_wage, final_wage, reason: reason || null,
      });
    } else {
      await db('wage_deductions').insert({
        shift_id: req.params.id, employee_id: shift.employee_id,
        original_wage, deduction_amount, final_wage, reason: reason || null,
      });
    }

    const deduction = await db('wage_deductions').where({ shift_id: req.params.id }).first();
    res.json({ success: true, data: deduction });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE wage deduction
router.delete('/:id/wage-deduction', async (req, res) => {
  try {
    await db('wage_deductions').where({ shift_id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT close shift — with deduction options and debt carry-forward
router.put('/:id/close', async (req, res) => {
  try {
    const { notes, deduct_amount } = req.body;
    // deduct_amount: number | null
    //   null/undefined = don't deduct (full deficit becomes debt)
    //   number = deduct this amount from wage (can be partial or full)

    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.daily_wage', 'employees.id as emp_id', 'employees.name as emp_name')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    // Calculate variance
    const readings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .where('pump_readings.shift_id', shift.id)
      .where('pumps.active', true);
    const collections = await db('shift_collections').where({ shift_id: shift.id }).first();
    const expenses = await db('shift_expenses').where({ shift_id: shift.id });
    const shiftCredits = await db('shift_credits').where({ shift_id: shift.id });

    const expected_sales = readings.reduce((s: number, r: any) => s + r.amount_sold, 0);
    const total_cash = collections ? collections.cash_amount : 0;
    const total_mpesa = collections ? collections.mpesa_amount : 0;
    const total_credits = shiftCredits.reduce((s: number, c: any) => s + c.amount, 0);
    const total_expenses = expenses.reduce((s: number, e: any) => s + e.amount, 0);
    const employee_wage = shift.daily_wage || 0;
    const total_accounted = total_cash + total_mpesa + total_credits + total_expenses + employee_wage;
    const variance = total_accounted - expected_sales;

    // Handle deficit and deductions
    if (variance < 0) {
      const deficit = Math.abs(variance);
      const actualDeduction = deduct_amount != null ? Math.min(deduct_amount, employee_wage, deficit) : 0;
      const carriedForward = deficit - actualDeduction;

      // Create/update wage deduction if deducting
      if (actualDeduction > 0) {
        const existing = await db('wage_deductions').where({ shift_id: shift.id }).first();
        if (existing) {
          await db('wage_deductions').where({ shift_id: shift.id }).update({
            deduction_amount: actualDeduction,
            original_wage: employee_wage,
            final_wage: employee_wage - actualDeduction,
            reason: `Shift deficit of KES ${deficit.toFixed(2)}`,
          });
        } else {
          await db('wage_deductions').insert({
            shift_id: shift.id,
            employee_id: shift.emp_id,
            original_wage: employee_wage,
            deduction_amount: actualDeduction,
            final_wage: employee_wage - actualDeduction,
            reason: `Shift deficit of KES ${deficit.toFixed(2)}`,
          });
        }
      }

      // Create staff debt if there's any unrecovered amount
      if (carriedForward > 0) {
        await db('staff_debts').insert({
          employee_id: shift.emp_id,
          shift_id: shift.id,
          original_deficit: deficit,
          deducted_from_wage: actualDeduction,
          carried_forward: carriedForward,
          balance: carriedForward,
          status: 'outstanding',
        });

        // Ensure employee has a credit_accounts row
        const existingAccount = await db('credit_accounts')
          .where({ employee_id: shift.emp_id, type: 'employee' })
          .first();
        if (!existingAccount) {
          await db('credit_accounts').insert({
            name: shift.emp_name,
            type: 'employee',
            employee_id: shift.emp_id,
          });
        }
      }
    }

    // Deduct litres sold from each linked tank
    const allReadings = await db('pump_readings')
      .join('pumps', 'pump_readings.pump_id', 'pumps.id')
      .where('pump_readings.shift_id', req.params.id)
      .where('pumps.active', true)
      .whereNotNull('pumps.tank_id')
      .select('pumps.tank_id', 'pump_readings.litres_sold');

    // Group litres sold by tank_id
    const tankDeductions: Record<number, number> = {};
    for (const r of allReadings) {
      const tankId = r.tank_id;
      tankDeductions[tankId] = (tankDeductions[tankId] || 0) + parseFloat(r.litres_sold || 0);
    }
    for (const [tankId, litres] of Object.entries(tankDeductions)) {
      if (litres > 0) {
        await db('tanks')
          .where({ id: parseInt(tankId) })
          .decrement('current_stock_litres', litres);
      }
    }

    // Close the shift
    await db('shifts').where({ id: req.params.id }).update({
      status: 'closed',
      end_time: new Date().toISOString(),
      notes: notes || null,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET staff debts for an employee
router.get('/staff-debts/:employeeId', async (req, res) => {
  try {
    const debts = await db('staff_debts')
      .where({ employee_id: req.params.employeeId })
      .orderBy('created_at', 'desc');
    const total = debts
      .filter((d: any) => d.status === 'outstanding')
      .reduce((sum: number, d: any) => sum + d.balance, 0);
    res.json({ success: true, data: { debts, total_outstanding: total } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT repay staff debt from wage (used when opening/during a shift to clear past debts)
router.put('/:id/repay-debt', async (req, res) => {
  try {
    const { amount } = req.body;
    const shift = await db('shifts')
      .join('employees', 'shifts.employee_id', 'employees.id')
      .select('shifts.*', 'employees.daily_wage', 'employees.id as emp_id')
      .where('shifts.id', req.params.id)
      .first();

    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

    // Get outstanding debts oldest first
    const debts = await db('staff_debts')
      .where({ employee_id: shift.emp_id, status: 'outstanding' })
      .orderBy('created_at', 'asc');

    let remaining = amount;
    for (const debt of debts) {
      if (remaining <= 0) break;
      const payment = Math.min(remaining, debt.balance);
      const newBalance = debt.balance - payment;
      await db('staff_debts').where({ id: debt.id }).update({
        balance: newBalance,
        status: newBalance <= 0 ? 'cleared' : 'outstanding',
      });
      remaining -= payment;
    }

    // Create/update wage deduction for this debt repayment
    const deductionAmount = amount - remaining; // actual amount applied
    if (deductionAmount > 0) {
      const existing = await db('wage_deductions').where({ shift_id: shift.id }).first();
      const totalDeduction = (existing?.deduction_amount || 0) + deductionAmount;
      if (existing) {
        await db('wage_deductions').where({ shift_id: shift.id }).update({
          deduction_amount: totalDeduction,
          final_wage: shift.daily_wage - totalDeduction,
          reason: existing.reason
            ? `${existing.reason} + Debt repayment KES ${deductionAmount.toFixed(2)}`
            : `Debt repayment KES ${deductionAmount.toFixed(2)}`,
        });
      } else {
        await db('wage_deductions').insert({
          shift_id: shift.id,
          employee_id: shift.emp_id,
          original_wage: shift.daily_wage,
          deduction_amount: totalDeduction,
          final_wage: shift.daily_wage - totalDeduction,
          reason: `Debt repayment KES ${deductionAmount.toFixed(2)}`,
        });
      }
    }

    // Return updated debts
    const updatedDebts = await db('staff_debts')
      .where({ employee_id: shift.emp_id })
      .orderBy('created_at', 'desc');
    const totalOutstanding = updatedDebts
      .filter((d: any) => d.status === 'outstanding')
      .reduce((sum: number, d: any) => sum + d.balance, 0);

    res.json({ success: true, data: { debts: updatedDebts, total_outstanding: totalOutstanding } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
