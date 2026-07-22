import db from '../src/database';
import { effectiveDeliveryTimestamp } from '../src/services/deliveryPolicy';

async function main() {
  const rows = await db('fuel_deliveries')
    .select(
      'id',
      'tank_id',
      'date',
      'delivery_timestamp',
      'created_at',
      'litres',
      'supplier',
      'supplier_id',
      'invoice_number',
    )
    .whereNull('deleted_at')
    .where(function () {
      this.whereNull('delivery_timestamp').orWhereRaw("delivery_timestamp <> date || ' 00:00:00'");
    })
    .orderBy('date', 'asc')
    .orderBy('id', 'asc');

  console.log(`Found ${rows.length} active deliveries whose effective timestamp is not selected-date midnight.`);
  console.log('This is a dry run only. No records were changed.');

  if (rows.length === 0) return;

  const preview = rows.slice(0, 100).map((row: any) => ({
    id: row.id,
    tank_id: row.tank_id,
    date: row.date,
    current_effective_timestamp: row.delivery_timestamp || row.created_at || null,
    proposed_effective_timestamp: effectiveDeliveryTimestamp(row.date),
    litres: Number(row.litres || 0),
    supplier: row.supplier || row.supplier_id || '',
    invoice_number: row.invoice_number || '',
  }));

  console.table(preview);
  if (rows.length > preview.length) {
    console.log(`Showing first ${preview.length} rows. ${rows.length - preview.length} more would also be listed.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
