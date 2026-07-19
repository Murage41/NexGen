import db from '../src/database';
import { computeShiftAccountability } from '../src/routes/shifts';

const round2 = (value: number) => Math.round(value * 100) / 100;

function assertEqual(actual: number, expected: number, label: string) {
  if (round2(actual) !== round2(expected)) {
    throw new Error(`${label}: expected ${round2(expected)}, got ${round2(actual)}`);
  }
}

function assertCase({
  label,
  salesCash,
  salesMpesa,
  debtCash,
  debtMpesa,
  credits = 0,
  invoice = 0,
  expenses = 0,
  wage = 0,
}: {
  label: string;
  salesCash: number;
  salesMpesa: number;
  debtCash: number;
  debtMpesa: number;
  credits?: number;
  invoice?: number;
  expenses?: number;
  wage?: number;
}) {
  const expectedSales = round2(salesCash + salesMpesa + credits + invoice + expenses + wage);
  const receivedCash = round2(salesCash + debtCash);
  const receivedMpesa = round2(salesMpesa + debtMpesa);
  const debtTotal = round2(debtCash + debtMpesa);

  const result = computeShiftAccountability({
    readings: [{ amount_sold: expectedSales }],
    collections: { cash_amount: receivedCash, mpesa_amount: receivedMpesa },
    shiftCredits: credits > 0 ? [{ amount: credits }] : [],
    invoiceConsumption: invoice > 0 ? [{ retail_amount: invoice }] : [],
    creditReceipts: [
      ...(debtCash > 0 ? [{ amount: debtCash, payment_method: 'cash' }] : []),
      ...(debtMpesa > 0 ? [{ amount: debtMpesa, payment_method: 'mpesa' }] : []),
    ],
    expenses: expenses > 0 ? [{ amount: expenses }] : [],
    employee_wage: wage,
  });

  assertEqual(result.total_cash, receivedCash, `${label} total cash`);
  assertEqual(result.total_mpesa, receivedMpesa, `${label} total M-Pesa`);
  assertEqual(result.sales_cash, salesCash, `${label} sales cash after debt`);
  assertEqual(result.sales_mpesa, salesMpesa, `${label} sales M-Pesa after debt`);
  assertEqual(result.expected_total_received, round2(receivedCash + receivedMpesa), `${label} received total`);
  assertEqual(result.expected_shift_total, round2(expectedSales + debtTotal), `${label} expected shift total`);
  assertEqual(result.total_accounted, round2(receivedCash + receivedMpesa + credits + invoice + expenses + wage), `${label} accounted total`);
  assertEqual(result.variance, 0, `${label} variance`);

  const doubleCounted = round2(receivedCash + receivedMpesa + debtTotal + credits + invoice + expenses + wage);
  if (round2(result.total_accounted) === doubleCounted && debtTotal > 0) {
    throw new Error(`${label}: debt receipts were added on top of received totals`);
  }
}

async function main() {
  try {
    assertCase({
      label: 'cash received 11000 with 1000 debt included',
      salesCash: 10000,
      salesMpesa: 0,
      debtCash: 1000,
      debtMpesa: 0,
    });

    let seed = 41;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const money = (max: number) => round2(nextRand() * max);

    for (let i = 0; i < 5000; i += 1) {
      assertCase({
        label: `random balanced shift ${i + 1}`,
        salesCash: money(200000),
        salesMpesa: money(200000),
        debtCash: money(50000),
        debtMpesa: money(50000),
        credits: money(50000),
        invoice: money(50000),
        expenses: money(10000),
        wage: money(3000),
      });
    }

    console.log('PASS shift debt receipts stay inside received cash/M-Pesa totals');
    console.log('PASS 5000 randomized balanced shift accountability checks');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
