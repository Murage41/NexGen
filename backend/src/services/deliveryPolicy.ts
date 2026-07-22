export const DELIVERY_STATUS_PENDING_PRICE = 'pending_price';
export const DELIVERY_STATUS_PRICED = 'priced';

export type DeliveryPricingStatus =
  | typeof DELIVERY_STATUS_PENDING_PRICE
  | typeof DELIVERY_STATUS_PRICED;

export function effectiveDeliveryTimestamp(date: string): string {
  return `${date} 00:00:00`;
}

export function normalizeDeliveryPricing(
  litres: number,
  costPerLitreInput: number | null | undefined,
): { costPerLitre: number; totalCost: number; pricingStatus: DeliveryPricingStatus } {
  const costPerLitre = Number(costPerLitreInput || 0);
  if (!Number.isFinite(costPerLitre) || costPerLitre < 0) {
    throw new Error('cost_per_litre cannot be negative');
  }

  const normalizedCost = Math.round(costPerLitre * 100) / 100;
  const totalCost = Math.round(Number(litres || 0) * normalizedCost * 100) / 100;

  return {
    costPerLitre: normalizedCost,
    totalCost,
    pricingStatus: normalizedCost > 0 ? DELIVERY_STATUS_PRICED : DELIVERY_STATUS_PENDING_PRICE,
  };
}

export function isDeliveryPriced(status: DeliveryPricingStatus): boolean {
  return status === DELIVERY_STATUS_PRICED;
}
