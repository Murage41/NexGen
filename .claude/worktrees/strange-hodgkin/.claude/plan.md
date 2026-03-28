# NexGen Phase 6 Implementation Plan

## Overview
Implement 5 features: Two-Step Shift Close (Blind Entry), Book Stock vs Dip Variance, Credit Limits + Aging, Simple P&L Report, and Customer Statements.

---

## Feature 1: Two-Step Shift Close (Blind Cash Entry)

### Goal
Attendants submit cash/M-Pesa without seeing expected sales or variance. Admin reviews and closes.

### Backend Changes

**shifts.ts — New shift status `pending_review`**
- Add new status flow: `open` → `pending_review` → `closed`
- New endpoint: `PUT /:id/submit` — attendant submits their collections, changes status to `pending_review`
- Modify `GET /:id` to accept `?role=attendant` query param:
  - When `role=attendant`: strip `expected_sales`, `variance`, `total_accounted` from response. Also hide pump readings (opening/closing amounts) so they can't back-calculate.
  - When `role=admin` or no param: return everything as-is
- Modify `PUT /:id/close`: only allowed from `pending_review` status (or `open` for admin direct close)
- Attendants can still EDIT readings, cash, M-Pesa, credits, expenses while `open` but NOT see the accountability breakdown
- Attendants CANNOT edit readings (pump litres/amounts) — only admin can. This is the separation.

**Migration — No schema change needed**
- `status` column is already a text field, just use a new value `pending_review`

### Desktop Changes (ShiftDetail.tsx)
- No changes needed — desktop is admin-only, always sees everything

### Mobile Changes

**ShiftRecord.tsx:**
- If user is attendant: hide the "Readings" tab entirely. Attendant only sees: Money In, Credits, Money Out
- If user is admin: show all tabs including Readings (as now)
- Add "Submit Shift" button for attendants (changes status to `pending_review`)

**ShiftDetail.tsx:**
- If user is attendant: hide accountability breakdown (expected sales, variance, total accounted). Just show what they entered (cash, M-Pesa, credits, expenses)
- If user is attendant AND status is `pending_review`: show "Awaiting admin review" badge
- If user is admin: show everything as now, plus "Review & Close" button when status is `pending_review`

---

## Feature 2: Book Stock vs Dip Variance

### Goal
Compare theoretical stock (calculated from sales + deliveries) against physical dip readings to catch losses.

### Backend Changes

**New endpoint in tankDips.ts: `GET /reconciliation`**
```
For each tank:
  1. Get last dip reading (with date)
  2. Get all deliveries since last dip
  3. Get all pump sales (litres) since last dip (from pump_readings joined via pumps.tank_id)
  4. Calculate:
     - book_stock = last_dip + deliveries_since - litres_sold_since
     - variance_litres = current_dip - book_stock (if current dip exists)
     - variance_percent = (variance_litres / book_stock) * 100
```

Returns per-tank reconciliation data.

### Desktop Changes

**TankStock.tsx — Add a "Reconciliation" tab**
- New tab alongside Tanks, Deliveries, Dips
- Shows per-tank card with:
  - Last dip: X litres (date)
  - + Deliveries since: X litres
  - − Sales since: X litres
  - = Expected (Book) Stock: X litres
  - Actual (Latest Dip): X litres
  - Variance: X litres (X%)
- Color coding: green (±1%), amber (±1-3%), red (>3%)

### Mobile Changes
- Add same reconciliation view on a Reports or TankStock mobile page (lighter version)

---

## Feature 3: Credit Limits + Aging

### Goal
Set credit limits per customer and show aging buckets (30/60/90 days) for outstanding debts.

### Backend Changes

**Migration — New table `customer_credit_limits`**
```sql
CREATE TABLE customer_credit_limits (
  id INTEGER PRIMARY KEY,
  customer_name TEXT UNIQUE NOT NULL,
  credit_limit REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**credits.ts — New endpoints:**
- `GET /limits` — list all customer credit limits
- `PUT /limits/:customerName` — set/update credit limit for a customer
- `GET /aging` — returns aging report:
  ```
  For each customer with outstanding credits:
    - current (0-30 days): sum of outstanding balances
    - days_31_60: sum
    - days_61_90: sum
    - over_90: sum
    - total_outstanding
    - credit_limit (from customer_credit_limits)
    - available_credit = credit_limit - total_outstanding
  ```
- Modify `POST /` and shift credit creation: check if adding this credit would exceed the customer's limit. If so, return 400 error.

### Desktop Changes

**Credits.tsx — Add aging section and credit limit management:**
- New "Aging Report" tab showing the aging table
- New "Credit Limits" tab with ability to set limits per customer
- When creating a credit, show warning if near/over limit

### Mobile Changes
- Show aging summary on Credits page (read-only for attendants)

---

## Feature 4: Simple P&L Report

### Goal
Show a clear Profit & Loss statement: Revenue - COGS - Expenses = Profit.

### Backend Changes

**reports.ts — Enhance monthly report:**
The existing monthly report already has most of the data. Enhance it:
```
Revenue:
  - Petrol sales (litres × price, or from pump_readings.amount_sold)
  - Diesel sales
  - Total Revenue

Cost of Goods Sold:
  - Fuel purchases (from fuel_deliveries.total_cost)
  - Gross Profit = Revenue - COGS

Operating Expenses:
  - Wages (from shifts → employees.daily_wage)
  - Shift expenses (from shift_expenses, grouped by category)
  - General expenses (from expenses table, grouped by category)
  - Total Operating Expenses

Net Profit = Gross Profit - Operating Expenses
Margin = Net Profit / Revenue × 100
```

### Desktop Changes

**Reports.tsx — Add P&L view:**
- New "P&L" tab alongside Daily and Monthly
- Clean P&L statement format with sections
- Month selector
- Shows margins and comparisons

### Mobile Changes
- Add P&L view on Reports page (simplified, same data)

---

## Feature 5: Customer Statements

### Goal
Generate a running statement for a specific customer showing all credits and payments.

### Backend Changes

**credits.ts — New endpoint:**
- `GET /statement/:customerName?from=DATE&to=DATE`
  ```
  Returns:
    - customer_name, customer_phone
    - opening_balance (outstanding before 'from' date)
    - transactions[] (credits and payments in date order):
      - date, type (credit/payment), description, amount, running_balance
    - closing_balance
    - total_credits, total_payments in period
  ```

### Desktop Changes

**New page: CustomerStatement.tsx** (or modal in Credits page)
- Customer selector (dropdown from distinct customer names)
- Date range picker
- Running statement table: Date | Description | Debit | Credit | Balance
- Print button (window.print() with print CSS)
- Opening and closing balance shown

### Mobile Changes
- Same view accessible from Credits page, optimized for mobile

---

## Implementation Order

1. **Feature 1: Two-Step Shift Close** — most impactful, touches shift workflow
2. **Feature 3: Credit Limits + Aging** — needs migration, adds new table
3. **Feature 2: Book Stock Reconciliation** — read-only endpoint + UI
4. **Feature 4: P&L Report** — enhances existing report
5. **Feature 5: Customer Statements** — new endpoint + UI

## Files to Create/Modify

### Backend
- `backend/src/routes/shifts.ts` — modify (blind entry, submit endpoint, pending_review)
- `backend/src/routes/tankDips.ts` — add reconciliation endpoint
- `backend/src/routes/credits.ts` — add limits, aging, statement endpoints
- `backend/src/routes/reports.ts` — enhance monthly with P&L breakdown
- `backend/migrations/20260321_006_customer_credit_limits.ts` — new migration

### Desktop
- `desktop/src/renderer/pages/ShiftDetail.tsx` — minor (handle pending_review status)
- `desktop/src/renderer/pages/TankStock.tsx` — add reconciliation tab
- `desktop/src/renderer/pages/Credits.tsx` — add aging, limits, statement sections
- `desktop/src/renderer/pages/Reports.tsx` — add P&L tab
- `desktop/src/renderer/services/api.ts` — add new API methods

### Mobile
- `mobile/src/pages/ShiftRecord.tsx` — hide readings tab for attendants, add submit
- `mobile/src/pages/ShiftDetail.tsx` — hide accountability for attendants
- `mobile/src/pages/Credits.tsx` — add aging view
- `mobile/src/pages/Reports.tsx` — add P&L view
- `mobile/src/services/api.ts` — add new API methods
