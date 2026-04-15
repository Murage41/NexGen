# NexGen ERP — Migration Guide (New Windows 10 PC)

This guide takes a **fresh Windows 10 PC** with nothing installed and gets NexGen fully running,
including all your live data. The setup is simple — one `npm install` and one `npm run dev`.

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

## Step 3 — Install Ngrok (for phone/mobile access)

NexGen uses ngrok to expose the backend to your phone over the internet.

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

## Step 6 — Migrate the Database (Your Live Data)

The database is **not** in the git repo. You must copy it manually from the old PC.

### On the OLD PC — locate the database:
```
D:\NexGen\backend\data\nexgen.db
```

### Copy it to the NEW PC:
Transfer via USB drive or over the local network, then place it at:
```
C:\NexGen\backend\data\nexgen.db
```

If the `data` folder doesn't exist yet, create it first:
```cmd
mkdir C:\NexGen\backend\data
```

Then paste `nexgen.db` into it.

### If starting fresh (no data to migrate):
```cmd
cd C:\NexGen\backend
npx knex migrate:latest --knexfile src/knexfile.ts
```

---

## Step 7 — Run the Application

From the root directory, one command starts everything (backend + desktop + mobile + ngrok):

```cmd
cd C:\NexGen
npm run dev
```

You will see four colour-coded outputs in the same terminal:
- **BACKEND** — API server on port 3001
- **DESKTOP** — Electron app opens automatically
- **MOBILE** — Web app on port 5174
- **NGROK** — Public tunnel for phone access

The mobile app is accessible on any phone at:
```
https://voluble-octavia-intrepid.ngrok-free.dev
```

---

## Step 8 — Run on Startup (Optional)

To have NexGen start automatically when Windows boots, create a shortcut to a batch file.

### 8.1 Create the startup script

Create the file `C:\NexGen\start-nexgen.bat`:
```bat
@echo off
cd /d C:\NexGen
npm run dev
```

### 8.2 Add it to Windows Startup

Press `Win + R`, type:
```
shell:startup
```

Copy a **shortcut** to `start-nexgen.bat` into that folder. NexGen will now launch on every login.

---

## Verify Everything Works

After `npm run dev`:

1. The Electron desktop window should open automatically
2. Log in and check the **Dashboard** — sales, MTD figures should appear
3. On your phone, open `https://voluble-octavia-intrepid.ngrok-free.dev` and log in

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm install` fails with node-gyp error | Reinstall Node.js and ensure C++ build tools are included |
| Desktop app doesn't open | Check the BACKEND output — it must say "running on port 3001" first |
| Phone can't reach the app | Check NGROK output for errors; re-run `ngrok config add-authtoken` |
| Database is empty after migration | Confirm file is at `C:\NexGen\backend\data\nexgen.db` (not just `C:\NexGen\nexgen.db`) |
| `concurrently` not found | Run `npm install` again from `C:\NexGen` |
| Port 3001 already in use | Check Task Manager for any leftover node.exe processes and end them |
