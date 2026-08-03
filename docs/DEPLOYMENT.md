# NexGen Deployment, Hosting, and Access

This is the recommended production shape for a single filling station ERP.
The goal is simple: the station keeps working even if the internet is down,
remote access is deliberate, and the SQLite database is treated as the
business record rather than a disposable dev file.

Before treating any build as production-ready, complete the controls and
release gates in `docs/PRODUCTION-SECURITY-AND-COMPLIANCE.md`. That document
also covers coexistence with POSitive, Windows policy, Tailscale, licensing,
ODPC, eTIMS, external APIs, and Android distribution.

## Current Assessment

The old setup was development-first:

- `npm run dev` started backend, desktop, mobile, and ngrok together.
- The backend listened on `0.0.0.0` by default.
- CORS allowed every origin.
- Desktop used a hardcoded admin bypass key.
- Employee PINs were stored as plaintext.
- Backup, drift check, and DB stats endpoints were callable without login.
- Backup copied the SQLite file directly while the app could be running.

That is acceptable for development, but it is not professional enough for a
live station.

## Recommended Production Architecture

Use a station PC or mini-server as the source of truth.

```text
Station PC
  - Backend API on localhost or LAN
  - SQLite database on local SSD
  - Desktop app for manager/admin work
  - Built mobile app served from /mobile

Attendant phones/tablets
  - Access /mobile over station Wi-Fi, Tailscale, or Cloudflare Access

Owner/admin remote access
  - Tailscale for private device access, or
  - Cloudflare Tunnel + Access for browser access with identity controls
```

Do not deploy the current SQLite version to a stateless/serverless host.
If NexGen becomes multi-branch or truly cloud-hosted, migrate the database
layer to PostgreSQL first.

## Access Modes

### 1. Local Desktop Only

Use this when all work happens on the station PC.

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
```

This is the safest default. Nothing on the LAN can call the backend.

### 2. Station Wi-Fi / LAN Mobile

Use this when attendants use phones on the station network.

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
CORS_ORIGINS=
```

Serve the mobile app from:

```text
http://STATION-PC-LAN-IP:3001/mobile
```

Use a router DHCP reservation or static IP for the station PC. Block inbound
WAN traffic on the router. Do not port-forward `3001` to the internet.

### 3. Private Remote Access

Use Tailscale when the owner/admin wants private access from known devices.
Grant access only to the station PC and required ports.

### 4. Browser Remote Access With Identity

Use Cloudflare Tunnel + Cloudflare Access when you want a domain such as:

```text
https://station.example.com/mobile
```

Run the backend on `127.0.0.1`, let `cloudflared` connect outbound to
Cloudflare, and require Access login/MFA before the app is reachable.

### 5. Ngrok

For the station PC, use the station stack:

```cmd
npm run station:tunnel
```

Use this when you want foreground logs for backend, desktop, and ngrok in the
same terminal. If you close that terminal, the station stack stops.

For full development mode only, use:

```cmd
npm run dev:tunnel
```

That starts the heavier development stack, including the separate mobile Vite
dev server. Use it for development, demos, or emergency temporary access. Do
not leave an unauthenticated public ngrok URL as the normal production entry
point.

## Production Environment

Create `backend/.env` from `backend/.env.example`.

Generate strong values for:

- `SESSION_SECRET`
- `DESKTOP_KEY`, required for the current desktop app unless running mobile-only

Mobile sessions expire automatically. The recommended single-station default is:

```env
SESSION_TTL_HOURS=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_WINDOW_MINUTES=15
LOGIN_LOCK_MINUTES=15
```

This covers a normal long shift while forcing a fresh login after the shift/day.
Repeated wrong PINs lock that employee/IP combination briefly to slow brute-force
attempts.

If `DESKTOP_KEY` is set, build the desktop app with the same value as
`VITE_DESKTOP_KEY`.

## Station Update From GitHub

Use this when updating the station PC from the latest committed `main`. The
examples below use the station path `E:\NexGen`. Change every path consistently
if a different PC uses another drive.

This procedure updates the current transitional station installation that is
run from the repository with `npm run station:bg`. It does not install the
packaged Windows application. Do not mix these two deployment models during
one update.

First identify the shell from its prompt:

```text
E:\NexGen>     Command Prompt
PS E:\NexGen>  PowerShell
```

Do not enter PowerShell commands such as `$backup`, `New-Item`, `Copy-Item`, or
`Test-Path` at a Command Prompt.

Before the maintenance window:

1. Confirm the current POSitive installation can sell and print normally.
2. Close NexGen on every desktop and phone.
3. Confirm the Windows account has access to `E:\NexGen` and the backup drive.
4. Confirm the station has Node.js `22.12.0` or newer and npm `10` or newer.
5. Do not proceed unless the Git branch is `main` and the working tree is clean.

Check the required runtime from either shell:

```cmd
node --version
npm --version
```

### Command Prompt update

Run this block at a normal Command Prompt. These are interactive commands, so
the `for` variable uses one percent sign (`%I`).

```cmd
cd /d E:\NexGen

git branch --show-current
git status --short
git rev-parse --short HEAD

npm run dev:stop
dir E:\NexGen\backend\data\nexgen.db

for /f %I in ('powershell.exe -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%I"
set "BACKUP=E:\NexGen-Backups\before-main-update-%STAMP%"
mkdir "%BACKUP%"
xcopy "E:\NexGen\backend\data" "%BACKUP%\data\" /E /I /H /K /Y

if exist "%BACKUP%\data\nexgen.db" (echo BACKUP VERIFIED: "%BACKUP%\data\nexgen.db") else (echo BACKUP FAILED & exit /b 1)
```

Do not continue unless `dir` found the live database and the final command
prints `BACKUP VERIFIED`. Then run:

```cmd
cd /d E:\NexGen
git pull --ff-only origin main

npm ci

cd /d E:\NexGen\backend
npm run build
npm run migrate
npm run audit:receivables
npm run audit:operations

cd /d E:\NexGen
npm run build:mobile
npm run startup:install
npm run station:bg
timeout /t 15 /nobreak
npm run dev:status
curl.exe http://127.0.0.1:3001/api/health
```

### PowerShell update

Run this block only when the prompt starts with `PS`. `npm.cmd` avoids the
PowerShell `npm.ps1` execution-policy restriction.

```powershell
Set-Location E:\NexGen

git branch --show-current
git status --short
git rev-parse --short HEAD

npm.cmd run dev:stop
Get-Item -LiteralPath "E:\NexGen\backend\data\nexgen.db"

$backup = "E:\NexGen-Backups\before-main-update-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force -Path $backup
Copy-Item -LiteralPath "E:\NexGen\backend\data" -Destination (Join-Path $backup "data") -Recurse -Force

if (-not (Test-Path (Join-Path $backup "data\nexgen.db"))) {
  throw "BACKUP FAILED: nexgen.db is missing"
}
Write-Host "BACKUP VERIFIED: $(Join-Path $backup 'data\nexgen.db')"

git pull --ff-only origin main

npm.cmd ci

Set-Location E:\NexGen\backend
npm.cmd run build
npm.cmd run migrate
npm.cmd run audit:receivables
npm.cmd run audit:operations

Set-Location E:\NexGen
npm.cmd run build:mobile
npm.cmd run startup:install
npm.cmd run station:bg
Start-Sleep -Seconds 15
npm.cmd run dev:status
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

The branch must be `main`. If `git status --short` lists files, identify them
before pulling. Do not overwrite station-side code changes.

`git pull --ff-only origin main` is the production-safe form. It downloads only
the commits that the station PC does not already have, then advances `main`
only if it can do so cleanly. If the station PC has local code changes or a
diverged branch, it stops instead of creating a merge commit.

`git pull origin main` also downloads only new commits, not a fresh copy of the
whole repository, and it works when the station PC is clean. The reason the
`--ff-only` form is preferred for production is that it refuses unexpected local
Git history instead of trying to merge it automatically.

The current station stack runs backend and desktop source through their
development runners, so separate backend and desktop builds are not required
for this mode. The mobile build is required because the backend serves the
phone interface from `mobile/dist`. The backend build above is still required
as an update gate because it catches TypeScript errors before the live stack is
restarted. `audit:receivables` is read-only; stop and investigate if it reports
any integrity problem. `audit:operations` is also read-only. Stop if its core
database, foreign-key, receivable, revision, idempotency, or accounting checks
fail. Stale open shifts and older closed shifts without a reconciliation
snapshot are warnings that require review, not migration failures.

The shift safety update includes migrations `041` and `042`. Migration `041`
adds shift write revisions and duplicate-request protection. Migration `042`
adds the configurable stale-shift setting and the shift status/date index.
`npm run migrate` is required, is repeat-safe, and must finish before NexGen is
restarted.

### Verify the station update

Do not declare the update complete after the health endpoint alone:

1. Open NexGen on the station PC and sign in.
2. Open the phone interface at the station's existing `/mobile` address and
   sign in with a test employee or admin account.
3. Open **Invoice Customers**, select a customer, and confirm consumption,
   invoices, and payments load.
4. Filter consumption by date and shift, then move to the next page if there
   are enough records.
5. Open a current shift and start an invoice-customer consumption entry. For a
   fuel with several pumps, confirm the exact pump/source is required. Cancel
   without posting unless this is a real transaction.
6. Preview a closed-shift correction and cancel it. Do not use a live
   correction merely as a smoke test.
7. On **Shifts**, apply a date/status filter, open a shift, use the back button,
   and confirm the filter, sort order, page, and scroll position are preserved.
8. Export the filtered shifts with **Export CSV**. Open the file and confirm it
   contains only the intended period and includes close reconciliation and
   review columns. Exports are capped at 50,000 rows; narrow the dates for a
   larger history.
9. In **Settings > Data Management**, confirm **Open Shift Warning** is correct
   for this station (default 30 hours), run **System Check**, and require its
   core checks to pass. Review every stale-shift or legacy-snapshot warning.
10. Use **Create Backup** and record the displayed backup filename. Confirm the
    file exists under the configured data directory's `backups` folder.
11. During a controlled test shift only, open the same shift on desktop and
    phone. Save a harmless collection or reading change on one device, then
    try to save the older values on the other. Confirm NexGen warns about the
    newer server version and that **Use Server**/**Use Server Values** and
    **Keep Device** do not silently overwrite each other.
12. Confirm shifts, tank balances, credits, reports, employee payroll, and the
    latest backup still display.
13. Restart Windows, sign in as the account that owns the scheduled task, wait
   15 seconds, and repeat `npm run dev:status` and the health check.
14. Confirm POSitive can still sell, print, use eTIMS, and complete its normal
   backup.

Follow `docs/INVOICE-CUSTOMER-WORKFLOW.md` for the full invoice-customer
acceptance test and operating rules.

### Roll back a failed update

Stop NexGen first. Restore the repository version and the matching database
backup as one release unit. Do not run an older commit against a database that
has already received newer irreversible migrations. Preserve the failed data
directory for investigation, then record the attempted commit, error, and
restored backup path.

## Build And Run

### Transitional source deployment

Build mobile first so the backend can serve it:

```cmd
cd /d E:\NexGen
npm run build:mobile
```

Build backend:

```cmd
cd /d E:\NexGen\backend
npm run build
```

Run backend:

```cmd
cd /d E:\NexGen\backend
npm start
```

For production, run the backend as a Windows service using NSSM, PM2, or
Task Scheduler. A service is better than a logged-in terminal window.

### Packaged Windows application

Build the Windows installer once on a controlled release machine from the
tested Git commit:

```cmd
cd /d D:\NexGen\desktop
npm run build
```

Distribute that exact signed installer and its published SHA-256 checksum to
each station. Do not rebuild it independently on the live station. The current
installer uses the default Electron icon and is not code-signed, so it is for
controlled testing only and is blocked from production distribution.

The installed desktop application is a client. It does not replace the backend
service or host the SQLite database by itself. Install and configure the
backend host first, then point the desktop application at that host.

## Current Background Startup

For the current station setup, the repo includes Windows helper scripts that run
the lighter station stack in the background: backend, desktop Vite, and ngrok.
Mobile is served by the backend from the built `/mobile` files.

```cmd
npm run station:bg
npm run dev:status
npm run dev:stop
```

Use `npm run station:bg` for normal station operation and startup tasks. Use
`npm run station:tunnel` when troubleshooting because it keeps the logs visible
in the terminal. Reserve `npm run dev:bg` for development/testing because it
also starts the separate mobile Vite dev server.

Startup at user login is handled by a Windows Scheduled Task:

```cmd
npm run startup:install
npm run startup:uninstall
```

The installed task is named `NexGen ERP Station Stack`. It starts the backend,
desktop Vite server, and ngrok tunnel after the Windows user logs in. Install it
while signed in as the Windows user that will run NexGen on the station PC. It
does not run before login.

For final production, prefer running only the compiled backend plus the built
mobile app from `/mobile`; the desktop app should be launched as a normal user
application, not as a hidden service.

## Backup And Recovery

The protected endpoint is:

```text
POST /api/health/backup
```

It now requires admin authentication and checkpoints WAL before copying the
database file.

Minimum backup policy:

- Nightly local backup.
- Weekly offsite backup to cloud storage or external drive.
- Monthly restore test on a different machine.
- Keep at least 30 daily backups and 12 monthly backups.

For a stronger setup, use SQLite's online backup tooling or `VACUUM INTO`
from a controlled local script.

## Shift Operations Monitoring

- The desktop dashboard and shift list warn when an open shift exceeds the
  configured threshold. Change the threshold under **Settings > Data
  Management > Open Shift Warning**; the default is 30 hours.
- Run `npm run audit:operations` from `E:\NexGen\backend` after every migration
  and during scheduled maintenance. The command does not modify business data.
- Treat database quick-check, foreign-key, receivable, accounting, revision,
  or incomplete duplicate-request findings as failures. Investigate stale open
  shifts immediately. Closed shifts created before reconciliation snapshots
  existed may appear as legacy warnings and should be checked during audit.
- Shift readings and collections use revision checks. When two devices edit an
  older copy, the second save must show a conflict instead of silently replacing
  the first save.
- Completed duplicate-request keys are retained for 90 days by default and are
  pruned when the backend starts. Set `IDEMPOTENCY_RETENTION_DAYS` to a value
  from 7 to 3650 when policy requires a different period. This cleanup never
  deletes credits, payments, expenses, readings, or other business records.
- CSV exports are limited to 50,000 shifts. Use a narrower date range for
  larger histories and protect exports as confidential business records.

## Operational Requirements

- Put the station PC on a UPS.
- Use a local SSD, not a network share, for `backend/data/nexgen.db`.
- Disable Windows sleep on the station PC.
- Reserve the station PC LAN IP in the router.
- Keep paper/manual shift book as emergency fallback.
- Restrict who can install tunnel tools or change router/firewall settings.
- Review logs and backup freshness weekly.

For fuel delivery date, pending invoice, and backdated stock handling, follow
`docs/DELIVERY-WORKFLOW.md`.

For flexible wages, effective-dated compensation, shift earnings, payroll,
staff-debt deductions, and shift-linked payroll payments, follow
`docs/EMPLOYEE-COMPENSATION-AND-PAYROLL.md`.

If production stores data outside the repository, set an absolute local path:

```env
NEXGEN_DATA_DIR=E:\NexGen-Data
```

The backend database and protected backup endpoint both use this directory.
Keep it on a local SSD, grant access only to the NexGen service identity and
authorized administrators, and include the complete directory in backup and
restore tests.

## Remaining Hardening Work

- Replace desktop shared-key bypass with proper admin login.
- Stop exposing active employee names publicly for mobile login; use staff
  code/PIN or username/PIN instead.
- Add rate limiting to remaining sensitive endpoints beyond login.
- Add structured audit log entries for login, backup, restore, and config
  changes.
- Add a one-click backup verification/restore test command.
