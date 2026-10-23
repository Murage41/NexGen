# NexGen roadmap

What is left to build, in order. One release at a time; each needs the
owner's go-ahead on its spec before code (CLAUDE.md, due diligence). When an
item ships, delete its line here and record it in `PROJECT-STATUS.md`.

Earlier specifications, release cards and phase plans were removed from the
tree on 2026-10-24; read them in git (`git show f10306b:docs/ROADMAP.md`,
`f10306b:docs/IMPLEMENTATION-STAGES.md`, `f10306b:docs/releases/`). Private
analyses stay in `D:\NexGen\.claude\plans\`.

## Now

1. **Screens (proposal, awaiting the owner).** Fewer words and fields,
   colour, prefilled defaults; explanations live in the manuals. Mockups:
   https://claude.ai/artifact/WvVb8WyPLxuvQaAqrJitny (desktop and phone:
   shifts list, open shift, shift page and close, dashboard, customers).
   Proposed: drop the opening note, close notes and tick-list, helper
   paragraphs and the separate pay panel; keep **Money added / removed** as a
   small "Cash in / out" link (Odoo "Cash In/Out", Square "Paid In/Out");
   merge Credit Accounts and Customer Invoices into one Customers page.
   Behaviour changes to agree: prefilled opening cash (source to decide), a
   date on the open-shift form (item 3).
2. **Edit history for open shifts.** Every save of readings, cash/M-Pesa and
   the wage on an open shift adds who, when, old and new value; a plain
   **History** list on the shift; no restore button (re-enter through the
   normal form). Needs a migration. Practice: NetSuite System Notes
   (https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_158644279544.html).
   Today readings are overwritten; the 2026-10-23 recovery relied on leftover
   SQLite WAL frames.
3. **Shift date.** A new shift is always dated today (`resolvedDate` in the
   open route, `backend/src/routes/shifts.ts`), so a missed shift cannot be
   entered on its real date.
4. **The owner's other issues** (bugs from over-complication): each with due
   diligence before code.
5. **B2 decision.** Money-only invoice credit/debit notes (`4f9b3b4`,
   migration 056) are on `main` but held back from the station until the owner
   decides after the screen review.

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
