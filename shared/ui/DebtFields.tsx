import { ArrowLeftRight } from 'lucide-react';

// What a debt is for (update #28): Petrol or Diesel in litres or amount, the
// other worked out at the shift's pump price; Other (oil, gas, a cash loan) is
// an amount only. Shared by the phone and desktop shift screens.
export type DebtFuel = 'petrol' | 'diesel' | 'other';
export type DebtFigures = { fuel: DebtFuel; litres: string; amount: string; typed: 'litres' | 'amount' };

export const emptyDebt = (fuel: DebtFuel = 'diesel'): DebtFigures => ({ fuel, litres: '', amount: '', typed: 'amount' });

const toLitres = (amount: number, price: number) => String(Math.round((amount / price) * 1000) / 1000);
const toAmount = (litres: number, price: number) => String(Math.round(litres * price * 100) / 100);

// The body a debt is posted with: a fuel debt sends both figures as shown.
export function debtBody(figures: DebtFigures) {
  const amount = Number(figures.amount);
  if (figures.fuel === 'other') return { fuel_type: 'other' as const, amount };
  return { fuel_type: figures.fuel, litres: Number(figures.litres), amount };
}

export const debtReady = (figures: DebtFigures) =>
  Number(figures.amount) > 0 && (figures.fuel === 'other' || Number(figures.litres) > 0);

export function DebtFields({
  value,
  onChange,
  prices,
  allowOther = true,
  compact = false,
}: {
  value: DebtFigures;
  onChange: (next: DebtFigures) => void;
  prices: { petrol?: number | null; diesel?: number | null } | null | undefined;
  allowOther?: boolean;
  compact?: boolean;
}) {
  const price = value.fuel === 'other' ? null : Number(prices?.[value.fuel] || 0) || null;
  const setFuel = (fuel: DebtFuel) => {
    const p = fuel === 'other' ? null : Number(prices?.[fuel] || 0) || null;
    if (fuel === 'other') return onChange({ ...value, fuel, litres: '' });
    // Keep what was typed; work the other figure out at the new fuel's price.
    if (!p) return onChange({ ...value, fuel });
    if (value.typed === 'amount' && Number(value.amount) > 0) return onChange({ ...value, fuel, litres: toLitres(Number(value.amount), p) });
    if (value.typed === 'litres' && Number(value.litres) > 0) return onChange({ ...value, fuel, amount: toAmount(Number(value.litres), p) });
    onChange({ ...value, fuel });
  };
  const typeLitres = (litres: string) => onChange({ ...value, litres, typed: 'litres', amount: price && Number(litres) > 0 ? toAmount(Number(litres), price) : '' });
  const typeAmount = (amount: string) => onChange({ ...value, amount, typed: 'amount', litres: price && Number(amount) > 0 ? toLitres(Number(amount), price) : '' });
  const fuels: DebtFuel[] = allowOther ? ['petrol', 'diesel', 'other'] : ['petrol', 'diesel'];
  const pad = compact ? 'p-2' : 'p-3';

  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${fuels.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {fuels.map((fuel) => (
          <button key={fuel} type="button" onClick={() => setFuel(fuel)}
            className={`rounded-lg border py-2 text-sm font-medium capitalize ${value.fuel === fuel ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-300 bg-white text-gray-700'}`}>
            {fuel}
          </button>
        ))}
      </div>
      {value.fuel === 'other' ? (
        <input type="number" inputMode="decimal" step="0.01" value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value, typed: 'amount' })}
          placeholder="Amount (KES)" className={`w-full rounded-lg border border-gray-300 ${pad} text-sm`} />
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <label className="text-xs text-gray-500">Litres
              <input type="number" inputMode="decimal" step="0.001" value={value.litres} onChange={(e) => typeLitres(e.target.value)}
                placeholder="0.000" disabled={!price}
                className={`mt-1 w-full rounded-lg border ${value.typed === 'litres' ? 'border-teal-600' : 'border-gray-300'} ${pad} text-sm text-gray-800`} />
            </label>
            <ArrowLeftRight size={16} className="mb-3 text-gray-400" />
            <label className="text-xs text-gray-500">Amount (KES)
              <input type="number" inputMode="decimal" step="0.01" value={value.amount} onChange={(e) => typeAmount(e.target.value)}
                placeholder="0.00" disabled={!price}
                className={`mt-1 w-full rounded-lg border ${value.typed === 'amount' ? 'border-teal-600' : 'border-gray-300'} ${pad} text-sm text-gray-800`} />
            </label>
          </div>
          <p className={`text-xs ${price ? 'text-gray-500' : 'text-red-600'}`}>
            {price ? `At this shift's ${value.fuel} price, KES ${price.toFixed(2)} a litre` : `No ${value.fuel} price is set for this shift. Set it in Prices first.`}
          </p>
        </>
      )}
    </div>
  );
}
