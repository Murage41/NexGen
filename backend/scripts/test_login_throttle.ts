import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

// Wrong-PIN limits on login and approvals. Guessing is bounded per account,
// never per client address (which a client can forge through ngrok), and a
// stranger using up an account's allowance cannot lock its owner out of a
// phone they have signed in on before. Runs on a private temporary database;
// never touches data/nexgen.db.
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-login-throttle-test-'));
  process.env.NEXGEN_DATA_DIR = directory;
  process.env.DESKTOP_KEY = 'login-throttle-test-desktop-key-0';
  const { default: db } = await import('../src/database');
  const { hashPin } = await import('../src/services/pinSecurity');
  const auth = await import('../src/middleware/requireAdmin');
  const { default: authRouter } = await import('../src/routes/auth');

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: any[]) => { warnings.push(args.join(' ')); };
  const realNow = Date.now;
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    await db.migrate.latest();
    const person = async (name: string, role: 'admin' | 'attendant', pin: string) => {
      const [id] = await db('employees').insert({ name, daily_wage: 0, pin: hashPin(pin), role, active: true });
      return id as number;
    };
    const owner = await person('Owner Admin', 'admin', '4821');
    const clerk = await person('Day Clerk', 'attendant', '1111');

    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
    app.get('/probe', auth.requireAuth, (_req, res) => res.json({ ok: true }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server!.once('listening', r));
    const port = (server.address() as any).port;
    let fakeAddress = 0;
    const login = async (employee_id: number, pin: string, device_token?: string) => {
      // A different forged client address on every attempt - the old bypass.
      fakeAddress += 1;
      const response = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${fakeAddress % 250}` },
        body: JSON.stringify({ employee_id, pin, ...(device_token ? { device_token } : {}) }),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const verifyPin = async (headers: Record<string, string>, pin: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/auth/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ purpose: 'credit_override', account_id: 1, shift_id: 1, amount: 100, employee_id: owner, pin }),
      });
      return { status: response.status, body: await response.json() as any };
    };

    // ---- A. The owner's phone signs in before any attack ----
    const first = await login(owner, '4821');
    assert.equal(first.status, 200);
    assert.equal(typeof first.body.token, 'string');
    assert.equal(typeof first.body.device_token, 'string', 'a sign-in marks the device as known');
    assert(!('pin' in first.body.data), 'the PIN hash never leaves the server');
    const ownerPhone = first.body.device_token;

    // ---- B. A stranger rotating forged addresses gets 5 guesses, then none ----
    for (const guess of ['0000', '1234', '1111', '2222', '9999']) {
      assert.equal((await login(owner, guess)).status, 401);
    }
    const blocked = await login(owner, '4821');
    assert.equal(blocked.status, 429, 'even the correct PIN is refused from a new device once the allowance is spent');
    assert.match(blocked.body.error, /from new devices/);
    assert(blocked.body.retry_after_seconds > 23 * 3600, 'the allowance is per rolling day');
    console.log('PASS forged client addresses no longer reset the limit: 5 wrong guesses per account per day from new devices');

    // ---- C. ...but cannot lock the owner out of their own phone ----
    const fromPhone = await login(owner, '4821', ownerPhone);
    assert.equal(fromPhone.status, 200, "the owner's known phone still signs in");
    assert.notEqual(fromPhone.body.device_token, ownerPhone, 'each sign-in issues a fresh device token');
    console.log("PASS a stranger's guessing does not lock the owner out of a known phone");

    // ---- D. A known device has its own allowance, then loses its standing ----
    const clerkPhone = (await login(clerk, '1111')).body.device_token;
    const clerkTablet = (await login(clerk, '1111')).body.device_token;
    for (let i = 0; i < 4; i += 1) assert.equal((await login(clerk, '0000', clerkPhone)).status, 401);
    const afterTypos = await login(clerk, '1111', clerkPhone);
    assert.equal(afterTypos.status, 200, 'typos then the right PIN: fine');
    const clerkPhone2 = afterTypos.body.device_token;
    for (let i = 0; i < 5; i += 1) assert.equal((await login(clerk, '0000', clerkPhone2)).status, 401);
    // Five in a row: this token is no longer trusted, so its guesses now draw
    // on the clerk's new-device allowance...
    for (let i = 0; i < 5; i += 1) assert.equal((await login(clerk, '0000', clerkPhone2)).status, 401);
    // ...which is now spent, so the right PIN from it is refused,
    assert.equal((await login(clerk, '1111', clerkPhone2)).status, 429, 'a device that kept guessing loses its standing');
    // while the clerk's other known device is unaffected.
    assert.equal((await login(clerk, '1111', clerkTablet)).status, 200);
    console.log('PASS a known device gets 5 wrong guesses in a row, then counts as new; other known devices unaffected');

    // ---- E. Device tokens cannot be borrowed, forged or confused ----
    assert.equal((await login(clerk, '1111', ownerPhone)).status, 429, "the owner's device token gives no standing on the clerk's account");
    const dot = ownerPhone.lastIndexOf('.');
    const claims = JSON.parse(Buffer.from(ownerPhone.slice(0, dot), 'base64').toString());
    const forged = `${Buffer.from(JSON.stringify({ ...claims, employee: clerk })).toString('base64')}${ownerPhone.slice(dot)}`;
    assert.equal((await login(clerk, '1111', forged)).status, 429, 'editing a device token breaks it');
    assert.equal(auth.verifyDeviceToken(first.body.token), null, 'a session token is not a device token');
    assert.equal(auth.verifyDeviceToken(auth.generateApprovalToken(owner, 'x')), null, 'nor is an approval token');
    const probe = await fetch(`http://127.0.0.1:${port}/probe`, { headers: { Authorization: `Bearer ${ownerPhone}` } });
    assert.equal(probe.status, 401, 'a device token is not a session');
    for (let i = 0; i < 8; i += 1) {
      assert.equal((await login(99999, '0000')).status, 401, 'an account that does not exist is never locked or counted');
    }
    console.log('PASS device tokens are per employee, tamper-proof and distinct from session and approval tokens');

    // ---- F. The allowance recovers with time ----
    Date.now = () => realNow() + 24 * 60 * 60 * 1000 + 1000;
    assert.equal((await login(owner, '4821')).status, 200, 'a day later a new device may sign in again');
    Date.now = realNow;
    console.log('PASS the new-device allowance recovers after 24 hours');

    // ---- G. Approval PINs: limited per approver and caller, and per day ----
    const desktop = { 'x-desktop-key': process.env.DESKTOP_KEY! };
    const clerkSession = { Authorization: `Bearer ${auth.generateToken(clerk, 'attendant')}` };
    for (let i = 0; i < 5; i += 1) assert.equal((await verifyPin(clerkSession, '0000')).status, 403);
    assert.equal((await verifyPin(clerkSession, '4821')).status, 429, "the clerk's phone is locked for the owner's approvals");
    assert.equal((await verifyPin(desktop, '4821')).status, 200, "but the clerk's guessing does not block the owner at the desktop");
    // Waiting out each 15-minute lock does not allow unlimited guessing.
    let clock = 0;
    for (let round = 0; round < 3; round += 1) {
      clock += 16 * 60 * 1000;
      const at = realNow() + clock;
      Date.now = () => at;
      for (let i = 0; i < 5; i += 1) assert.equal((await verifyPin(clerkSession, '0000')).status, 403);
    }
    clock += 16 * 60 * 1000;
    const later = realNow() + clock;
    Date.now = () => later;
    const capped = await verifyPin(clerkSession, '4821');
    assert.equal(capped.status, 429, '20 wrong approval PINs in a day stop that caller until the next day');
    assert.match(capped.body.error, /hours/);
    Date.now = realNow;
    console.log('PASS approval PINs: 5 wrong locks that caller for 15 minutes, 20 in a day stops it, other callers unaffected');

    // ---- H. The station log records wrong guesses, never the PINs ----
    const loginWarnings = warnings.filter((line) => line.includes('[auth:login] incorrect PIN'));
    const approvalWarnings = warnings.filter((line) => line.includes('[auth:approval] incorrect PIN'));
    assert.equal(loginWarnings.length, 19, '5 in B, then 4 + 5 + 5 in D');
    assert.equal(approvalWarnings.length, 20);
    assert(warnings.every((line) => !/\b(0000|1234|2222|9999)\b/.test(line)), 'no guessed PIN appears in the log');
    assert(loginWarnings.some((line) => line.includes('forwarded "203.0.113.')), 'the claimed address is kept for the record');
    console.log('PASS wrong guesses are logged with the account and claimed address, without the PIN');
  } finally {
    Date.now = realNow;
    console.warn = realWarn;
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
