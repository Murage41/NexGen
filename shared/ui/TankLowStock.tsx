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
        {hints.join(' · ')}
      </p>
    </div>
  );
}

// Each tank's fuel now as a bar (home screens, everyone). Red when below its
// order level, amber under a quarter full, teal otherwise.
export function TankLevels({ tanks, onOpen }: { tanks: any[] | undefined; onOpen?: () => void }) {
  if (!tanks || tanks.length === 0) return null;
  return (
    <button type="button" onClick={onOpen} className="w-full text-left bg-white rounded-xl p-4 shadow-sm mb-4">
      <p className="font-semibold text-gray-700 mb-3">Tanks</p>
      <div className="space-y-3">
        {tanks.map((tank) => {
          const capacity = Number(tank.capacity_litres || 0);
          const now = Number(tank.stock_now_litres ?? tank.current_stock_litres ?? 0);
          const share = capacity > 0 ? Math.max(0, Math.min(100, (now / capacity) * 100)) : 0;
          const low = isLowStock(tank);
          const colour = low ? 'bg-red-500' : share < 25 ? 'bg-amber-500' : 'bg-blue-600';
          return (
            <div key={tank.id}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">{tank.label}</span>
                <span className={low ? 'font-semibold text-red-600' : 'text-gray-800'}>{litres(now)}{low ? ' · Low' : ''}</span>
              </div>
              <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden">
                <div className={`h-full ${colour}`} style={{ width: `${share}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </button>
  );
}
