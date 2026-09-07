# Historical employee debt clearance

Use this maintenance command only when the owner has confirmed an existing employee debt was already settled and explicitly requests a balance-only correction. It does not pay wages, deduct wages, record cash received, change a shift, or recalculate a reconciliation. Normal new repayments still belong in the employee repayment workflow.

From the station project folder, preview using the reviewed employee ID and exact debt ID/amount pairs:

```text
npm run clear:employee-debt --workspace=backend -- --employee EMPLOYEE_ID --expected-debts "ID:AMOUNT,ID:AMOUNT" --reason "Owner-confirmed historical settlement; balance clearance only."
```

Replace the placeholders with independently reviewed records. The database path printed by the command must be the station's active database. By default it uses the configured NEXGEN_DATA_DIR, otherwise backend/data/nexgen.db. An explicit --database path is supported for verification of disposable copies. Never restore an older development database over the station to apply a clearance.

After validating the preview, stop station activity and repeat the same command with --apply. The command creates a verified backup and a JSON audit file in the database's backups folder before applying anything. It runs no migrations. If the settlement-history table already exists, it also records explanatory clearance notes there; older schemas retain the explanation in the JSON audit file.

The transaction changes only the selected debts' balance/status and the employee account's balance, plus clearance notes when supported. It compares every unrelated table row before/after and rolls back on an unexpected change. It stops if there are additional outstanding debts, changed balances, incorrect ownership or an inconsistent account total. A repeat after successful clearance returns already_cleared without adding another settlement.

An audit file marked prepared is not proof that the transaction failed or succeeded: if the process stopped after commit, use the same command's read-only preview to check. Do not restore a backup over newer business activity.

## Closed-shift display and employee history fixes

Closed-shift calculations must use the stored wage payment. The editable close form initializes to zero for an already closed shift; using that zero overstated the displayed shortage by the saved wage. The desktop and mobile calculations now distinguish saved closed-shift wages from cash entered for an open shift. This is a display correction and does not update historical shift data.

Expanded employee credit accounts now show staff debts, allocated repayments/reversals, historical adjustments, clearance/review notes and a link to the full pay statement. Customer credit line items are not employee debt history. Historical balance adjustments are explicitly labelled and are not represented as newly received cash.

Validation commands:

```text
npm run test:employee-debt-clearance --workspace=backend
npm run test:closed-shift-variance --workspace=backend
npm run build --workspace=backend
npm run build:mobile
```
