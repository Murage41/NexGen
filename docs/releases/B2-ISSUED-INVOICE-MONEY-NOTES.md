# B2: fixed issued consumption and monetary notes

Authorised 2026-10-20. Base: published `454640a`, complete A1-A4/B1 plus
the combined station installation decision. Branch: `codex/issued-invoice-notes`.
Station installation of that earlier update remains unconfirmed; do not infer
it from this development authorisation. Next development after B2 is B3.

## One workflow and boundary

Once a fuel invoice is issued, its underlying customer, litres, fuel, shift,
pump/tank/source links, invoice lines and original document are fixed. A later
commercial correction is an amount of money, linked to that invoice, with a
reason and admin approval. Do not replace issued source consumption or release
it for billing again, including after full credit. Draft/unbilled correction
remains its existing workflow; B3 handles its further improvements.

Reuse the existing Credit note / Debit note forms and settlement helpers.
New public requests use `correction: amount`, a positive numeric amount in
KES (maximum KES 100 million, two decimal places) and a reason. Arithmetic uses
integer cents. Approvals
bind the customer, original invoice, kind, amount and reason. No new note
changes litres, shift money, attendant responsibility, stock or FIFO.

A credit note reduces its invoice's unpaid money first. Excess is held customer
credit and uses the existing application rules for other/new invoices; no
cash is automatically refunded. A debit note is an existing DN bill, linked to
its original invoice and payable through the existing invoice-payment path.
Its line is explicitly a monetary adjustment, with no fuel litres or unit
price. An amount-only standalone DN bill remains available for a customer who
needs a valid charge (including the right customer after a wrong-customer bill).
The admin makes the corresponding notes manually; no automatic reassignment
or employee charge is introduced.

Issued fuel invoices cannot use Void to release their source. Use a full
credit note, within the remaining uncredited document amount. Unpaid debit
note bills may retain their existing void workflow without releasing fuel.
Historical fuel notes, issued source corrections, genuine payments and PDFs
remain recorded; historical note reversal remains available where valid.
Undo must not reactivate or rewrite issued consumption under the old workflow.

## Affected code and excluded work

- Backend: invoice note input/approval, adjustment settlement, source correction
  guards, draft reservation release, invoice lifecycle/history and documents.
- Existing desktop shared note forms, invoice/customer details and source
  correction affordances; phone source/history/read views show the same fixed
  boundary. E1/E2's additional phone issue/note actions remain separate.
- Migration `20261020_056_issued_invoice_money_notes.ts`: guarded database
  protection for issued source/line/original invoice facts. No history rewrite,
  estimated source links or financial backfill. Existing old voids remain as
  recorded; no invented reconstruction of their released consumption.
- Preserve original shift closes/readings/counts/openings, inventory/FIFO,
  payments and supplier/payroll facts. Existing genuine payment/refund paths
  retain their scope; B6's office-payment/refund redesign is not part of B2.
- Do not include primary checkout's unrelated mixed 2b code or its old 055.

## Measurable acceptance

1. Issued invoice 1,000, actual payment 800, credit note 300: original face
   remains 1,000, real payment remains 800, applied reduction 200, held credit
   100, unpaid balance zero. A subsequent DN bill 250 uses the held 100 and
   leaves 150 payable. Another real payment settles that 150 once.
2. Full credit on unpaid/part-paid/paid invoices never changes the source,
   original PDF, pump totals, closing counts, stock/FIFO or earned wages;
   historically invoiced fuel never returns to the unbilled/draft selector.
3. Wrong customer: manual credit on A and monetary DN on B leave actual
   payments with A, keep source/customer on the original invoice and expose
   B's payable bill. No automatic transfer, refund or employee charge.
4. Cumulative credits cannot exceed that document's billed amount: original
   face plus posted historical inline debit notes, less posted credit notes.
   A linked separate DN has its own face and correction cap.
   Reversals retain history and restore valid account/aging/revenue effects.
5. Backend and database refuse issued source changes, replacement/undo,
   reassignment, line edits, deletion or return to draft; draft release still
   works. Source-locked flags and controls agree on desktop and phone.
6. Held invoice credit cannot be hidden by switching the account to money
   billing. Reversal refuses an unavailable or non-invoice account.
7. Strict amounts, role checks, exact approval, duplicate submissions and
   historical compatibility work. Notes post today, do not create receipts,
   and show monetary content on new PDFs while old saved PDF bytes remain.

## Required verification and deployment

Run all registered backend suites, backend/desktop/mobile typechecks, both
client builds, meaningful planted faults, migration/restore and isolated
desktop/phone checks. Compare original protected records, run integrity
audits, close temporary listeners/tabs and prove the real database unchanged.
Use the available September station copy only through a private scratch
database, recording its age; refresh for installation checks as needed.

B2 must ship as a complete source guard plus monetary remedy release. Back up
before migration 056. Its separate station update follows the completed
A1-B1 update; it is not silently added to that already-pinned installation.
Recovery preserves later real transactions and notes; never restore an old
database over new business merely to undo an application change.

## Development evidence

Completed 2026-10-21, authorised 2026-10-20. Exact publication commit is
supplied in the completion report; no station installation is claimed.

- All **44 registered backend suites**, three package typechecks and desktop
  renderer/mobile production builds pass. Existing bundle-size/Browserslist
  warnings remain; there are no dependency/lockfile changes. Final combined
  runner reports 49 checks and no failures. The older credit-limit and shift
  financial-view fixtures now construct draft facts before issue, preserving
  their original expected figures rather than bypassing the new guards.
- The new source-guard suite migrates 055 to 056, repeats the migration and
  checks direct SQL changes to source facts, links, status, invoice lines,
  original headers, deletion, extra lines, draft return and held-credit mode
  changes. Historical reversed/linked-void entries stay fixed; already released
  historical voids are not relinked. Unbilled/draft correction remains usable,
  and historical original-source undo cannot reactivate issued fuel.
- The monetary suite proves 1,000 / paid 800 / credit 300 gives applied 200,
  held 100, then a linked DN 250 leaves 150; real allocations stay intact.
  It covers full/paid/unpaid notes, separate customer bills, cap/reversal,
  current receivables and posting-dated revenue/cash signs. Notes have zero
  cash delta. Historical inline DN 200 on a 1,000 bill paid 1,200 remains
  correctable for all 1,200; linked separate DN bills never inflate that cap.
- Strict raw cents include 0.01, 0.29 and 99,999,999.99; missing/string/zero/
  negative/nonfinite/overlimit/extra-precision inputs are refused. Old fuel/
  attendant note fields are refused. Exact reason/amount/customer/kind approval,
  admin roles/availability, semantic retries across renewed approval and
  account-mode/reversal dependencies are covered. Held credit cannot disappear
  through a billing-mode switch.
- **Six planted faults were caught**: omitted source-update guard, omitted
  issued-line insertion guard, bypassed historical original-source undo guard,
  wrong applied/held split, ignoring historical credits in the ceiling, and
  omitted reason approval binding. Each was restored with matching source
  bytes/hashes and followed by clean checks; the final full run is clean.
- On an isolated copy of the available September station data, migration,
  verified backup, repeat application and independent restoration preserve
  all **73 existing business tables / 4,180 original rows**. Original 055 source
  file hash remains unchanged. No current live-station data connection was used.
- Desktop PIN-approved forms posted CN 300 and linked DN 250 against the
  synthetic 1,000 invoice with its 800 M-Pesa receipt. The DN opens as a money
  bill, uses held 100 and shows due 150. Phone at 390 pixels shows the original
  10 litres still Invoiced, zero unbilled fuel, guidance to the station note
  form, both bills and the retained payment. Both browser error logs are empty.
- Final UI audit confirms every preexisting business row, the synthetic issued
  source/face, saved original PDF bytes, real payment/allocation, original close
  and pump readings are unchanged. Operational/receivable integrity is clean.
  Real primary and worktree database fingerprints report `REAL-DB-UNCHANGED`.
  Test viewports/tabs/listeners are reset/closed. Private evidence stays in
  `.e2e-data/` and the local check logs, outside the public release.

Next development is B3. Install B2 separately after the already-pinned combined
A1-B1 update, with a verified pre-056 backup and station acceptance checks.
