import { useNavigate } from 'react-router-dom';
import { Users, Fuel, DollarSign, BarChart3, LogOut, Droplets, Truck } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';

type MenuItem = {
  label: string;
  path: string;
  icon: typeof Users;
  color: string;
  bg: string;
  adminOnly?: boolean;
};

const menuItems: MenuItem[] = [
  { label: 'Employees', path: '/employees', icon: Users, color: 'text-purple-500', bg: 'bg-purple-50', adminOnly: true },
  { label: 'Pumps', path: '/pumps', icon: Fuel, color: 'text-blue-500', bg: 'bg-blue-50', adminOnly: true },
  { label: 'Tanks & Stock', path: '/tanks', icon: Droplets, color: 'text-cyan-500', bg: 'bg-cyan-50', adminOnly: true },
  { label: 'Fuel Deliveries', path: '/deliveries', icon: Truck, color: 'text-orange-500', bg: 'bg-orange-50', adminOnly: true },
  { label: 'Suppliers', path: '/suppliers', icon: Truck, color: 'text-teal-500', bg: 'bg-teal-50', adminOnly: true },
  { label: 'Fuel Pricing', path: '/prices', icon: DollarSign, color: 'text-green-500', bg: 'bg-green-50', adminOnly: true },
  { label: 'Reports', path: '/reports', icon: BarChart3, color: 'text-amber-500', bg: 'bg-amber-50' },
];

export default function More() {
  const navigate = useNavigate();
  const { logout, isAdmin } = useAuth();

  const visibleItems = menuItems.filter(item => !item.adminOnly || isAdmin);

  return (
    <div className="pb-6">
      <PageHeader title="More" />

      <div className="space-y-3">
        {visibleItems.map(item => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="w-full bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 active:bg-gray-50"
          >
            <div className={`w-11 h-11 rounded-xl ${item.bg} flex items-center justify-center`}>
              <item.icon size={22} className={item.color} />
            </div>
            <span className="text-base font-medium text-gray-800">{item.label}</span>
          </button>
        ))}
      </div>

      <button
        onClick={logout}
        className="w-full mt-8 bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 active:bg-red-50 border border-red-100"
      >
        <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center">
          <LogOut size={22} className="text-red-500" />
        </div>
        <span className="text-base font-medium text-red-600">Logout</span>
      </button>
    </div>
  );
}
