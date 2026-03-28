# NexGen Phase 6 — Professional ERP Features

## Context
The core system is working (shifts, readings, collections, credits, expenses, wage deductions, reports). Now adding 5 high-impact features to bring it closer to professional ERP standards: blind cash entry with two-step shift close, book stock reconciliation, credit limits with aging, P&L report, and customer statements.

---

## Feature 1: Two-Step Shift Close (Blind Cash Entry)

**Why:** Prevents attendant from back-calculating expected sales and adjusting cash figures to match. The person entering money should not see the readings.

### New Shift Statuses
- `open` → `pending_review` → `closed`
- Admin can skip straight from `open` → `closed` (full access always)

### Backend Changes

**`backend/src/routes/shifts.ts`**

1. **GET `/:id`** — Add `?role=attendant` query param support:
   - When `role=attendant` AND status is `open`: strip `readings`, `expected_sales`, `variance`, `total_accounted` from response. Return only collections, expenses, credits.
   - When `role=attendant` AND status is `pending_review`: show a "Submitted" flag, still hide readings/variance.
   - Admin (no role param or role=admin): always returns everything.

2. **New PUT `/:id/submit`** — Attendant submits collections:
   - Changes status from `open` to `pending_review`
   - Validates that collections exist (cash/mpesa entered)

3. **Modify PUT `/:id/close`** — Accept from both `open` and `pending_review`

4. **GET `/current`** — Also find `pending_review` shifts

5. **GET `/`** — Support `status=pending_review` filter

### Mobile Changes

- Hide "Readings" tab for attendants (only Money In, Credits, Money Out)
- Hide Accountability Card and Pump Readings for attendants on open shifts
- "Submit for Review" button for attendants instead of "Close & Lock"
- "Submitted — awaiting admin review" banner when pending_review
- Admin sees everything always

---

## Feature 2: Book Stock vs Dip Variance

**Why:** Catches fuel losses early — theft, evaporation, meter miscalibration.

### Calculation
```
book_stock = last_dip_litres + deliveries_since_last_dip - litres_sold_since_last_dip
dip_variance = actual_dip - book_stock
```

### Backend: New GET `/api/tank-dips/reconciliation`
- For each tank: latest dip, book stock calculation, variance
- Color coding: green ±0.5%, amber ±1%, red beyond

### New Pages
- `mobile/src/pages/StockReconciliation.tsx` (Admin only)
- Desktop: integrate into Tank Stock page

---

## Feature 3: Credit Limits + Aging

**Why:** Know who owes how much for how long. Prevent over-extending credit.

### Migration: New `customer_credit_limits` table
- customer_name (unique), credit_limit (decimal, 0 = unlimited)

### Backend
- GET/PUT `/api/credits/limits` — manage limits
- Check limit before creating credits (reject if over limit)
- Aging buckets in summary: Current (0-30), 31-60, 61-90, 90+ days

### UI
- Aging columns in customer summary
- Set credit limit per customer
- Warning when near/over limit

---

## Feature 4: P&L Report

**Why:** Monthly profitability at a glance.

### Backend: Enhance monthly report
- Expense breakdown by category
- Margin percentages

### UI: P&L section in Reports page
```
Revenue (Petrol + Diesel)
- Cost of Goods (Fuel Purchases)
= Gross Profit (margin %)
- Operating Expenses (Wages, Transport, etc. itemized)
= Net Profit (net margin %)
```

---

## Feature 5: Customer Statements

**Why:** Professional collections tool — show customer their transaction history.

### Backend: New GET `/api/credits/statement/:customerName`
- Opening balance, all credits (+) and payments (-) in date range, running balance, closing balance

### UI: New CustomerStatement page
- Customer dropdown, date range picker
- Statement with running balance
- Print-friendly layout

---

## Build Order
1. Migration (customer_credit_limits)
2. Backend: all 5 features
3. Mobile UI: all 5 features
4. Desktop UI: all 5 features

## Verification
- Attendant blind entry → submit → admin reviews → close
- Tank dip variance calculation
- Credit limit enforcement
- P&L accuracy
- Statement running balance
