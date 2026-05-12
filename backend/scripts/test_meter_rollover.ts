// Quick sanity test for compensate() helper. Not a full test framework — just
// run and eyeball: `npx tsx scripts/test_meter_rollover.ts`.
import { compensate, toDisplay } from '../src/services/meterRollover';

const cap = 1000000;
const cases: Array<[number, number, number, boolean, string]> = [
  [834336.84,   835333.40, 835333.40,  false, 'no rollover, simple delta'],
  [4834336.84,  835333.40, 4835333.40, false, 'no rollover, opening had 4 prior wraps'],
  [999900.00,        50.00, 1000050.00, true,  'rollover crossing 1M'],
  [3999900.00,       50.00, 4000050.00, true,  'rollover crossing 4M'],
  [834336.84,   834336.84, 834336.84,  false, 'same value (no sales)'],
  [834336.84,        0.00, 1000000.00, true,  'edge: rolled exactly to 0'],
  [0,             123.45,    123.45,   false, 'fresh meter, first reading'],
];

let pass = 0, fail = 0;
for (const [op, raw, exp, rolled, label] of cases) {
  const r = compensate(op, raw, cap);
  const ok = r.ok && Math.abs(r.cumulative - exp) < 0.001 && r.rolledOver === rolled;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: opening=${op} raw=${raw} -> cumulative=${r.ok ? r.cumulative : 'ERR'} rolled=${r.ok ? r.rolledOver : '?'} (expected ${exp}/${rolled})`);
  ok ? pass++ : fail++;
}

const errCases: Array<[number, number, number, string]> = [
  [100, 1000001, cap, 'raw outside capacity'],
  [-1,  100,      cap, 'negative opening'],
  [100, 100,      0,   'zero capacity'],
];
for (const [op, raw, c, label] of errCases) {
  const r = compensate(op, raw, c);
  const ok = !r.ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} reject ${label}: -> ${r.ok ? 'WRONGLY ACCEPTED' : r.reason}`);
  ok ? pass++ : fail++;
}

console.log(`toDisplay(4835333.4, 1000000) = ${toDisplay(4835333.4, 1000000)} (expected 835333.4)`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
