# Phase 3 — General Ledger & Financial Statements

**Priority**: P2-P3 (Important for growth, KRA audits, and bank loans)
**Effort**: 2-3 weeks
**Risk to existing data**: NONE — entirely new tables and auto-posting logic. Existing operational flow unchanged.

---

## Context

### The core gap
NexGen tracks *what happened* (fuel sold, money collected, expenses paid, deliveries received) but cannot produce formal financial documents:
- **Income Statement (P&L)**: How much profit did the station make this month?
- **Balance Sheet**: What are the station's assets, liabilities, and equity right now?
- **Trial Balance**: Do all debits equal all credits? (basic accounting sanity check)

These are the three documents that a KRA auditor, bank loan officer, or investor will ask for. Currently the owner can only show the dashboard and daily reports, which are operational — not accounting.

### What the research says
> "A robust General Ledger (GL) acting as the single source of truth for all transactions." — *Backend Accounting Module*

> "Each Journal Entry ties to one or more Journal Lines, each affecting a GL Account (debit or credit). An Invoice (AR) or Bill (AP) would produce postings to the GL." — *Backend Accounting Module, Section: Data Model*

> "The ultimate goal of the ERP's accounting module is Audit Readiness." — *Architectural Framework, Conclusion*

### Why this works for a single station
A full ERP GL (with multi-currency, multi-entity, consolidation) is massive overkill. NexGen needs a **simplified double-entry system** that:
1. Auto-generates journal entries from existing operations (no manual journal posting needed day-to-day)
2. Comes with a pre-configured Chart of Accounts for a Kenyan petrol station
3. Produces P&L, Balance Sheet, and Trial Balance reports on demand
4. The owner never has to "do bookkeeping" — the system does it automatically from shift closes, deliveries, expenses, and payments

---

## 3A. Chart of Accounts

### Pre-configured for NexGen Petrol Station

```
CODE    | NAME                              | TYPE        | CATEGORY
--------|-----------------------------------|-------------|----------
ASSETS
1000    | Cash in Hand                      | Asset       | Current Asset
1010    | Cash in Safe/Vault                | Asset       | Current Asset
1020    | M-Pesa Float                      | Asset       | Current Asset
1021    | M-Pesa Settlement Pending         | Asset       | Current Asset
1030    | Bank Account                      | Asset       | Current Asset
1100    | Accounts Receivable - Customers   | Asset       | Current Asset
1110    | Accounts Receivable - Staff       | Asset       | Current Asset
1200    | Fuel Inventory - Petrol           | Asset       | Current Asset
1210    | Fuel Inventory - Diesel           | Asset       | Current Asset
1300    | Pumps & Dispensers                | Asset       | Fixed Asset
1310    | Storage Tanks                     | Asset       | Fixed Asset
1320    | Other Equipment                   | Asset       | Fixed Asset
1399    | Accumulated Depreciation          | Asset       | Fixed Asset (contra)

LIABILITIES
2000    | Accounts Payable - Suppliers      | Liability   | Current Liability
2010    | Wages Payable                     | Liability   | Current Liability
2020    | M-Pesa Fees Payable               | Liability   | Current Liability
2100    | EPRA Levies Payable               | Liability   | Current Liability
2200    | KRA VAT Payable                   | Liability   | Current Liability

EQUITY
3000    | Owner's Capital                   | Equity      | Equity
3100    | Retained Earnings                 | Equity      | Equity
3200    | Owner's Drawings                  | Equity      | Equity

REVENUE
4000    | Fuel Sales - Petrol               | Revenue     | Operating Revenue
4010    | Fuel Sales - Diesel               | Revenue     | Operating Revenue
4100    | Other Income                      | Revenue     | Other Revenue

COST OF GOODS SOLD
5000    | COGS - Petrol                     | Expense     | COGS
5010    | COGS - Diesel                     | Expense     | COGS
5020    | Stock Shrinkage/Loss              | Expense     | COGS

OPERATING EXPENSES
6000    | Staff Wages                       | Expense     | Operating Expense
6010    | Rent                              | Expense     | Operating Expense
6020    | Electricity                       | Expense     | Operating Expense
6030    | Security                          | Expense     | Operating Expense
6040    | Maintenance & Repairs             | Expense     | Operating Expense
6050    | Transport                         | Expense     | Operating Expense
6060    | Generator Fuel                    | Expense     | Operating Expense
6070    | Cleaning                          | Expense     | Operating Expense
6080    | Stationery                        | Expense     | Operating Expense
6090    | Communication (Airtime/Data)      | Expense     | Operating Expense
6100    | Bank Charges                      | Expense     | Operating Expense
6110    | M-Pesa Merchant Fees              | Expense     | Operating Expense
6120    | Insurance                         | Expense     | Operating Expense
6130    | Licenses & Permits                | Expense     | Operating Expense
6140    | Accounting & Professional Fees    | Expense     | Operating Expense
6150    | Depreciation                      | Expense     | Operating Expense
6999    | Other Expenses                    | Expense     | Operating Expense
```

### Schema

```sql
CREATE TABLE chart_of_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- '1000', '4010', etc.
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,          -- 'asset', 'liability', 'equity', 'revenue', 'expense'
  category TEXT,                       -- 'current_asset', 'fixed_asset', 'cogs', 'operating_expense', etc.
  parent_code TEXT,                    -- For sub-accounts (optional hierarchy)
  is_system INTEGER DEFAULT 0,        -- 1 = system-managed, cannot delete
  active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3B. Journal Entries (Auto-Posted)

### Schema

```sql
CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source_type TEXT NOT NULL,           -- 'shift_close', 'delivery', 'expense', 'credit_payment',
                                       -- 'supplier_payment', 'manual', 'wage_deduction'
  source_id INTEGER,                   -- ID of the originating record (shift.id, delivery.id, etc.)
  total_debit DECIMAL(14,2) NOT NULL,
  total_credit DECIMAL(14,2) NOT NULL,
  posted_by TEXT,                      -- employee name or 'system'
  reversed INTEGER DEFAULT 0,          -- 1 if this entry has been reversed
  reversal_of INTEGER,                 -- ID of entry this reverses (if applicable)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  debit_amount DECIMAL(14,2) DEFAULT 0,
  credit_amount DECIMAL(14,2) DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- For period-end snapshots
CREATE TABLE accounting_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT DEFAULT 'open',          -- 'open', 'closed'
  closed_by TEXT,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3C. Auto-Posting Rules

The key principle: **the owner never manually creates journal entries**. Every existing operation automatically generates the correct double-entry postings.

### Shift Close → Journal Entry

When a shift closes, the system auto-posts:

```
SHIFT CLOSE: Shift #21, Kanini, 2026-04-09
Petrol sold: 500L × KES 195 = KES 97,500 (FIFO COGS: KES 92,250)
Diesel sold: 300L × KES 185 = KES 55,500 (FIFO COGS: KES 49,740)
Cash collected: KES 120,000
M-Pesa collected: KES 25,000 (fee: KES 137.50)
Credits issued: KES 5,000
Expenses: KES 800 (cleaning)
Wage: KES 1,000

JOURNAL ENTRY:
  DR  1000  Cash in Hand              120,000.00
  DR  1020  M-Pesa Float               25,000.00
  DR  1100  Accounts Receivable          5,000.00
  DR  5000  COGS - Petrol              92,250.00
  DR  5010  COGS - Diesel              49,740.00
  DR  6000  Staff Wages                 1,000.00
  DR  6070  Cleaning                      800.00
  DR  6110  M-Pesa Merchant Fees          137.50
    CR  4000  Fuel Sales - Petrol                  97,500.00
    CR  4010  Fuel Sales - Diesel                  55,500.00
    CR  1200  Fuel Inventory - Petrol              92,250.00
    CR  1210  Fuel Inventory - Diesel              49,740.00
    CR  2010  Wages Payable                         1,000.00
    CR  2020  M-Pesa Fees Payable                     137.50
    CR  1000  Cash in Hand (expenses)                 800.00
  -------------------------------------------------------
  TOTAL DEBITS:  293,927.50  =  TOTAL CREDITS: 293,927.50  ✓
```

### Fuel Delivery → Journal Entry

```
DELIVERY: 8,000L diesel @ KES 165.80 from Mache

  DR  1210  Fuel Inventory - Diesel  1,326,400.00
    CR  2000  Accounts Payable - Suppliers       1,326,400.00
```

### Supplier Payment → Journal Entry

```
PAYMENT: KES 1,326,400 to Mache (bank transfer)

  DR  2000  Accounts Payable - Suppliers  1,326,400.00
    CR  1030  Bank Account                          1,326,400.00
```

### Credit Payment → Journal Entry

```
PAYMENT: Mgdi pays KES 5,000 via M-Pesa

  DR  1020  M-Pesa Float                5,000.00
    CR  1100  Accounts Receivable                    5,000.00
```

### General Expense → Journal Entry

```
EXPENSE: KES 15,000 Rent (December)

  DR  6010  Rent                      15,000.00
    CR  1000  Cash in Hand                          15,000.00
```

### Shift Variance (Deficit) → Journal Entry

```
VARIANCE: Shift #21 short by KES 500, deducted from wage

  DR  1110  Accounts Receivable - Staff    500.00
    CR  1000  Cash in Hand (shortage)                 500.00

  DR  2010  Wages Payable                  500.00
    CR  1110  Accounts Receivable - Staff             500.00
```

---

## 3D. Financial Reports

### Income Statement (P&L)

```
NEXGEN PETROL STATION
INCOME STATEMENT
For the period: 1 March 2026 — 31 March 2026

REVENUE
  Fuel Sales - Petrol           1,185,578.18
  Fuel Sales - Diesel           1,300,479.06
                               ─────────────
  TOTAL REVENUE                 2,486,057.24

COST OF GOODS SOLD
  COGS - Petrol                   (FIFO cost)
  COGS - Diesel                   (FIFO cost)
  Stock Shrinkage/Loss                   0.00
                               ─────────────
  TOTAL COGS                    (FIFO total)

GROSS PROFIT                    (Revenue - COGS)
Gross Margin                    XX.X%

OPERATING EXPENSES
  Staff Wages                      XX,XXX.XX
  Rent                             XX,XXX.XX
  Electricity                       X,XXX.XX
  M-Pesa Merchant Fees               XXX.XX
  ...
                               ─────────────
  TOTAL OPERATING EXPENSES         XX,XXX.XX

NET PROFIT / (LOSS)             XX,XXX.XX
Net Margin                      XX.X%
```

### Balance Sheet

```
NEXGEN PETROL STATION
BALANCE SHEET
As at: 31 March 2026

ASSETS
  Current Assets
    Cash in Hand                   XX,XXX.XX
    M-Pesa Float                   XX,XXX.XX
    Bank Account                   XX,XXX.XX
    Accounts Receivable             X,XXX.XX
    Fuel Inventory - Petrol        XX,XXX.XX
    Fuel Inventory - Diesel        XX,XXX.XX
                               ─────────────
    Total Current Assets          XXX,XXX.XX

  Fixed Assets
    Pumps & Dispensers             XX,XXX.XX
    Storage Tanks                  XX,XXX.XX
    Less: Accumulated Depreciation (X,XXX.XX)
                               ─────────────
    Total Fixed Assets             XX,XXX.XX

TOTAL ASSETS                      XXX,XXX.XX

LIABILITIES
  Accounts Payable - Suppliers     XX,XXX.XX
  Wages Payable                     X,XXX.XX
                               ─────────────
  Total Liabilities                XX,XXX.XX

EQUITY
  Owner's Capital                 XXX,XXX.XX
  Retained Earnings                XX,XXX.XX
                               ─────────────
  Total Equity                    XXX,XXX.XX

TOTAL LIABILITIES + EQUITY        XXX,XXX.XX
```

### Trial Balance

```
NEXGEN PETROL STATION
TRIAL BALANCE
As at: 31 March 2026

Account                     | Debit       | Credit
----------------------------|-------------|----------
1000 Cash in Hand           | XX,XXX.XX   |
1020 M-Pesa Float           | XX,XXX.XX   |
1100 A/R Customers          |  X,XXX.XX   |
1200 Inventory - Petrol     | XX,XXX.XX   |
...                         |             |
2000 A/P Suppliers          |             | XX,XXX.XX
...                         |             |
4000 Sales - Petrol         |             | X,XXX,XXX.XX
...                         |             |
5000 COGS - Petrol          | XXX,XXX.XX  |
...                         |             |
6000 Staff Wages            |  XX,XXX.XX  |
...                         |             |
----------------------------|-------------|----------
TOTALS                      | X,XXX,XXX.XX| X,XXX,XXX.XX  ✓ (must be equal)
```

---

## 3E. Implementation

### Backend

| File | Purpose |
|------|---------|
| New: `backend/src/services/journalService.ts` | Core GL engine: `postEntry()`, `reverseEntry()`, `getTrialBalance()`, `getIncomeStatement()`, `getBalanceSheet()` |
| New: `backend/src/routes/accounting.ts` | API: GET /trial-balance, GET /income-statement, GET /balance-sheet, GET /journal-entries, POST /journal-entries (manual), GET /chart-of-accounts |
| `shifts.ts` — PUT /:id/close | After all existing close logic, call `journalService.postShiftClose(shift, trx)` |
| `fuelDeliveries.ts` — POST | Call `journalService.postDelivery(delivery, trx)` |
| `fuelDeliveries.ts` — DELETE | Call `journalService.reverseDelivery(deliveryId, trx)` |
| `creditAccounts.ts` — POST /:id/payments | Call `journalService.postCreditPayment(payment, trx)` |
| `suppliers.ts` — POST /:id/payments | Call `journalService.postSupplierPayment(payment, trx)` |
| `expenses.ts` — POST | Call `journalService.postExpense(expense, trx)` |

### The journal service is a thin layer

```typescript
// backend/src/services/journalService.ts
export async function postShiftClose(shift: any, trx: Knex.Transaction) {
  const lines: JournalLine[] = [];

  // Revenue lines
  for (const snapshot of shift.tank_snapshots) {
    const salesAccount = snapshot.fuel_type === 'petrol' ? '4000' : '4010';
    const cogsAccount = snapshot.fuel_type === 'petrol' ? '5000' : '5010';
    const inventoryAccount = snapshot.fuel_type === 'petrol' ? '1200' : '1210';

    lines.push({ account: salesAccount, credit: snapshot.sales_amount });
    lines.push({ account: cogsAccount, debit: snapshot.cogs });
    lines.push({ account: inventoryAccount, credit: snapshot.cogs });
  }

  // Collection lines
  lines.push({ account: '1000', debit: shift.cash_amount });
  lines.push({ account: '1020', debit: shift.mpesa_amount });
  if (shift.credits_amount > 0) {
    lines.push({ account: '1100', debit: shift.credits_amount });
  }

  // Expense lines (one per category)
  for (const exp of shift.expenses) {
    const expenseAccount = mapCategoryToAccount(exp.category);
    lines.push({ account: expenseAccount, debit: exp.amount });
    lines.push({ account: '1000', credit: exp.amount }); // paid from cash
  }

  // Wage
  lines.push({ account: '6000', debit: shift.wage_paid });
  lines.push({ account: '2010', credit: shift.wage_paid });

  // M-Pesa fees (if tracked)
  if (shift.mpesa_fee > 0) {
    lines.push({ account: '6110', debit: shift.mpesa_fee });
    lines.push({ account: '2020', credit: shift.mpesa_fee });
  }

  return postEntry({
    date: shift.shift_date,
    description: `Shift #${shift.id} close — ${shift.employee_name}`,
    source_type: 'shift_close',
    source_id: shift.id,
    lines,
  }, trx);
}
```

### Frontend

| Page | Purpose |
|------|---------|
| New: `Accounting.tsx` (desktop only initially) | Dashboard with P&L, Balance Sheet, Trial Balance tabs |
| New: `JournalEntries.tsx` | Browse all journal entries, filter by date/source/account. Drill into any entry to see lines. |
| New: `ChartOfAccounts.tsx` | View/manage accounts. System accounts are read-only. |
| Reports page | Add "Financial Statements" section with P&L and Balance Sheet |

---

## Integration Safety

This is the **safest phase** because:

1. **All new tables** — chart_of_accounts, journal_entries, journal_lines, accounting_periods are brand new
2. **Existing operations are unchanged** — shift close, deliveries, expenses all continue to work exactly as before
3. **Journal posting is additive** — it runs AFTER the existing logic, inside the same transaction. If it fails, the whole transaction rolls back (existing data safe)
4. **Historical backfill**: A migration script replays all closed shifts, deliveries, and expenses to generate historical journal entries. This is read-only against existing tables.
5. **The GL is derived data** — if something goes wrong, you can delete all journal entries and re-generate from source transactions

### Backfill approach

```typescript
// Migration 017: Backfill historical journal entries
// 1. Replay all closed shifts (ordered by shift_date)
// 2. Replay all fuel deliveries (ordered by date)
// 3. Replay all general expenses (ordered by date)
// 4. Replay all credit payments (ordered by date)
// 5. Verify: trial balance debits = credits
```

---

## Build Order

1. Migration 017: chart_of_accounts, journal_entries, journal_lines, accounting_periods
2. Seed chart of accounts with NexGen-specific accounts
3. Build `journalService.ts` — postEntry, reverseEntry, report generators
4. Wire into shift close (postShiftClose)
5. Wire into deliveries (postDelivery)
6. Wire into expenses (postExpense)
7. Wire into credit/supplier payments
8. Backfill migration: replay historical transactions
9. Build Trial Balance API + verification
10. Build Income Statement API
11. Build Balance Sheet API
12. Frontend: Accounting pages (desktop first)

## Verification Checklist

- [ ] Trial Balance: total debits = total credits (mandatory — if not equal, there's a bug)
- [ ] Income Statement: net profit matches dashboard "Net Profit" number
- [ ] Balance Sheet: Assets = Liabilities + Equity
- [ ] Close a shift → journal entry auto-created with correct accounts and amounts
- [ ] Record delivery → journal entry with DR Inventory, CR AP
- [ ] Record expense → journal entry with DR Expense, CR Cash
- [ ] Delete a delivery → reversal journal entry auto-created
- [ ] Historical data: backfill produces balanced trial balance for all past periods
- [ ] Account drill-down: click any account to see all journal lines affecting it
