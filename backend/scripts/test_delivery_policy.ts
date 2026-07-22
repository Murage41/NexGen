import { createDeliverySchema } from '../src/schemas';
import {
  DELIVERY_STATUS_PENDING_PRICE,
  DELIVERY_STATUS_PRICED,
  effectiveDeliveryTimestamp,
  normalizeDeliveryPricing,
} from '../src/services/deliveryPolicy';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertThrows(fn: () => unknown, label: string) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${label}: expected error`);
}

assertEqual(
  effectiveDeliveryTimestamp('2026-07-21'),
  '2026-07-21 00:00:00',
  'date-only delivery timestamp',
);

const pending = normalizeDeliveryPricing(10000, undefined);
assertEqual(pending.costPerLitre, 0, 'pending cost per litre');
assertEqual(pending.totalCost, 0, 'pending total cost');
assertEqual(pending.pricingStatus, DELIVERY_STATUS_PENDING_PRICE, 'pending pricing status');

const priced = normalizeDeliveryPricing(5000, 187.456);
assertEqual(priced.costPerLitre, 187.46, 'priced cost per litre rounded');
assertEqual(priced.totalCost, 937300, 'priced total cost');
assertEqual(priced.pricingStatus, DELIVERY_STATUS_PRICED, 'priced status');

assertThrows(() => normalizeDeliveryPricing(100, -1), 'negative cost rejection');

createDeliverySchema.parse({
  tank_id: 1,
  supplier_id: 1,
  litres: 10000,
  date: '2026-07-21',
});

createDeliverySchema.parse({
  tank_id: 1,
  supplier_id: 1,
  litres: 10000,
  cost_per_litre: 187.46,
  date: '2026-07-21',
  invoice_number: 'INV-001',
});

let seed = 7331;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

for (let i = 0; i < 5000; i += 1) {
  const month = String(1 + Math.floor(random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(random() * 28)).padStart(2, '0');
  const date = `2026-${month}-${day}`;
  const litres = Math.round((100 + random() * 60000) * 100) / 100;
  const costInput = i % 7 === 0
    ? undefined
    : i % 11 === 0
      ? null
      : Math.round((120 + random() * 120) * 1000) / 1000;
  const result = normalizeDeliveryPricing(litres, costInput);

  assertEqual(effectiveDeliveryTimestamp(date), `${date} 00:00:00`, `random timestamp ${i}`);
  if (costInput == null) {
    assertEqual(result.pricingStatus, DELIVERY_STATUS_PENDING_PRICE, `random pending status ${i}`);
    assertEqual(result.totalCost, 0, `random pending total ${i}`);
  } else {
    const roundedCost = Math.round(costInput * 100) / 100;
    assertEqual(result.costPerLitre, roundedCost, `random rounded cost ${i}`);
    assertEqual(result.totalCost, Math.round(litres * roundedCost * 100) / 100, `random total ${i}`);
    assertEqual(result.pricingStatus, DELIVERY_STATUS_PRICED, `random priced status ${i}`);
  }
}

console.log('PASS delivery date policy and provisional pricing');
console.log('PASS 5000 randomized delivery policy checks');
