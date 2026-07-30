import type { Knex } from 'knex';
import { roundMoney } from './receivablePayments';

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

export type InvoiceLitreValidation = {
  by_fuel: Record<string, { sold_litres: number; invoice_litres: number; remaining_litres: number }>;
  by_pump: Record<number, { sold_litres: number; invoice_litres: number; remaining_litres: number }>;
  missing_source_entries: number;
};

export function validateInvoiceConsumptionAgainstReadings(
  readings: any[],
  consumption: any[],
  toleranceLitres = 0.01,
): InvoiceLitreValidation {
  const byFuel: InvoiceLitreValidation['by_fuel'] = {};
  const byPump: InvoiceLitreValidation['by_pump'] = {};

  for (const reading of readings) {
    const fuelType = String(reading.fuel_type || '');
    const pumpId = Number(reading.pump_id);
    const sold = Number(reading.litres_sold || 0);
    if (!byFuel[fuelType]) {
      byFuel[fuelType] = { sold_litres: 0, invoice_litres: 0, remaining_litres: 0 };
    }
    byFuel[fuelType].sold_litres += sold;
    if (pumpId) {
      if (!byPump[pumpId]) {
        byPump[pumpId] = { sold_litres: 0, invoice_litres: 0, remaining_litres: 0 };
      }
      byPump[pumpId].sold_litres += sold;
    }
  }

  let missingSourceEntries = 0;
  for (const entry of consumption) {
    const fuelType = String(entry.fuel_type || '');
    const litres = Number(entry.litres || 0);
    if (!byFuel[fuelType]) {
      byFuel[fuelType] = { sold_litres: 0, invoice_litres: 0, remaining_litres: 0 };
    }
    byFuel[fuelType].invoice_litres += litres;

    const pumpId = Number(entry.pump_id || 0);
    if (!pumpId) {
      missingSourceEntries += 1;
      continue;
    }
    if (!byPump[pumpId]) {
      byPump[pumpId] = { sold_litres: 0, invoice_litres: 0, remaining_litres: 0 };
    }
    byPump[pumpId].invoice_litres += litres;
  }

  for (const [fuelType, totals] of Object.entries(byFuel)) {
    totals.sold_litres = roundMoney(totals.sold_litres);
    totals.invoice_litres = roundMoney(totals.invoice_litres);
    totals.remaining_litres = roundMoney(totals.sold_litres - totals.invoice_litres);
    if (totals.invoice_litres - totals.sold_litres > toleranceLitres) {
      throw validationError(
        `Invoice-customer ${fuelType} consumption is ${totals.invoice_litres.toFixed(2)} L, but this shift sold only ${totals.sold_litres.toFixed(2)} L of ${fuelType}.`,
      );
    }
  }

  for (const [pumpId, totals] of Object.entries(byPump)) {
    totals.sold_litres = roundMoney(totals.sold_litres);
    totals.invoice_litres = roundMoney(totals.invoice_litres);
    totals.remaining_litres = roundMoney(totals.sold_litres - totals.invoice_litres);
    if (totals.invoice_litres - totals.sold_litres > toleranceLitres) {
      throw validationError(
        `Invoice-customer consumption assigned to pump/nozzle ${pumpId} is ${totals.invoice_litres.toFixed(2)} L, but that source sold only ${totals.sold_litres.toFixed(2)} L.`,
      );
    }
  }

  return {
    by_fuel: byFuel,
    by_pump: byPump,
    missing_source_entries: missingSourceEntries,
  };
}
