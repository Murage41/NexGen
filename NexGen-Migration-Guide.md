# NexGen ERP — Migration Guide (New Windows 10 PC)

> Production note: this guide was originally written for a development-style
> PC move. For live deployment, use `docs/DEPLOYMENT.md`. Ngrok is no longer
> started by default; use `npm run dev:tunnel` only for temporary dev/demo
> access.

This guide takes a **fresh Windows 10 PC** with nothing installed and gets NexGen fully running.
The new PC starts with a fresh database; the old development database is not migrated.

---

## Step 1 — Install Git

1. Download from: https://git-scm.com/download/win
2. Run the installer, accept all defaults.
3. Open **Command Prompt** and verify:
   ```cmd
   git --version
   ```

---

## Step 2 — Install Node.js (v20 LTS)

1. Download from: https://nodejs.org/en/download
2. Run the installer, accept all defaults. (This also installs npm.)
3. Verify:
   ```cmd
   node --version
   npm --version
   ```

---

## Step 3 — Install Ngrok (optional temporary phone/mobile access)

Ngrok is only needed for temporary development/demo tunnel access. For live
station use, prefer LAN, Tailscale, or Cloudflare Tunnel.

1. Download from: https://ngrok.com/download (Windows 64-bit)
2. Extract `ngrok.exe` anywhere, e.g. `C:\ngrok\ngrok.exe`
3. Add it to your PATH:
   - Open **Start** → search "Environment Variables"
   - Under **System Variables**, click **Path** → **Edit** → **New**
   - Add: `C:\ngrok`
   - Click OK on all dialogs
4. Set up your ngrok account (free):
   - Sign in at https://ngrok.com
   - Copy your auth token from the dashboard
   - Run:
     ```cmd
     ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
     ```
5. Verify:
   ```cmd
   ngrok version
   ```

> **Note:** The ngrok domain `voluble-octavia-intrepid.ngrok-free.dev` is tied to the ngrok account.
> Make sure you're using the same ngrok account on the new PC, or the mobile URL will be different.

---

## Step 4 — Clone the Repository

```cmd
cd C:\
git clone https://github.com/Murage41/NexGen.git
cd NexGen
```

---

## Step 5 — Install All Dependencies

Run this once from the root directory. It installs everything for backend, desktop, and mobile:

```cmd
cd C:\NexGen
npm install
```

> This may take 3–5 minutes. Wait until the prompt returns.

---

## Optional — Capture New PC Specs

After cloning and installing dependencies, run this on the new PC and send the
output back for review:

```cmd
cd C:\NexGen
npm run machine:spec > C:\NexGen\nexgen-machine-spec.json
```

If you want to check the PC before cloning the repo, run this PowerShell
command instead:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_ComputerSystem,Win32_OperatingSystem,Win32_Processor | Select-Object *; Get-CimInstance Win32_LogicalDisk | Where-Object DriveType -eq 3 | Select-Object DeviceID,Size,FreeSpace; node --version; npm --version; git --version; ngrok version"
```

---

## Step 6 — Create a Fresh Database

The database is **not** in the git repo. For this migration, do not copy the old
development database. NexGen will create a fresh SQLite database and run all
migrations on the new PC.

Create the data folder and run migrations:

```cmd
mkdir C:\NexGen\backend\data
cd C:\NexGen\backend
npx knex migrate:latest --knexfile src/knexfile.ts
```

After migration, enter the production opening setup from the physical station:

- employees and PINs
- tanks and pumps
- pump opening display readings
- physical tank stock from dip readings
- current fuel prices
- only unpaid credit balances
- only unpaid supplier balances

---

## Step 7 — Run the Application

From the root directory, one command starts the development stack (backend + desktop + mobile):

```cmd
cd C:\NexGen
npm run dev
```

You will see three colour-coded outputs in the same terminal:
- **BACKEND** — API server on port 3001
- **DESKTOP** — Electron app opens automatically
- **MOBILE** — Web app on port 5174
- **NGROK/TUNNEL** — only when started separately with `npm run dev:tunnel`

For temporary tunnel access, start:
```cmd
npm run dev:tunnel
```

Then use the tunnel URL shown by ngrok. For production mobile access, use the
LAN, Tailscale, or Cloudflare Tunnel guidance in `docs/DEPLOYMENT.md`.

The old development tunnel was:
```
https://voluble-octavia-intrepid.ngrok-free.dev
```

---

## Step 8 - Run on Login

Install the startup task while signed in as the Windows user who will operate
NexGen on the new PC. The task is user-specific, so if the new PC uses a user
like `Station`, `Admin`, or `Owner`, log in as that user before running this
step.

This starts NexGen in the background when that user logs in. It also starts
the ngrok tunnel because the installer uses `-WithTunnel`.

```cmd
cd C:\NexGen
npm run startup:install
```

Start it immediately without waiting for the next login:

```cmd
npm run dev:bg
```

Check whether backend, mobile, desktop dev server, and ngrok are running:

```cmd
npm run dev:status
```

Stop the background stack:

```cmd
npm run dev:stop
```

Remove the startup task:

```cmd
npm run startup:uninstall
```

The scheduled task is named `NexGen ERP Dev Stack`. It runs on user login, not
before login. If you later change the Windows user that operates the station,
run `npm run startup:install` again while logged in as the new user.

---

## Verify Everything Works

After `npm run dev`, or after background startup:

1. Run `npm run dev:status` and confirm backend health is `ok`
2. Open the desktop app/dev page and check the **Dashboard**
3. On your phone, use the LAN/mobile URL from `docs/DEPLOYMENT.md`, or the ngrok URL reported by `npm run dev:status`

---

## Pull Future ERP Updates

The live database is ignored by Git, so normal code updates should not overwrite
station data.

When you push new ERP changes from the development PC, update the station PC
like this:

```cmd
cd C:\NexGen
npm run dev:stop
git pull --ff-only
npm install
npm run dev:bg
npm run dev:status
```

If `git pull --ff-only` fails, do not force it. It means the station PC has
local code changes that need review first.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm install` fails with node-gyp error | Reinstall Node.js and ensure C++ build tools are included |
| Desktop app doesn't open | Check the BACKEND output — it must say "running on port 3001" first |
| Phone can't reach the app | Confirm the station PC IP/port, Wi-Fi network, firewall, or tunnel status |
| Database is empty after migration | Confirm file is at `C:\NexGen\backend\data\nexgen.db` (not just `C:\NexGen\nexgen.db`) |
| `concurrently` not found | Run `npm install` again from `C:\NexGen` |
| Port 3001 already in use | Check Task Manager for any leftover node.exe processes and end them |
