import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Execute the actual screen expressions against a saved-close reconciliation
// fixture. This catches a screen using the empty close form instead of saved pay.
function expression(file: string, variable: string) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === variable && node.initializer) found = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing screen expression ${variable}`);
  return (values: Record<string, any>) => Function(...Object.keys(values), `return (${found});`)(...Object.values(values));
}
const root = path.resolve(__dirname, '../..');
for (const [file, totalName] of [
  ['desktop/src/renderer/pages/ShiftDetail.tsx', 'totalAccounted'],
  ['mobile/src/pages/ShiftDetail.tsx', 'closeTotalAccounted'],
]) {
  const absolute = path.join(root, file);
  const wage = expression(absolute, 'directDrawerPayment');
  const total = expression(absolute, totalName);
  const saved = {isOpen: false, enteredWagePaid: 0, shift: {wage_paid: 800, employee_wage: 800}};
  const amounts = {drawerTotal: 83650, totalCredits: 5040, totalInvoiceConsumption: 39413.14, totalExpenses: 0, totalPayrollPayments: 0, enteredWagePaid: 0};
  assert.equal(Math.round((total({...amounts, directDrawerPayment: wage(saved)}) - 129260) * 100) / 100, -356.86);
  assert.equal(wage({...saved, shift: {wage_paid: 0, employee_wage: 800}}), 0, 'Explicit zero paid must remain zero.');
  assert.equal(wage({...saved, isOpen: true, enteredWagePaid: 443.14}), 443.14, 'Open shift uses actual entered cash.');
  if (file.startsWith('desktop')) {
    const sales = expression(absolute, 'salesAccounted');
    assert.equal(Math.round((sales({...amounts, salesCollections: 79650, directDrawerPayment: 800}) - 125260) * 100) / 100, -356.86);
  }
}
console.log('PASS: both screens retain saved closed-shift wages, explicit zero and editable open-shift cash.');
