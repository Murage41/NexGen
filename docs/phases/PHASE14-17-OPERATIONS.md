# Phase 14–17 — Operations guide

Small-scope wrap-up for the production-readiness debug sweep. Items that
did not warrant full migrations or code changes are captured here as
runbooks.

## Phase 14 — Performance

**Current state.** Single-station SQLite, ~28 closed shifts, ~30 deliveries,
~50 credits, ~10 accounts as of 2026-04-16. Every dashboard / report load
completes in < 300ms on the current hardware. No query needs tuning yet.

**What shipped.** Migration 021 adds hot-path indexes on the tables that
would feel it first as data grows: `pump_readings.shift_id`,
`credit_payments.(account_id|credit_id)`, `batch_consumption.(shift_id,
tank_id)`, `tank_stock_ledger.tank_id`, `fuel_deliveries.(tank_id, date)`,
and shift sub-resource joins. Guarded with `IF NOT EXISTS` so re-running
is safe.

**Watch items.**
- Dashboard `detectDriftSummary()` walks every dip + every account on each
  load. If drift scan ever exceeds 200ms, cache the result for 60–300s
  inside `services/driftDetector.ts`.
- `tank_stock_ledger` grows ~3 rows per delivery + 1 row per shift. At
  current rate that's ~1500 rows/year — no action needed for years.

## Phase 15 — Compliance (Kenya)

**EPRA price alerts** — already wired in `dashboard.ts` (`epra_alerts`
field). No further action.

**VAT (16%)** — NexGen sells at the pump-priced total which already
includes VAT per EPRA rules. No separate VAT ledger needed unless the
station registers for VAT input claims (threshold is ~5M KES turnover;
track via monthly report `total_sales`).

**Weighbridge / dip-stick calibration** — tank dip variance reports
(`reports.ts` → stock-reconciliation) already show per-tank variance
against book stock. The owner uses this to spot meter drift beyond the
standard ±0.5% EPRA tolerance.

**Employee PAYE / NSSF / NHIF** — outside scope. Shift wages are tracked
but no statutory deductions computed.

## Phase 16 — Backup

**What shipped.** `POST /api/health/backup` copies `nexgen.db` to
`backend/data/backups/nexgen-YYYYMMDDHHMMSS.db` (Kenya timestamp).
Existing manual backups (`nexgen.db.backup-*`) preserved.

**Nightly automation.** Windows Task Scheduler (station PC runs 24/7):

```
Program: curl.exe
Arguments: -X POST http://localhost:3001/api/health/backup
Trigger:  Daily at 02:00 EAT
```

**Retention.** Keep 30 daily + 12 monthly. Delete older than 1 year.
(Not automated — 30 files × ~1MB each is negligible; review quarterly.)

**Offsite.** Once a week, copy the latest backup to a USB stick or
Google Drive. SQLite files are a single file — `copy` is the whole
procedure.

## Phase 17 — Recovery

**Fresh machine / total loss.**

1. Install Node.js 20+.
2. `git clone` the NexGen repo.
3. `npm install` at repo root.
4. Copy the most recent `nexgen-*.db` to `backend/data/nexgen.db`.
5. `npm run dev --workspace=backend` — migrations auto-run; server is up.
6. Launch desktop app: `npm run dev --workspace=desktop`.

**Partial corruption (SQLite error on start).**

1. Stop all dev servers.
2. `cp backend/data/nexgen.db backend/data/nexgen.db.corrupt-$(date +%Y%m%d)`.
3. Replace with latest backup: `cp backups/nexgen-<latest>.db backend/data/nexgen.db`.
4. Restart. Check `/api/health/drift-check`.
5. Reconstruct any transactions lost since the backup from the paper shift
   book — all real operations flow through shifts which are dated.

**Accidental data deletion.**

Every destructive operation is now soft-delete only (Phases 7, 8, 9). To
recover: set `deleted_at = NULL` on the affected row. Hard recovery from
backup is only needed if a schema migration corrupted data.

**Drift repair.** `POST /api/health/phase1-backfill` is idempotent — safe
to run after any suspicious mutation or restore. The dashboard banner
(Phase 11) is the primary detection mechanism.
