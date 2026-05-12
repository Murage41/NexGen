import { compensate } from '../src/services/meterRollover';
const opening = 835859.29; // pump 1 petrol current cumulative
const cap = 1000000;
console.log('Opening cumulative:', opening, 'display:', opening - Math.floor(opening / cap) * cap);
console.log('--- normal entry (display 836000.50) ---');
console.log(compensate(opening, 836000.50, cap));
console.log('--- raw 50 — implies rollover ---');
console.log(compensate(opening, 50.00, cap));
console.log('--- same as opening (no sales) ---');
console.log(compensate(opening, 835859.29, cap));
console.log('--- diesel cumulative >2M ---');
const dOpening = 2123456.78;
console.log('display:', dOpening - Math.floor(dOpening / cap) * cap);
console.log(compensate(dOpening, 124000, cap));
console.log(compensate(dOpening, 100, cap));
