import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Approvals are a verified administrator, not typed text (M3), and routine
// decisions no longer demand written reasons (M4). Writing off or paying back
// an attendant's variance needs an approval bound to exactly that decision.
// Runs on a private temporary database; never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-approval-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'approval-test-desktop-key-0000';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { approvalBindings, resolveApprover } = await import('../src/services/approval');
  const { addPayrollDeduction } = await import('../src/services/payrollMutations');
  const { calculatePayrollRun, getPayrollRun, approvePayrollRun } = await import('../src/services/payroll');
  const { generateShiftEarnings } = await import('../src/services/compensation');
  const { getVarianceStatement, postShiftVariance } = await import('../src/services/employeeVariances');
  const { getKenyaDate } = await import('../src/utils/timezone');
  const { closeShiftSchema, createPayrollDeductionSchema } = await import('../src/schemas');
  const { redactSensitiveValues } = await import('../src/utils/redact');
  const { default: authRouter } = await import('../src/routes/auth');
  const { default: payrollRouter } = await import('../src/routes/payroll');
  const { default: shiftsRouter } = await import('../src/routes/shifts');

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
    app.use('/payroll', payrollRouter);
    app.use('/shifts', shiftsRouter);
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
    const subject = { purpose: 'balance_move', from_kind: 'customer', from_id: 1, to_kind: 'customer', to_id: 2, shift_id: 0, amount: 400 };
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

    // employee_id names the approving admin; for_employee_id the attendant.
    const pinFor = (who: number, pin: string) => ({ ...subject, employee_id: who, pin });
    assert.equal((await verify(pinFor(owner, '4821'), {})).status, 401, 'verify-pin needs a signed-in caller');
    assert.equal(
      (await verify(pinFor(owner, '4821'), attendantSession)).status,
      403,
      'an attendant cannot request an administrator-only approval',
    );
    const overrideSubject = { purpose: 'credit_override', account_id: 1, shift_id: 1, amount: 500 };
    assert.equal(
      (await verify({ ...overrideSubject, employee_id: owner, pin: '4821' }, attendantSession)).status,
      200,
      'an attendant can have an admin confirm a credit override on their phone',
    );
    assert.equal((await verify({ ...subject, purpose: 'payout', employee_id: owner, pin: '4821' })).status, 400, 'unknown purpose');
    assert.equal((await verify({ purpose: 'recovery', amount: 400, employee_id: owner, pin: '4821' })).status, 400, 'debt recovery is no longer approved');
    assert.equal((await verify({ purpose: 'balance_move', amount: 400, employee_id: owner, pin: '4821' })).status, 400, 'decision not described');
    for (const retiredPurpose of ['variance_waiver', 'variance_settlement', 'variance_refund']) {
      assert.equal((await verify({ ...subject, purpose: retiredPurpose, employee_id: owner, pin: '4821' })).status, 400, `${retiredPurpose} is no longer approved`);
    }
    assert.equal((await verify(pinFor(attendant, '9999'))).status, 403, 'an attendant cannot approve');
    assert.equal((await verify(pinFor(retired, '2468'))).status, 403, 'an inactive admin cannot approve');

    for (let i = 0; i < 5; i += 1) {
      assert.equal((await verify(pinFor(manager, '0000'))).status, 403);
    }
    assert.equal((await verify(pinFor(manager, '1357'))).status, 429, 'the correct PIN is refused while locked');

    const ok = await verify(pinFor(owner, '4821'));
    assert.equal(ok.status, 200, 'the lock is per approver; the owner is unaffected');
    const okBody = await ok.json();
    assert.equal(okBody.data.approver.name, 'Owner Admin');
    assert(!JSON.stringify(okBody).includes('scrypt'), 'the PIN hash never leaves the server');
    const token: string = okBody.data.approval_token;
    const binding400 = approvalBindings.balance_move({ from_kind: 'customer', from_id: 1, to_kind: 'customer', to_id: 2, shift_id: 0, amount: 400 });
    assert.equal(auth.verifyApprovalToken(token)?.binding, binding400);

    const mobileAdmin = await verify(pinFor(owner, '4821'), { Authorization: `Bearer ${auth.generateToken(owner, 'admin')}` });
    assert.equal(mobileAdmin.status, 200, 'an admin session may also verify');

    // Tokens cannot cross over, be edited, or outlive their window.
    assert.equal((await call('/probe', { headers: { Authorization: `Bearer ${token}` } })).status, 401, 'an approval is not a session');
    assert.equal(auth.verifyApprovalToken(auth.generateToken(owner, 'admin')), null, 'a session is not an approval');
    const dot = token.lastIndexOf('.');
    const claims = JSON.parse(Buffer.from(token.slice(0, dot), 'base64').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, binding: approvalBindings.balance_move({ from_kind: 'customer', from_id: 1, to_kind: 'customer', to_id: 2, shift_id: 0, amount: 9000 }) })).toString('base64');
    assert.equal(auth.verifyApprovalToken(`${forged}.${token.slice(dot + 1)}`), null, 'editing the binding breaks the signature');
    const realNow = Date.now;
    Date.now = () => realNow() - auth.APPROVAL_TOKEN_TTL_MS - 1000;
    const expired = auth.generateApprovalToken(owner, 'x');
    Date.now = realNow;
    assert.equal(auth.verifyApprovalToken(expired), null, 'approvals expire');
    console.log('PASS approver list, PIN verification, per-approver lockout, token separation, tamper and expiry');

    // ---- B. Approver resolution rules ----
    assert.deepEqual(await resolveApprover(owner, undefined, binding400, db), { id: owner, name: 'Owner Admin' }, 'a signed-in admin approves as themselves');
    await assert.rejects(() => resolveApprover(attendant, undefined, binding400, db), /administrator must approve/, 'an attendant cannot approve for themselves');
    assert.deepEqual(
      await resolveApprover(attendant, auth.generateApprovalToken(owner, binding400), binding400, db),
      { id: owner, name: 'Owner Admin' },
      "an attendant's session can carry an admin's PIN approval",
    );
    await assert.rejects(() => resolveApprover(null, undefined, binding400, db), /Select the approving administrator/);
    await assert.rejects(
      () => resolveApprover(null, token, approvalBindings.balance_move({ from_kind: 'customer', from_id: 1, to_kind: 'customer', to_id: 2, shift_id: 0, amount: 0 }), db),
      /no longer matches/,
      'approval of KES 400 cannot approve KES 0',
    );
    assert.deepEqual(await resolveApprover(null, token, binding400, db), { id: owner, name: 'Owner Admin' });
    const managerToken = auth.generateApprovalToken(manager, binding400);
    await db('employees').where({ id: manager }).update({ active: false });
    await assert.rejects(() => resolveApprover(null, managerToken, binding400, db), /no longer an active administrator/, 'deactivation revokes an issued approval');
    await db('employees').where({ id: manager }).update({ active: true });
    console.log('PASS session approver, missing approval, mismatched decision, revoked approver');

    // ---- C. An employee pays shortages in money; nothing is written off or paid back ----
    const today = getKenyaDate();
    const [shiftId] = await db('shifts').insert({ employee_id: attendant, shift_date: today, start_time: `${today}T06:00:00Z`, status: 'closed', wage_paid: 0 });
    await db.transaction((trx) => postShiftVariance(trx, { id: shiftId, employee_id: attendant, shift_date: today }, -300, owner));
    const headers = (key: string, extra: Record<string, string> = desktop) => ({ ...extra, 'Idempotency-Key': key });
    const pay = (body: any, key: string) =>
      call(`/payroll/employees/${attendant}/receipts`, { method: 'POST', headers: headers(key), body });
    for (const method of ['write_off', 'surplus']) {
      // With a reference, so the method is the only thing wrong.
      const refused = await pay({ amount: 100, payment_method: method, reference: 'REF123', notes: 'x', date: today }, `nocash-${method}`);
      assert.equal(refused.status, 400, `${method} is not a payment`);
      assert.match((await refused.json()).error, /cash, M-Pesa or bank/);
    }
    for (const route of ['waivers', 'refunds']) {
      const gone = await call(`/payroll/employees/${attendant}/variances/${route}`, { method: 'POST', headers: headers(`retired-${route}`), body: { amount: 10 } });
      assert.equal(gone.status, 410, `${route} are retired`);
    }
    let res = await pay({ amount: 150, payment_method: 'cash', date: today }, 'repayment-001');
    assert.equal(res.status, 200, 'a cash payment needs no reference');
    res = await pay({ amount: 150, payment_method: 'mpesa', date: today }, 'repayment-002');
    assert.equal(res.status, 400, 'M-Pesa needs its reference');
    res = await pay({ amount: 500, payment_method: 'cash', date: today }, 'repayment-003');
    assert.equal(res.status, 409, 'never more than is owed');
    let statement = await getVarianceStatement(db, attendant);
    assert.deepEqual([statement.totals.owes, statement.totals.credit], [150, 0]);
    assert.equal((await db('employee_variance_entries').whereIn('entry_type', ['waiver', 'refund'])).length, 0);
    console.log('PASS shortages are paid in money only; write-offs and paybacks are gone');

    // ---- D. Validators, older clients, and log redaction ----
    const reviewed = { readings_reviewed: true, collections_reviewed: true, entries_reviewed: true };
    const parsed = closeShiftSchema.safeParse({ wage_paid: 0, reconciliation: reviewed, recovery_decision: { version: 'a'.repeat(64), amount: 1, approval_token: 'tok' } });
    assert(parsed.success, 'a phone on a cached older bundle can still close');
    assert.equal((parsed.data as any).recovery_decision, undefined, 'a recovery sent by an older phone is ignored');
    const deductionParsed = createPayrollDeductionSchema.safeParse({ deduction_type: 'manual', amount: 10, approval_token: 'tok' });
    assert(deductionParsed.success && deductionParsed.data.approval_token === 'tok');
    const logged = JSON.stringify(redactSensitiveValues({ employee_id: 1, pin: '4821', approval_token: 'secret-token' }));
    assert(!logged.includes('4821') && !logged.includes('secret-token'), 'PINs and tokens are redacted from request logs');
    assert.equal((await call('/shifts/1/recovery-preview', { method: 'POST', headers: desktop, body: {} })).status, 410);
    assert.equal((await call('/payroll/runs/1/lines/1/recovery', { method: 'PUT', headers: headers('recovery-001'), body: {} })).status, 410);
    console.log('PASS validators keep approvals, older clients still close, retired recovery endpoints answer 410');

    // ---- E. Payroll: other deductions keep their approval; variances never ----
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
    await db.transaction((trx) => postShiftVariance(trx, { id: workedId, employee_id: monthly, shift_date: '2026-08-05' }, -500, owner));
    const runId = await calculatePayrollRun(
      { name: 'August', pay_schedule: 'monthly', period_start: '2026-08-01', period_end: '2026-08-31' },
      db,
      '2026-09-01',
    );
    const line = (await getPayrollRun(runId, db)).lines.find((l: any) => l.employee_id === monthly);
    assert(line, 'payroll line for the monthly employee');
    assert.equal(line.recovery, undefined, 'payroll offers no debt recovery');

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
    await assert.rejects(
      () => db.transaction((trx) => addPayrollDeduction(runId, line.id, { deduction_type: 'staff_debt', amount: 100 }, null, trx)),
      /not deducted from pay/,
      'a variance can never be deducted from pay',
    );

    await approvePayrollRun(runId, null, db);
    const approvedLine = await db('payroll_lines').where({ id: line.id }).first();
    assert.equal(Number(approvedLine.total_deductions), 50, 'only the advance');
    assert.equal((await getVarianceStatement(db, monthly)).totals.owes, 500, 'the variance is untouched by payroll');
    console.log('PASS payroll deductions need a matching approval; variances are never deducted from pay');

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
