# NexGen Testing And Deployment Guide

Start here. Follow the steps in order. Do not start with Android or Tailscale;
first prove the backend, database, desktop, and mobile web build are solid.

## How To Read This Guide

Each step now says:

- `Where`: which machine and folder to use.
- `Backend state`: whether the backend should be stopped or running.
- `Terminal`: whether to use the same terminal or open another one.

There are two tracks:

- Local testing on this dev PC: use `D:\NexGen`, run backend manually with
  `npm start`, and stop it with `Ctrl+C`.
- Station deployment: use the station PC folder, usually `E:\NexGen`, install
  the backend as a Windows service, then install the desktop program.

Backend state rules:

| Step | Backend state |
|------|---------------|
| Build commands | Stopped is preferred, but not required |
| Local smoke test | Running manually in Terminal A |
| Functional tests | Running |
| Installing Windows service | Manual backend must be stopped |
| Installing desktop program | Backend service should be running |
| LAN/Tailscale/mobile tests | Backend service should be running |
| Building Android APK | Backend not required |
| Testing Android APK login | Backend must be running |

## 0. Safety Rules

- Do all first tests on a dev PC or staging station PC, not the live station.
- Never force-pull or reset the live station repo.
- Before touching live data, create and verify a backup.
- Keep the station PC as the source of truth for a single station.
- Do not expose port `3001` with router port forwarding.

## 1. Dev PC Build Check

Where: dev PC.

Folder: `D:\NexGen`.

Backend state: stopped is preferred.

Terminal: normal PowerShell or Command Prompt.

Run:

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

Where: dev PC.

Folder: `D:\NexGen`.

Backend state: this step starts the backend manually.

Terminal A: open PowerShell and leave it running.

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

Do not close Terminal A while testing. The backend is running if you see:

```text
NexGen API running on http://127.0.0.1:3001
```

Terminal B: open a second PowerShell or Command Prompt.

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

If you are continuing to the functional tests, keep Terminal A running.

If you are finished with local testing, stop the backend in Terminal A with
`Ctrl+C`.

Temporary test data is in:

```text
D:\NexGen\backend\.test-data
```

## 3. Functional Test Checklist

Where: dev PC or staging station PC.

Backend state: running. If you just finished Step 2, keep Terminal A running.

Browser: use `http://127.0.0.1:3001/mobile` for local testing.

Important: a fresh database has no employees, so seed the first admin before
using the mobile login screen.

Terminal B PowerShell:

```powershell
$DesktopKey = "replace-with-24-plus-random-characters"
$headers = @{ "x-desktop-key" = $DesktopKey }
$body = @{
  name = "Owner Admin"
  daily_wage = 0
  phone = ""
  pin = "1234"
  role = "admin"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3001/api/employees" -Headers $headers -ContentType "application/json" -Body $body
```

Use the same value as `DESKTOP_KEY` from Step 2. If you changed it, update
`$DesktopKey` here.

Then test:

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

For item 19, stop Terminal A with `Ctrl+C`, then start it again:

```powershell
cd D:\NexGen\backend
npm start
```

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

Where: station PC.

Backend state: stopped.

Terminal: PowerShell or Command Prompt on the station PC.

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

Where: station PC.

Backend state: stopped.

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

Where: station PC.

Folder: `E:\NexGen` in these examples. If your station repo is somewhere else,
replace `E:\NexGen` with the real folder.

Backend state: stopped is preferred.

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

Where: station PC.

Folder: `E:\NexGen`.

Backend state: manual backend must be stopped. If you previously ran
`npm start`, stop it with `Ctrl+C` before installing the service. Port `3001`
must be free.

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

Expected:

- Service `NexGenBackend` is installed.
- Service status is `Running`.
- Backend health returns `status: ok`.

If phones cannot connect over LAN/Tailscale, add a Windows Firewall rule from
an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "NexGen Backend 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
```

## 9. Install Desktop App

Where: station PC.

Backend state: backend service should be running.

Folder: no terminal required unless you are launching from PowerShell.

Run the installer:

```text
E:\NexGen\desktop\release\NexGen-ERP-Setup-1.0.0.exe
```

If Windows SmartScreen warns because the installer is unsigned, choose:

```text
More info -> Run anyway
```

Then open NexGen ERP from the Start Menu or desktop shortcut.

Test:

- Dashboard loads.
- Employees page loads.
- Create/update employee works.
- Reports load.

## 10. Test Mobile Web Over LAN

Where: station PC and phone.

Backend state: backend service must be running.

Backend setting: service should have been installed with `-HostAddress 0.0.0.0`.

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

Where: station PC and phone.

Backend state: backend service must be running.

Backend setting: service should have been installed with `-HostAddress 0.0.0.0`.

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

Where: dev PC or station PC with Android Studio installed.

Backend state: not required for building. Backend is required later when you
open the app and log in.

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

### Install Debug APK On Android

Option A: install with USB debugging and Android Platform Tools:

```cmd
adb install -r mobile\android\app\build\outputs\apk\debug\app-debug.apk
```

Option B: copy the APK to the phone and tap it:

1. Copy `app-debug.apk` to the phone by USB, Drive, WhatsApp, or another file
   transfer method.
2. Open the APK on the phone.
3. Allow installation from that source when Android asks.
4. Open `NexGen`.
5. In `Station server`, enter the LAN or Tailscale server address:

```text
http://STATION-PC-IP:3001
http://nexgen-station:3001
http://100.x.y.z:3001
```

6. Save, then log in.

For real distribution, still add:

- App icon and splash branding.
- Release signing keystore.
- Signed APK or AAB build.

## 13. Backup And Recovery Test

Where: station PC.

Backend state: backend service must be running.

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
