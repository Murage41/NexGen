# Station PC

How NexGen runs at the station, how it is backed up and updated, and the
station profile.

## How it runs

- The station PC (Windows, `E:\NexGen`) holds the only live database,
  `backend\data\nexgen.db`, on its local disk.
- `npm run station:bg` starts the backend, the desktop screens (built files
  at `http://localhost:5173`, reachable from this PC only) and the ngrok link
  for phones. Once Cloudflare is set up (below), Windows runs the link itself
  and NexGen stops starting ngrok. The phone app is served by the backend at `/mobile`.
  `npm run dev:status` shows what is running; `npm run dev:stop` stops it.
- A Windows task (`npm run startup:install`) starts it when the Windows user
  signs in.
- `backend\.env` holds the station's own secret keys (`SESSION_SECRET`,
  `DESKTOP_KEY`); `desktop\.env` holds the same desktop key as
  `VITE_DESKTOP_KEY`. They never go to GitHub. Without them NexGen falls back
  to test keys that are in the public code, so a new station PC needs them
  before ngrok is started. Changing them signs everyone out once, and the
  desktop screens must be built again (`npm run build:desktop`) because the
  desktop key is built into them.
- POSitive stays the fiscal (eTIMS) system. NexGen documents are not tax
  invoices.
- Keep the PC on a UPS, with sleep off, and keep the paper shift book as a
  fallback.

## Desktop app

- The desktop screens open as their own NexGen window. Install once, in
  Microsoft Edge on the station PC: open `http://localhost:5173`, then
  **Settings and more (…) → Apps → Install this site as an app**, tick
  **Pin to taskbar** / **Pin to Start**, and in `edge://apps` choose **More
  options → Auto-start on device login**.
- It only works on this PC. Away from the station, use the phone app (it
  installs on a laptop the same way) until named desktop logins exist.
- If the window opens before NexGen has started, wait a moment and press F5.

## Phone app

- Open the phone link once. On Android, Chrome offers **Install app** (or use
  **More → Install NexGen**); on iPhone, Safari **Share → Add to Home
  Screen**. NexGen then opens from its own icon, full screen.
- The phone keeps only the app's own files (screens, styles, icons), so it
  opens quickly. Every figure comes live from the station; nothing financial is
  kept on the phone. Typed shift entries stay on the phone until saved, as
  before.
- After a station update, the phone gets the new screens the next time NexGen
  is opened. Nothing to reinstall.
- If the phone, the link or the station PC is down, the app still opens and
  shows **Can't reach the station** at the top; nothing can be saved until it
  connects. **Try again** reloads.

## Remote link (Cloudflare)

Phones reach the station through ngrok until this is set up once. Afterwards
phones use the company address, only people on the sign-in list get in, and
NexGen's PIN login still applies on top. Cloudflare's free plan covers up to
50 people.

1. Buy the company domain and add it to a free Cloudflare account. Cloudflare
   shows two name servers to set at the domain seller.
2. In Cloudflare Zero Trust, add a self-hosted Access application for
   `station.<domain>`. Session duration: 1 month. Policy: Allow, including
   the email of each person who may use the phone app. They sign in with a
   code emailed to them (one-time PIN, valid 10 minutes). Everyone else is
   refused.
3. Only after step 2, create a tunnel (Cloudflared, Windows). Run the command
   it shows in Command Prompt opened as administrator; it installs the
   connector as a Windows service that starts with Windows. The command holds
   a secret token: never paste it in a chat or a file. Add the public
   hostname `station.<domain>` → HTTP → `localhost:3001`.
4. Restart NexGen (`npm run dev:stop`, then `npm run station:bg`). It sees the
   service and stops starting ngrok; `npm run dev:status` shows
   "Remote link: Cloudflare" and the service as Running.
5. On each phone, open `https://station.<domain>/mobile/`, enter the emailed
   code, install NexGen from the new address and remove the old icon.

- When the sign-in runs out (after a month), opening NexGen shows
  Cloudflare's sign-in page; enter the new code and NexGen opens again.
- When someone leaves, remove their email from the policy and end their
  session in Zero Trust.
- Way back: in Command Prompt as administrator run
  `cloudflared.exe service uninstall`, then restart NexGen; ngrok comes back.

## Backups

- **Settings → System → Back up now**, or `npm run backup:database -w backend`,
  makes a checked, standalone copy in `backend\data\backups`. It includes the
  saved invoice PDFs; supplier PDFs are copied beside it.
- Every station update makes a backup before any migration.
- Keep copies off the PC too (external drive or cloud), and test a restore
  now and then.
- To copy station data to the development PC, copy a finished backup, not the
  running database file on its own.

## Updates

The station never `git pull`s. Each update is a fast-forward to one pinned
commit, given by the developer as a Command Prompt block with its own checks.
The order is always: stop NexGen, fetch, fast-forward, back up, install (only
if packages changed), build the phone app, start, check. The full rule is in
`docs/ENGINEERING-STANDARDS.md` §7.

## Checks

```bat
cd /d E:\NexGen\backend
npm run audit:operations
npm run audit:receivables
```

Both read only. Run them after any update with a migration. Any finding is
investigated before carrying on. `audit:operations` (and **Settings → System
check**) also compares stored figures with their records: each dip's book
stock, each customer debt, supplier bill and delivery's fuel left. The Today
page shows a red line when one disagrees.

## Station profile and logo

**Settings → Station profile** (desktop): station name (required for
documents), business name, location, address, phone, email, KRA PIN, VAT
number, M-Pesa and bank payment details, and a note printed on every
document. A document keeps the profile as it was when issued.

The NexGen logo is built in; **Upload a logo** (PNG or JPEG, under 2 MB)
replaces it, and **Use the NexGen logo** switches back.

## Open-shift warning

The Today page and shift list warn when a shift has been open longer than
**Settings → System** (30 hours by default).
