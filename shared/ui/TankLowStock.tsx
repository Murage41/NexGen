import { AlertTriangle } from 'lucide-react';

// Tank low-stock warning (M7), shared by desktop and phone. The server works
// out the fuel in each tank now (services/tankStock.ts); these only show it.

const litres = (value: any) => `${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })} L`;

// Below its "order more at" level? A tank without a level never is.
export function isLowStock(tank: any): boolean {
  return tank.reorder_level_litres != null && Number(tank.stock_now_litres) < Number(tank.reorder_level_litres);
}

// The dashboard's low_stock list as one warning. Nothing when no tank is low.
export function LowStockNotice({ tanks, onOpen }: { tanks: any[] | undefined; onOpen?: () => void }) {
  if (!tanks || tanks.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="mb-4 flex w-full items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-left text-sm text-red-900"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
      <span>
        <strong>Fuel is low: order more.</strong>
        {tanks.map((tank) => (
          <span key={tank.tank_id} className="block">
            {tank.label}: {litres(tank.stock_now_litres)} left (order at {litres(tank.reorder_level_litres)})
          </span>
        ))}
      </span>
    </button>
  );
}

// The "order more at" input on the tank form, with what the level means:
// its share of the tank and, when known, how many days of sales it covers.
export function OrderLevelField({
  value,
  onChange,
  capacity,
  avgDailyLitres,
  inputClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  capacity: number;
  avgDailyLitres?: number;
  inputClassName: string;
}) {
  const level = value === '' ? null : Number(value);
  const hints: string[] = [];
  if (level !== null && Number.isFinite(level) && capacity > 0) hints.push(`${((level / capacity) * 100).toFixed(0)}% of the tank`);
  if (avgDailyLitres && avgDailyLitres > 0) {
    hints.push(`sells about ${litres(avgDailyLitres)} a day (last 14 days)`);
    if (level !== null && Number.isFinite(level)) hints.push(`about ${(level / avgDailyLitres).toFixed(1)} days of fuel`);
  }
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Order more at (litres)</label>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
        placeholder="Empty: no warning"
      />
      <p className="mt-1 text-xs text-gray-500">
        {hints.length > 0 ? hints.join(' · ') : 'Everyone sees a warning when the fuel in the tank falls below this.'}
      </p>
      <p className="mt-0.5 text-xs text-gray-400">Set it to cover the days from ordering to delivery, plus a margin.</p>
    </div>
  );
}
