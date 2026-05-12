import { updateReadingsSchema } from '../src/schemas';

const payload = { readings: [{ pump_id: 1, raw_closing_litres: 838115.59, raw_closing_amount: 283830.78 }] };
const r = updateReadingsSchema.safeParse(payload);
console.log('success:', r.success);
if (!r.success) {
  console.log('issues:', JSON.stringify(r.error.issues, null, 2));
} else {
  console.log('parsed:', JSON.stringify(r.data));
}
