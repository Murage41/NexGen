# Phase 1 — Quick Wins: Financial Accuracy & Regulatory Compliance

**Priority**: P1 (Immediate)
**Effort**: 3-5 days
**Risk to existing data**: NONE — additive changes only, no existing columns or tables are altered

---

## Context

NexGen currently tracks sales, collections, and stock accurately at the operational level. However, three gaps identified by both industry research and real-world station operations cause **reported profit to diverge from actual profit**:

1. M-Pesa merchant fees are invisible — you think you collected KES 50,000 M-Pesa but Safaricom deposits ~KES 49,725
2. No EPRA price ceiling enforcement — risk of selling above regulated max or accidentally pricing below cost
3. Tank variance has no categorisation — a -200L dip variance could be evaporation, theft, or meter drift, but they all look the same

These are small, self-contained changes that plug directly into existing tables.

---

## 1A. M-Pesa Settlement Fee Tracking

### What the research says
> "Payments via Lipa na M-Pesa Buy Goods tills attract a merchant fee of up to 0.55%. The accounting module must subtract these fees from gross sales to provide a net-revenue view, preventing the station from overstating its available cash." — *Architectural Framework, Section: Digital Payment Ecosystem*

### What NexGen currently does
`shift_collections` stores `mpesa_amount` as a flat number. The dashboard and reports use this number as-is. There is no concept of fees deducted before settlement.

### What changes

#### Migration 015 — `mpesa_fee_config` + columns on `shift_collections`

```sql
-- New table: M-Pesa fee configuration
CREATE TABLE mpesa_fee_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fee_type TEXT NOT NULL DEFAULT 'percentage',     -- 'percentage' or 'fixed'
  fee_value DECIMAL(10,4) NOT NULL DEFAULT 0.55,   -- 0.55% for Lipa na M-Pesa Buy Goods
  effective_date TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add columns to shift_collections
ALTER TABLE shift_collections ADD COLUMN mpesa_fee DECIMAL(10,2) DEFAULT 0;
ALTER TABLE shift_collections ADD COLUMN mpesa_net DECIMAL(10,2) DEFAULT 0;
```

#### Backend changes

| File | Change |
|------|--------|
| `shifts.ts` — PUT /:id/collections | When `mpesa_amount` is saved, auto-compute `mpesa_fee = mpesa_amount * (fee_rate / 100)` and `mpesa_net = mpesa_amount - mpesa_fee` |
| `shifts.ts` — GET /:id | Include `mpesa_fee` and `mpesa_net` in shift detail response |
| `shifts.ts` — PUT /:id/close | Use `mpesa_net` instead of `mpesa_amount` when computing actual cash available (variance formula stays the same for accountability — fee is a known deduction) |
| `reports.ts` — daily report | Add `total_mpesa_fees` row showing daily fee total. Show both gross and net M-Pesa |
| `dashboard.ts` | MTD section: show `Total M-Pesa Fees` as a line item under expenses |
| New: `backend/src/routes/mpesaConfig.ts` | GET / POST for fee configuration (admin only) |

#### Frontend changes

| Page | Change |
|------|--------|
| `ShiftDetail.tsx` (mobile + desktop) | In collections section, show: `M-Pesa: KES 50,000 (fee: KES 275, net: KES 49,725)` |
| `Dashboard` | Add "M-Pesa Fees MTD" line in expense breakdown |
| Settings/Config page | Allow admin to set M-Pesa fee rate |

#### Integration safety
- **No existing data is modified.** New columns default to 0.
- Backfill script (optional): `UPDATE shift_collections SET mpesa_fee = mpesa_amount * 0.0055, mpesa_net = mpesa_amount - (mpesa_amount * 0.0055)` for historical data.
- The variance formula (`cash + mpesa + credits + expenses + wage - expected`) stays unchanged — fees are a post-collection deduction, not a collection discrepancy.

---

## 1B. EPRA Price Ceiling Enforcement

### What the research says
> "The system must enforce the EPRA Price Ceiling. When price changes occur at midnight on the 14th of every month, the ERP should automatically update the pricebook across all POS terminals and dispensers, maintaining a historical log of price changes for audit purposes." — *Architectural Framework, Section: Regulatory Fiscal Reporting*

### What NexGen currently does
`fuel_prices` stores `fuel_type`, `price_per_litre`, and `effective_date`. Prices are manually entered with no upper-bound check.

### What changes

#### Migration 015 (same migration) — columns on `fuel_prices`

```sql
ALTER TABLE fuel_prices ADD COLUMN epra_max_price DECIMAL(10,2);
ALTER TABLE fuel_prices ADD COLUMN epra_effective_date TEXT;
ALTER TABLE fuel_prices ADD COLUMN source TEXT DEFAULT 'manual';  -- 'manual' or 'epra'
```

#### Backend changes

| File | Change |
|------|--------|
| `fuelPrices.ts` — POST / PUT | Validate: if `epra_max_price` is set, reject `price_per_litre > epra_max_price` with error: `"Price KES X exceeds EPRA ceiling of KES Y for {fuel_type}"` |
| `fuelPrices.ts` — GET /current | Return `epra_max_price` alongside current price so frontend can display it |
| `fuelPrices.ts` — POST /epra-update | New endpoint: admin sets new EPRA ceiling prices (effective_date, petrol_max, diesel_max). Creates new `fuel_prices` rows with `source: 'epra'` |
| `dashboard.ts` | If current price is within 5% of EPRA ceiling, show amber warning. If price > ceiling (legacy data), show red alert. |

#### Frontend changes

| Page | Change |
|------|--------|
| Fuel Prices page | Show EPRA ceiling next to current price. Color-code: green (OK), amber (within 5%), red (exceeds). |
| Dashboard | Alert banner if any fuel type exceeds EPRA ceiling |

#### Integration safety
- **No existing data is modified.** New columns are nullable/defaulted.
- Existing prices without `epra_max_price` simply have no ceiling check (backwards compatible).
- Historical EPRA prices can be backfilled from EPRA gazette records.

---

## 1C. Tank Variance Categorisation (Shrinkage Accounting)

### What the research says
> "The ERP must categorize Natural Losses (evaporation or 'breaths') separately from Operational Losses (theft or leakage) to maintain an accurate COGS and ensure compliance with Mineral Oil Regulations." — *Architectural Framework, Section: Inventory Valuation*

> "A daily variance is expected due to measurement noise, but the ERP must track the Cumulative % Variance to identify long-term trends. Thresholds for immediate investigation typically include a consistent loss of 0.1% of monthly sales." — *Architectural Framework, Section: Core Reconciliation Formula*

### What NexGen currently does
`tank_dips` records `measured_litres`, `book_stock_at_dip`, and `variance_litres`. The variance is a raw number with no categorisation or trend tracking.

### What changes

#### Migration 015 (same migration) — columns on `tank_dips`

```sql
ALTER TABLE tank_dips ADD COLUMN variance_category TEXT DEFAULT 'unclassified';
  -- Values: 'natural_loss', 'operational_loss', 'meter_drift', 'delivery_variance', 'unclassified'
ALTER TABLE tank_dips ADD COLUMN variance_notes TEXT;
ALTER TABLE tank_dips ADD COLUMN cumulative_variance_pct DECIMAL(10,4);
```

#### Backend changes

| File | Change |
|------|--------|
| `tankDips.ts` — POST | Accept optional `variance_category` and `variance_notes`. Auto-compute `cumulative_variance_pct` as: `(SUM(all variances for this tank, this month) / SUM(all sales for this tank, this month)) * 100` |
| `tankDips.ts` — PUT /:id | Allow updating category and notes after the fact (manager reviews dip and classifies) |
| `tankDips.ts` — GET /trends | New endpoint: returns monthly cumulative variance % per tank. Flags months where loss > 0.1% of sales |
| `reports.ts` — daily report | Include variance category breakdown if dips were taken that day |
| `dashboard.ts` | New card: "Stock Variance MTD" showing cumulative % per tank with color coding |

#### Threshold alerts (in response, not push notifications)

```typescript
// In tankDips POST response:
warnings: []
// If cumulative_variance_pct > 0.1:
warnings.push(`Tank ${tankLabel} cumulative loss is ${pct}% of monthly sales — exceeds 0.1% threshold. Investigate for leaks or meter drift.`);
// If single dip variance > 150 litres:
warnings.push(`Single dip variance of ${variance}L exceeds 150L threshold — check for delivery discrepancy or theft.`);
```

#### Frontend changes

| Page | Change |
|------|--------|
| Tank Dips page | Add dropdown for variance category + text field for notes when recording a dip. Show cumulative % badge. |
| Tank Dips — history view | Color-code rows by category. Show trend chart of cumulative % over time. |
| Dashboard | "Stock Health" card showing per-tank cumulative variance % |

#### Integration safety
- **No existing data is modified.** New columns have defaults (`'unclassified'`, `NULL`).
- Existing dips remain valid — they just show as "unclassified" until categorised.
- Cumulative % is computed on-the-fly, not stored historically, so it works with existing data.

---

## Build Order

1. Create migration 015 (all three features in one migration)
2. M-Pesa fee config table + route
3. M-Pesa fee columns on shift_collections + backend logic
4. EPRA ceiling columns on fuel_prices + validation
5. Variance categorisation columns on tank_dips + trends endpoint
6. Dashboard updates (M-Pesa fees, EPRA alerts, stock health)
7. Frontend: ShiftDetail M-Pesa net display, Fuel Prices EPRA display, Tank Dips categorisation UI
8. Optional: backfill M-Pesa fees on historical shifts

## Verification Checklist

- [ ] Record M-Pesa collection of KES 10,000 → fee auto-computed as KES 55, net shown as KES 9,945
- [ ] Set EPRA petrol ceiling to KES 195 → try to set price to KES 200 → rejected
- [ ] Record tank dip with -200L variance → classify as "operational_loss" → cumulative % updates
- [ ] Dashboard shows M-Pesa fees MTD, EPRA compliance status, stock health per tank
- [ ] Daily report shows gross vs net M-Pesa, variance categories
- [ ] All existing data displays correctly (no regressions)
