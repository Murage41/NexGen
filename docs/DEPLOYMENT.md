# NexGen Deployment, Hosting, and Access

This is the recommended production shape for a single filling station ERP.
The goal is simple: the station keeps working even if the internet is down,
remote access is deliberate, and the SQLite database is treated as the
business record rather than a disposable dev file.

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

Ngrok is now opt-in with:

```cmd
npm run dev:tunnel
```

Use it for development, demos, or emergency temporary access. Do not leave an
unauthenticated public ngrok URL as the normal production entry point.

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

## Build And Run

Build mobile first so the backend can serve it:

```cmd
cd D:\NexGen\mobile
npm run build
```

Build backend:

```cmd
cd D:\NexGen\backend
npm run build
```

Run backend:

```cmd
cd D:\NexGen\backend
npm start
```

For production, run the backend as a Windows service using NSSM, PM2, or
Task Scheduler. A service is better than a logged-in terminal window.

## Current Background Startup

For the current development/migration phase, the repo includes Windows helper
scripts that run the full dev stack in the background:

```cmd
npm run dev:bg
npm run dev:status
npm run dev:stop
```

Startup at user login is handled by a Windows Scheduled Task:

```cmd
npm run startup:install
npm run startup:uninstall
```

The installed task is named `NexGen ERP Dev Stack`. It starts the backend,
desktop Vite server, mobile Vite server, and ngrok tunnel after the Windows
user logs in. Install it while signed in as the Windows user that will run
NexGen on the station PC. It does not run before login.

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

## Operational Requirements

- Put the station PC on a UPS.
- Use a local SSD, not a network share, for `backend/data/nexgen.db`.
- Disable Windows sleep on the station PC.
- Reserve the station PC LAN IP in the router.
- Keep paper/manual shift book as emergency fallback.
- Restrict who can install tunnel tools or change router/firewall settings.
- Review logs and backup freshness weekly.

## Remaining Hardening Work

- Replace desktop shared-key bypass with proper admin login.
- Stop exposing active employee names publicly for mobile login; use staff
  code/PIN or username/PIN instead.
- Add rate limiting to remaining sensitive endpoints beyond login.
- Add structured audit log entries for login, backup, restore, and config
  changes.
- Add a one-click backup verification/restore test command.
