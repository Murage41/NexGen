# NexGen roadmap

What is left to build, in order. One release at a time; each needs the
owner's go-ahead on its spec before code (CLAUDE.md, due diligence). When an
item ships, delete its line here and record it in `PROJECT-STATUS.md`.

Earlier specifications, release cards and phase plans were removed from the
tree on 2026-10-24; read them in git (`git show f10306b:docs/ROADMAP.md`,
`f10306b:docs/IMPLEMENTATION-STAGES.md`, `f10306b:docs/releases/`). Private
analyses stay in `D:\NexGen\.claude\plans\`.

## Now

1. **Screens: workflow and look (plan below).** Facelift #18, shifts #19/#20,
   employees #21, customers list #22, stock and suppliers #23 are on the
   station, and phase 5 as #24. The screen review is finished.
2. **Edit history for open shifts** (owner asked 2026-11-04: add it to the
   existing History, include the other shift actions, leave out syncing, keep
   it easy to follow). Plan below; mockup on the board, row "Edit history".
   Owner yes 2026-11-04; built as update #25, together with **Shortages
   ledger and My Account** (below; owner, 2026-11-05: one station update).
3. **The owner's other issues** (bugs from over-complication): each with due
   diligence before code.
4. **Undo and delete recounts** (owner asked 2026-11-12 how reversals work;
   chose "all, money bugs first"). Plan below; built for update #26.
5. **Invoice customers: billed as sold, nothing left unbilled, followed up**
   (owner, 2026-11-17: removal guard and lines per shift; asked for a full
   invoice review the same day; 2026-11-18 agreed the review's plan without
   the discount per litre and the reference per fill). Plan below; built on
   branch `claude/project-thread-kh1f1p` for #27.

Done: shift date on the open-shift form and B2 (money-only invoice notes)
both went to the station with #18.

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

**Phase 4 proposal (stock and suppliers), 2026-10-28; mockups on the board
above, row "Phase 4". Frontend only; no backend change.**
- Found today (scratch copy, admin, desktop and phone): Tank & Stock shows
  the tanks twice (cards and a table) and six station-wide tabs; Stock Ledger
  and Adjustments make you pick a tank from a dropdown first. The supplier
  page stacks every bill and every payment on one long page; its "Date"
  column is really the due date and nothing marks late bills; bills don't
  say which delivery (tank, litres) they are for. Phone: **Suppliers → +**
  opens "Supplier not found" (`mobile/src/pages/Suppliers.tsx:32` goes to
  `/suppliers/new`, which no page handles); every delivery prints
  "Invoice: -".
- **Stock (renamed from Tank & Stock):** tanks list on the left (level bar
  coloured by order level), **All deliveries** under them, **Record
  delivery** on top; a tank opens its own page: header (in the tank now,
  % full, order level, last dip and its variance), buttons Record dip, Adjust,
  Edit, and tabs **Stock ledger · Dips · Deliveries · Adjustments** (the
  variance trend sits at the top of Dips). One short line when a shift is open.
- **Supplier page:** header (we owe, overdue, paid this month), Record
  payment, Edit; tabs **Bills · Payments · Details**. Bills show delivered
  date, tank and litres (from the delivery), amount, still owed, due date with
  "N days late" / "Due today", Unpaid first with an All filter.
- **Prices** stays as it is. **Pumps** moves into Settings (set up once, not
  daily work); the phone keeps Pumps under More for attendants.
- Phone: the same tank and supplier pages with chips; Add supplier fixed;
  empty invoice numbers hidden.

**Phase 5 proposal (today, expenses, reports, corrections, settings),
2026-10-29; mockups on the board, row "Phase 5". Frontend only; no backend
change. Owner yes 2026-10-30; built as update #24.**
- Found today (scratch copy, admin, desktop and phone): the dashboard's open
  shift shows a time but no date, so a shift open for six days reads
  "Started 11:06" (`desktop/.../Dashboard.tsx:206`,
  `mobile/src/pages/Dashboard.tsx:71`); "1 open shift need review"; most tiles
  open nothing; the server already returns what we owe suppliers
  (`backend/src/routes/dashboard.ts`, `total_supplier_payables`) but no
  screen shows it. Expenses mixes about 20 wage rows ("Fixed earning for
  completed shift") into the expense list, lists 18 categories, prints
  "Prev: KES 43,134.811" (`Expenses.tsx:121`, no rounding) and an Actions
  column of plain words. Reports has six tabs that each wait for a Generate
  click; Stock opens on today (empty); Cash flow says "Legacy shifts",
  "collections inferred from counted funds", "Shift Payouts Added Back"
  (`Reports.tsx:1073-1080`, phone `Reports.tsx:535-542`). Fixes live in two
  places: **Corrections** (new corrections) and **Reports → Mistakes Fixed**
  (balance moves and corrections before 23 Sep).
- **Today (was Dashboard):** warnings first (open shift with its date, tanks
  below order level), then rows Today (sales, cash, M-Pesa, on credit),
  This month (sales, profit, expenses with wages, shortages owed), Money owed
  (customers owe us, we owe suppliers, tanks). Every box opens its page; the
  week chart goes to Reports → Month.
- **Expenses:** chips **Expenses · Wages**, month arrows, this month against
  last month (rounded), bars by category, a list with the shift it was paid
  from (link) or Office; edit only on office expenses, as now. Category filter
  lists only categories used.
- **Reports:** tabs **Day · Month · Stock · Who owes us · Cash flow**, each
  showing at once (day arrows, no Generate); Day opens on the last day with a
  closed shift; plain cash-flow labels; Print stays. Figures unchanged.
- **Corrections:** one list of corrections, balance moves and the older
  closed-shift corrections, with chips by type; a row opens its detail and
  Undo as now. Mistakes Fixed leaves Reports.
- **Settings:** tabs **Station profile · Pumps · System** (open-shift warning
  hours, system check, backup).
- Phone: owner home gets the shift date and Customers owe / We owe
  suppliers; Expenses gets the same chips; Reports the same tabs and labels;
  More says Prices like the desktop.
- Practice: Business Central Role Centers (insights first, then cues that
  open their list,
  https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-designing-role-centers);
  dashboards readable at a glance, most important top left (ArcGIS,
  https://doc.arcgis.com/en/dashboards/latest/reference/author-effective-dashboards.htm);
  NN/g progressive disclosure (above).

## Edit history plan (item 2), 2026-11-04

**Today** (`backend/src/services/shiftTimeline.ts`, shown under the shift's
History tab on desktop and phone as "Activity Timeline"): it is built from the
shift's own rows, so it lists shift opened, credit sales, invoice fuel, debt
payments, wage paid from the till, review, corrections and close. It has no
readings, no cash/M-Pesa counts, expenses only as a count at close, nothing
removed (deleted rows just vanish), no opening-reading changes, and never
says who. Readings and counts are overwritten on save
(`PUT /shifts/:id/readings`, `/collections`); desktop and phone save
automatically 1.2 s after typing stops (`ShiftDetail.tsx:175`,
`ShiftRecord.tsx:112`), so one sitting makes many saves.

**What changes**
- New table `shift_history` (migration 057): shift, what (readings, opening
  readings, cash and M-Pesa count, entry removed), the changed figures as
  old → new, who, when. Written by the server in the same save, only when a
  figure really changed. Rows are never edited or deleted (database guard).
- Who: the phone user's name; the desktop shows **Station PC** until the
  desktop has its own sign-in (G1).
- Recorded: closing readings entered or changed, opening readings changed,
  cash and M-Pesa counts entered or changed, and credit sales, invoice fuel,
  expenses and debt payments removed, invoice fuel litres changed. Additions already come
  from their own rows; expenses get one line each.
- **Kept short** (the owner's ask): saves of the same thing by the same
  person within 10 minutes show as one line with the first old figure and
  the last new one; figures that end where they started drop out; a first
  entry shows a summary ("3 pumps · sales KES 92,371", "Cash 21,400 · M-Pesa
  33,880"), a change shows only what changed. Syncing never shows. Every raw
  save is still kept for recovery.
- One History list, latest first (owner), plain titles (Credit sale, Expense,
  Closing readings changed, Shift closed), colour dot: added, changed,
  removed. No restore button.
- Won't solve: changes made before this update are unknown; desktop changes
  name the PC, not the person, until G1.
- Tests: new suite `test:shift-history` (a no-op save writes nothing, grouping,
  revert drops out, removal recorded, attendant only on own shift), with a
  mutation check.

Practice: NetSuite System Notes record field, old value, new value, who and
when on every save
(https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_158644279544.html);
Odoo field tracking logs "old → new" with who and when in the record's own
history (https://www.dasolo.ai/blog/odoo-data-api-5/odoo-tracking-field-explained-127).

## Shortages ledger and My Account (owner, 2026-11-04), built with #25

**Today:** the admin's employee page **Shortages** tab and the attendant's
**My Pay** use `shared/ui/EmployeeVariances.tsx`: a table of shortages per
shift (paid, still owed, worked out oldest first) and, below it, a separate
"Payments and moves" list. My Pay (`shared/ui/EmployeePayView.tsx`, server
`employeePayStatement` in `backend/src/services/employeePay.ts`) stacks three
tiles, the pay plan, shifts not yet in payroll, payroll runs and the
shortages on one long page.

**What changes**
- **Shortages = one dated list**, latest first (owner) by the time each was recorded:
  shortages, corrections that change one, payments, balance moves and the old
  records, each with amount and "owed after". Red adds to what is owed,
  green takes it off. **Still owes** on top. Admin keeps Record payment,
  Move balance and Reverse. Surpluses stay out (they are the station's).
  Server: one `ledger` list on the existing statement, built from the
  posted variance entries in `created_at` order; no database change.
- **My Pay becomes My Account** (phone bottom bar), with two chips:
  **Pay** (paid this month, in payroll but not paid, not in any payroll
  yet; my pay plan in full; then the lists: not in payroll yet, payroll
  runs, paid to me with date and how) and **Shortages** (the same dated
  list, read-only).
- The admin's employee **Pay** tab uses the same Pay view, so both sides read
  the same.
- Practice: an account statement in date order with a running balance
  (QuickBooks customer statements,
  https://quickbooks.intuit.com/learn-support/en-us/accounts-receivable/create-and-view-customer-statements/00/186219);
  one record per thing with tabs (SAP Fiori object page, above).

## Undo and delete recounts (owner, 2026-11-12), built for #26

**Today** (audit 2026-11-12): most figures already recount from active
entries (shift figures, account and invoice balances, shortages, stock).
Found: archiving a customer marked all their debts and payments removed
(`routes/creditAccounts.ts`), so old shifts lost those receipts; a supplier
bill paid by a general payment could be deleted (`routes/supplierInvoices.ts`
checked only `invoice_id`); debt, bill and batch balances were reversed by
adding back, capped, and nothing checked them; the Today drift check re-added
the stock history per dip (1.4 s at a year, 3.4 s at two); shift tank figures
were never recounted after a late delivery; removing an open-shift credit with
a payment half-removed it.

**What changes**
- Archive hides the account only; checks owed and held from records; history
  reports keep archived customers.
- Supplier bill delete refused with any live payment or allocation.
- Reversals recount debts, bills and fuel batches (`services/cacheRecounts.ts`);
  the drift check and System check compare all three; dips in one pass.
- Late delivery or adjustment recounts closed shifts' tank litres.
- Open-shift credit with a payment: refused (as Cancel shift).
- Station data copy (to shift #157): no archived customers, no drift in
  debts, bills or batches, no untracked supplier payments; no repair needed.
- Practice: a customer with entries is blocked, not deleted
  (https://learn.microsoft.com/en-us/dynamics365/business-central/receivables-how-block-customers);
  payments are unapplied before a paid entry is cancelled
  (https://learn.microsoft.com/cs-cz/training/modules/enter-payments-dynamics-365-business-central/3-unapply,
  https://odoo-modules.trobz.com/oca/account-reconcile/18.0/account_move_reconcile_forbid_cancel.html);
  open items reconcile to their source entries
  (https://docs.oracle.com/en/cloud/saas/financials/24b/faugl/account-reconciliation-and-subledgers.html).
- Won't change: undo of a payment correction re-pays debts oldest first, so
  which debt shows as paid can differ; totals are exact.

## Invoice customers (item 5), 2026-11-17

**Today:** removing a customer (`routes/creditAccounts.ts`, DELETE) checked
unpaid issued invoices and held credit only, so an invoice customer with fuel
not yet invoiced or a draft could be removed and that fuel dropped off the
invoice lists (reachable through the server only: no screen offers Remove for
invoice customers). The switch to money billing already checked both. The
invoice PDF (`services/documents.ts`) shows one line per fuel; the desktop
invoice screen already lists each shift entry.

**What changes**
- One check, `invoiceWorkLeft`, for removal and the switch to money: live fuel
  on no invoice (open or closed shifts) or a draft invoice refuses it, saying
  the litres, shifts and dates. Built; suite `test:reversal-recounts`.
- The invoice PDF keeps the fuel summary and amount due, then a **Fuel by
  shift** table (date, shift, fuel, litres, amount at the invoice price).
  Litres (meters give 3 decimals) and amounts are shared out by largest
  remainder so the rows add up exactly to each line; an invoice whose entries
  don't match its lines keeps one line per fuel. PDF only
  (`services/documents.ts`, `fuelByShift`), no database change; invoices
  already issued keep their saved PDF. A month is about 2 to 3 pages. Built; suite `test:station-documents`.
- Practice: a customer with open entries is blocked, not deleted
  (https://learn.microsoft.com/en-us/dynamics365/business-central/receivables-how-block-customers);
  one invoice for many deliveries keeps each delivery traceable
  (https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-to-combine-shipments-on-a-single-invoice);
  fleet customers check fuel invoices transaction by transaction
  (https://www.automotive-fleet.com/146368/how-to-audit-fleet-fuel-invoices).
- Won't show vehicle or issue-book numbers (NexGen doesn't record them).

**Invoice review, 2026-11-17** (doc: https://claude.ai/artifact/VBijrN7d9QikRCFgY6D92h).
Found on the station data copy: a draft took only fuel between its From and
To dates, so a sale older than the From date was never billed; the default
price was one rounded average per fuel, which overcharged an invoice slightly;
invoices went out 5 to 6 weeks late; Overdue showed only with a repayment
limit, which the customer did not have; fuel corrections skipped the credit
limit. Built (no database change):
- A draft takes every unbilled closed-shift fill up to one date (no From
  date); lines are one per fuel and pump price, each line the sum of the
  amounts recorded at the pump; typed prices and the line price editor are
  gone (`services/invoiceDraftReservations.ts`). Fuel by shift rows show the
  pump amounts. Suites `test:invoice-draft-reservations`, `test:station-documents`.
- Overdue (any invoice past its due date), Over limit and Not invoiced (fuel
  waiting over 35 days) for invoice customers, on the Customers lists and as
  Today reminders, desktop and phone (`services/invoiceCustomerMonitor.ts`).
- Statement of account PDF, made when opened and not saved: balance brought
  forward, activity with running balance, open invoices, ageing, fuel not yet
  invoiced (`statementDocument`). Suite `test:invoice-followup`.
- Fuel corrections that raise what a customer owes check the credit limit and
  record the approval (`correctionRules/fuelOnAccount.ts`, `test:corrections`).
- Practice: KRA eTIMS needs an e-invoice for every fuel sale in real time
  (https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-fuel-station-system);
  statements, reminders and ageing to collect
  (https://learn.microsoft.com/en-us/dynamics365/business-central/receivables-collect-outstanding-balances);
  bill what was delivered, nothing left behind
  (https://www.odoo.com/documentation/17.0/applications/sales/sales/invoicing/invoicing_policy.html);
  fuel cards bill monthly and tie each sale to a vehicle
  (https://nationaloil.co.ke/fuel-cards/).
- Not built (owner, 2026-11-18): a discount per litre, a reference per fill.
  Open with the owner: payment terms and a credit limit for the invoice
  customer; whether POSitive issues an eTIMS receipt per credit fill.

## Later, in order

- **B4** Expense corrections (category, date, amount).
- **B5** Employee debts added by hand and targeted repayments.
- **B6** Office customer/invoice payments, employee receipts, refunds.
- **B7** Corrections to wages paid from the till, separate from earned pay.
- **C1** Supplier cash flow from actual supplier payments. **C2** Supplier
  payables drift audit (bill balances are checked since #26; supplier totals
  and statements remain).
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
