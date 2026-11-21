import type { Knex } from 'knex';
import { roundMoney } from './receivablePayments';
import { getRetailPriceAsOf } from './invoiceAccounting';

type DbConnection = Knex | Knex.Transaction;

export type ConsumptionSourceInput = {
  fuelType: 'petrol' | 'diesel';
  pumpId?: number | null;
  tankId?: number | null;
};

export type ResolvedConsumptionSource = {
  pump_id: number | null;
  tank_id: number | null;
  source_required: boolean;
};

function validationError(message: string): Error {
  return Object.assign(new Error(message), { http: 400, httpStatus: 400 });
}

export async function resolveConsumptionSource(
  trx: DbConnection,
  input: ConsumptionSourceInput,
): Promise<ResolvedConsumptionSource> {
  let tank: any = null;
  if (input.tankId) {
    tank = await trx('tanks').where({ id: Number(input.tankId) }).first();
    if (!tank) throw validationError('Selected tank was not found.');
    if (tank.fuel_type !== input.fuelType) {
      throw validationError(
        `Tank "${tank.label}" contains ${tank.fuel_type}, not ${input.fuelType}.`,
      );
    }
  }

  if (input.pumpId) {
    const pump = await trx('pumps').where({ id: Number(input.pumpId) }).first();
    if (!pump) throw validationError('Selected pump/nozzle was not found.');
    if (!pump.active) throw validationError(`Pump/nozzle "${pump.label}" is inactive.`);
    if (pump.fuel_type !== input.fuelType) {
      throw validationError(
        `Pump/nozzle "${pump.label}" dispenses ${pump.fuel_type}, not ${input.fuelType}.`,
      );
    }
    if (input.tankId && Number(pump.tank_id) !== Number(input.tankId)) {
      throw validationError('The selected pump/nozzle is not connected to the selected tank.');
    }
    if (pump.tank_id) {
      const pumpTank = await trx('tanks').where({ id: pump.tank_id }).first();
      if (!pumpTank || pumpTank.fuel_type !== input.fuelType) {
        throw validationError('The selected pump/nozzle is connected to an incompatible tank.');
      }
    }
    return {
      pump_id: Number(pump.id),
      tank_id: pump.tank_id ? Number(pump.tank_id) : (input.tankId ? Number(input.tankId) : null),
      source_required: false,
    };
  }

  let candidates = trx('pumps')
    .where({ active: true, fuel_type: input.fuelType })
    .whereNotNull('tank_id');
  if (input.tankId) candidates = candidates.where({ tank_id: Number(input.tankId) });
  const pumps = await candidates.select('id', 'tank_id');

  if (pumps.length === 1) {
    return {
      pump_id: Number(pumps[0].id),
      tank_id: Number(pumps[0].tank_id),
      source_required: false,
    };
  }

  return {
    pump_id: null,
    tank_id: input.tankId ? Number(input.tankId) : null,
    source_required: pumps.length > 1,
  };
}

// Fuel on account (invoice customers, and money customers whose debt was
// entered as fuel) can never be more than that fuel's pumps sold on the shift.
// Checked per fuel: the pump a fill came from is not recorded (update #28).
export type InvoiceLitreValidation = {
  by_fuel: Record<string, { sold_litres: number; invoice_litres: number; remaining_litres: number }>;
};

export function validateInvoiceConsumptionAgainstReadings(
  readings: any[],
  onAccount: Array<{ fuel_type?: unknown; litres?: unknown }>,
  toleranceLitres = 0.01,
): InvoiceLitreValidation {
  const byFuel: InvoiceLitreValidation['by_fuel'] = {};
  const totals = (fuel: string) => (byFuel[fuel] ||= { sold_litres: 0, invoice_litres: 0, remaining_litres: 0 });
  for (const reading of readings) totals(String(reading.fuel_type || '')).sold_litres += Number(reading.litres_sold || 0);
  for (const entry of onAccount) {
    const fuel = String(entry.fuel_type || '');
    if (fuel !== 'petrol' && fuel !== 'diesel') continue;
    totals(fuel).invoice_litres += Number(entry.litres || 0);
  }
  for (const [fuelType, row] of Object.entries(byFuel)) {
    row.sold_litres = roundMoney(row.sold_litres);
    row.invoice_litres = roundMoney(row.invoice_litres);
    row.remaining_litres = roundMoney(row.sold_litres - row.invoice_litres);
    if (row.invoice_litres - row.sold_litres > toleranceLitres) {
      throw validationError(
        `Fuel on account is ${row.invoice_litres.toFixed(2)} L of ${fuelType}, but this shift sold only ${row.sold_litres.toFixed(2)} L of ${fuelType}.`,
      );
    }
  }
  return { by_fuel: byFuel };
}

// A debt entered as fuel (update #28): the form shows litres and amount, one
// typed and the other worked out at the shift's pump price. Both arrive; the
// server checks they agree with its own price and keeps them as shown, so a
// KES 10,000 sale stays exactly KES 10,000. Only one of the two may be sent.
export async function fuelDebtFigures(
  trx: DbConnection,
  input: { fuelType: string; shiftDate: string; litres?: unknown; amount?: unknown },
): Promise<{ price: number; litres: number; amount: number }> {
  const price = await getRetailPriceAsOf(trx, input.fuelType, input.shiftDate);
  if (price === null || !(Number(price) > 0)) {
    throw Object.assign(new Error(`No ${input.fuelType} pump price is set for ${input.shiftDate}.`), { http: 400, code: 'NO_PUMP_PRICE' });
  }
  const hasLitres = input.litres !== undefined && input.litres !== null && input.litres !== '';
  const hasAmount = input.amount !== undefined && input.amount !== null && input.amount !== '';
  const litresIn = Number(input.litres);
  const amountIn = Number(input.amount);
  if ((hasLitres && !(litresIn > 0)) || (hasAmount && !(amountIn > 0)) || (!hasLitres && !hasAmount)) {
    throw Object.assign(new Error('Enter the litres or the amount.'), { http: 400, code: 'INVALID_LITRES' });
  }
  const litres = hasLitres ? Math.round(litresIn * 1000) / 1000 : Math.round((amountIn / Number(price)) * 1000) / 1000;
  const amount = hasAmount ? roundMoney(amountIn) : roundMoney(litres * Number(price));
  if (Math.abs(amount - litres * Number(price)) > 0.5) {
    throw Object.assign(new Error(`The pump price is KES ${Number(price).toFixed(2)} a litre: ${litres} L is not KES ${amount.toFixed(2)}. Check the figures.`), { http: 409, code: 'PRICE_MISMATCH' });
  }
  return { price: Number(price), litres, amount };
}
