# Data Storage Recommendation: SQLite vs XML vs Alternatives

## Summary

**Keep SQLite. Do not switch to XML.** For a financial system like NexGen, SQLite is the correct choice by every important metric. XML is a document format — it is not a database. Migrating to XML would introduce serious financial risk.

The only time to revisit this decision is if you open multiple stations that need to share data in real-time — at that point, migrate SQLite → PostgreSQL (not XML).

---

## What the Excel/XML context actually is

The "XML" reference in your question turned out to be the Excel files (`NEXGENLTRS (Autosaved).xlsx` and `NexGen_Litres_Tracker.xlsx`) — the pre-NexGen manual tracking spreadsheets. Reviewing them reveals:

### What the Excel did well (and what NexGen already inherits)
- Tracked daily cash, M-Pesa, expenses, pump readings
- Recorded P1/P2 meter readings, variance, delivery litres
- Listed customer credits by name columns (MGDI, KMTH, KAU, MBUVI, MBITI, NGOVI, MUSILI)

### What the Excel could NOT do
- Enforce relationships (a credit to "Mgdi" and another to "MGDI" were different people)
- Prevent silent corruption (one typo in a formula cascades for months)
- Audit trail (no record of who changed what)
- Multi-user access (only one person can have it open)
- Queries (can't ask "total credit outstanding for Mgdi across all months")
- Referential integrity (delete a shift → collections and credits become orphans)
- Atomic transactions (crash mid-save → corrupted file)
- FIFO costing (impossible to express in a spreadsheet formula)
- Book stock computation from deliveries and sales (requires joins)

These are exactly the reasons NexGen exists as a database application.

---

## Why XML is wrong for financial data

XML is a **document markup format**, not a database. It was designed for exchanging structured documents between systems, not for transactional storage.

| Requirement | SQLite | XML |
|-------------|--------|-----|
| ACID transactions (money can't be lost) | ✅ Built-in | ❌ Not a concept |
| Concurrent writes (2 users closing shifts) | ✅ WAL mode handles it | ❌ File corruption |
| Referential integrity (FK constraints) | ✅ Enforced by engine | ❌ No enforcement |
| Query performance (10,000 shifts) | ✅ Milliseconds with indexes | ❌ Must parse whole file |
| Atomic updates (post a journal entry) | ✅ All-or-nothing commit | ❌ Partial writes possible |
| FIFO batch consumption (joins across tables) | ✅ SQL joins | ❌ Requires loading everything |
| Crash recovery | ✅ Journal/WAL replay | ❌ Corrupted XML = data loss |
| Data size (growing to millions of rows) | ✅ Scales to terabytes | ❌ Unreasonable to load >50MB in memory |
| Backup | ✅ Single file copy | ✅ Single file copy (but bigger) |
| Audit trail | ✅ Dedicated tables with timestamps | ❌ Comments/history bolted on |
| Soft deletes | ✅ `deleted_at` columns already in use | ❌ Must rewrite whole file to "delete" |

### Real-world consequence
If the station loses power during a shift close while writing XML, you likely lose the entire day's data. With SQLite, the transaction either completes or rolls back — nothing in between. For financial data, this is non-negotiable.

---

## What the research recommends

Both research documents explicitly call for relational databases:

> "ACID transactions for finance, strong typing/schemas for accuracy, mature ecosystem for audit/security. Spring Boot + PostgreSQL + Kafka is a proven stack for high-load financial systems." — *Backend Accounting Module, Section: Technology Stack*

> "The central DB should be highly available. Options include master-slave replication with automatic failover (e.g. PostgreSQL Patroni, Oracle RAC, or cloud managed DB in multi-AZ)." — *Backend Accounting Module, Section: Performance*

Neither document mentions XML as a storage option because it is not a database.

---

## When to migrate from SQLite (and to what)

SQLite is **embedded** — it lives inside the app. This is its strength (zero setup, zero admin) and its limit (only one machine can write at a time).

### Stay on SQLite while:
- ✅ Single station
- ✅ Single machine (desktop app + mobile app connecting over LAN)
- ✅ < 10 concurrent users
- ✅ < 100 MB database size
- ✅ No real-time multi-site requirement

NexGen is well within all these limits. After 20 days of operation, the database is only 131 KB. Even 10 years of dense daily operation would put it well under 500 MB.

### Migrate to PostgreSQL when:
- 🔔 Opening a second station that needs to share data with the first
- 🔔 More than 20 concurrent users writing simultaneously
- 🔔 Database grows beyond 5 GB
- 🔔 Need real-time replication or failover
- 🔔 Need features SQLite lacks (stored procedures, advanced indexes, concurrent writers at scale)

**The migration path is straightforward** because NexGen uses Knex.js, which abstracts the database. Changing from SQLite to PostgreSQL is primarily a config change plus handling a few SQL dialect differences (date functions, autoincrement syntax).

### Never migrate to:
- ❌ XML files
- ❌ JSON files
- ❌ Google Sheets / Excel
- ❌ NoSQL (MongoDB, DynamoDB) — wrong fit for relational financial data
- ❌ Firebase — wrong consistency model for accounting

---

## Current NexGen storage — is it well-structured?

Yes. The schema reflects 14 iterative migrations and demonstrates mature design:

### Strengths
- **Immutable audit trails**: `tank_stock_ledger` is append-only
- **Soft deletes**: 14 tables have `deleted_at` — no data is ever truly lost
- **FIFO costing**: `delivery_batches` + `batch_consumption` correctly model First-In-First-Out cost allocation
- **Foreign keys** enforced on all critical relationships
- **Atomic operations** wrapped in Knex transactions
- **Schema versioning** via migrations — every change is tracked and reversible
- **Kenya timezone** handled consistently via `getKenyaDate()`
- **Cached computed values** (`tanks.current_stock_litres`) that are recomputed from source data — best-of-both-worlds

### Minor improvements for Phase 1-4 (covered in phase docs)
- Add `mpesa_fee` and `mpesa_net` to `shift_collections`
- Add supplier / AP tables
- Add chart of accounts and journal entries (GL)
- Add bank transactions and reconciliation

None of these changes require moving away from SQLite.

---

## Concrete recommendations

### 1. Keep SQLite as the primary store ✅
- It is the right tool for this job
- All Phase 1-4 additions work natively with SQLite
- Migrations are clean and reversible

### 2. Add export-to-XML/CSV for interop 📤
If there are **specific** cases where XML is needed (e.g. tax filing to KRA in SAF-T format, e-invoicing, auditor requests), build **export functions** that generate XML/CSV on demand from the SQLite data. This is trivial and the right approach.

Example: `GET /api/reports/xml/daily?date=2026-04-09` returns an XML-formatted report for that day. The source of truth stays in SQLite; XML is just a transport format.

### 3. Automate backups 💾
Currently `nexgen.db.backup-20260409` exists — good. Formalize this:
- Daily automated backup at shift-change time (e.g. midnight)
- Weekly backup to cloud storage (Google Drive / Dropbox)
- Monthly archive with retention (keep 12 months)
- Test restore procedure quarterly

Backup script (Node or Windows Task Scheduler):
```javascript
// Simple file copy is safe for SQLite when the DB is idle or in WAL mode
fs.copyFileSync('nexgen.db', `backups/nexgen-${date}.db`);
```

### 4. Enable WAL mode for better concurrency 🚀
If not already enabled, run once:
```sql
PRAGMA journal_mode = WAL;
```
This allows readers and writers to work simultaneously — important when the mobile app is reading while the desktop app is writing.

### 5. Plan the PostgreSQL migration path for year 2+ 📈
Document (in `MIGRATION-TO-POSTGRES.md` when the time comes) the steps for moving to PostgreSQL if the business expands:
- Export schema via Knex migrations (already supported)
- Change `knexfile.ts` connection config
- Handle SQLite-specific SQL (few edge cases: `DATETIME('now')`, `INTEGER PRIMARY KEY AUTOINCREMENT`)
- Data migration via `knex-seeder` or custom ETL script
- Test parallel-run period before cutover

---

## Final word

The Excel files show how the business was managed before — with manual columns, names, and formulas. NexGen has correctly translated that into a relational model with referential integrity, audit trails, and FIFO costing.

**SQLite is not a limitation. It is the correct choice.** The only legitimate reasons to change storage would be multi-station scaling (→ PostgreSQL) or integration with external systems that require specific formats (→ add export functions, don't change the primary store).

Do not migrate to XML. Do not migrate to spreadsheets. Invest the saved time in Phase 1 (Quick Wins) and Phase 2 (Suppliers + Credits restructuring), which actually move the business forward.
