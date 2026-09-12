import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Gauge, Receipt, CreditCard, Menu, DollarSign } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getStaleShifts } from '../services/api';

const STALE_SHIFT_POLL_MS = 2 * 60 * 1000;

export default function BottomNav() {
  const { isAdmin } = useAuth();
  const [staleShiftCount, setStaleShiftCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    const check = () =>
      getStaleShifts()
        .then((res) => { if (live) setStaleShiftCount(res.data.data.count); })
        .catch(() => {});
    check();
    const timer = setInterval(check, STALE_SHIFT_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [isAdmin]);

  const adminTabs = [
    { to: '/', icon: LayoutDashboard, label: 'Home' },
    { to: '/shifts', icon: Gauge, label: 'Shifts' },
    { to: '/expenses', icon: Receipt, label: 'Expenses' },
    { to: '/credits', icon: CreditCard, label: 'Credits' },
    { to: '/more', icon: Menu, label: 'More' },
  ];

  const attendantTabs = [
    { to: '/', icon: LayoutDashboard, label: 'Home' },
    { to: '/my-shift', icon: Gauge, label: 'My Shift' },
    { to: '/my-pay', icon: Receipt, label: 'My Pay' },
    { to: '/prices', icon: DollarSign, label: 'Prices' },
  ];

  const tabs = isAdmin ? adminTabs : attendantTabs;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`
            }
          >
            <span className="relative">
              <Icon size={22} />
              {to === '/shifts' && staleShiftCount > 0 && (
                <span className="absolute -top-1 -right-2 rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-tight text-gray-900">
                  {staleShiftCount}
                </span>
              )}
            </span>
            <span className="mt-0.5">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
