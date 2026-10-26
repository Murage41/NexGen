# NexGen roadmap

What is left to build, in order. One release at a time; each needs the
owner's go-ahead on its spec before code (CLAUDE.md, due diligence). When an
item ships, delete its line here and record it in `PROJECT-STATUS.md`.

Earlier specifications, release cards and phase plans were removed from the
tree on 2026-10-24; read them in git (`git show f10306b:docs/ROADMAP.md`,
`f10306b:docs/IMPLEMENTATION-STAGES.md`, `f10306b:docs/releases/`). Private
analyses stay in `D:\NexGen\.claude\plans\`.

## Now

1. **Screens: workflow and look (plan below).** Step 0, the facelift of
   every screen without moving anything (owner yes, 2026-10-26), is built on
   branch `ui-facelift` as station update #18; then the phases below.
2. **Edit history for open shifts.** Every save of readings, cash/M-Pesa and
   the wage on an open shift adds who, when, old and new value; a plain
   **History** list on the shift; no restore button (re-enter through the
   normal form). Needs a migration. Practice: NetSuite System Notes
   (https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_158644279544.html).
   Today readings are overwritten; the 2026-10-23 recovery relied on leftover
   SQLite WAL frames.
3. **Shift date.** Agreed 2026-10-24 (see the screen plan's decisions);
   backend done on branch `shift-date`, screen field with phase 1.
4. **The owner's other issues** (bugs from over-complication): each with due
   diligence before code.
5. **B2 decision.** Money-only invoice credit/debit notes (`4f9b3b4`,
   migration 056) are on `main` but held back from the station until the owner
   decides after the screen review.

## Screen review plan (item 1)

Owner, 2026-10-23: the screens are plain, wordy, full of notes fields and
unasked features, and it takes too many clicks to reach things (e.g. an
employee's debt is reached from a number in the Employees table; their pay
statement only from inside a payroll run). Front-end and workflow only;
**any backend change needs the owner's approval first.** Money rules, records
and tests stay as they are. Mockups:
https://claude.ai/artifact/WvVb8WyPLxuvQaAqrJitny.

**Practice it follows**
- One page per thing (shift, employee, customer, supplier, tank): a list, then
  the record's own page with a header of key figures and tabs for its parts.
  SAP Fiori object page
  (https://experience.sap.com/fiori-design-web/v1-72/object-page), Dynamics
  365 main forms with tabs
  (https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/design-considerations-main-forms),
  Odoo's employee form with tabs and smart buttons.
- Tabs only switch views of the same record, short labels, most used first
  (NN/g "Tabs, Used Right", https://www.nngroup.com/articles/tabs-used-right/).
- Show the main task; move rare actions and history behind a tab or link
  (NN/g progressive disclosure, https://www.nngroup.com/videos/progressive-disclosure/).
- Keep the list visible beside the record on desktop; drill down on the phone
  (Microsoft list/details,
  https://learn.microsoft.com/en-us/windows/apps/design/controls/list-details).
- Phone bottom bar: 3 to 5 destinations (Material,
  https://material.io/components/bottom-navigation).
- The same words and layout everywhere; show, don't make people remember
  (Nielsen's heuristics, https://www.nngroup.com/articles/ten-usability-heuristics/).
- Shift close as in POS back offices: system works out expected money, the
  person enters the count, the difference is shown before closing (Odoo POS
  closing control).

**What changes in NexGen**
- **Shift page = the shift's work, in steps:** header (attendant, number,
  date, status, sales so far) and tabs **Readings → Money → Close →
  History**. An open shift lands on Readings. Money holds cash, M-Pesa, pay
  taken, credit sales, fuel on account, expenses, debt payments and Cash
  in/out. Close shows expected, counted and short/over, then one button.
  History holds the activity list, original close, corrections and (item 2)
  edit history. Today the desktop page stacks about 13 panels with readings
  sixth; the phone already splits Readings / Credits / Money Out.
- **Employee page:** Employees list → employee → tabs **Overview** (owed,
  earned this month, pay due) · **Shifts** · **Pay** (earnings, payroll,
  payments, statement) · **Shortages** (with Record payment) · **Pay plan** ·
  **Details**. (Credits already lists customers only; the phone's
  unreachable "Staff Debts" code goes in the tidy-up.) Payroll stays as its own page for running payroll.
- **Customer page:** Credit Accounts and Customer Invoices become one
  **Customers** list → customer → tabs **Statement** · **Fuel** (invoice
  customers) · **Invoices** · **Payments** · **Limits** · **Details**, with
  Record payment / Invoice / Refund / Move balance as header buttons.
- **Same pattern** for suppliers (bills, payments) and tanks (stock, dips,
  deliveries).
- **Menu** grouped: Today · Shifts · Customers · Expenses | Employees ·
  Payroll | Stock · Suppliers · Prices | Reports · Corrections · Settings.
  Phone keeps 5 bottom items.
- **Look:** navy menu, teal actions, light background, colour for status;
  helper paragraphs and routine notes fields removed (the manuals explain).

**Clicks for everyday tasks (desktop, today → proposed)**

| Task | Today | Proposed |
|---|---|---|
| Enter closing readings | Shifts, shift, scroll past 5 panels | Shifts, shift (opens on Readings) |
| Close a shift | Scroll to bottom, Close, tick 3 boxes, Close | Close tab, Close shift |
| See an employee's pay statement | Payroll, run, line, statement | Employees, employee, Pay |
| Record a shortage payment | Employees, Shortages number, Record payment | Employees, employee, Shortages, Record payment |
| Invoice customer's fuel | Customer Invoices, Customers tab, Open, Fuel | Customers, customer, Fuel |
| Attendant records their shift (phone) | Home, View Shift Details, Record, tab | Home, My open shift (opens on Readings) |

**How the review runs (one phase = one station update)**
1. **Shifts first:** shifts list, open shift, shift page tabs, attendant's
   phone flow, close, closed-shift view and corrections entry. Shared page
   pieces (record header, tabs, list, colours) are built here and reused.
2. Employees and payroll.
3. Customers (merge) and invoices.
4. Stock, deliveries, suppliers, prices, pumps.
5. Dashboard, expenses, reports, corrections register, settings.

For every screen, before and after, on a scratch copy of real data, as admin
and as attendant, desktop and phone: what the screen is for in one line; the
top tasks and their clicks; every field (needed? prefilled?); every sentence
on screen (move to the manual?); errors, empty and loading states; what an
attendant must not see; anything that would need a backend change (stop and
ask). Owner-reported bugs are listed per screen as they come up and fixed in
that screen's phase.

**Owner decisions, 2026-10-24:**
- Opening cash and opening M-Pesa start at **0** (not empty, not prefilled
  from anything). Frontend only; part of phase 1.
- A date on the open-shift form (item 3): today by default; an admin may pick
  an earlier day, never a future one or one before the last closed shift
  (openings continue its meter readings); calculated payroll still blocks
  its days. Backend built on branch `shift-date` (`shift_date` on
  `POST /shifts`, suite `test:shift-date`); the form field comes with phase 1.

## Later, in order

- **B3** Editable unbilled invoice fuel, draft refresh, limit and litre checks.
- **B4** Expense corrections (category, date, amount).
- **B5** Employee debts added by hand and targeted repayments.
- **B6** Office customer/invoice payments, employee receipts, refunds.
- **B7** Corrections to wages paid from the till, separate from earned pay.
- **C1** Supplier cash flow from actual supplier payments. **C2** Supplier
  payables drift audit.
- **D1–D5** Deliveries as order → goods received → supplier invoice matching;
  supplier price/document amendments; physical stock adjustments and returns.
  Meter readings are never edited.
- **E1–E2** Invoices, payments and notes on the phone (administrators).
- **G1–G5** Access: named desktop login and sessions (replacing the shared
  key), rights checks, shift handover, employee history and requests, admin
  audit page.
- **H1–H3** Staff advances linked to real money out, and their recovery,
  using employee debts (no new ledger).
- **I1–I2** Period lock; originally reported versus amended period figures.
- **J** Housekeeping, one slice at a time: input validation (pumps, prices,
  tanks), date/uniqueness rules, error logging, backup schedule/retention and
  restore tests, measured performance, phone/desktop parity, dependency
  vulnerabilities (`npm audit`: 23 findings on 2026-10-24), public-repo
  privacy (names in pushed migrations 018/023 and one-off `repair_*`/`fix_*`
  scripts), money rounding policy, API shapes and paging.
- **Production for other stations:** security baseline (Windows policy,
  Tailscale or Cloudflare Access instead of ngrok, desktop login, ODPC data
  protection, eTIMS stays with the POS). See
  `git show f10306b:docs/PRODUCTION-SECURITY-AND-COMPLIANCE.md`.
