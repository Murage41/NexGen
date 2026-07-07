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

## No-Skip Golden Path

Use this as the master order. The detailed sections below explain each item.

1. On dev PC, open Terminal 1 in `D:\NexGen`.
2. Run `git status --short`; it should print nothing or only ignored/test files.
3. Run `npm install`.
4. Run `npm run build:backend`.
5. Run `npm run build:mobile`.
6. Run `npm run build:desktop`.
7. Run `npm run android:sync`.
8. In Terminal 1, start the backend manually with the Step 2 PowerShell commands.
9. Leave Terminal 1 open.
10. Open Terminal 2 in `D:\NexGen`.
11. Run `Invoke-RestMethod http://127.0.0.1:3001/api/health`.
12. Open `http://127.0.0.1:3001/mobile` in a browser.
13. In Terminal 2, create the first admin using the Step 3 command.
14. Copy the returned `login_username`.
15. In the browser, log in by selecting the admin employee name and PIN.
16. Log out.
17. Log in again using staff code/username and PIN.
18. Complete one full shift workflow.
19. Create a backup using the Step 13 command.
20. Verify the backup using `npm run backup:verify -- <backup-file>`.
21. Stop the manual backend in Terminal 1 with `Ctrl+C`.
22. Restart the manual backend with `npm start`.
23. Confirm the data still appears.
24. Only after local testing passes, move to station PC deployment.
25. On the station PC, build backend/mobile/desktop.
26. Stop any manually running backend.
27. Install backend as a Windows service.
28. Confirm `npm run service:status` returns health `ok`.
29. Run the desktop installer.
30. Test desktop app.
31. Test mobile over LAN.
32. Test mobile over Tailscale.
33. Build Android APK on a machine with Android Studio/JDK.
34. Install APK on phone.
35. Enter the station server URL in the app.
36. Log in and test shift/admin workflows.
37. Do backup and restore rehearsal before live cutover.

## If Backend Is Running Or Stopped

Check whether port `3001` is already in use:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue
```

If you see a row, something is listening on `3001`.

If the backend is running manually in a terminal:

```text
Press Ctrl+C in that terminal.
```

If the backend is running as a service:

```cmd
npm run service:status
```

Stop the service only when you intentionally need it stopped:

```powershell
Stop-Service NexGenBackend
```

Start it again:

```powershell
Start-Service NexGenBackend
```

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

Do not try to use the mobile login before this command succeeds.

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

Expected response includes:

```text
data.id
data.name
data.role
data.login_username
```

Write down:

```text
PIN: 1234
login_username: value returned by the command
```

Then test in the browser:

1. Open `http://127.0.0.1:3001/mobile`.
2. Select the admin employee name.
3. Enter PIN `1234`.
4. Confirm Dashboard loads.
5. Log out.
6. Choose `Staff code`.
7. Enter the returned `login_username`.
8. Enter PIN `1234`.
9. Confirm Dashboard loads again.
10. Add tanks.
11. Add pumps and assign them to tanks.
12. Add fuel prices.
13. Open a shift.
14. Enter pump readings.
15. Enter collections: cash, M-Pesa, credits if applicable.
16. Add a shift expense.
17. Add a customer credit.
18. Close the shift as admin.
19. Check dashboard totals.
20. Check daily report.
21. Check stock/tank ledger.
22. Trigger a backup using Step 13.
23. Verify the backup using Step 13.
24. Stop and restart backend.
25. Confirm all data remains.

Detailed business-data entries for a quick staging test:

```text
Tank: Petrol Main, petrol, 10000 litres
Tank: Diesel Main, diesel, 10000 litres
Pump: P1, nozzle N1, petrol, Petrol Main
Pump: D1, nozzle N1, diesel, Diesel Main
Fuel price: petrol 200
Fuel price: diesel 180
Test shift opening litres: 1000
Test shift closing litres: 1010
Expected petrol litres sold: 10
```

If the UI requires opening amount/closing amount, use values that match the
same sale:

```text
Opening amount: 200000
Closing amount: 202000
Expected amount sold: 2000
```

Old short checklist, kept for review:

1. Confirm the employee response shows `login_username`.
2. Log in on mobile by selecting employee name and PIN.
3. Log in on mobile by staff code/username and PIN.
4. Add tanks.
5. Add pumps and assign them to tanks.
6. Add fuel prices.
7. Open a shift.
8. Enter pump readings.
9. Enter collections: cash, M-Pesa, credits if applicable.
10. Add a shift expense.
11. Add a customer credit.
12. Close the shift as admin.
13. Check dashboard totals.
14. Check daily report.
15. Check stock/tank ledger.
16. Trigger a backup.
17. Verify the backup.
18. Stop and restart backend.
19. Confirm all data remains.

For item 24, stop Terminal A with `Ctrl+C`, then start it again:

```powershell
cd D:\NexGen\backend
npm start
```

Then refresh the browser page and log in again.

Backup verification is detailed in Step 13. For a quick local verification,
use:

```cmd
npm run backup:verify -- D:\NexGen\backend\.test-data\backups\BACKUP-FILE-NAME.db
```

## 4. Role And Security Tests

Where: dev PC or staging station PC.

Backend state: running.

Browser: `http://127.0.0.1:3001/mobile` for local testing.

Test these before station rollout:

- Wrong PIN returns login failed.
- Repeated wrong PINs trigger temporary lockout.
- Admin can view reports and settings.
- Employee can access only the allowed shift/mobile views.
- Employee cannot call admin-only endpoints.
- Backup endpoint requires admin auth.
- `audit_logs` records login and backup events.

To test wrong PIN:

1. Open the login screen.
2. Select the admin employee.
3. Enter an incorrect PIN such as `1111`.
4. Confirm login fails.
5. Enter the correct PIN `1234`.
6. Confirm login succeeds unless lockout has been triggered.

To inspect audit logs directly in the staging database, use a SQLite browser or
run a small read-only query later. Do not edit audit rows.

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

Confirm tools:

```cmd
git --version
node --version
npm --version
nssm version
```

If `nssm version` fails, install NSSM or pass the full `nssm.exe` path later
with `-NssmPath`.

Clone or update the repo:

```cmd
cd /d E:\
git clone https://github.com/Murage41/NexGen.git
cd NexGen
git switch codex/production-readiness
npm install
```

If the repo already exists:

```cmd
cd /d E:\NexGen
git status --short
git switch codex/production-readiness
git pull --ff-only
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

Generate strong values in PowerShell:

```powershell
$SessionSecret = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$DesktopKey = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$SessionSecret
$DesktopKey
```

Copy these values somewhere secure for this installation. Do not commit them.

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

Confirm the installer exists:

```powershell
Test-Path "E:\NexGen\desktop\release\NexGen-ERP-Setup-1.0.0.exe"
```

Expected:

```text
True
```

## 8. Install Backend As Windows Service

Where: station PC.

Folder: `E:\NexGen`.

Backend state: manual backend must be stopped. If you previously ran
`npm start`, stop it with `Ctrl+C` before installing the service. Port `3001`
must be free.

Check port first:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue
```

If it returns a row, stop the manual backend or old service before continuing.

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

If NSSM is not in PATH:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Install-NexGenBackendService.ps1 -NssmPath "C:\path\to\nssm.exe" -HostAddress 0.0.0.0 -SessionSecret $SessionSecret -DesktopKey $DesktopKey -Start
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

Option A: File Explorer.

1. Open File Explorer.
2. Go to `E:\NexGen\desktop\release`.
3. Double-click `NexGen-ERP-Setup-1.0.0.exe`.
4. If Windows SmartScreen appears, choose `More info`.
5. Choose `Run anyway`.
6. Choose install location if prompted.
7. Finish installation.
8. Launch `NexGen ERP` from the desktop shortcut or Start Menu.

Option B: PowerShell:

```powershell
Start-Process "E:\NexGen\desktop\release\NexGen-ERP-Setup-1.0.0.exe"
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

Look for the active Wi-Fi or Ethernet IPv4 address, for example:

```text
192.168.1.50
```

On a phone connected to the same Wi-Fi, open:

```text
http://STATION-PC-IP:3001/mobile
```

Example:

```text
http://192.168.1.50:3001/mobile
```

Test employee login and admin login.

If it fails:

1. Confirm `npm run service:status` works on the station PC.
2. Confirm the phone is on the same Wi-Fi.
3. Confirm Windows Firewall allows port `3001`.
4. Confirm backend service was installed with `-HostAddress 0.0.0.0`.

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
3. Confirm the station PC appears in Tailscale.
4. Turn off Wi-Fi to test from mobile data.
5. Open the mobile URL or Android app.
6. In the app's `Station server` field, enter:

```text
http://nexgen-station:3001
```

or:

```text
http://100.x.y.z:3001
```

7. Tap `Save`.
8. Log in by staff code or employee name.

If MagicDNS fails, use the `100.x.y.z` Tailnet IP.

## 12. Build Android APK

Where: dev PC or station PC with Android Studio installed.

Backend state: not required for building. Backend is required later when you
open the app and log in.

Install Android Studio and set `JAVA_HOME` first.

Confirm Java:

```cmd
java -version
```

If that fails, fix Java/JDK before continuing.

Then build:

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

Confirm it exists:

```powershell
Test-Path "E:\NexGen\mobile\android\app\build\outputs\apk\debug\app-debug.apk"
```

### Install Debug APK On Android

Option A: install with USB debugging and Android Platform Tools:

1. Enable Developer Options on the phone.
2. Enable USB Debugging.
3. Connect phone by USB.
4. Run:

```cmd
adb devices
adb install -r E:\NexGen\mobile\android\app\build\outputs\apk\debug\app-debug.apk
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

6. Tap `Save`.
7. Log in.

For real distribution, still add:

- App icon and splash branding.
- Release signing keystore.
- Signed APK or AAB build.

## 13. Backup And Recovery Test

Where: station PC or local staging PC.

Backend state: backend must be running.

### Local Manual Backend

Use this if you are still testing with `npm start` and `.test-data`.

```powershell
$loginBody = @{
  username = "owner.admin"
  pin = "1234"
} | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3001/api/auth/login" -ContentType "application/json" -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.token)" }
$backup = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3001/api/health/backup" -Headers $headers
$backup
```

Replace `owner.admin` with the actual `login_username` returned when you created
the admin.

Verify local test backup:

```powershell
$backupPath = "D:\NexGen\backend\.test-data\backups\$($backup.file)"
cd D:\NexGen
npm run backup:verify -- $backupPath
```

### Station Service Backend

Use this when the backend is installed as a service.

```powershell
$loginBody = @{
  username = "owner.admin"
  pin = "1234"
} | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3001/api/auth/login" -ContentType "application/json" -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.token)" }
$backup = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3001/api/health/backup" -Headers $headers
$backup
```

Backup folder:

```text
C:\ProgramData\NexGen\data\backups
```

Verify station backup:

```powershell
$backupPath = "C:\ProgramData\NexGen\data\backups\$($backup.file)"
cd E:\NexGen
npm run backup:verify -- $backupPath
```

Expected verifier output:

```text
"ok": true
"integrity_check": "ok"
```

Do one restore rehearsal on a different machine before live use.

## 14. Live Cutover Checklist

Where: station PC and phones.

Backend state: backend service running.

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

Reboot test:

1. Restart Windows.
2. Wait for login.
3. Run `npm run service:status`.
4. Open desktop app.
5. Open mobile URL from a phone.
6. Confirm both work before live use.

## 15. Update Procedure After Future Changes

Where: station PC.

Backend state: service can be running while pulling/building, but restart after
backend changes if needed.

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

If backend code changed, restart the service:

```powershell
Restart-Service NexGenBackend
npm run service:status
```

If `git pull --ff-only` fails, stop and review local changes. Do not force-pull
the live station.
