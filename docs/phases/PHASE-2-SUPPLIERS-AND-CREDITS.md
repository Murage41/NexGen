# Phase 2 — Supplier Management (AP) + Credits Account-Based Restructuring

**Priority**: P2 (Important — next after quick wins)
**Effort**: 5-8 days
**Risk to existing data**: LOW — restructuring credits is the most sensitive part, handled via migration with data preservation

---

## Context

### From the Excel data (NEXGENLTRS)
The station's pre-NexGen Excel tracking reveals:
- **Single supplier**: "mache" (used for all fuel deliveries — petrol and diesel)
- **No AP tracking**: Deliveries are recorded as received, but there's no record of whether the supplier has been paid, payment terms, or outstanding supplier debt
- **Credits tracked by name columns**: Sheet2 has columns like MGDI, KMTH, KAU, MBUVI, MBITI, NGOVI, MUSILI — these are customer names with credit amounts jotted per shift. No structured aging or account-level tracking.

### From the research
> "Accounts Payable (AP) for vendor bills (fuel deliveries, supplies, services) and payments." — *Backend Accounting Module, Section: Key Requirements*

> The ERP must handle the flow: `Supplier → Deliver fuel → Create AP Invoice → Post Entry (DR Inventory, CR AP) → Process Payment at due date` — *Backend Accounting Module, Sequence: Bulk Fuel Purchase*

### Current NexGen credit system problem
Currently, each credit during a shift creates **both** a `shift_credits` row (for shift accountability) AND a separate `credits` row (for the ledger). Payments are made against **individual credit entries**, not against the customer's account. This means:
- A customer with 5 credit purchases has 5 separate balances to track
- When they pay KES 2,000, you have to decide which specific credit to apply it against
- There's no single "account balance" to look at — you have to sum all outstanding credits
- The `credit_accounts` table exists but only aggregates via SQL queries, it doesn't hold a real balance

**The owner wants**: Credits during a shift are recorded individually (for shift accountability), but the **payment goes against the account total**, not individual credits. One customer = one balance = one payment.

---

## 2A. Supplier / Accounts Payable Management

### New tables

#### Migration 016

```sql
-- Suppliers master table
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  bank_name TEXT,
  bank_account TEXT,
  payment_terms_days INTEGER DEFAULT 0,  -- 0 = COD, 30 = net-30, etc.
  notes TEXT,
  active INTEGER DEFAULT 1,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supplier invoices (AP)
CREATE TABLE supplier_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  invoice_number TEXT,                    -- Supplier's invoice number
  delivery_id INTEGER REFERENCES fuel_deliveries(id),
  amount DECIMAL(14,2) NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',  -- 'unpaid', 'partial', 'paid'
  balance DECIMAL(14,2) NOT NULL,         -- Remaining amount
  notes TEXT,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supplier payments
CREATE TABLE supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  invoice_id INTEGER REFERENCES supplier_invoices(id),  -- NULL = general payment against account
  amount DECIMAL(14,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'bank_transfer',  -- bank_transfer, mpesa, cash, cheque
  payment_date TEXT NOT NULL,
  reference TEXT,                          -- Cheque number, M-Pesa code, etc.
  notes TEXT,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Link fuel_deliveries to suppliers
ALTER TABLE fuel_deliveries ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
```

### Backend changes

| File | Change |
|------|--------|
| New: `backend/src/routes/suppliers.ts` | Full CRUD for suppliers. GET / (list with outstanding balance), GET /:id (detail with invoices + payments), POST, PUT /:id, DELETE /:id (soft) |
| New: `backend/src/routes/supplierInvoices.ts` | POST (create invoice, optionally link to delivery), PUT /:id (update), GET / (list with filters: status, supplier, date range) |
| New: `backend/src/routes/supplierPayments.ts` | POST (record payment against invoice or general account), GET / (payment history) |
| `fuelDeliveries.ts` — POST | Accept optional `supplier_id`. If provided, auto-create a `supplier_invoices` row with `amount = total_cost`, `balance = total_cost`, `status = 'unpaid'` |
| `fuelDeliveries.ts` — GET | Join supplier name into delivery response |
| `dashboard.ts` | New card: "Supplier Payables" — total outstanding AP balance |
| `reports.ts` | Monthly report: add "Accounts Payable Summary" section |

### Data backfill (migration 016 script)

```typescript
// 1. Create supplier "Mache" from existing delivery data
const [macheId] = await trx('suppliers').insert({
  name: 'Mache', payment_terms_days: 0, active: 1
});

// 2. Link all existing deliveries to Mache
await trx('fuel_deliveries').whereNull('supplier_id').update({ supplier_id: macheId });

// 3. Create invoices for all existing deliveries (mark as paid since they're historical)
const deliveries = await trx('fuel_deliveries').whereNull('deleted_at');
for (const d of deliveries) {
  await trx('supplier_invoices').insert({
    supplier_id: macheId,
    delivery_id: d.id,
    amount: d.total_cost,
    balance: 0,          // Historical = assume paid
    status: 'paid',
    due_date: d.date,
  });
}
```

### Frontend changes

| Page | Change |
|------|--------|
| New: `Suppliers.tsx` | List suppliers, outstanding balances, tap to see detail |
| New: `SupplierDetail.tsx` | Invoices list, payment history, record payment button |
| `FuelDeliveries` form | Dropdown to select supplier (pre-populated from suppliers table). Auto-creates invoice. |
| Dashboard | "Supplier Payables" card |

### Integration safety
- `fuel_deliveries.supplier_id` is nullable — existing deliveries work fine with NULL until backfill runs
- Backfill creates the supplier and links everything, marking historical invoices as paid
- The `supplier` text column on `fuel_deliveries` is kept for backwards compatibility
- No existing queries break — new supplier data is purely additive

---

## 2B. Credits Restructuring — Account-Based Payments

### The problem in detail

Current flow:
```
Shift → Add Credit (KES 500 for Mgdi) → Creates credits row #1 (balance: 500)
Shift → Add Credit (KES 300 for Mgdi) → Creates credits row #2 (balance: 300)
Shift → Add Credit (KES 200 for Mgdi) → Creates credits row #3 (balance: 200)

Mgdi wants to pay KES 600:
  → Which credit do you apply it to? #1? Split across #1 and #2?
  → Currently must pay against individual credit IDs
```

Desired flow:
```
Shift → Add Credit (KES 500 for Mgdi) → shift_credits row (shift accountability)
                                       → credit_accounts.balance += 500 (account grows)
Shift → Add Credit (KES 300 for Mgdi) → shift_credits row
                                       → credit_accounts.balance += 300
Shift → Add Credit (KES 200 for Mgdi) → shift_credits row
                                       → credit_accounts.balance += 200

credit_accounts row for Mgdi: balance = 1,000

Mgdi pays KES 600:
  → credit_accounts.balance = 1,000 - 600 = 400
  → credit_payments records the payment against account_id (not credit_id)
  → Individual credit rows remain as historical line items (for audit/shift reports)
```

### Schema changes (Migration 016, same migration)

```sql
-- Add running balance to credit_accounts
ALTER TABLE credit_accounts ADD COLUMN balance DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Add account-level payment tracking
ALTER TABLE credit_payments ADD COLUMN payment_type TEXT DEFAULT 'account';
  -- 'account' = payment against account balance (new default)
  -- 'credit'  = payment against specific credit (legacy, kept for backwards compat)

-- credits table: balance column becomes informational only
-- (individual credit rows still track their own amount for shift reporting,
--  but payments are no longer applied to them directly)
```

### How the new flow works

#### Adding a credit during a shift

```typescript
// POST /shifts/:id/credits
// 1. Create shift_credit row (unchanged — shift accountability)
await trx('shift_credits').insert({
  shift_id, customer_name, customer_phone, amount, description
});

// 2. Find or create credit_account
let account = await trx('credit_accounts')
  .where({ name: customer_name, type: 'customer' }).first();
if (!account) {
  [accountId] = await trx('credit_accounts').insert({
    name: customer_name, phone: customer_phone, type: 'customer', balance: 0
  });
}

// 3. Create credits row (line item — for audit trail)
await trx('credits').insert({
  customer_name, customer_phone, amount,
  balance: amount,           // Individual balance (informational)
  account_id: account.id,
  shift_id, description,
  status: 'outstanding'
});

// 4. INCREMENT the account balance (this is the KEY change)
await trx('credit_accounts')
  .where({ id: account.id })
  .increment('balance', amount);
```

#### Making a payment

```typescript
// POST /credit-accounts/:id/payments   (NEW — account-level payments)
const account = await trx('credit_accounts').where({ id: accountId }).first();

if (amount > account.balance) {
  return res.status(400).json({
    error: `Payment KES ${amount} exceeds account balance KES ${account.balance}`
  });
}

// 1. Record payment against the ACCOUNT (not individual credits)
await trx('credit_payments').insert({
  account_id: account.id,
  credit_id: null,           // Account-level payment, not credit-specific
  amount,
  payment_method,
  payment_type: 'account',
  date: paymentDate,
  notes
});

// 2. DECREMENT the account balance
await trx('credit_accounts')
  .where({ id: account.id })
  .decrement('balance', amount);

// 3. Auto-settle oldest credits (FIFO — optional but clean)
// Walk through outstanding credits oldest-first and mark them paid
let remaining = amount;
const openCredits = await trx('credits')
  .where({ account_id: account.id })
  .whereNot('status', 'paid')
  .whereNull('deleted_at')
  .orderBy('created_at', 'asc');

for (const credit of openCredits) {
  if (remaining <= 0) break;
  const apply = Math.min(remaining, credit.balance);
  const newBalance = credit.balance - apply;
  await trx('credits').where({ id: credit.id }).update({
    balance: Math.max(0, newBalance),
    status: newBalance <= 0 ? 'paid' : 'partial'
  });
  remaining -= apply;
}
```

#### What the account detail looks like

```
ACCOUNT: Mgdi
Phone: 0712345678
Balance: KES 400

TRANSACTIONS:
Date        | Description              | Debit  | Credit | Running
2026-04-01  | Fuel credit (Shift #19)  | 500    |        | 500
2026-04-02  | Fuel credit (Shift #20)  | 300    |        | 800
2026-04-05  | Fuel credit (Shift #23)  | 200    |        | 1,000
2026-04-06  | Payment (M-Pesa)         |        | 600    | 400
```

### Backend changes

| File | Change |
|------|--------|
| `shifts.ts` — POST /:id/credits | Increment `credit_accounts.balance` instead of only creating a `credits` row |
| `shifts.ts` — DELETE /:id/credits/:creditId | Decrement `credit_accounts.balance` by the credit amount |
| `credits.ts` — POST /:id/payments | **Deprecate** — redirect to account-level payments. Keep for backwards compat but log warning. |
| `creditAccounts.ts` — POST /:id/payments | **New endpoint** — payment against account balance (code above) |
| `creditAccounts.ts` — GET / | Return `balance` directly from `credit_accounts.balance` instead of computing via SUM |
| `creditAccounts.ts` — GET /:id | Return account with balance, transaction history (credits + payments interleaved chronologically) |
| `creditAccounts.ts` — GET /:id/statement | Already exists — update to use `credit_accounts.balance` as authoritative |

### Data backfill (migration 016)

```typescript
// Compute and set balance for all existing credit_accounts
const accounts = await trx('credit_accounts').where({ type: 'customer' });
for (const acc of accounts) {
  // Sum all outstanding credit balances for this account
  const result = await trx('credits')
    .where({ account_id: acc.id })
    .whereNull('deleted_at')
    .whereNot('status', 'paid')
    .sum('balance as total')
    .first();
  const balance = result?.total || 0;

  await trx('credit_accounts')
    .where({ id: acc.id })
    .update({ balance });
}
```

### Frontend changes

| Page | Change |
|------|--------|
| `Credits.tsx` (mobile + desktop) | **Payment button goes to account**, not individual credit. Show account balance prominently. Individual credits listed as line items below. |
| `CreditAccountDetail.tsx` | Show single balance, transaction history (debits and credits interleaved), "Record Payment" button |
| `ShiftDetail.tsx` | Adding a credit is unchanged — still enter name, phone, amount. Display unchanged. |
| New: `CreditAccountPayment.tsx` | Payment form: amount (max = account balance), method (cash/mpesa), date, notes |

### Integration safety

- **`credit_accounts.balance`** is a new column with default 0 — existing accounts are unaffected until backfill runs
- Backfill computes the correct balance from existing `credits` rows — no data lost
- **Individual `credits` rows are preserved** — they remain as line items for shift reporting and audit
- The old `credits.balance` column stays and continues to update (for backward compatibility), but `credit_accounts.balance` is now authoritative
- `credit_payments` gains a `payment_type` column (default 'account') — existing payments keep working
- The `POST /credits/:id/payments` endpoint continues to work but internally routes to the account

---

## Build Order

1. Migration 016: suppliers table, supplier_invoices, supplier_payments, fuel_deliveries.supplier_id, credit_accounts.balance, credit_payments.payment_type
2. Data backfill: create "Mache" supplier, link deliveries, compute credit_account balances
3. Suppliers CRUD routes + frontend
4. Fuel delivery form: supplier dropdown + auto-invoice creation
5. Credits restructuring: shift credit → increment account balance
6. New: account-level payment endpoint
7. Frontend: Credits page → account-based payment flow
8. Dashboard: supplier payables card
9. Reports: AP summary section

## Verification Checklist

- [ ] Add credit (KES 500, Mgdi, Shift #21) → `credit_accounts.balance` for Mgdi increases by 500
- [ ] Add another credit (KES 300, Mgdi, Shift #22) → account balance now 800
- [ ] Pay KES 500 against Mgdi's account → balance drops to 300, oldest credits auto-settled
- [ ] Shift detail still shows individual credit line items (for shift accountability)
- [ ] Account statement shows chronological debits (credits) and credits (payments) with running balance
- [ ] Cannot overpay: paying KES 400 when balance is 300 → rejected
- [ ] Record fuel delivery → supplier invoice auto-created → shows in supplier detail
- [ ] Record supplier payment → invoice balance decreases
- [ ] Dashboard shows supplier payables total
- [ ] All existing credit data intact after migration (balances computed correctly)
