import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Gauge, Receipt, CreditCard, Menu, DollarSign } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function BottomNav() {
  const { isAdmin } = useAuth();

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
    { to: '/prices', icon: DollarSign, label: 'Prices' },
  ];

  const tabs = isAdmin ? adminTabs : attendantTabs;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50"
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
            <Icon size={22} />
            <span className="mt-0.5">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
