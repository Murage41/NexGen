import db from '../database';
import { getKenyaDate } from '../utils/timezone';

/**
 * Returns the active M-Pesa fee rate (as a percentage, e.g. 0.55) effective on
 * the given date. Falls back to 0.55 if no config row is set.
 */
export async function getMpesaFeeRate(asOfDate?: string): Promise<number> {
  const date = asOfDate || getKenyaDate();
  const row = await db('mpesa_fee_config')
    .where('effective_date', '<=', date)
    .orderBy('effective_date', 'desc')
    .orderBy('id', 'desc')
    .first();
  if (!row) return 0.55;
  return Number(row.fee_value);
}

/**
 * Computes fee and net for a given gross M-Pesa amount.
 * Rounds to 2dp to keep cash math consistent across the system.
 */
export async function computeMpesaFee(
  grossAmount: number,
  asOfDate?: string,
): Promise<{ fee: number; net: number; rate: number }> {
  const rate = await getMpesaFeeRate(asOfDate);
  const fee = Math.round(grossAmount * (rate / 100) * 100) / 100;
  const net = Math.round((grossAmount - fee) * 100) / 100;
  return { fee, net, rate };
}
