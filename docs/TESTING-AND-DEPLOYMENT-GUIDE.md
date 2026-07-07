# NexGen Testing And Deployment Guide

Start here. Follow the steps in order. Do not start with Android or Tailscale;
first prove the backend, database, desktop, and mobile web build are solid.

## 0. Safety Rules

- Do all first tests on a dev PC or staging station PC, not the live station.
- Never force-pull or reset the live station repo.
- Before touching live data, create and verify a backup.
- Keep the station PC as the source of truth for a single station.
- Do not expose port `3001` with router port forwarding.

## 1. Dev PC Build Check

Run this on the development machine:

```cmd
cd /d D:\NexGen
git status --short
npm install
npm run build:backend
npm run build:mobile
npm run build:desktop
npm run android:sync
```

Expected results:

- Backend TypeScript build passes.
- Mobile Vite build passes.
- Desktop installer is created at `desktop\release\NexGen-ERP-Setup-1.0.0.exe`.
- Android Capacitor sync completes.

Known note: full APK build needs Java/JDK plus Android Studio/SDK. If those are
not installed, `gradlew.bat assembleDebug` will fail with a `JAVA_HOME` error.

## 2. Local Production Smoke Test

This proves the compiled backend can run like a service without using the live
database.

Open PowerShell:

```powershell
cd D:\NexGen
$env:NODE_ENV = "production"
$env:HOST = "127.0.0.1"
$env:PORT = "3001"
$env:NEXGEN_DATA_DIR = "D:\NexGen\backend\.test-data"
$env:SESSION_SECRET = "replace-with-32-plus-random-characters"
$env:DESKTOP_KEY = "replace-with-24-plus-random-characters"
cd backend
npm start
```

In another terminal:

```cmd
curl.exe http://127.0.0.1:3001/api/health
```

Or in PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

Expected:

```json
{"status":"ok"}
```

Then open:

```text
http://127.0.0.1:3001/mobile
```

After testing, stop the backend with `Ctrl+C`. The temporary test data is in:

```text
D:\NexGen\backend\.test-data
```

## 3. Functional Test Checklist

Use a fresh staging database.

1. Create the first admin employee.
2. Confirm the employee response shows `login_username`.
3. Log in on mobile by selecting employee name and PIN.
4. Log in on mobile by staff code/username and PIN.
5. Add tanks.
6. Add pumps and assign them to tanks.
7. Add fuel prices.
8. Open a shift.
9. Enter pump readings.
10. Enter collections: cash, M-Pesa, credits if applicable.
11. Add a shift expense.
12. Add a customer credit.
13. Close the shift as admin.
14. Check dashboard totals.
15. Check daily report.
16. Check stock/tank ledger.
17. Trigger a backup.
18. Verify the backup.
19. Stop and restart backend.
20. Confirm all data remains.

Backup verification:

```cmd
npm run backup:verify -- C:\path\to\nexgen-backup.db
```

## 4. Role And Security Tests

Test these before station rollout:

- Wrong PIN returns login failed.
- Repeated wrong PINs trigger temporary lockout.
- Admin can view reports and settings.
- Employee can access only the allowed shift/mobile views.
- Employee cannot call admin-only endpoints.
- Backup endpoint requires admin auth.
- `audit_logs` records login and backup events.

## 5. Station PC Preparation

On the station PC:

1. Install Git.
2. Install Node.js LTS.
3. Install NSSM for the backend Windows service.
4. Optional but recommended: install Tailscale.
5. Disable Windows sleep.
6. Put the PC on a UPS.
7. Reserve the station PC IP in the router if using LAN access.

Clone or update the repo:

```cmd
cd /d E:\
git clone https://github.com/Murage41/NexGen.git
cd NexGen
git switch codex/production-readiness
npm install
```

If this work has already been merged to `main`, use:

```cmd
git switch main
git pull --ff-only
```

## 6. Production Secrets

The desktop production build still uses `VITE_DESKTOP_KEY`, so the desktop key
must match the backend `DESKTOP_KEY`.

Pick strong values before building:

```powershell
$SessionSecret = "replace-with-32-plus-random-characters"
$DesktopKey = "replace-with-24-plus-random-characters"
```

For a desktop-only station, backend can listen on localhost:

```text
HOST=127.0.0.1
```

For LAN or Tailscale phone access, backend must listen on all local interfaces:

```text
HOST=0.0.0.0
```

## 7. Build For Station Deployment

Build mobile and backend:

```cmd
cd /d E:\NexGen
npm run build:mobile
npm run build:backend
```

Build desktop with the same desktop key:

```powershell
cd E:\NexGen
$env:VITE_DESKTOP_KEY = $DesktopKey
npm run build:desktop
```

Installer output:

```text
E:\NexGen\desktop\release\NexGen-ERP-Setup-1.0.0.exe
```

## 8. Install Backend As Windows Service

For desktop-only testing:

```powershell
cd E:\NexGen
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Install-NexGenBackendService.ps1 -SessionSecret $SessionSecret -DesktopKey $DesktopKey -Start
```

For LAN or Tailscale mobile access:

```powershell
cd E:\NexGen
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Install-NexGenBackendService.ps1 -HostAddress 0.0.0.0 -SessionSecret $SessionSecret -DesktopKey $DesktopKey -Start
```

Check status:

```cmd
npm run service:status
```

If phones cannot connect over LAN/Tailscale, add a Windows Firewall rule from
an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "NexGen Backend 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
```

## 9. Install Desktop App

Run:

```text
E:\NexGen\desktop\release\NexGen-ERP-Setup-1.0.0.exe
```

Then open NexGen ERP from the Start Menu or desktop shortcut.

Test:

- Dashboard loads.
- Employees page loads.
- Create/update employee works.
- Reports load.

## 10. Test Mobile Web Over LAN

Find the station PC IP:

```cmd
ipconfig
```

On a phone connected to the same Wi-Fi, open:

```text
http://STATION-PC-IP:3001/mobile
```

Test employee login and admin login.

## 11. Test Tailscale Access

On the station PC:

```cmd
cd /d E:\NexGen
npm run tailscale:status
```

Use the printed MagicDNS or Tailnet IP URL:

```text
http://nexgen-station:3001/mobile
http://100.x.y.z:3001/mobile
```

On Android:

1. Install Tailscale.
2. Sign in and approve the device.
3. Turn off Wi-Fi to test from mobile data.
4. Open the mobile URL or Android app.
5. In the app's `Station server` field, enter:

```text
http://nexgen-station:3001
```

or:

```text
http://100.x.y.z:3001
```

Save, then log in.

## 12. Build Android APK

Install Android Studio and set `JAVA_HOME` first.

Then:

```cmd
cd /d E:\NexGen
npm run android:sync
cd mobile\android
gradlew.bat assembleDebug
```

Debug APK output:

```text
mobile\android\app\build\outputs\apk\debug\app-debug.apk
```

For real distribution, still add:

- App icon and splash branding.
- Release signing keystore.
- Signed APK or AAB build.

## 13. Backup And Recovery Test

Trigger a backup from an authenticated admin session or API client:

```text
POST /api/health/backup
```

Backup folder:

```text
C:\ProgramData\NexGen\data\backups
```

Verify:

```cmd
npm run backup:verify -- C:\ProgramData\NexGen\data\backups\nexgen-YYYYMMDDHHMMSS.db
```

Do one restore rehearsal on a different machine before live use.

## 14. Live Cutover Checklist

Before using NexGen as the live station record:

- Backend service starts automatically.
- Desktop app opens after reboot.
- Mobile web works over LAN or Tailscale.
- Android APK connects to station server.
- Admin and employee logins work.
- Shift workflow has been tested end to end.
- Backup creates successfully.
- Backup verification passes.
- Station PC sleep is disabled.
- UPS is connected.
- No router port forwarding to `3001`.
- Tailscale old/lost devices removed.
- Paper/manual shift book is ready as fallback.

## 15. Update Procedure After Future Changes

On station PC:

```cmd
cd /d E:\NexGen
npm run service:status
git status --short
git pull --ff-only
npm install
npm run build:mobile
npm run build:backend
npm run build:desktop
npm run android:sync
npm run service:status
```

If `git pull --ff-only` fails, stop and review local changes. Do not force-pull
the live station.
