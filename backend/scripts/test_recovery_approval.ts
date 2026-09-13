import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Approvals are a verified administrator, not typed text (M3), and routine
// decisions no longer demand written reasons (M4). Runs on a private temporary
// database; never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-approval-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'approval-test-desktop-key-0000';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { approvalBindings, resolveApprover } = await import('../src/services/approval');
  const { shiftRecoveryPreview, postShiftRecovery } = await import('../src/services/shiftSettlement');
  const { savePayrollRecovery, addPayrollDeduction } = await import('../src/services/payrollMutations');
  const { payrollRecoveryPreview } = await import('../src/services/payrollDetails');
  const { calculatePayrollRun, getPayrollRun, approvePayrollRun } = await import('../src/services/payroll');
  const { generateShiftEarnings } = await import('../src/services/compensation');
  const { employeeDebtSummary } = await import('../src/services/employeeDebt');
  const { closeShiftSchema, createPayrollDeductionSchema } = await import('../src/schemas');
  const { redactSensitiveValues } = await import('../src/utils/redact');
  const { default: authRouter } = await import('../src/routes/auth');

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();

    const person = async (name: string, role: 'admin' | 'attendant', pin: string) => {
      const [id] = await db('employees').insert({ name, daily_wage: 0, pin: hashPin(pin), role, active: true });
      return id as number;
    };
    const owner = await person('Owner Admin', 'admin', '4821');
    const manager = await person('Manager Admin', 'admin', '1357');
    const retired = await person('Retired Admin', 'admin', '2468');
    await db('employees').where({ id: retired }).update({ active: false });
    const attendant = await person('Night Attendant', 'attendant', '9999');

    // ---- A. Approver list and PIN verification over HTTP ----
    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
    app.get('/probe', auth.requireAuth, (_req, res) => res.json({ ok: true }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    const call = (url: string, options: { method?: string; body?: any; headers?: Record<string, string> } = {}) =>
      fetch(`http://127.0.0.1:${port}${url}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const version = 'a'.repeat(64);
    const subject = { purpose: 'recovery', version, amount: 400 };
    const verify = (body: any, headers: Record<string, string> = desktop) =>
      call('/auth/verify-pin', { method: 'POST', headers, body });

    const attendantSession = { Authorization: `Bearer ${auth.generateToken(attendant, 'attendant')}` };
    assert.equal((await call('/auth/approvers')).status, 401, 'the public cannot list approvers');
    assert.equal(
      (await call('/auth/approvers', { headers: attendantSession })).status,
      200,
      'an attendant can list approvers, to ask one to confirm a credit override',
    );
    const approvers = (await (await call('/auth/approvers', { headers: desktop })).json()).data;
    assert.deepEqual(approvers.map((a: any) => a.name), ['Manager Admin', 'Owner Admin'], 'only active admins');
    assert(approvers.every((a: any) => Object.keys(a).sort().join() === 'id,name'), 'approvers expose id and name only');

    assert.equal((await verify({ ...subject, employee_id: owner, pin: '4821' }, {})).status, 401, 'verify-pin needs a signed-in caller');
    assert.equal(
      (await verify({ ...subject, employee_id: owner, pin: '4821' }, attendantSession)).status,
      403,
      'an attendant cannot request a recovery approval',
    );
    const overrideSubject = { purpose: 'credit_override', account_id: 1, shift_id: 1, amount: 500 };
    assert.equal(
      (await verify({ ...overrideSubject, employee_id: owner, pin: '4821' }, attendantSession)).status,
      200,
      'an attendant can have an admin confirm a credit override on their phone',
    );
    assert.equal((await verify({ ...subject, purpose: 'payout', employee_id: owner, pin: '4821' })).status, 400, 'unknown purpose');
    assert.equal((await verify({ purpose: 'recovery', amount: 400, employee_id: owner, pin: '4821' })).status, 400, 'decision not described');
    assert.equal((await verify({ ...subject, employee_id: attendant, pin: '9999' })).status, 403, 'an attendant cannot approve');
    assert.equal((await verify({ ...subject, employee_id: retired, pin: '2468' })).status, 403, 'an inactive admin cannot approve');

    for (let i = 0; i < 5; i += 1) {
      assert.equal((await verify({ ...subject, employee_id: manager, pin: '0000' })).status, 403);
    }
    assert.equal((await verify({ ...subject, employee_id: manager, pin: '1357' })).status, 429, 'the correct PIN is refused while locked');

    const ok = await verify({ ...subject, employee_id: owner, pin: '4821' });
    assert.equal(ok.status, 200, 'the lock is per approver; the owner is unaffected');
    const okBody = await ok.json();
    assert.equal(okBody.data.approver.name, 'Owner Admin');
    assert(!JSON.stringify(okBody).includes('scrypt'), 'the PIN hash never leaves the server');
    const token: string = okBody.data.approval_token;
    assert.equal(auth.verifyApprovalToken(token)?.binding, approvalBindings.recovery({ version, amount: 400 }));

    const mobileAdmin = await verify({ ...subject, employee_id: owner, pin: '4821' }, { Authorization: `Bearer ${auth.generateToken(owner, 'admin')}` });
    assert.equal(mobileAdmin.status, 200, 'an admin session may also verify');

    // Tokens cannot cross over, be edited, or outlive their window.
    assert.equal((await call('/probe', { headers: { Authorization: `Bearer ${token}` } })).status, 401, 'an approval is not a session');
    assert.equal(auth.verifyApprovalToken(auth.generateToken(owner, 'admin')), null, 'a session is not an approval');
    const dot = token.lastIndexOf('.');
    const claims = JSON.parse(Buffer.from(token.slice(0, dot), 'base64').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, binding: approvalBindings.recovery({ version, amount: 9000 }) })).toString('base64');
    assert.equal(auth.verifyApprovalToken(`${forged}.${token.slice(dot + 1)}`), null, 'editing the binding breaks the signature');
    const realNow = Date.now;
    Date.now = () => realNow() - auth.APPROVAL_TOKEN_TTL_MS - 1000;
    const expired = auth.generateApprovalToken(owner, 'x');
    Date.now = realNow;
    assert.equal(auth.verifyApprovalToken(expired), null, 'approvals expire');
    console.log('PASS approver list, PIN verification, per-approver lockout, token separation, tamper and expiry');

    // ---- B. Approver resolution rules ----
    const binding400 = approvalBindings.recovery({ version, amount: 400 });
    assert.deepEqual(await resolveApprover(owner, undefined, binding400, db), { id: owner, name: 'Owner Admin' }, 'a signed-in admin approves as themselves');
    await assert.rejects(() => resolveApprover(attendant, undefined, binding400, db), /administrator must approve/, 'an attendant cannot approve for themselves');
    assert.deepEqual(
      await resolveApprover(attendant, auth.generateApprovalToken(owner, binding400), binding400, db),
      { id: owner, name: 'Owner Admin' },
      "an attendant's session can carry an admin's PIN approval",
    );
    await assert.rejects(() => resolveApprover(null, undefined, binding400, db), /Select the approving administrator/);
    await assert.rejects(
      () => resolveApprover(null, token, approvalBindings.recovery({ version, amount: 0 }), db),
      /no longer matches/,
      'approval of KES 400 cannot approve KES 0',
    );
    assert.deepEqual(await resolveApprover(null, token, binding400, db), { id: owner, name: 'Owner Admin' });
    const managerToken = auth.generateApprovalToken(manager, binding400);
    await db('employees').where({ id: manager }).update({ active: false });
    await assert.rejects(() => resolveApprover(null, managerToken, binding400, db), /no longer an active administrator/, 'deactivation revokes an issued approval');
    await db('employees').where({ id: manager }).update({ active: true });
    console.log('PASS session approver, missing approval, mismatched decision, revoked approver');

    // ---- C. Shift close recovery ----
    const [dailyPlan] = await db('employee_compensation_plans').insert({
      employee_id: attendant, name: 'Daily', pay_schedule: 'daily', effective_from: '2026-08-01', version: 1, status: 'active',
    });
    await db('employee_compensation_components').insert({ plan_id: dailyPlan, component_type: 'fixed_per_shift', amount: 500 });
    const makeShift = async (date: string, status: string) => {
      const [id] = await db('shifts').insert({
        employee_id: attendant, compensation_plan_id: dailyPlan, shift_date: date, start_time: `${date}T06:00:00Z`, status, wage_paid: 0,
      });
      return db('shifts').where({ id }).first();
    };
    const oldShift = await makeShift('2026-09-01', 'closed');
    await db('staff_debts').insert({
      employee_id: attendant, shift_id: oldShift.id, original_deficit: 300, carried_forward: 300, balance: 300, status: 'outstanding', recovery_status: 'confirmed',
    });
    const tonight = await makeShift('2026-09-02', 'open');
    const variance = -120;
    const preview = await shiftRecoveryPreview(tonight, [], variance, db);
    assert.equal(preview.outstanding, 420, "old debt plus tonight's shortage");
    assert.equal(preview.proposed, 420);
    const close = (decision: any, actor: number | null, shift = tonight, v = variance) =>
      db.transaction((trx) => postShiftRecovery(shift, [], v, decision, trx, actor));

    await assert.rejects(() => close({ version: preview.version, amount: 420 }, null), /Select the approving administrator/, 'desktop close needs an approver');
    assert.equal((await employeeDebtSummary(attendant, db)).outstanding, 300, 'a refused close writes nothing');
    const for100 = auth.generateApprovalToken(owner, approvalBindings.recovery({ version: preview.version, amount: 100 }));
    await assert.rejects(() => close({ version: preview.version, amount: 420, approval_token: for100 }, null), /no longer matches/);

    // Reduced recovery, no written reason (M4), approved on the desktop.
    const for250 = auth.generateApprovalToken(owner, approvalBindings.recovery({ version: preview.version, amount: 250 }));
    await close({ version: preview.version, amount: 250, approval_token: for250 }, null);
    assert.equal((await employeeDebtSummary(attendant, db)).outstanding, 170, '300 + 120 shortage - 250 repaid');
    const receipt = await db('credit_payments').where({ payment_type: 'staff_debt' }).orderBy('id', 'desc').first();
    assert.equal(receipt.created_by_employee_id, owner, 'the repayment is attributed to the approver');
    assert.equal(receipt.notes, `Shift #${tonight.id} close recovery, approved by Owner Admin`);
    assert.equal(receipt.shift_id, null, 'a repayment never enters a shift drawer');
    const shiftReview = JSON.parse((await db('shifts').where({ id: tonight.id }).first()).recovery_review);
    assert.equal(shiftReview.approved_by, owner);
    assert.equal(shiftReview.approved_by_name, 'Owner Admin');
    assert.equal(shiftReview.amount, 250);
    assert(!('approval_token' in shiftReview) && !JSON.stringify(shiftReview).includes(for250), 'the approval token is never stored');

    // Mobile: the signed-in admin approves; deferring recovery is attributed too.
    const next = await makeShift('2026-09-03', 'open');
    const nextPreview = await shiftRecoveryPreview(next, [], 0, db);
    await close({ version: nextPreview.version, amount: 0 }, manager, next, 0);
    const deferReview = JSON.parse((await db('shifts').where({ id: next.id }).first()).recovery_review);
    assert.equal(deferReview.approved_by_name, 'Manager Admin');
    assert.equal((await employeeDebtSummary(attendant, db)).outstanding, 170);
    console.log('PASS shift close: approval required, bound to amount, attributed, token not stored, no reason needed');

    // ---- D. Validators keep the token and still accept cached older clients ----
    const reviewed = { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true };
    const parsed = closeShiftSchema.safeParse({ wage_paid: 0, reconciliation: reviewed, recovery_decision: { version, amount: 1, approval_token: 'tok' } });
    assert(parsed.success);
    assert.equal(parsed.data.recovery_decision?.approval_token, 'tok', 'the close validator must not strip the approval');
    assert(
      closeShiftSchema.safeParse({ wage_paid: 0, variance_reason: 'older phone', reconciliation: reviewed, recovery_decision: { version, amount: 1, authorization_reference: 'Murage', reason: 'older phone' } }).success,
      'a phone on a cached older bundle can still close',
    );
    const deductionParsed = createPayrollDeductionSchema.safeParse({ deduction_type: 'manual', amount: 10, approval_token: 'tok' });
    assert(deductionParsed.success && deductionParsed.data.approval_token === 'tok');
    const logged = JSON.stringify(redactSensitiveValues({ employee_id: 1, pin: '4821', recovery_decision: { amount: 1, approval_token: 'secret-token' } }));
    assert(!logged.includes('4821') && !logged.includes('secret-token'), 'PINs and tokens are redacted from request logs');
    console.log('PASS validators preserve approvals, accept older clients, and logs redact PINs and tokens');

    // ---- E. Payroll: deduction and recovery approvals survive to approval ----
    const monthly = await person('Monthly Staff', 'attendant', '1111');
    const [monthlyPlan] = await db('employee_compensation_plans').insert({
      employee_id: monthly, name: 'Monthly', pay_schedule: 'monthly', effective_from: '2026-08-01', version: 1, status: 'active',
    });
    await db('employee_compensation_components').insert({ plan_id: monthlyPlan, component_type: 'fixed_per_shift', amount: 800 });
    const [workedId] = await db('shifts').insert({
      employee_id: monthly, compensation_plan_id: monthlyPlan, shift_date: '2026-08-05', start_time: '2026-08-05T06:00:00Z', status: 'closed', wage_paid: 0,
    });
    const worked = await db('shifts').where({ id: workedId }).first();
    await db.transaction((trx) => generateShiftEarnings(worked, [], '2026-09-01T06:00:00Z', trx));
    await db('staff_debts').insert({
      employee_id: monthly, shift_id: workedId, original_deficit: 500, carried_forward: 500, balance: 500, status: 'outstanding', recovery_status: 'confirmed',
    });
    const runId = await calculatePayrollRun(
      { name: 'August', pay_schedule: 'monthly', period_start: '2026-08-01', period_end: '2026-08-31' },
      db,
      '2026-09-01',
    );
    const line = (await getPayrollRun(runId, db)).lines.find((l: any) => l.employee_id === monthly);
    assert(line, 'payroll line for the monthly employee');

    const advanceBinding = approvalBindings.deduction({ payroll_line_id: line.id, deduction_type: 'advance', amount: 50 });
    await assert.rejects(
      () => db.transaction((trx) => addPayrollDeduction(runId, line.id, { deduction_type: 'advance', amount: 75, approval_token: auth.generateApprovalToken(owner, advanceBinding) }, null, trx)),
      /no longer matches/,
      'approval of KES 50 cannot add KES 75',
    );
    await assert.rejects(
      () => db.transaction((trx) => addPayrollDeduction(runId, line.id, { deduction_type: 'advance', amount: 50 }, null, trx)),
      /Select the approving administrator/,
    );
    await db.transaction((trx) =>
      addPayrollDeduction(runId, line.id, { deduction_type: 'advance', amount: 50, notes: 'Advance 3 Sept', approval_token: auth.generateApprovalToken(owner, advanceBinding) }, null, trx),
    );
    const advance = await db('payroll_deductions').where({ payroll_line_id: line.id, deduction_type: 'advance' }).first();
    assert.equal(advance.authorization_reference, 'Approved by Owner Admin');
    assert.equal(advance.created_by_employee_id, owner);
    assert.equal(advance.notes, 'Advance 3 Sept');

    const payPreview = await payrollRecoveryPreview(line.id, db);
    assert.equal(payPreview.proposed, 500);
    await assert.rejects(
      () => db.transaction((trx) => savePayrollRecovery(runId, line.id, { version: payPreview.version, amount: 200 }, null, trx)),
      /Select the approving administrator/,
    );
    const for200 = auth.generateApprovalToken(owner, approvalBindings.recovery({ version: payPreview.version, amount: 200 }));
    await db.transaction((trx) => savePayrollRecovery(runId, line.id, { version: payPreview.version, amount: 200, approval_token: for200 }, null, trx));
    const draft = await db('payroll_deductions').where({ payroll_line_id: line.id, deduction_type: 'staff_debt' }).first();
    assert.equal(draft.authorization_reference, 'Approved by Owner Admin');
    assert.equal(draft.created_by_employee_id, owner);
    const lineReview = JSON.parse((await db('payroll_lines').where({ id: line.id }).first()).recovery_review);
    assert.equal(lineReview.approved_by_name, 'Owner Admin');
    assert(!JSON.stringify(lineReview).includes(for200), 'the approval token is never stored');

    // Approval re-validates the saved decision long after its token expired.
    await approvePayrollRun(runId, null, db);
    assert.equal((await employeeDebtSummary(monthly, db)).outstanding, 300, '500 - 200 recovered at approval');
    console.log('PASS payroll deduction and reduced recovery need a matching approval, and approve without a reason');

    assert.equal((await db.raw('PRAGMA integrity_check'))[0].integrity_check, 'ok');
    assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
