# Phase 4 — External Integrations, Bank Reconciliation & Governance

**Priority**: P3-P4 (Future — when station scales or regulatory deadlines arrive)
**Effort**: 2-4 weeks (can be split into sub-phases)
**Risk to existing data**: NONE — integrations are additive, governance adds constraints that can be enabled gradually

---

## Context

Phases 1-3 bring NexGen to the level of a professional, audit-ready station accounting system. Phase 4 handles the **external world**:

1. **KRA eTIMS integration** — electronic invoicing that KRA is currently rolling out to Kenyan fuel stations (500+ stations already onboarded per the research)
2. **Bank reconciliation** — automatically match bank statements against recorded cash and M-Pesa transactions
3. **M-Pesa Daraja API** — pull live M-Pesa transaction data instead of relying on manual entry
4. **Role segregation & approval workflows** — when the station grows beyond one owner-manager
5. **Distributed / offline-first** — for unreliable internet zones (the research specifically flags this: *"Offline ERP is no longer optional"*)

Each sub-section below can be built independently when the business need appears.

---

## 4A. KRA eTIMS Fuel Station Integration

### What the research says
> "eTIMS Fuel Station System: Streamlining Tax Compliance and Operations for Kenyan Fuel Retailers. KRA has onboarded 500 fuel stations to eTIMS Fuel Module." — *Architectural Framework, Works Cited*

### What it means for NexGen
KRA's eTIMS (electronic Tax Invoice Management System) requires fuel stations to transmit sales data electronically in near-real-time. Every fuel sale must generate a fiscal invoice with a KRA-assigned control number that's embedded in the customer receipt.

### Schema

```sql
CREATE TABLE etims_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kra_pin TEXT NOT NULL,
  device_id TEXT NOT NULL,
  api_endpoint TEXT NOT NULL,
  api_key TEXT,                        -- Encrypted
  active INTEGER DEFAULT 1,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE etims_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,           -- 'shift_close', 'pump_sale', 'credit_payment'
  source_id INTEGER NOT NULL,
  kra_invoice_number TEXT,             -- Returned by KRA after submission
  kra_control_code TEXT,               -- QR/barcode data for receipt
  invoice_date TEXT NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  tax_amount DECIMAL(14,2) NOT NULL,
  status TEXT DEFAULT 'pending',       -- 'pending', 'submitted', 'acknowledged', 'failed'
  error_message TEXT,
  submitted_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  payload TEXT,                        -- JSON sent to KRA (audit)
  response TEXT,                       -- JSON received from KRA (audit)
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Backend

| Component | Purpose |
|-----------|---------|
| `backend/src/services/etimsService.ts` | Queue invoice, sign payload, POST to KRA API, handle response, retry logic |
| `backend/src/routes/etims.ts` | GET /status, GET /invoices, POST /retry/:id, POST /config |
| Background worker | Polls `etims_invoices WHERE status = 'pending'` and submits to KRA |
| `shifts.ts` — PUT /:id/close | After shift close, queue one aggregate eTIMS invoice for the shift |

### Frontend

| Page | Purpose |
|------|---------|
| `ETIMS.tsx` (admin only) | Dashboard: pending/submitted/failed counts, retry button, last sync time |
| Shift detail | Show "eTIMS: Submitted ✓" or "eTIMS: Pending ⏳" badge |
| Receipt printout | Include KRA control code / QR code when available |

### Integration safety
- **Completely additive** — no existing tables modified
- If eTIMS API is down, the worker queues invoices for later. Shift close is never blocked.
- Configuration is disabled by default — eTIMS only activates when admin enables it
- **This should be built when KRA mandates it for your station** or when you want proactive compliance ahead of the deadline

---

## 4B. Bank Reconciliation

### What the research says
> "The ERP should import bank statements (via OFX/QFX, SWIFT, or open banking APIs) and match them to transactions. Real-time reconciliation can be enhanced by API-based balance queries." — *Backend Accounting Module, Section: Integration Patterns*

> "Bulk Settlement Matching: Credit card and mobile money processors often deposit funds in batches or lump sums. The ERP must be able to perform Many-to-One Reconciliation, matching a single bank deposit to multiple individual POS transactions." — *Architectural Framework*

### Schema

```sql
CREATE TABLE bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  branch TEXT,
  currency TEXT DEFAULT 'KES',
  current_balance DECIMAL(14,2) DEFAULT 0,
  gl_account_code TEXT REFERENCES chart_of_accounts(code),  -- e.g. '1030'
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  transaction_date TEXT NOT NULL,
  value_date TEXT,
  description TEXT,
  reference TEXT,
  debit_amount DECIMAL(14,2) DEFAULT 0,
  credit_amount DECIMAL(14,2) DEFAULT 0,
  balance_after DECIMAL(14,2),
  transaction_type TEXT,               -- 'deposit', 'withdrawal', 'transfer', 'fee', 'mpesa_settlement'
  matched_source_type TEXT,            -- 'shift_collection', 'supplier_payment', 'expense', etc.
  matched_source_id INTEGER,
  match_status TEXT DEFAULT 'unmatched', -- 'unmatched', 'matched', 'flagged'
  matched_at TIMESTAMP,
  matched_by TEXT,
  imported_from TEXT,                  -- 'csv', 'ofx', 'api'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bank_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  opening_balance DECIMAL(14,2) NOT NULL,
  closing_balance DECIMAL(14,2) NOT NULL,
  book_balance DECIMAL(14,2) NOT NULL,
  variance DECIMAL(14,2) NOT NULL,
  status TEXT DEFAULT 'draft',         -- 'draft', 'completed'
  reconciled_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Import flows

| Source | Method |
|--------|--------|
| KCB / Equity / Coop | Upload CSV/OFX bank statement (monthly) |
| Safaricom M-Pesa | Upload M-Pesa statement (CSV export from Safaricom portal) |
| Future | Open Banking API (when available for Kenyan banks) |

### Matching engine

Auto-match candidates:
- **Exact match**: amount + date ± 1 day → likely a supplier payment or expense
- **Grouped match**: one bank deposit = sum of multiple shift cash deposits from same date
- **M-Pesa settlement**: one bank credit from Safaricom = sum of a day's M-Pesa collections minus fees

Unmatched items get flagged for manual review. Each manual match creates an audit log entry.

### Backend

| File | Purpose |
|------|---------|
| `backend/src/routes/bankAccounts.ts` | CRUD bank accounts |
| `backend/src/routes/bankImport.ts` | POST /upload — accept CSV/OFX, parse, insert as `bank_transactions` |
| `backend/src/services/reconciliationService.ts` | autoMatch(), manualMatch(), generateReconciliationReport() |
| `backend/src/routes/reconciliation.ts` | GET /unmatched, POST /match, GET /report |

### Frontend

| Page | Purpose |
|------|---------|
| `BankAccounts.tsx` | List accounts with current balance |
| `BankImport.tsx` | Upload statement, see parsed transactions, auto-match preview |
| `Reconciliation.tsx` | Two-column view: bank transactions (left) vs book transactions (right), drag-to-match interface |

### Integration safety
- **New tables only** — existing financial data not touched
- Works alongside Phase 3 GL: bank_transactions link to journal_entries via matched_source
- If matching is wrong, the match can be undone without data loss

---

## 4C. M-Pesa Daraja API Integration

### Problem
Currently the attendant manually types the total M-Pesa amount into shift collections. Errors, omissions, and theft are possible.

### Solution
Integrate with Safaricom's Daraja API to pull actual transactions for the station's Till number automatically.

### Schema

```sql
CREATE TABLE mpesa_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT UNIQUE NOT NULL,  -- Safaricom's M-Pesa code (e.g. SHW1AB2CD3)
  transaction_date TIMESTAMP NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  customer_phone TEXT,
  customer_name TEXT,
  till_number TEXT,
  reference TEXT,
  fee DECIMAL(10,2) DEFAULT 0,
  shift_id INTEGER REFERENCES shifts(id),  -- Auto-assigned to open shift at time of transaction
  status TEXT DEFAULT 'completed',
  raw_payload TEXT,
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Backend

| Component | Purpose |
|-----------|---------|
| `backend/src/services/mpesaService.ts` | OAuth token fetch, `getTransactions(from, to)`, webhook handler for C2B confirmation |
| `backend/src/routes/mpesa.ts` | Daraja webhook endpoint, manual sync trigger, config |
| Background worker | Polls Daraja every 5 minutes for new transactions (or uses webhook) |
| `shifts.ts` — PUT /:id/collections | If Daraja integration active, `mpesa_amount` is **read-only** from `mpesa_transactions` sum — no manual typing |

### Frontend

| Page | Purpose |
|------|---------|
| Shift detail — collections | M-Pesa field shows "Auto (Daraja): KES 50,000" with list of transactions below |
| New: `MpesaTransactions.tsx` | Browse all M-Pesa transactions with filters |

### Integration safety
- Daraja integration is **opt-in per station**
- If disabled, manual entry still works (Phase 1 M-Pesa fee tracking handles it)
- If Daraja is unreachable, the attendant can still enter manually — the system falls back gracefully

---

## 4D. Role Segregation & Approval Workflows

### What the research says
> "The ERP should enforce roles/permissions. The user who posts an invoice should not be the same who approves its payment." — *Backend Accounting Module, Section: Audit Controls*

### Current NexGen
Two roles: `admin` (full access) and `attendant` (limited). No approval workflows. Suitable for a single owner-managed station but insufficient as the business grows.

### Schema

```sql
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,           -- 'owner', 'manager', 'accountant', 'cashier', 'attendant'
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,           -- 'shift.close', 'expense.approve', 'delivery.delete', 'journal.post_manual'
  description TEXT
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id),
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code)
);

-- Extend employees table
ALTER TABLE employees ADD COLUMN role_id INTEGER REFERENCES roles(id);

-- Approval workflows
CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type TEXT NOT NULL,          -- 'expense', 'delivery_delete', 'credit_write_off', 'manual_journal'
  source_id INTEGER NOT NULL,
  amount DECIMAL(14,2),
  requested_by INTEGER REFERENCES employees(id),
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER REFERENCES employees(id),
  approved_at TIMESTAMP,
  status TEXT DEFAULT 'pending',       -- 'pending', 'approved', 'rejected'
  reason TEXT,
  notes TEXT
);

-- Audit log
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES employees(id),
  action TEXT NOT NULL,                -- 'create', 'update', 'delete', 'approve', 'login'
  entity_type TEXT NOT NULL,           -- table name
  entity_id INTEGER,
  old_values TEXT,                     -- JSON
  new_values TEXT,                     -- JSON
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Role examples

```
OWNER
  - All permissions

MANAGER
  - shift.close, shift.modify, expense.create, expense.approve (up to KES 10,000)
  - delivery.create, credit.create, credit.payment
  - NOT: delivery.delete, journal.post_manual, role.modify

ACCOUNTANT
  - journal.post_manual, journal.view, report.view_all
  - expense.approve (all amounts)
  - NOT: shift.close, delivery.create

CASHIER
  - collection.record, credit.create
  - NOT: shift.close, expense.create

ATTENDANT
  - pump.reading, shift.view_own
  - NOT: collection.record, expense.create
```

### Backend

| File | Change |
|------|--------|
| `backend/src/middleware/authorize.ts` | New middleware: `requirePermission('expense.approve')` |
| All routes | Add permission checks to sensitive endpoints |
| `backend/src/services/auditService.ts` | `log(action, entity, oldValues, newValues, user)` — called from every mutation |
| `backend/src/routes/approvals.ts` | Queue and resolve approval requests |

### Frontend

| Page | Change |
|------|--------|
| `Employees.tsx` | Assign role per employee |
| New: `Roles.tsx` | Configure roles and permissions |
| New: `Approvals.tsx` | Manager dashboard of pending approval requests |
| New: `AuditLog.tsx` | Searchable audit log (admin only) |
| All pages | Hide buttons the user doesn't have permission for |

### Integration safety
- **Backwards compatible**: existing `employees.role` ('admin' / 'attendant') remains. The new `role_id` is additional.
- Migration seeds default roles matching current behaviour (admin = owner role, attendant = attendant role)
- Approval workflows are **opt-in per action type** — can enable them one at a time (e.g. first only for expense.approve > 5000)
- Audit log is write-only — never affects existing data

---

## 4E. Offline-First / Low-Connectivity Resilience

### What the research says
> "Distribution in Low-Connectivity Zones: Why Offline ERP is No Longer Optional." — *Architectural Framework, Works Cited*

### The problem
NexGen runs as a client-server app. If internet drops:
- Mobile app can't reach backend
- Desktop app (which runs its own backend) is fine locally but can't sync with other devices
- Multiple stations can't share data

### Solution (future, when expanding beyond one station)

1. **Local-first architecture**: each device has its own SQLite DB that syncs to a central cloud backend when connectivity returns
2. **Conflict resolution**: use `updated_at` timestamps + CRDTs for merging
3. **Background sync worker**: queues local changes, pushes when online
4. **Sync status indicator**: every screen shows "Synced ✓" or "Pending: 3 changes"

This is a significant architectural change — probably warrants its own project when the need appears (e.g. opening a second station). Not in scope for a single-station deployment.

---

## Build Order (Sub-Phases)

Each can be built independently when the business need emerges:

**4A — eTIMS**: When KRA mandates it for your station or before the deadline arrives
**4B — Bank Reconciliation**: When monthly volumes exceed what manual checking can handle (probably now, honestly)
**4C — Daraja**: When manual M-Pesa entry becomes a trust issue (e.g. hiring cashiers you don't fully trust)
**4D — Roles & Audit**: When hiring a manager or accountant
**4E — Offline-First**: When opening a second station

## Verification Checklist (per sub-phase)

### 4A — eTIMS
- [ ] Close a shift → eTIMS invoice queued → submitted to KRA → control code stored
- [ ] KRA API down → invoice stays pending → retries automatically when API returns
- [ ] Receipt print shows QR/control code

### 4B — Bank Reconciliation
- [ ] Upload bank statement CSV → transactions imported
- [ ] Auto-match finds obvious pairs (same amount, same date)
- [ ] Manual drag-and-drop match works
- [ ] Monthly reconciliation report: bank balance = book balance

### 4C — Daraja
- [ ] Daraja webhook received → new mpesa_transaction row → auto-assigned to open shift
- [ ] Shift collection M-Pesa field auto-populated from transactions
- [ ] Attendant cannot modify (read-only when Daraja active)

### 4D — Roles
- [ ] Attendant user cannot access expense creation
- [ ] Manager approval required for expenses > KES 10,000
- [ ] Audit log records every mutation with user ID and timestamp
- [ ] Admin can see audit log, others cannot
