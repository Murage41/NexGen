# NexGen: staged implementation plan

Planning baseline: 2026-10-15. The owner instructed us to proceed with this
sequence, starting with A1. This does not bundle the later releases or grant
permission to commit, push or deploy every item. Keep each release's concrete
scope and checkpoint explicit.

Current station: `c5c4ee8`, migration `054`. The next station update is #16;
assign its exact contents and commit only when that release is ready.
Later release IDs below are planning labels, not station update numbers.

Read with [ROADMAP.md](ROADMAP.md), [PROJECT-STATUS.md](PROJECT-STATUS.md),
[ENGINEERING-STANDARDS.md](ENGINEERING-STANDARDS.md) and
[SIMPLIFIED-FINANCE-AND-SHIFT-CORRECTIONS.md](SIMPLIFIED-FINANCE-AND-SHIFT-CORRECTIONS.md).
The opening-float specification is [SHIFT-FLOATS.md](SHIFT-FLOATS.md). It
defines A3's field meanings, arithmetic, historical compatibility and examples.

## Status and rules for this sequence

- A1 is isolated on attached worktree branch `codex/remove-mpesa-fees`, based
  on station `c5c4ee8`. All 36 backend suites, three type checks, both client
  builds, two planted regressions and scratch API/UI checks pass. No schema
  change or old 2b/A4 behavior is included. The owner authorised A1 publication
  on 2026-10-16; publication is blocked by unavailable GitHub/network access.
  Station installation and the owner's checkpoint remain. Original mixed work
  is preserved. Do not start A2 before that checkpoint.
- Every other release below is **not built as an agreed complete release**.
  Existing helpers, screens and selected uncommitted code can be reused after
  review; that does not make a release complete or authorise all old 2b work.
- Preserve existing local work. Start the approved release from the station's
  known code and preserve the older 2b work separately; do not reset, revert
  unrelated files, or quietly include that whole change set.
- One row is one release. Finish its evidence, installation and station
  check before starting a dependent release. A group letter is never a
  bundled update containing all of that group's rows.
- Keep pump readings fixed in finance work. Do not reopen/reclose a shift or
  replay FIFO to change money, debts, billing allocation or expenses.
- Keep original close snapshots, issued documents and historical allocation
  evidence. Show the current financial position consistently alongside them.
- A debt/payment adjustment is not automatically an employee charge. Review
  actual responsibility and amounts already charged or repaid.
- Reuse existing posting/allocation/approval mechanisms. This plan does not
  commission another correction engine or a general ledger for floats.

## Definition required before each release

Write a short release card before implementation, including:

1. The one user workflow or system being delivered, with example inputs and
   expected money/stock/debt outputs.
2. Exact routes, screens, packages and historical records affected; explicitly
   list excluded work and any reused 2b code.
3. Required decisions, dependency release IDs and migration/backfill policy.
4. Numeric acceptance cases, permission/conflict/duplicate-request cases,
   comparison evidence and the station check the owner will perform.
5. Rollback/recovery steps that preserve business entered after installation.

A broad row must be divided before code, never enlarged while implementing.
Use suffixes for additional bounded releases, such as `J1a` or `J6a`, and
give each its own card, checks and station update. Do not leave several
route families, pages or dependency packages hidden inside one release.

## Gates applying to every release

- Read the current status, relevant standards and agreed release card;
  reconcile unknown Git changes without overwriting another session's work.
- Type-check each touched package and run the full registered backend suite.
  Build affected clients, including the served mobile production build.
- Money and permission changes need meaningful tests and planted-bug checks;
  prove the backend before wiring its UI. Document any genuinely inapplicable
  gate rather than silently skipping it.
- Obtain a fresh verified station copy before migrations or historical-read
  changes. Test only an isolated scratch copy, never the development copy of
  real station data or a development ngrok tunnel.
- Compare pre/post figures and underlying records. Original closes and issued
  source/documents must remain unchanged. For an approved physical/cost
  amendment, show exactly its intended stock/COGS delta and unaffected records.
- Run relevant integrity audits. Stop isolated servers and finish with
  `node scripts/e2e/fingerprint.cjs check` reporting `REAL-DB-UNCHANGED`.
- Verify desktop and phone where both are affected, using admin and attendant
  roles as appropriate. A blocked visual check remains unfinished work.
- Update owner guides, roadmap and status. Commit/push only when requested;
  install one update with its own backup/check command block in station
  Command Prompt. The owner confirms the release's actual station case.
- Do not advance to dependent work until that station check passes. Restore
  verification precedes risky migrations; never restore an old database over
  newer station business as a casual application rollback.

## A. Establish the approved financial baseline

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| A1 | Isolate the approved station baseline and remove M-Pesa fees from runtime, API, settings and both clients. | Shipping all old 2b; rewriting historical fee columns or pushed migrations. | Development checks and visual verification pass on the isolated candidate; commit/release and station checkpoint remain. |
| A2 | One common current-financial reader for shift detail, daily/dashboard and relevant period totals; original close remains accessible. | Changing source readings, original snapshots or physical stock; a new correction engine. | The same amended case gives identical current totals everywhere; original figures remain reproducible; read-only views change no money. |
| A3 | Complete opening-float and custody reconciliation system under `SHIFT-FLOATS.md`: manually enter opening cash and opening M-Pesa before opening; coherent closing figures/readers and minimum explicit money-in/out where needed. | Previous-shift lookup, inferred/default carried balances, automatic inter-shift transfers, loan/general-ledger work. | Both declarations required, explicit zero valid; opening/closing and movements reconcile; float creates no sale/profit; a later shift uses only its own declaration. |
| A4 | Correct independent closing cash and M-Pesa totals with reason, approval, history and conflict checking. | Receipt-per-transaction capture; requiring the combined total to stay unchanged; modifying opening floats or meters incidentally. | Cash-only, M-Pesa-only and combined changes work; variance and reports agree; original close, later openings, tank records and FIFO stay unchanged. |

A3 can be developed internally in this order: opening fields and form;
reconciliation formula; shared readers/reports; minimum manual money-in/out;
desktop/phone verification. Enable and ship the complete system only when all
parts agree. Do not expose half-enabled opening funds to a live shift.

A3 uses actual money held at closing for new balance-based shifts, as defined
in `SHIFT-FLOATS.md`. Legacy shifts retain their original basis. Label every
figure accordingly; opening float must never be counted as sales, treated
as a fresh receipt, or deducted twice.

## B. Finish one financial record family at a time

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| B1 | Customer credit and shift debt-receipt changes, using exact debt/payment allocations and exposure controls. | Meter revenue changes, invented receipts, or automatic charges against attendants. | Wrong customer/amount/method, duplicate and missing cases yield correct customer balances; real cash counted once; employee impact separately approved. |
| B2 | Freeze issued invoice source consumption and provide suitable linked monetary credit/debit notes, retained payments and correctly held customer credit/refund due. | Replacing issued litres/customer/shift/source; silently releasing fully credited fuel back to unbilled; rebuilding B6's payment/refund workflow. | Source and original PDF unchanged after notes, full credit and partial payment; additional/reduced money due remains actionable; existing receipt/refund paths still work. |
| B3 | Editable unbilled invoice fuel; refresh reserved drafts; normal limit/approval and pump/fuel litre controls. | Bypassing B2, extra stock consumption, or inventing another sale. | Unbilled changes refresh the draft correctly; exposure increases checked; invoice litres do not exceed metered litres; issued source still refused. |
| B4 | Drawer/office expense amendments with category, date, reason and the correct expense/reconciliation effect. | Fake cash receipt to cancel expense; changing fuel cost or wages earned. | Missing/duplicate/wrong expense changes expense totals once; actual cash and any employee responsibility remain separately explainable. |
| B5 | Manual employee debts and targeted new repayments, including debts added by hand; preserve historical repayment allocations. | Reallocating old repayments oldest-first, shortages reducing wages, or a customer edit automatically charging staff. | New receipt names its debt; overpayment against that debt refused; historical applications unchanged; already-paid/adjusted cases retain real money evidence. |
| B6 | Office customer/invoice payments, employee receipts and genuine refunds using existing posting/reversal/allocation helpers. | Treating debt adjustment as new cash, automatic refund payout, or deleting payment history. | Wrong account/date/method/amount, reversal, held credit and genuine refund produce correct allocations and cash flow, including already-settled cases. |
| B7 | Drawer wage-payment amendments and related payroll-payment records, separate from earned wages and employee debt. | Recalculating earned pay from unrelated money changes or paying wages twice. | Correcting paid amount/method changes payout/reconciliation once; earned wages and actual existing repayments remain intact. |

B2's source guards and monetary actions are one release: shipping only the
guard would leave issued-invoice mistakes without a usable remedy.

Before B5/B6, agree the ordinary form's distinction between actual money and
a balance-only adjustment. The chosen representation must keep cash flow
truthful; this plan does not re-adopt old unmarked fake-payment proposals.

## C. Make supplier money reports trustworthy

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| C1 | Supplier cash outflow from actual posted supplier payments, using real dates/methods/reversals after checking historical coverage. | Delivery value as presumed cash paid; changing supplier debt or fuel valuation. | Unpaid delivery has zero cash outflow; partial/late/reversed payments appear correctly; expense/COGS is not deducted again. |
| C2 | Dedicated supplier-payables drift audit over bills, allocations, payments and balances, with clear findings. | Requiring the advances ledger or silently repairing financial records. | Clean fixtures reconcile; planted missing/double allocation or balance drift is detected; audit is read-only. |

## D. M9 procurement and physical fuel work

Agree the complete order/receipt/bill data relationships before D1; ship each
vertical slice separately. Every slice remains usable with old deliveries.

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| D1 | Fuel orders: supplier, fuel, litres, expected date and open/partial/closed/cancelled lifecycle; manually start an order from low-stock warning. | Automatic orders; creating stock, FIFO cost or supplier debt from an order. | Create/change/cancel and permissions work; stock/payables unchanged; orders can later accept partial receipts. |
| D2 | GRNs: actual receipt linked to an order or none; partial receipts and variance; delivery document with station header. | Blocking walk-in deliveries or backfilling synthetic historical orders. | Receipt creates tank/FIFO quantity once; partial/order-less cases work; legacy deliveries remain valid; both delivery screens/exports agree. |
| D3 | Supplier-invoice matching and pricing using existing payables and pending-price state. | Duplicate supplier bills/debts or confusing billed litres with received litres. | Match partial/multiple receipts as agreed; billed/received differences visible; historical monthly COGS and payment-allocation guards preserved. |
| D4 | Supplier document and price amendments with linked history and controlled valuation consequences, including a delivery batch price changed after some litres sold. | Blanket stock quantity changes or unconditional replay of every tank. | Partly consumed batch gives the known remaining-stock and consumed-COGS deltas; correct bill/payment balances; recost only affected fuel; unrelated tanks/periods unchanged. |
| D5 | Physical receipt/delivery/stock adjustments and returns with evidence, dip reconciliation and affected FIFO handling. | Customer note creating tank fuel; meter edits; changing original close snapshots. | Quantity change reconciles book stock/dips; required cost replay bounded and explained; real return and supplier credit/payment remain distinct. |

D4/D5 need their own small-case design before code: unconsumed versus consumed
fuel, backdated records, missing batches, and supplier credit versus actual
cash refund. Split by physical workflow further if one release is too large.

## E. Complete invoice work on the phone

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| E1 | Admin draft/review/refresh/issue invoice flow using the agreed source boundary and stored documents. | New billing rules or attendant access to invoice balances. | A phone admin issues and opens the same invoice/PDF as desktop; repeat submission creates one invoice. |
| E2 | Phone invoice payments and monetary notes with permitted reversals, using shared controls and signed-in approval. | Restoring obsolete attendant-liability options or issued-source edits. | Notes/payment/reversal scenarios match desktop balances and history; denied attendant requests expose no private data. |

## F. Review usability after the money workflows settle

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| F1 | Shift workflow review: opening/float, recording, saving, reconciliation and close on both clients. | Replacing financial rules or combining unrelated business pages. | Owner completes agreed shift tasks without hidden actions; unsaved/conflicting work and original/current figures are clear. |
| F2 | Business-page review: customers, procurement, stock and reports against a bounded prioritised issue list. | An unlimited redesign or reopening finished accounting decisions. | Each listed issue has a demonstrated before/after result; desktop and phone layouts checked. Split by page when needed. |

## G. One identity and access system

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| G1 | Named authenticated desktop identity and revocable sessions; `login_enabled` independent of employment/payroll; credential reset/strength/throttling, expiry/recent authentication and safe startup/secret handling. | A separate unauthenticated name picker to replace again later; changing pay/employment when access is disabled. | Admin stays able to sign in; disable/reset/demotion/logout revoke access; shared header and embedded secrets grant no privilege; session/security rollout proven. |
| G2 | Remaining server rights inventory, own-record/nested-ID checks, shared-device draft/cache isolation and appropriate session controls; move pump synchronisation/setup out of screen GETs into explicit writes. | Rebuilding M6 restrictions already present or hiding secrets only in UI. | A/B identities, forged IDs, exports/documents and stale offline replay prove isolation; opening a page changes no pump records; authorized shift recording still works. |
| G3 | Handover submit/return/review/finalise against exact revisions, separate from financial close. | Submission creating debt, paying wages, or silently discarding actual cash. | Returned/changed/duplicate submissions preserve versions; only approved finalisation posts financial effects once. |
| G4 | Employee full history, own statements and requests/disputes with admin responses. | Request or acknowledgement automatically changing debt or authorising deductions. | Employee traces totals to source records, sees request status, and cannot view another employee; admin totals agree. |
| G5 | Admin audit/accountability page and required who/when/reason attribution; protected history and last-admin safeguards. | Logging credentials or treating a displayed name as authenticated identity. | Approval/amendment can be traced to actor and effect; audit cannot be deleted; last admin protected. |

Before broad staff rollout, complete a supervised pilot covering sign-in,
shared-device logout, a whole shift, handover, own pay/debt and a request.
An unresolved isolation issue blocks expansion; disable/revoke staff access
without undoing business data. The pilot is a release gate, not a large
additional feature bundle.

## H. Advances through the existing employee debt system

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| H1 | Issue a labelled employee advance through the existing employee debt records, linked atomically to the actual cash/M-Pesa/bank outflow and its funding source. | New chart of accounts/journal engine or bank-balance subsystem; paying it as earned wages; treating principal as an expense. | Issue once, duplicate/refused request and reversal cases yield known debt and actual money out; non-attendant employees work without app login. |
| H2 | Targeted manual advance recovery, outstanding/overdue statement and correction history, reusing B5's debt/receipt controls. | Reminders, automatic deductions, redistributing old repayments or recording recovery as income/negative expense. | Advance 100 less actual repayment 40 leaves 60, one outflow and one receipt; partial/full/overpayment/reversal cases preserve the exact application. |
| H3 | Only if needed, explicit admin-recorded advance recovery alongside a payroll/drawer payment, preserving earnings and actual money movement. | Automatic payroll deduction, copying old expense-based recovery postings or charging the same recovery twice. | Gross earned pay, net paid money and principal recovered reconcile; no duplicate expense or receipt; staff pay statements explain each part. |

After B5 and A3, check the existing nullable-shift employee debt entries and
funds-movement links before adding any storage. The old local ledger design is
historical reference; a new general ledger is not a dependency or approved
scope. Keep separate advance labels and targeted applications without changing
the established no-payroll-recovery rule for employee shortages. H3 requires
an agreed operational need and may be omitted. Opening migrated advance balances
require owner-verified evidence; never invent a historic payment or publish
private planning data.

## I. Period controls and reproducible reports

| Release | Scope | Not included | Required evidence before moving on |
|---|---|---|---|
| I1 | Books-closed-through-date policy across relevant financial/stock writes, with auditable privileged reopening if agreed. | Arbitrary lock bypass or assuming only one new journal table needs checking. | Every in-scope write route respects the date; unauthorized/backdated/concurrent attempts leave records unchanged. |
| I2 | Period reports as originally reported versus later amended, with explanations and matching exports. | Rebuilding A2's common reader or silently replacing original issued period evidence. | Reproduce a saved period, post an allowed later amendment, and explain the delta without losing its original report. |

## J. Finish verified audit findings in bounded releases

Each J row starts with a fresh code inventory because the old audits contain
completed and superseded items. Its release card names the exact route
family, page or package. Complete only that bounded slice; record additional
slices under the same ID with suffixes and install them separately.

| Release | Scope boundary | Required evidence before moving on |
|---|---|---|
| J1 | Remaining validation, one route family per slice: tanks, pumps, prices, then genuinely uncovered financial routes. | Every selected create/edit route validates finite numbers, enums, strings and nullable fields; invalid requests change nothing. |
| J2 | Date/uniqueness rules, one agreed entity family per slice; review existing duplicates before constraints. | Future/backdated policy consistent; legitimate existing records preserved; duplicate/race and migration cases covered. |
| J3 | Error logging/process handling, one backend module group per slice; secrets redacted. | Each scoped failure is logged/actionable; process-level handling tested; no credentials or full private payloads logged. |
| J4 | Backup scheduling/health, retention, then restore verification as separately defined operational slices. | Schedule can be verified; retention keeps agreed copies/uploads; isolated periodic restore actually runs and reports failure. |
| J5 | Measured performance, one hot path/query family per slice; justified indexes and grouped queries. | Before/after timing/query counts improve; calculations, ordering and permissions unchanged. |
| J6 | Remaining parity, one verified missing phone/desktop workflow or page per slice. | Positive and denied workflows match across clients; completed or intentionally desktop-only functions not rebuilt. |
| J7 | Dependency vulnerabilities, one compatible package/change set per slice. | Audit finding addressed or disposition recorded; full regressions/builds pass; no unreviewed broad upgrades. |
| J8 | Owner-decided public-repository privacy cleanup, one document/script category per slice. | No private names/data newly exposed; safety guards preserved; pushed migrations not rewritten; history limitation stated. |
| J9 | Money/cost precision, starting with normal FIFO multiplication/accumulation and output rounding; define the rounding policy before changes. | Fractional litres/cost fixtures give the agreed cents across stock/COGS/profit; repeated calculation is stable; any historic delta is explained before rollout. |
| J10 | API response contracts and pagination, one route family per slice, including numeric/boolean shapes and unbounded lists. | Shared clients handle identical validated shapes; paging neither loses nor duplicates records; permissions and report totals unchanged. |

J1-J10 are scheduling slots, not permission for whole-category sweeps. Before
starting one, enumerate its suffix releases and acceptance cards. For example,
backup health, retention and restore verification must not become an opaque
single change; nor may J6 silently absorb every screen in both applications.

## Focused cases that must survive the sequence

- An opening declaration is explicit even when zero; it is entered before
  opening. Changing an earlier shift never changes a later declaration.
- No-activity money held equal to opening float reconciles without sales.
  Any explicit money-in/out affects the named custody once, not revenue.
- Independent closing totals can rise/fall separately; actual missing money
  remains a responsibility issue, not proof that a customer paid or did not.
- Moving the same genuine debt/payment between customers does not itself
  justify charging an employee. Existing shortages/repayments are checked.
- Issued consumption/PDF stays fixed through partial payment, full credit,
  additional notes and later refunds. Unbilled changes never remove fuel twice.
- Recovering customer/employee debt or advance principal is not another sale;
  a supplier payment is not a second fuel expense.
- A genuine supplier return is stock movement; a credit note is a money/debt
  document; an actual refund is a separate cash/bank/M-Pesa event.

## Supersession and coverage map

| Earlier item | Treatment in this sequence |
|---|---|
| M6-M8, Tiers 1-3 and M10 | Completed/superseded history; preserve working behavior, do not rebuild. Fee configuration specifically retired by A1. |
| Corrections phase 2b | No blanket shipment. Reuse reviewed pieces only within A/B cards; preserve unrelated local work separately. |
| Manual-only proposals in sections 3e-3g | Historical decisions/proposals to reconcile with latest finance; no second manual-correction system in parallel. |
| Closed-edit feasibility in section 3h | Evidence only; not permission for every hypothetical edit or removal of immutability guards. |
| Latest simplified finance, section 3i | A/B/C, with the fixed issued-source boundary and unchanged physical readings. |
| Old phase 3 | B7 plus D4/D5, scoped by wage/document/physical record family; meter editing excluded. |
| Old phase 4 | I1/I2 and A2's current/original views; no new ledger or duplicate reporting engine implied. |
| M9 | D1-D5, preserving order-less historic receipts, stock/FIFO and existing payables. |
| Phone invoice actions and UI review | E1/E2 and F1/F2; reconcile obsolete note options before reuse. |
| Named desktop sessions and full hardening | One G1-G5 system, followed by supervised rollout; no throwaway identity picker. |
| Advances/loans ledger | H1-H3 reuse employee debts and real money movements; the old journal proposal and optional full ledger unification are not required. |
| Supplier drift and remaining Tier 5 | C2 and bounded J releases; advances alone do not fix supplier-payables drift. |
| Accepted future scope | eTIMS remains with the fiscal system; statutory payroll, full ledger unification and multi-station architecture need separate decisions. |

The owner instructed us to proceed, beginning with A1. Dependencies can be
refined in release cards; do not reorder silently, bundle future stages or
begin the next dependent release before the preceding station checkpoint
has passed. Commit/push and station installation follow the repository rules.
