# Employee and administrator access: execution plan

Prepared: 8 September 2026. Reviewed application version: `d35b8ac`.

Status: **Plan only. Employee rollout should wait for the controls and acceptance checks below.** The previous payroll fixes did not complete application-wide access control. This plan does not enable accounts or change financial records.

## Intended result

Employees use their own accounts to record their assigned shift, understand reconciliation, and check their own pay and debt. Administrators control approvals, financial corrections, employment details and station administration. Both see the same underlying figures; private details are filtered by the server without changing accounting totals.

Keep the existing two business roles, `attendant` and `admin`. Add an explicit login-enabled setting independent of employment status: having an employee/payroll record must not automatically allow login. Administrative access must belong to an identified person rather than a shared desktop credential.

## Recommended rights

| Area | Employee | Administrator |
| --- | --- | --- |
| Home | Own active shift, sync/review status, own wages due and debt | Station overview and operational alerts |
| Shift history | All own shifts, with dates, filters and pagination | All employees and shifts |
| Shift reconciliation | Own readings, collections, expenses, credit sales, invoice consumption, saved close and explanation of variance | Same figures for any shift, plus approval and correction tools |
| Record readings and collections | Assigned open shift only; see saved versus unsynced values | Any open shift; all changes attributed |
| Opening readings, price anomalies and exceptional meter overrides | View opening values; request a correction or exception | Review and authorize exceptions with a reason |
| Shift expenses | Record an actual expense in own open shift, with description and receipt/reference; request correction | Review and correct through an audited process |
| Customer credit sales and invoice fuel-ups | Record against existing approved customers, within authorized terms, on own open shift | Approve customer eligibility, new accounts and exceptions |
| Customer lookup | Only the fields needed for service: name/identifier, billing mode, authorization status and permitted collection amount | Full customer history, contact details, terms, balances and invoices |
| Customer debt receipts | Cash/M-Pesa actually received in own open shift, with reference; customer accounts only | Record direct receipts, review and reverse under existing closed-drawer safeguards |
| Shift submission | Submit handover, explain variance, and see returned questions | Assign/open, review, finalize/lock, cancel or perform approved corrections |
| Own compensation | View plan history, effective dates, rates, components and every included shift | Create future plan versions and manage compensation |
| Own payroll | View draft versus approved statements, gross pay, deductions, net pay, payments, balances and shift allocations; print own statement | Calculate, review recovery, approve, pay, supplement or void under existing safeguards |
| Staff debt | View own origin shifts, original shortfall, recoveries, receipts, reversals, clearance notes and remaining balance | Confirm/dispute debt, authorize recovery, post verified receipts and perform guarded corrections |
| Disagreements | Ask for an explanation or raise a dispute on own shift/pay/debt; follow its status | Investigate, respond and make a recorded decision |
| Acknowledgment | Acknowledge seeing own statement/handover; this is separate from agreeing to a deduction | See acknowledgment and any separately recorded authorization |
| Other employees' data | No pay, debt, personal details, sessions or statements | Access needed for administration, with audit history |
| Station finances | No business profit, supplier balances, purchase costs, total payroll or general expense reports | Full financial reports and management |
| Prices and equipment | View current selling prices and assigned pump labels needed to work | Change prices, pump/tank configuration, deliveries and stock adjustments |
| Accounts and security | Change own credential, sign out, and see own active sessions | Enable/disable login, reset credentials, revoke sessions and manage roles |
| Backups and maintenance | No access | Restricted administration; no raw database files through employee devices |

An employee's shortage must stay visible after it is repaid. The screen should distinguish **original variance**, **recovery already recorded**, and **debt still outstanding**. A debt clearance must not turn a historical shortage into a balanced shift.

Private drawer transactions require special handling: retain their aggregate contribution to the employee's shift reconciliation, but describe the hidden amount as an administrator-authorized drawer transaction. Do not expose another employee's name, payroll line, debt account or repayment details. This keeps the displayed figures explainable and consistent.

## Confirmed gaps in the current application

The following findings come from source review and, where noted, actual requests to the existing routes using synthetic accounts in an isolated temporary database. No station or development financial data was used for mutation tests.

| Priority | Finding and evidence | Required change |
| --- | --- | --- |
| Before any staff login | `requireAdmin.ts` accepts a desktop key as administrator without a personal session. The desktop API client attaches a key; development defaults are embedded in source. A configured-key request without login returned administrator data in the isolated test. | Remove shared-key access from staff-reachable APIs. Provide proper desktop administrator login before removing the shortcut so the owner is not locked out. |
| Before any staff login | Session verification trusts the role inside the token without rechecking employee status. Existing disabled-employee and demoted-admin sessions still succeeded in the isolated test. | Recheck the active account, current role, login-enabled state and session validity on every request; revoke on disable, role change, credential reset and logout. |
| Before any staff login | The mobile menu hides station management pages, but the dashboard and many report/customer/supplier/expense reads have only general authentication. Nine representative read requests succeeded with an attendant session, including cash flow and customer statements. | Deny unlisted access at the backend. Split employee summaries and operational lookup from full administrative records. Check all route families, exports and document downloads. |
| Before employee recording | Legacy `credits.ts` creation and repayment routes lack administrator/shift-ownership authorization. An attendant created credit linked to another employee's closed shift and posted a back-office repayment in the isolated test. | Restrict or retire these legacy paths; use the existing controlled shift receipt/credit workflows. Preserve legitimate administrator callers by routing them through the same accounting services. |
| Before employee recording | Reading anomaly/large-sale confirmation flags are accepted on the employee-accessible readings route without an administrator check. Employees can also auto-create customer accounts by typing new customer names in shift credit entry. | Separate ordinary recording from administrator exception approval and approved-customer management. |
| Before employee recording | Viewing an open shift can insert/delete pump readings when active pumps change. Invoice-consumption entries can be edited or deleted by the shift employee while ordinary shift expense/credit deletion is admin-only. | Make reads side-effect free. Adopt one rule for posted financial-entry corrections: employee requests, administrator changes, reason and before/after record. Preserve unsaved draft editing. |
| Before shared-device use | Browser session tokens are stored in local storage. Offline drafts are keyed only by shift ID and are not removed or isolated on logout. | Isolate drafts by server, employee and shift; prevent another signed-in user from viewing or submitting them. Use server-revocable sessions and clear private screen/cache state at logout. |
| Before staff self-service | My Shift shows at most ten closed shifts without a full-history control. There is no complete employee dispute/handover workflow. | Add paginated own-history and an explicit request/response path; preserve existing detailed My Pay statements. |

Controls that already worked in the isolated checks: attendants could view their own pay; requests for another employee's debt, another employee's shift, the full employee directory and payroll runs were denied. Preserve these checks and extend them across the whole application.

Source locations: `backend/src/middleware/requireAdmin.ts`, `backend/src/routes/auth.ts`, `backend/src/routes/{dashboard,reports,credits,creditAccounts,shifts,employees,payroll}.ts`, `desktop/src/renderer/services/api.ts`, `mobile/src/{App.tsx,context/AuthContext.tsx,utils/shiftDraft.ts}`, and `mobile/src/pages/{Dashboard,MyShift,ShiftRecord,EmployeePay}.tsx`.

## Execution order

### 1. Establish identity and immediate revocation

Build desktop login and a server session registry. Treat the current database role and login-enabled status as authoritative; unknown roles or missing accounts must fail closed. Add logout, revoke-all and administrator session management. Disabling login must not change employment dates, payroll eligibility or financial balances.

Remove browser-embedded administrator secrets. Generate station-specific server secrets and reject insecure exposed-server configuration. Coordinate this with the desktop login and station startup change in one tested release. The present `station:bg` launcher runs development processes; the staff-access release needs a tested compiled backend/client startup path, not just a new environment variable that leaves the desktop unusable.

Use stronger employee sign-in than the current four-digit PIN: prefer device-bound sign-in with a private PIN for unlocking; use a passphrase plus a second factor for remote administrators. If PIN-only employee sign-in is retained for the initial local pilot, require at least six digits, persistent per-account and per-source throttling, and no exposure of that PIN-only endpoint to the public internet. Harden forwarded-address handling so callers cannot reset throttling by supplying a different header. Provide first-login credential change and reset flows.

Use secure, server-revocable browser sessions with appropriate cookie/CSRF controls for browser clients; keep any native client credential in OS-protected storage. Test the station, mobile origin and tunnel together. Proposed defaults: 12-hour maximum session, 15-minute staff inactivity lock and 5-minute administrator inactivity lock on shared terminals; preserve private unsynced drafts behind reauthentication. Require recent authentication for role changes, credential resets and irreversible administrative operations. These timeout values are rollout defaults, not claims about an external standard.

The session controls follow [OWASP session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html); credential and throttling design follows [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

Acceptance: disable, reset, demotion, expiry and logout immediately invalidate the old session; neither a desktop header nor a changed browser role grants privileges; at least one active administrator remains available.

### 2. Enforce the rights matrix at the server

Create one explicit route permission inventory. Default to deny; allow only the documented employee operations. Cover reports, dashboard, supplier invoices/payments, customer invoices/payments, credits, deliveries, tanks/dips, equipment, pricing, operations, health/backup, exports and document routes.

Add an employee home response based on the signed-in identity. Restrict full financial endpoints to administrators. Add a minimal customer lookup for shift work, and restrict full customer account history. Ensure every nested ID belongs to the authorized shift/account inside the same transaction as a write. Ignore attempts to replace the signed-in employee with a request parameter. Filter response fields on the server, including activity notes and indirect links.

These controls apply the least-privilege and per-request checks described in the [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

Acceptance: employee A cannot read or change employee B's data by changing IDs, query filters, URLs, request bodies or export paths. Hidden information is absent from the response, not merely hidden in the page. Anonymous requests expose only deliberate login/health metadata.

### 3. Preserve shift accounting while limiting employee writes

Retain ordinary own-open-shift readings and collection entry, stale-write protection and duplicate-request protection. Administrator approval remains necessary for opening-value changes and anomaly overrides. Move pump synchronization out of GET requests into explicit administrator setup/open-shift operations; preserve historical readings for inactive pumps.

Introduce a handover submission status separate from financial close. Submission freezes the employee's input revision for review without creating debt, paying wages or recomputing a close. An administrator can return it with questions or finalize it after reviewing the exact version. Make the state visible to the employee and preserve rejected/returned versions.

Use the same correction rule for expenses, credit sales, receipts and invoice consumption. Employees can edit unsaved drafts and submit correction requests for posted entries. Administrators apply recorded corrections, retaining existing guards on closed shifts and invoiced entries. Ordinary received cash must still be recorded even when its classification needs review; approval status must not silently remove physical cash or expenses from drawer accountability.

Acceptance: employee recording still works during a real shift; a stale draft cannot overwrite an administrator correction; rejected, duplicate or unauthorized requests leave balances and recorded cash unchanged. Merely opening any screen leaves financial rows unchanged.

### 4. Finish employee information and requests

Provide **Home, My Shift, My History, My Pay & Debt, Requests, and Account**. Reuse the existing pay and debt statement. Add full history pagination, clearly distinguish drafts from approved amounts, show source shift/date and historical plan rate, and preserve legacy-payment uncertainty labels rather than inventing allocation history.

Allow employees to raise a dispute or correction request with a reason against their own records and see administrator responses. A request does not itself change a balance. Administrator review can place an eligible debt on hold using the existing recovery-status rules; the employee cannot change that status. Show pending/disputed/confirmed/settled separately. Keep acknowledgment of a statement separate from authorization for a deduction.

Acceptance: employees can trace an August total to every included shift and rate change, understand what was paid and recovered, and see why a debt balance changed. The same totals appear to the administrator. Own-statement printing contains no other employee's information.

### 5. Make administrator actions accountable

Provide an access page showing role, login-enabled state, reset/revocation controls and last login, plus a queue for handovers, requests and exceptional entries. Require an identified administrator, reason and timestamp for financial approvals/corrections. Do not allow deleting the audit trail or disabling/demoting the last administrator.

Keep administrative notes intended for staff separate from private investigation notes. Do not add names, credentials or unrelated personal information to employee-visible notes. Record who did what and the relevant before/after values without logging credentials or full sensitive request bodies.

Acceptance: the owner can identify the person responsible for each approval and see its effect before applying it. A debt correction remains separate from cash receipt, payroll payment and shift reconciliation.

### 6. Prove safety and roll out gradually

Use a fresh verified station backup in isolation for migration and accounting comparisons. Run direct API tests with employee A, employee B, administrator, disabled user, expired/revoked session and anonymous requests. Include unknown roles, forged IDs, legacy endpoints, nested entry IDs, repeated requests, mobile/desktop login and offline draft replay after account switching.

Compare every historical financial table before/after security migrations and read-only access. Recheck closed shifts, saved close snapshots, payroll payments, recoveries, customer debts, staff debts, cash collections and stock. No permission migration may recalculate historical pay, clear balances or backfill receipts.

Test complete positive workflows as well as denied requests: normal readings/collections, authorized customer credit, invoice fuel-up, customer receipt, expense recording, handover, administrator close, daily recovery, non-daily payroll recovery, own statements, and request resolution. Re-run the existing payroll/shift/receivable regression suites and all builds.

Start with login disabled for staff, then enable one employee for a supervised pilot. Verify isolation using a second test identity, shared-device logout and a complete shift cycle. Expand only after the pilot checks pass. If a security issue appears, disable staff login and revoke sessions while preserving administrator operation and all business data. A rollback must not restore an old database over newer station work.

## Debt clearance is separate

Emma's authorized historical clearance is a balance-only operation. It must run against the explicitly identified target database through `clear:employee-debt`, which validates the expected five debts totalling KES 4,741.52, creates a verified backup and audit file, and verifies all unrelated rows remain unchanged. It must not alter payroll payments, shift 101, drawer cash or saved reconciliations. If newer debts or different balances exist, stop and review them rather than broadening the clearance automatically.

At preparation time this session could access only the development workspace and the supplied station backup; the station's live database was not mounted here. Creating this plan does not establish that the live debt has been cleared. Record the clearance's actual database path and resulting audit file separately when it is applied.
