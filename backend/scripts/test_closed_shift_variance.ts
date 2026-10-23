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
  const executable = ts.transpileModule(`function evaluate() { return (${found}); }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  return (values: Record<string, any>) => Function(...Object.keys(values), `${executable}\nreturn evaluate();`)(...Object.values(values));
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
  const amounts = {drawerTotal: 83650, totalCredits: 5040, totalInvoiceConsumption: 39413.14, totalExpenses: 0, totalPayrollPayments: 0, fundsRemoved: 0, enteredWagePaid: 0, isOpen: true, shift: saved.shift};
  assert.equal(Math.round((total({...amounts, directDrawerPayment: wage(saved)}) - 129260) * 100) / 100, -356.86);
  assert.equal(wage({...saved, shift: {wage_paid: 0, employee_wage: 800}}), 0, 'Explicit zero paid must remain zero.');
  assert.equal(wage({...saved, shift: {actual_wage_paid: 600, wage_paid: 800, employee_wage: 800}}), 600,
    'The selected actual cash payment overrides the historical gross wage.');
  assert.equal(wage({...saved, shift: {actual_wage_paid: 0, wage_paid: 800, employee_wage: 800}}), 0,
    'Explicit zero actual cash must not fall back to a gross or backfilled wage.');
  assert.equal(wage({...saved, isOpen: true, enteredWagePaid: 443.14}), 443.14, 'Open shift uses actual entered cash.');
  if (file.startsWith('desktop')) {
    const sales = expression(absolute, 'salesAccounted');
    assert.equal(Math.round((sales({...amounts, salesCollections: 79650, directDrawerPayment: 800}) - 125260) * 100) / 100, -356.86);
    const corrected = { ...amounts, isOpen: false, directDrawerPayment: 800, salesCollections: 79650,
      shift: { total_accounted: 128000, sales_accounted: 124000 } };
    assert.equal(total(corrected), 128000, 'Closed desktop total uses the selected server financial view.');
    assert.equal(sales(corrected), 124000, 'Closed desktop sales total does not reconstruct stale arrays.');
  } else {
    const displayed = expression(absolute, 'totalAccounted');
    assert.equal(displayed({...amounts, employeeWage: 800, shift: { total_accounted: 128000 }}), 128000,
      'Closed phone display uses the selected server financial view.');
  }

  // Execute the screen's open-shift preview, using independent known amounts
  // from docs/SHIFTS.md. A float or bank movement changes custody, never sales.
  const expectedTotal = expression(absolute, 'expectedShiftTotal');
  const payouts = expression(absolute, 'businessPayouts');
  const receipts = expression(absolute, 'expectedReceipts');
  const expectedClosing = expression(absolute, 'expectedClosing');
  const inferred = expression(absolute, 'inferredCollections');
  const examples = [
    { name: 'balanced closing count', sales: 10000, debt: 500, credits: 1000, invoice: 2000, expense: 400, wage: 600, cash: 6000, mpesa: 5500, opening: 5000, added: 0, removed: 0, expected: 11500, variance: 0, collections: 7500 },
    { name: 'counted shortage', sales: 10000, debt: 500, credits: 1000, invoice: 2000, expense: 400, wage: 600, cash: 5700, mpesa: 5500, opening: 5000, added: 0, removed: 0, expected: 11500, variance: -300, collections: 7200 },
    { name: 'M-Pesa removed to bank', sales: 10000, debt: 500, credits: 1000, invoice: 2000, expense: 400, wage: 600, cash: 6000, mpesa: 3000, opening: 5000, added: 0, removed: 2500, expected: 9000, variance: 0, collections: 7500 },
    { name: 'cash float topped up', sales: 10000, debt: 500, credits: 1000, invoice: 2000, expense: 400, wage: 600, cash: 7000, mpesa: 5500, opening: 5000, added: 1000, removed: 0, expected: 12500, variance: 0, collections: 7500 },
    { name: 'opening money spent without sales', sales: 0, debt: 0, credits: 0, invoice: 0, expense: 1000, wage: 0, cash: 2000, mpesa: 2000, opening: 5000, added: 0, removed: 0, expected: 4000, variance: 0, collections: 0 },
  ];
  for (const example of examples) {
    const values: Record<string, any> = {
      isOpen: true, shift: {}, expected: example.sales, expectedSales: example.sales,
      openingTotal: example.opening, fundsAdded: example.added, fundsRemoved: example.removed,
      totalCash: example.cash, totalMpesa: example.mpesa, drawerTotal: example.cash + example.mpesa,
      totalCreditReceipts: example.debt, totalCredits: example.credits, totalInvoiceConsumption: example.invoice,
      totalExpenses: example.expense, directDrawerPayment: example.wage, totalPayrollPayments: 0,
    };
    values.businessPayouts = payouts(values);
    values.expectedReceipts = receipts(values);
    const target = expectedClosing(values);
    assert.equal(target, example.expected, `${file}: ${example.name} expected closing`);
    assert.equal(inferred(values), example.collections, `${file}: ${example.name} inferred collections`);
    assert.equal(Math.round((total(values) - expectedTotal(values)) * 100) / 100, example.variance,
      `${file}: ${example.name} combined variance`);
  }
}

// Full-total corrections must retain an explicit zero while refusing an empty
// or invalid currency amount before the form requests an approvable preview.
const collectionTotal = expression(path.join(root, 'shared/ui/Corrections.tsx'), 'validCollectionTotal')({});
for (const [input, valid] of [
  ['0', true], ['0.00', true], ['.50', true], ['99999999.99', true], ['100000000', true],
  ['', false], ['   ', false], ['-0.01', false], ['0.001', false], ['100000000.01', false],
  ['Infinity', false], ['NaN', false],
] as Array<[string, boolean]>) {
  assert.equal(collectionTotal(input), valid, `Closing correction amount ${JSON.stringify(input)} validity`);
}

// A customer sale or receipt is a positive money record; removing it uses the
// duplicate/never-received choice rather than posting a zero-valued record.
const customerAmount = expression(path.join(root, 'shared/ui/Corrections.tsx'), 'validCustomerCorrectionAmount')({ validCollectionTotal: collectionTotal });
for (const [input, valid] of [
  ['0', false], ['0.00', false], ['', false], ['0.001', false], ['-1', false], ['Infinity', false],
  ['.01', true], ['42.50', true], ['100000000', true], ['100000000.01', false],
] as Array<[string, boolean]>) {
  assert.equal(customerAmount(input), valid, `Customer correction amount ${JSON.stringify(input)} validity`);
}
const moneyAmountChanged = expression(path.join(root, 'shared/ui/Corrections.tsx'), 'moneyAmountChanged');
const paidSale = { customerMoney: true, kind: 'wrong_amount', target: { amount: 1000, balance: 0 } };
assert.equal(moneyAmountChanged({ ...paidSale, amount: '1000' }), false,
  'A paid sale still has its full sale amount; unchanged full amount must wait for an edit.');
assert.equal(moneyAmountChanged({ ...paidSale, amount: '900' }), true,
  'The correction compares the entered full amount with the full source sale, not its zero unpaid balance.');

// A same-sum correction can keep its count effects while another financial
// entry changes the displayed shift result. Require a fresh review before PIN
// approval instead of approving that changed result silently.
const previewChanged = expression(path.join(root, 'shared/ui/Corrections.tsx'), 'previewChanged');
const shown = { effects: ['The combined closing count changes by KES 0.00.'], shifts: [{ shift_id: 12, corrected: 0 }] };
assert.equal(previewChanged({ plan: { data: shown }, final: structuredClone(shown) }), false,
  'An unchanged preview may proceed to approval.');
assert.equal(previewChanged({ plan: { data: shown }, final: { ...shown, shifts: [{ shift_id: 12, corrected: -300 }] } }), true,
  'A changed server result requires renewed review even when the combined count effects are unchanged.');
console.log('PASS: both screens preserve selected figures and balance previews; closing/customer corrections validate currency, use full amounts and require renewed review for changed displayed results.');
