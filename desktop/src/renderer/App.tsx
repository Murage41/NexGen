import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, Gauge, Users, Fuel, DollarSign,
  CreditCard, FileText, Receipt, BarChart3, Settings, Droplets, Truck,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Shifts from './pages/Shifts';
import ShiftDetail from './pages/ShiftDetail';
import Pumps from './pages/Pumps';
import Employees from './pages/Employees';
import FuelPricing from './pages/FuelPricing';
import Expenses from './pages/Expenses';
import Credits from './pages/Credits';
import CreditAccounts from './pages/CreditAccounts';
import Invoices from './pages/Invoices';
import TankStock from './pages/TankStock';
import Reports from './pages/Reports';
import Suppliers from './pages/Suppliers';
import SettingsPage from './pages/Settings';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/shifts', icon: Gauge, label: 'Shifts & Readings' },
  { to: '/pumps', icon: Fuel, label: 'Pumps' },
  { to: '/employees', icon: Users, label: 'Employees' },
  { to: '/fuel-pricing', icon: DollarSign, label: 'Fuel Pricing' },
  { to: '/expenses', icon: Receipt, label: 'Expenses' },
  { to: '/credit-accounts', icon: CreditCard, label: 'Credit Accounts' },
  { to: '/invoices', icon: FileText, label: 'Invoices' },
  { to: '/suppliers', icon: Truck, label: 'Suppliers' },
  { to: '/tank-stock', icon: Droplets, label: 'Tank & Stock' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function App() {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-xl font-bold text-blue-400">NexGen</h1>
          <p className="text-xs text-gray-400 mt-0.5">Petrol Station Manager</p>
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-700 text-xs text-gray-500">
          v1.0.0
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/shifts" element={<Shifts />} />
            <Route path="/shifts/:id" element={<ShiftDetail />} />
            <Route path="/pumps" element={<Pumps />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/fuel-pricing" element={<FuelPricing />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/credit-accounts" element={<CreditAccounts />} />
            <Route path="/credits" element={<Navigate to="/credit-accounts" replace />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/tank-stock" element={<TankStock />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
