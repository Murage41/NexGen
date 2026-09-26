# NexGen Roadmap: Pending Work

The committed source of truth for **what is left to build**, in order.
**Last checked against the code: 2026-09-24** (every item below was confirmed
still missing; parts already built are marked). Current
state and the station's version are in `docs/PROJECT-STATUS.md`; how to build
is in `docs/ENGINEERING-STANDARDS.md`.

Longer analyses (with real station data, so kept off the public repo) live on
the development PC only, under `D:\NexGen\.claude\plans\`:
`URGENT-MATTERS-PLAN.md` (M-series history), `EXECUTION-ROADMAP.md`,
`system-improvements-plan.md` (Tier 4 #16), `ledger-system-design.md`
(Tier 4 #17), `production-readiness-debug-plan.md` (Tier 5 detail). A session
in a git worktree can read them by that absolute path.

When an item ships: mark it done here (one line, commit hash), move its
outcome into `docs/PROJECT-STATUS.md`, and update any user doc it changes.

| Order | Item | Size |
|---|---|---|
| 1 | ~~M6: what attendants can see (view-only access, blind open shift)~~ **done, on the station 2026-09-26 (update #11, `157a9ec`)** | M |
| 2 | M7: tank low-stock alert | S |
| 3 | M8: station profile, logo, PDF documents | M |
| 4 | M9: deliveries as Order → GRN → supplier invoice | L |
| 5 | Invoice actions on the phone | M |
| 6 | UI and design review (owner, 2026-09-21) | M |
| 7 | Tier 4: named sessions, advances ledger, access hardening | L each |
| 8 | Tier 5: deferred audit findings | long tail |

The owner sets the order; ask before reordering.

---

## 1. M6: what attendants can see (owner decisions 2026-09-24)

**Done: on the station since 2026-09-26 (update #11, `157a9ec`).** Owner guide:
`docs/ATTENDANT-ACCESS.md`; tests: `npm run test:attendant-access`. Building it
found that "everything else" was *not* all admin-only: `GET /tank-dips`,
every `GET /customer-invoices` route, `GET /expenses` and the closed shift's
`cogs` in `/shifts/:id/tank-summary` were open to attendants. All are now
admin-only (no attendant screen used them). The phone's Pumps page also shows
the last closing reading as the pump displays it (`GET /pumps` gained
`last_closing_litres` / `last_closing_amount`, stored running totals).

**Principle: least privilege.** An attendant sees what they need to serve
customers and run their own shift, plus their own pay and shortages. They never
see the figures the owner uses to check them (an open shift's running variance,
stock variance), costs or profit, or other people's money. This is standard
POS practice: cashiers process sales and close their till but have no access
to sales reports or cost data (Lightspeed X-Series user roles,
support.vendhq.com; KORONA POS cashier roles, manual.koronapos.com; Eposly on
role-based permissions and shrink). Hiding the running balance is a *blind
close* (Microsoft Dynamics 365 Commerce, learn.microsoft.com/dynamics365/commerce/shift-drawer-management;
Lightspeed, lightspeedhq.com/blog/retail-cash-handling).

**All decided by the owner (2026-09-24):** tank fuel levels, money customers'
credit, no invoice customers, only their own debts, no variance on an open
shift; and, accepted from the recommendations (marked *(rec.)*): pumps shown,
customers' phone numbers and statements hidden, and station-wide figures
replaced by the shift status on the attendant's home screen.

| Area | Attendant sees | Hidden from attendants |
|---|---|---|
| Tanks | Fuel level (litres), capacity, % full; the low-stock warning once M7 exists | Stock value, cost per litre, FIFO/COGS, dip (book vs measured) variance, stock adjustments, deliveries |
| Pumps *(rec.)* | Name, fuel, tank, active or not, last closing reading, where the meter rolls over | Nothing sensitive there |
| Prices | Current pump prices (already: Prices tab) | |
| Money (credit) customers | Name, balance, credit limit, credit still available, over-limit / overdue warning (so they know whether to serve on credit) | Phone number and KRA PIN *(rec.)*, full statements and payment history *(rec.)* |
| Invoice customers | **Name only**, to choose when recording fuel taken on account during their own shift | Balances, invoices, notes, consumption history |
| Their own money | Pay, payments, shortages by shift and what they have paid (already: My Pay) | Other employees' pay, debts and shortages |
| Their shifts | Open shift: the readings, sales, credits and expenses they record. Closed shifts: the result, including their shortage | Open shift: expected sales, expected total, total accounted, running variance, the "Shortage" label |
| Station figures *(rec.)* | Whether a shift is open, who is on, since when | Today's sales, litres and collections, today's variance, the weekly sales chart (during an open shift today's sales *is* the expected total), reports, profit |
| Everything else | | Deliveries, suppliers, payroll, reports, settings, balance moves and corrections (already admin-only) |

**Today (verified 2026-09-24):**
- Already right: `GET /credit-accounts` gives non-admins customer accounts only
  and drops the KRA PIN (`creditAccounts.ts` ≈ lines 40, 95); other employees'
  accounts are refused; every create/edit/delete route in `tanks.ts`,
  `pumps.ts` and `creditAccounts.ts` is `requireAdmin`; `GET /tanks` returns no
  cost fields; attendants see their own shortages in My Pay (`GET /payroll/me`),
  and admin buttons show only when an admin opens someone else's pay.
- Gaps:
  - `GET /credit-accounts` still sends attendants every customer's phone and
    **invoice customers' balances**.
  - `GET /credit-accounts/:id` and `/:id/statement` let an attendant read any
    customer's full history. No attendant screen uses them (checked
    `mobile/src/pages`), so they can become admin-only for customer accounts.
  - `GET /tanks/:id/stock-summary`, `/:id/ledger`, `/:id/adjustments` carry
    cost and variance figures and are open to attendants.
  - `GET /shifts/:id` sends the open shift's expected totals and variance to
    everyone; `mobile/src/pages/ShiftDetail.tsx` (≈ lines 404-485) shows them
    with no `isAdmin` check; attendants reach it through `/shifts/:id`.
  - `GET /dashboard`'s non-admin subset (`routes/dashboard.ts` ≈ line 501)
    still sends `today_sales`, `today_litres_*`, `today_variance`,
    `today_collections`, `weekly_sales`; `mobile/src/pages/Dashboard.tsx`
    shows them.
  - The phone's `Tanks`, `Pumps` and `Credits` pages exist but only on the
    admin routes (`mobile/src/App.tsx`).

**Build (server first, then phone):**
1. `GET /credit-accounts` for non-admins: money customers → id, name,
   billing mode, balance, credit limit, available credit, limit status;
   invoice customers → id, name, billing mode only. No phone.
2. `GET /credit-accounts/:id` and `/:id/statement`: customer accounts
   admin-only (an employee still reads their own account).
3. Tank detail routes (`stock-summary`, `ledger`, `adjustments`): admin-only;
   the tank list stays open.
4. `GET /shifts/:id` for a non-admin viewer of an **open** shift: omit expected
   sales, expected shift total, total accounted, variance and anything derived
   from them (check the activity timeline and shift list too). Closed shifts
   unchanged.
5. `GET /dashboard` non-admin subset: current shift status and stale-shift
   flag only (plus low stock after M7).
6. Phone: open the existing Tanks, Pumps and Credits pages to attendants as
   read-only views (one mechanism, not new screens): every create/edit/delete
   control and admin-only link hidden; add them to the attendant navigation;
   hide the Expected / Variance card and "Shortage" label on an open shift;
   trim the attendant home screen to match item 5.
7. Tests: a backend suite that signs in as an attendant and checks every
   route above returns only the allowed fields (and 403 where admin-only);
   then an attendant session on a scratch copy of real data in the browser.

**Limit to state honestly:** the pump's own money meter still shows sales, so
a blind shift removes the easy running balance, not all arithmetic.

---

## 2. M7: tank low-stock alert

**Asked:** an alert when tank stock is low, configurable per tank.

**Today:** `tanks` has `capacity_litres` and `current_stock_litres`, no
threshold. The dashboard shows fill percentages; `stock_health` is about
variance, not level.

**Build:**
1. Migration: `tanks.low_stock_threshold_litres` (nullable = no alert); set it
   on the tank form in litres, showing the percentage too. Consider a default
   (e.g. 10% of capacity).
2. A `low_stock` list in the dashboard payload for both roles.
3. One persistent dashboard banner + nav badge (the stale-shift badge
   pattern), not repeated pop-ups.

**Watch:** `current_stock_litres` is a recomputed cache; the alert is only as
good as it. A later ordering flow (M9) should link from the alert.

---

## 3. M8: station profile, logo and PDF documents

**Asked:** digitise the signboard logo (owner supplies a photo), build a
document header from it, and use it for station documents, starting with
customer invoices.

**Decided (2026-09-12):** PDFs are generated on the backend with a pure-JS
renderer (pdfmake or `@react-pdf/renderer`, no headless Chromium, not
Electron's printToPDF), **stored against the record at issue time and
re-served**, never re-rendered, so a document reprints unchanged years later.

**Today:** no image assets or PDF library; station name/address live in the
desktop's `localStorage` (lost if site data is cleared, invisible to mobile).
Supplier invoice PDF upload/storage already exists (`routes/fuelDeliveries.ts`,
magic-byte check, size cap, relative path on the row); reuse that pattern.

**Build:**
1. Logo: SVG + PNG exports from the owner's photo, bundled (no CDN).
2. Migration + API for a station profile: legal and trading name, address,
   phone, email, KRA PIN, VAT number, till/paybill, logo. Migrate the
   `localStorage` values; repoint desktop Settings at the API.
3. PDF renderer + a `documents` storage path; shared document shell (header,
   footer, page numbers).
4. Customer invoice document using `customer_invoices.invoice_number`, the
   customer's name, address and KRA PIN, payment details in the footer.
5. **Mark every document "not a fiscal/tax invoice".** POSitive remains the
   eTIMS system of record (`docs/PRODUCTION-SECURITY-AND-COMPLIANCE.md`).

---

## 4. M9: deliveries as Order → GRN → supplier invoice (largest, riskiest)

**Asked:** split fuel deliveries like a professional ERP: (1) an order (litres,
fuel, supplier), (2) a goods received note (litres received vs ordered, where
stock updates), (3) the priced stage (the supplier's invoice, cost per litre),
with a delivery document from M8's template.

**Today:** one `fuel_deliveries` row (tank, supplier, litres, cost, date,
invoice number/file, `pricing_status` pending_price | priced). FIFO layers
(`delivery_batches`, `batch_consumption`) and stock recompute hang off it;
`supplier_invoices` / `supplier_payments` model payables.

**Build (data model written and agreed with the owner before any code):**
1. `fuel_orders` (supplier, fuel, litres, expected date, status: open /
   partially received / closed / cancelled) + order entry UI.
2. The delivery becomes the GRN, linked to an order **or none** (walk-in
   delivery must never be blocked); litres received and variance vs ordered.
   **Tank stock and FIFO batches are still created here.**
3. Pricing links to `supplier_invoices` (don't duplicate payables); keep
   `pricing_status`. Billed vs received litres differences stay visible.
4. GRN/delivery document with M8's header.
5. Existing deliveries stay valid as order-less, priced GRNs (no synthetic
   back-filled orders).
6. Regression: historical COGS must not move. Compare a monthly P&L before and
   after on a scratch copy of station data. Keep the supplier-payment void
   allocation check intact. Update both platforms' delivery screens, Tank &
   Stock, stock reconciliation reports and CSV exports.

---

## 5. Invoice actions on the phone

The phone shows invoice customers read-only. Missing: issue an invoice, record
an invoice payment, post credit/debit notes (with the attendant option) and
reverse them. Reuse `shared/ui/InvoiceNote.tsx` (it already supports the
mobile approval mode: the signed-in admin approves, no PIN prompt).

---

## 6. UI and design review

The owner deferred screen-layout problems "for when we do a UI and design
debugging" (2026-09-21), e.g. actions that are hard to find (the invoice
customer's consumption correction). Collect such issues here as they come up;
review both apps screen by screen when this item is reached.

---

## 7. Tier 4 (each its own piece of work)

- **#16 Named sessions on desktop:** "who is using this?" at start-up instead
  of the shared desktop-admin identity, so actions and approvals carry a real
  person. Build on `services/approval.ts#resolveApprover`.
  Detail: `.claude/plans/system-improvements-plan.md` Part C.
- **#17 Advances/loans ledger:** chart of accounts, journal entries,
  `ledger_parties`, advances and recoveries (closes the watchman-advance gap).
  Detail: `.claude/plans/ledger-system-design.md`.
- **#18 Full access hardening:** desktop login replacing the shared key,
  revocable session registry, `login_enabled` separate from employment,
  rights matrix, handover/dispute workflow, admin accountability page, pilot.
  Detail: `docs/EMPLOYEE-ADMIN-ACCESS-PLAN.md`.

## 8. Tier 5 (deferred audit findings, 2026-09-08; re-checked 2026-09-24)

Still open:
- Validation: of the create/edit routes, `pumps.ts` has 0 of 2 and
  `fuelPrices.ts` 0 of 3 behind a zod schema, `tanks.ts` 1 of 3. Missing
  `.finite()` on numeric fields; future dates are refused only for dip stock
  adjustments, not for deliveries or dips themselves; no uniqueness checks
  (customer phone, supplier name, tank/pump label).
- Logging: about 99 of 148 route catch blocks log nothing; no
  `unhandledRejection` / `uncaughtException` handlers in `src/index.ts`.
- No `updated_by` / `deleted_by` attribution; no admin audit-log view.
- Supplier payables have no drift check (the advances ledger would fix it).
- No `tank_dips` index; some N+1 queries on hot paths.
- Backups: `backup:database` exists, but no retention and no periodic
  restore-verification.
- Remaining phone/desktop parity gaps (list them when this is reached).

Already done since the audit (don't rebuild): pump/tank fuel-type check,
overpayments held as customer credit, M-Pesa settings and dip trends on the
desktop (Tier 3).

Detail with file:line citations: `.claude/plans/production-readiness-debug-plan.md`.
