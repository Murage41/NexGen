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
| 2 | ~~M7: tank low-stock alert~~ **done, on the station 2026-09-26 (update #12, `3131f77`)** | S |
| 3 | ~~M8: station profile, logo, PDF documents~~ **done, on the station 2026-09-26 (update #13, `9bd40d5`)** | M |
| 3b | ~~M10: correct an invoice customer's fuel entry before invoicing~~ **superseded 2026-09-30 by 3c (its code is reused)** | — |
| 3c | **Corrections phase 1**: one Correction record; closed shifts read their snapshot; fuel on account first (adopted 2026-09-30; **done 2026-09-30, station update #14**) | L |
| 3d | Corrections phases 2–4 (other records, meters/deliveries/stock, ledger and period lock); placement relative to M9 for the owner to confirm | L |
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

**Done: on the station since 2026-09-26 (update #12, `3131f77`), as
recommended below; the owner agreed the same day.** Owner guide: `docs/TANK-LOW-STOCK.md`; tests:
`npm run test:tank-low-stock` (10 planted bugs caught). Two details settled
while building: the order level can change during an open shift (a tank's
name, fuel and size still cannot), and the daily-sales guide counts a shift's
sales on the day it closed, as book stock does.

**Asked:** an alert when tank stock is low, configurable per tank.

**Today (verified 2026-09-26):**
- `tanks` has `capacity_litres` and `current_stock_litres`, no threshold
  (no low-stock field anywhere in backend, desktop, mobile or shared). The
  dashboard's `stock_health` (`routes/dashboard.ts` ≈ line 329) is about dip
  variance, not level.
- `current_stock_litres` is book stock: deliveries + adjustments − litres
  sold by **closed** shifts (`services/stockCalculator.ts`, `computeBookStock`).
  An open shift's sales are not in it, and the station's shifts can run over
  a day.
- **Bug found:** `GET /shifts/:id/tank-summary` for an open shift
  (`routes/shifts.ts` ≈ line 1945) adds that day's deliveries on top of book
  stock that already includes them. On the station copy the diesel main tank
  showed 7,898 L instead of 2,898 L (a 5,000 L delivery counted twice).
- The stale-shift badge (`desktop/src/renderer/App.tsx`,
  `mobile/src/components/BottomNav.tsx`) is the pattern for a nav badge.

**Practice:** automatic tank gauges raise a per-tank *Delivery Needed*
warning when the product level falls below a programmed limit, separate
from a lower *Low Product* alarm (Veeder-Root,
veeder.com/us/blog/warnings-and-alarms-veeder-root-automatic-tank-gauges).
ERPs keep a per-item minimum; falling below it triggers replenishment (Odoo
reordering rules, odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html).
The minimum is set as a *reorder point*: average daily usage × days from
order to delivery + safety stock (NetSuite,
netsuite.com/portal/resource/articles/inventory-management/reorder-point-rop.shtml).

**Recommendation (agreed by the owner 2026-09-26):**
1. One setting per tank, **"Order more at" (litres)**, blank = no alert; no
   automatic default (tanks sell very differently: on the station copy,
   2026-09-08 to 21, about 177 L/day petrol, 220 L/day diesel main, 88 L/day
   diesel 2). The admin tank form shows it as a % of capacity and, as a guide,
   the tank's average litres sold per day over the last 14 days.
2. **Stock now** = book stock − the open shift's litres sold so far (from its
   readings). One function used by the alert, the tank lists and the open
   shift's tank card (which fixes the double-counted delivery).
3. `low_stock` in the dashboard payload for **both roles** (tank, litres now,
   order level). One persistent banner on the home screens (desktop and
   phone) and a count badge on the Tanks nav item (desktop sidebar, phone
   More tab). No pop-ups, no automatic orders.
4. Migration `051`: `tanks.reorder_level_litres` (nullable). Admin-only to set.
5. Tests: stock now with an open shift, the alert on and off, the
   double-count regression, the attendant payload.

**Won't solve:** book stock is not measured stock, so losses the dips haven't
recorded make the alert late; an open shift's sales count only once its
readings are entered; nobody is notified unless NexGen is open (no SMS);
it does not place orders (M9 should link from the alert).

---

## 3. M8: station profile, logo and PDF documents

**Asked:** digitise the signboard logo (owner supplies a photo), build a
document header from it, and use it for station documents, starting with
customer invoices.

**Decided (2026-09-12):** PDFs are generated on the backend with a pure-JS
renderer (pdfmake or `@react-pdf/renderer`, no headless Chromium, not
Electron's printToPDF), **stored against the record at issue time and
re-served**, never re-rendered, so a document reprints unchanged years later.

**Logo: done 2026-09-26.** Rebuilt from the canopy photos (three equally
spaced teal rings, inner and outer C open right, middle open left, navy dot;
the damaged outer ring restored). The owner chose the version with the name
in Century Gothic Bold ("Nex" navy #263C96, "Gen" teal #00838F) and "FILLING
STATION" beneath. Files and the generator are on the development PC only:
`D:\NexGen\.claude\plans\branding\` (`nexgen-logo-final.svg`, `.png`,
`-transparent.png`).

**Today (verified 2026-09-26):**
- Station name and address live only in the desktop's `localStorage`
  (`desktop/src/renderer/pages/Settings.tsx` ≈ lines 47 and 141); nothing else
  reads them, the phone cannot see them, and clearing site data loses them.
- No PDF library and no invoice document. The only printout is the fuel
  consumption history (`InvoiceCustomerWorkspace.tsx` ≈ line 279, an HTML
  window sent to the printer).
- Customers have name, phone, KRA PIN and payment terms, but no address or
  email (`credit_accounts`). Invoices have number, period, issue and due
  dates, fuel lines (litres × agreed price), total and balance.
- Supplier invoice PDF upload/storage exists (`routes/fuelDeliveries.ts`,
  magic-byte check, size cap, relative path on the row); reuse that pattern.

**Practice:** ERPs keep one company record (logo, legal name, address, tax
IDs, contact and payment details) that every document's header and footer
reads (Odoo: Settings → Companies and Document Layout,
odoo.com/documentation/19.0/applications/general/companies.html). In Kenya,
since 1 January 2024 a business expense must be supported by an eTIMS
electronic tax invoice to be deductible (KRA,
kra.go.ke/news-center/public-notices/1944-enforcement-of-the-electronic-tax-invoice;
Tax Procedures Act s.23A), so the tax invoice stays with POSitive and NexGen
documents must say they are not tax invoices.

**Done: on the station since 2026-09-26 (update #13, `9bd40d5`), as below; the
owner agreed the same day.**
Tests: `npm run test:station-documents` (10 planted bugs caught; an 11th,
re-rendering a saved document, is harmless because the saved copy still wins).
Owner guide: `docs/STATION-PROFILE-AND-DOCUMENTS.md`. The PDFs are stored in
the database (`stored_documents`), not in files, so every backup has them;
the backup now also copies the uploaded supplier PDFs beside the database copy.

**Recommendation (agreed by the owner 2026-09-26):**
1. **Station profile** in the database, one record, edited in desktop
   Settings (admins; the phone reads it): trading name, registered name,
   location and postal address, phone, email, KRA PIN, VAT number (if
   registered), M-Pesa till/paybill, bank details, a footer note. The
   `localStorage` name and address are moved into it on first open.
2. **Logo:** the final logo ships inside NexGen as the default (it is already
   public on the canopy, and NexGen is also the software's name); a station
   can replace it in Settings (upload stored in the data folder, as supplier
   invoices are). Shown on the desktop and phone headers too.
3. **Documents:** pdfmake on the station server; one shared layout (logo and
   station details at the top, page numbers, payment details and "This is not
   a tax invoice. Tax invoices are issued through KRA eTIMS." at the foot).
   Document text uses pdfmake's bundled open font (Roboto); the logo is an
   image, so it keeps its Century Gothic lettering.
4. **First documents:** customer invoices, DN- debit note bills and credit
   notes: customer name, phone and KRA PIN; number, period, issue and due
   dates; fuel, litres, price and amount per line; total, paid, balance.
   Saved as a PDF when issued and re-served unchanged; an invoice issued
   before M8 gets its PDF the first time it is opened, saved then. Download
   and print on the desktop; open on the phone (admins).
5. Later documents (customer statements, receipts, payslips, delivery notes)
   reuse the same layout.

**Ripple:** a migration (station update backs up first), a new dependency
(`npm install` in the station update), a `documents` folder that the backup
must include, and desktop Settings changes.

**Won't solve:** eTIMS submission (stays with POSitive); emailing or
WhatsApping documents (later); customer addresses (none on file today).

---

## 3b. M10: correct an invoice customer's fuel entry before invoicing (owner, 2026-09-30)

**Superseded 2026-09-30 by §3c.** The owner judged it a fix for one case; it
was never committed. Its code becomes phase 1's fuel-on-account handler.

**Asked:** two wrong entries on an invoice customer, not yet invoiced: in one
shift diesel was recorded instead of petrol; in another, an entry the customer
never took. Can NexGen fix them before the invoice?

**Today (verified 2026-09-30):**
- While the shift is open, an administrator can change an entry's litres or
  delete it (`routes/shifts.ts` ≈ lines 1340 and 1440, `requireOpenShift`);
  the fuel type cannot be changed (delete and re-enter).
- Once the shift is closed nothing can change the entry, and a draft invoice
  can change only a line's agreed price (`routes/customerInvoices.ts`,
  `PUT /:id/lines/:lineId`), not leave an entry out. The wrong litres go onto
  the invoice.
- After issuing, credit and debit notes fix it (`docs/INVOICE-CUSTOMER-WORKFLOW.md`):
  wrong fuel = credit note for the diesel + DN- bill for the petrol; extra
  entry = credit note. A litres note can name the shift's attendant, whose
  shortage then changes at the shift's price (`services/invoiceAdjustments.ts`,
  `noteAttendant`). The customer first receives a wrong invoice plus notes.
- The "Reversed" consumption status is documented but no current route sets
  it (it came from the closed-shift corrections retired in update #8).
- A closed shift's screen recomputes its totals from its consumption rows
  (`routes/shifts.ts` ≈ line 323), so a correction must not alter them.

**Practice:** a delivery record is corrected or cancelled *before* it is
invoiced; once invoiced, only a credit note corrects it (Microsoft Dynamics
365: correct a packing slip before posting the invoice; posted-and-invoiced
packing slips cannot be cancelled,
learn.microsoft.com/en-us/troubleshoot/dynamics-365/supply-chain/warehousing/cancel-posted-packing-slip).
A return before invoicing reduces the delivered quantity, so the invoice bills
only what the customer kept (Odoo,
odoo.com/documentation/17.0/applications/sales/sales/products_prices/returns.html).

**Built 2026-09-30 as below, then superseded before commit** (its tests,
`test:entry-corrections`, caught 11 planted bugs; they became part of
`test:corrections`). Settled while
building: reasons need 10 characters (as notes); the right fuel on an entry
never exceeds what that fuel's pumps sold on the shift; a correction can be
**undone** (reason, approval) until its result is invoiced; a draft that
holds the entry is refreshed, a new fuel line added at the pump price and an
emptied line removed. The stale "Correct on shift #N" hints (left from the
corrections retired in update #8) were replaced by the Correct button.

**Recommendation (agreed by the owner 2026-09-30):** one action, **Correct entry**, on an
invoice customer's unbilled fuel entry from a closed shift (administrators,
desktop and phone, with the approving admin's PIN on the desktop as for
notes, and a reason):
1. **Remove it** (the extra entry): it stays on record marked Reversed, with
   date, reason and approver, and is never invoiced.
2. **Change it** (the wrong fuel, wrong litres or wrong customer): the entry is
   reversed and the right one recorded on the same shift, linked to it, at that
   shift's pump price for the right fuel.
3. **The attendant (optional, as with notes):** tick "the attendant of shift #N
   answers for it" and their shortage on that shift changes by the difference
   in value at the shift's prices: removing 20 L of diesel at 190 adds 3,800 to
   what they owe; diesel at 190 corrected to petrol at 180 for 50 L adds 500.
   Unticked, the difference is the station's.
4. The closed shift keeps showing what was recorded at close; the correction
   shows beside it. Stock is unchanged (pump meters measure the fuel). A draft
   invoice holding the entry is updated. After issuing, notes as today.

**Ripple:** shift views must count entries as they were at close; the
consumption history, credit-limit exposure and invoice drafts use the
corrected entries; the attendant's variances show the correction with its
reason; `docs/INVOICE-CUSTOMER-WORKFLOW.md` changes.

**Won't solve:** entries already on an issued invoice (notes, as today);
finding the mistakes (compare with the customer's issue book before invoicing).

---

## 3c. Corrections: one mechanism for every mistake (adopted 2026-09-30)

**Why:** the owner judged M10 (§3b) a fix for one case, not a long-term
design. NexGen had grown five separate correction routes (open-shift edits,
Move balance, invoice notes, payment reversal / invoice void, and M10), each
re-implementing the same effects, with gaps between them. The owner had three
independent designs written from a neutral brief; all three reached the same
core, and the owner adopted it: **one Correction record, built in phases**.
The three designs and the comparison are on the development PC only:
`D:\NexGen\.claude\plans\corrections-designs-2026-09-30.md`.

**Adopted design** ("Design 1" of the three, with "Design 2"'s cut-over
migration):
- Open records are edited (with a log). Closed records are never changed; they
  are **corrected**: a numbered Correction (C-2026-0001) whose lines reverse
  the wrong record, add the right one, or both, with a reason, an approving
  admin, a posting date (today) and an effective date (when it happened).
- **The stage decides the output, not the admin:** not yet invoiced →
  reverse/add; in a draft invoice → the same, and the draft is refreshed; on an
  issued invoice (paid or not) → the correction generates the credit and/or
  debit note itself; a locked month (phase 4) → posts in the current month.
- **Each record type has one rule** for what it does to every balance; the same
  rule runs for the original record and for its correction, so the two cannot
  disagree.
- **The attendant rule:** for each shift a correction touches, the shift's
  corrected result is the as-closed result plus the change, and NexGen's
  existing variance ledger already nets it within the shift (a surplus absorbs
  a later worsening first; `services/employeeVariances.ts` ≈ lines 176–250). An
  improvement always goes to the attendant's shift. A worsening asks one
  question: "the attendant (normal rules)" or "the station (not their doing)".
- **Closed shifts show their close snapshot**, never a recalculation; a banner
  shows the corrected result when corrections exist.
- **Undo** is a new correction that exactly cancels the old one.
- **Approval** binds the admin's PIN to exactly what the preview showed.
- **Register** of every correction; the database refuses changes to the
  recorded facts of closed shifts.
- **Migration by cut-over:** the new mechanism applies from its release; old
  notes, balance moves and past corrections stay as recorded, and nothing
  historical is recomputed.

**Corrected after checking the designs against the code** (so later sessions
don't re-litigate): NexGen already saves fuel cost per shift at close
(`batch_consumption`); already nets attendant corrections within a shift; keeps
cash and M-Pesa as per-shift totals (a unique M-Pesa code applies to payments,
not shift collections); treats fuel on account as a way a metered sale was
paid, never as stock or revenue (the meters are the sale; one of the designs
got this wrong and would have double counted fuel).

**Phases** (owner, 2026-09-30):
1. Foundation, plus the first record type (fuel on account). Spec below.
2. Other shift and customer records: credit sales (wrong customer, amount or
   shift), debt receipts and customer payments (replaces payment reversal),
   drawer expenses and wages, cash↔M-Pesa mix-ups; Move balance becomes "Move
   or write off a balance" inside the Correction (open to invoice customers);
   invoice void becomes Cancel (a full credit note); manual litres notes fold
   in (price notes stay for commercial changes).
3. Meter readings (a wrong reading moves two shifts), deliveries and supplier
   documents (fuel cost), stock.
4. The ledger (Tier 4 #17's journal design), "books closed up to [date]", and
   reports as reported / as corrected.

Sources (via the designs, checked): Microsoft Dynamics 365 Business Central,
"Correct or cancel unpaid sales invoices" and "Reverse journal postings"
(learn.microsoft.com); Dynamics 365 packing slips cannot be cancelled once
invoiced (learn.microsoft.com/en-us/troubleshoot/dynamics-365/supply-chain/warehousing/cancel-posted-packing-slip);
SAP document reversal with reason codes; Odoo credit notes, returns before
invoicing and lock dates (odoo.com/documentation/17.0/applications/sales/sales/products_prices/returns.html);
NetSuite period locking; KRA: transmitted invoices are corrected by credit/debit
notes referencing them (kra.go.ke, eTIMS).

### Phase 1 spec (go-ahead 2026-09-30; done, station update #14)

**As built** (so later phases start from it):
- `services/corrections.ts` (preview, post, undo, register, a shift's
  corrections) and one rule per record type in `services/correctionRules/`
  (`fuelOnAccount.ts`); routes `/api/corrections` (admins); approval purposes
  `correction` (bound to the plan hash, which includes the reason) and
  `correction_undo`.
- Each correction line carries its change to its shift's result; a shift's
  corrected result is the snapshot's plus those changes. The attendant part is
  one `correction` entry per shift in the variance ledger.
- A note made by a correction books only the price difference as revenue
  (`shiftValue` in `invoiceAdjustments.ts`); the station's own share of a
  worsening shows in the shift's corrected result, not in profit (the same as
  a shortage at close). Showing station-carried losses as a figure belongs
  with phase 4's ledger.
- Undo is refused once a correction made a note (correct again instead, which
  makes the opposite note), or its fuel is on an issued invoice, or a later
  correction changed its entry.
- Not built: a separate "Correct" on an invoice's fuel line (an invoice line
  sums many entries; the customer's fuel history shows each entry with its
  invoice and has Correct); a shift picker for "another shift" (the shift
  number is typed).

**Today (verified 2026-09-30):**
- A close snapshot exists (`shift_close_reconciliations`: expected sales,
  collections, credits, fuel on account, expenses, wages, total accounted,
  variance), but only for shifts closed since 2026-08-17: 46 of 116 closed
  shifts on the station copy. Shift screens recalculate a closed shift from its
  rows (`routes/shifts.ts` ≈ line 323 and the accountability block), so any
  row change moves a closed shift's figures.
- Nothing in the database stops a closed shift's rows being changed.
- M10 (uncommitted, development PC only) has the reverse/replace/attendant/
  draft/undo logic for fuel on account (`services/consumptionCorrections.ts`,
  `shared/ui/EntryCorrection.tsx`, migration 053 not pushed); it is reused
  here and its separate button, routes and tables are not shipped.

**Build:**
1. **Closed shifts read their snapshot.** Migration: create the missing
   snapshots for closed shifts without one, from their rows as they stand,
   marked `backfilled`. Shift screens (desktop, phone) and shift reports show
   a closed shift's figures from its snapshot; the lines list shows them as
   recorded at close; a banner shows "N corrections since close: corrected
   result …" when there are any.
2. **Database guards.** Triggers refuse changes to the recorded facts (fuel,
   litres, amounts, customer, shift) of a closed shift's lines, and any change
   to a snapshot. Status and link columns that legitimately change later (a
   fuel entry's invoice link and reversal status, a credit's unpaid balance)
   stay writable. The shift close writes its rows before it marks the shift
   closed.
3. **The Correction record.** Tables: `corrections` (number, what was wrong,
   reason code and note, posting and effective dates, status, approver,
   plan hash, undoes), `correction_lines` (reverse / add, record type, target,
   shift, party, fuel, litres, price, amount, who carries it, the record it
   created), `correction_reasons` (codes the station can extend). Fuel entries,
   attendant variance entries and notes gain a link to the correction that
   reversed, created or generated them. Numbering C-YYYY-NNNN.
4. **One preview-and-post service.** Preview builds the lines and every effect
   in plain words (customer, invoice, shift result, attendant, station) and a
   hash of them; the admin's PIN approves that hash (desktop: name + PIN;
   phone: the signed-in admin); posting rebuilds the plan and refuses if
   anything changed (e.g. the invoice was issued in between), in one
   transaction.
5. **First record type: fuel on account**, every error kind: wrong litres,
   wrong fuel, wrong customer, wrong shift (reverse on the recorded shift, add
   on the right one), recorded twice (reverse), missing (add). Every stage:
   unbilled; in a draft (refreshed); on an issued invoice, paid or not
   (automatic credit and/or debit note at the invoice's agreed price; excess
   credit held on account; fuel moved to another customer goes to that
   customer's unbilled fuel). Shift side always at the shift's pump price.
   The fuel on account for a fuel never exceeds what its pumps sold on the
   shift.
6. **Undo** as a cancelling correction, while nothing built on it has since
   been invoiced, issued or refunded; otherwise the screen says why.
7. **Screens (desktop and phone, admins):** one guided flow: what's wrong
   (six plain choices) → fix it (original greyed, only the wrong field
   editable, price locked to the shift's) → who carries it (only when a shift
   gets worse) → check (effects in plain words, reason code, note) → approve.
   Entry points: "Correct…" on a fuel entry in the customer's fuel history,
   on a closed shift's fuel-on-account list and on an invoice line;
   "Add missing fuel on account" on a closed shift. A **Corrections register**
   (desktop; list, filters, detail with undo). Attendants see corrections on
   their own shifts and variances.
8. **Tests:** as-closed never changes under any correction; each error kind at
   each stage; attendant rule on shortage and surplus shifts, both routings;
   notes generated correctly for paid and unpaid invoices; approval refused on
   any change; undo; database guards; mutation check. End-to-end on a scratch
   copy.
9. **Docs:** a new owner guide `docs/CORRECTIONS.md` ("before a shift closes,
   fix it; after, correct it"); `CLOSED-SHIFT-CORRECTIONS.md` and
   `INVOICE-CUSTOMER-WORKFLOW.md` point to it.

**Unchanged in phase 1:** Move balance, manual invoice notes and payment
reversal keep working as today (they fold in during phase 2). Past records are
not recomputed.

**Won't solve:** deciding which record is wrong (the issue book and
statements); eTIMS documents (the POS); other record types until phases 2–3.

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
customer's consumption correction, since answered by M10's Correct button).
Collect such issues here as they come up;
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
