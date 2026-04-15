# NexGen ERP — Roadmap Phases

These documents outline the recommended improvements to NexGen based on industry research (petroleum retail ERP best practices) compared against the current system. Each phase builds on the previous one but is independently valuable.

## Files in this directory

| File | Topic | Priority | Effort |
|------|-------|----------|--------|
| [PHASE-1-QUICK-WINS.md](./PHASE-1-QUICK-WINS.md) | M-Pesa fee tracking, EPRA ceiling enforcement, variance categorisation | **P1 — Immediate** | 3-5 days |
| [PHASE-2-SUPPLIERS-AND-CREDITS.md](./PHASE-2-SUPPLIERS-AND-CREDITS.md) | Supplier/AP management + account-based credit payments | **P2 — Important** | 5-8 days |
| [PHASE-3-GENERAL-LEDGER.md](./PHASE-3-GENERAL-LEDGER.md) | Double-entry GL, Chart of Accounts, P&L, Balance Sheet, Trial Balance | **P2-P3 — Growth** | 2-3 weeks |
| [PHASE-4-INTEGRATIONS-AND-GOVERNANCE.md](./PHASE-4-INTEGRATIONS-AND-GOVERNANCE.md) | KRA eTIMS, bank reconciliation, M-Pesa Daraja, roles & approvals | **P3-P4 — Future** | 2-4 weeks (split) |
| [DATA-STORAGE-RECOMMENDATION.md](./DATA-STORAGE-RECOMMENDATION.md) | SQLite vs XML vs PostgreSQL analysis | Reference | — |

## How to read these documents

Each phase document includes:

1. **Context** — what the problem is and why it matters for NexGen specifically
2. **What the research says** — quotes from the two reference documents
3. **What NexGen currently does** — honest assessment of current state
4. **What changes** — schema changes, backend changes, frontend changes
5. **Integration safety** — exactly how to roll it out without damaging existing data
6. **Build order** — step-by-step implementation sequence
7. **Verification checklist** — tests to run after implementation

## Recommended execution order

```
NOW  →  Phase 1 (Quick Wins)          ─── 1 week  ───  immediate financial accuracy
 ↓
 ↓   →  Phase 2 (Suppliers + Credits) ─── 2 weeks ───  proper AR/AP, account-based payments
 ↓
 ↓   →  Phase 3 (General Ledger)      ─── 3 weeks ───  audit-ready, formal financials
 ↓
 ↓   →  Phase 4 (As needed)
 ↓         ├─ Bank reconciliation when manual checking becomes burdensome
 ↓         ├─ eTIMS when KRA mandates
 ↓         ├─ Daraja when cashier trust becomes an issue
 ↓         └─ Roles when hiring managers/accountants
```

## Safety principles shared by all phases

1. **Additive schema changes** — new tables or nullable columns with defaults. Never drop or alter existing columns destructively.
2. **Data backfill in transactions** — if migration fails, it rolls back cleanly.
3. **Backwards-compatible APIs** — existing endpoints continue to work. New endpoints are added alongside.
4. **Soft deletes everywhere** — already in place for all financial tables. No hard deletes in production.
5. **Backup before migration** — `nexgen.db.backup-YYYYMMDD` is created automatically before each migration runs (extend migration runner if not already doing this).
6. **Recomputable caches** — `tanks.current_stock_litres` and `credit_accounts.balance` are caches. If anything gets out of sync, a recompute function restores truth from source tables.
7. **Journal entries never delete** — only reverse with a counter-entry. This preserves audit integrity.

## Research sources

- *Backend Accounting Module for Fuel Station ERP — Executive Summary* (general ERP architecture, GL/AR/AP, security, technology stack)
- *Architectural Framework for Modern Petroleum Retail Enterprise Resource Planning* (petroleum-specific: wet stock reconciliation, FIFO, M-Pesa fees, EPRA compliance, eTIMS)
