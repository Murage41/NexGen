# Station PC

How NexGen runs at the station, how it is backed up and updated, and the
station profile.

## How it runs

- The station PC (Windows, `E:\NexGen`) holds the only live database,
  `backend\data\nexgen.db`, on its local disk.
- `npm run station:bg` starts the backend, the desktop screens and the ngrok
  link for phones. The phone app is served by the backend at `/mobile`.
  `npm run dev:status` shows what is running; `npm run dev:stop` stops it.
- A Windows task (`npm run startup:install`) starts it when the Windows user
  signs in.
- POSitive stays the fiscal (eTIMS) system. NexGen documents are not tax
  invoices.
- Keep the PC on a UPS, with sleep off, and keep the paper shift book as a
  fallback.

## Backups

- **Settings → Create Backup**, or `npm run backup:database -w backend`,
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
investigated before carrying on.

## Station profile and logo

**Settings → Station profile** (desktop): station name (required for
documents), business name, location, address, phone, email, KRA PIN, VAT
number, M-Pesa and bank payment details, and a note printed on every
document. A document keeps the profile as it was when issued.

The NexGen logo is built in; **Upload a logo** (PNG or JPEG, under 2 MB)
replaces it, and **Use the NexGen logo** switches back.

## Open-shift warning

The dashboard and shift list warn when a shift has been open longer than
**Settings → Data Management → Open Shift Warning** (30 hours by default).
