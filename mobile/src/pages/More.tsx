import { useNavigate } from 'react-router-dom';
import { Users, Fuel, DollarSign, BarChart3, LogOut } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';

const menuItems = [
  { label: 'Employees', path: '/employees', icon: Users, color: 'text-purple-500', bg: 'bg-purple-50' },
  { label: 'Pumps', path: '/pumps', icon: Fuel, color: 'text-blue-500', bg: 'bg-blue-50' },
  { label: 'Fuel Pricing', path: '/prices', icon: DollarSign, color: 'text-green-500', bg: 'bg-green-50' },
  { label: 'Reports', path: '/reports', icon: BarChart3, color: 'text-amber-500', bg: 'bg-amber-50' },
];

export default function More() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <div className="pb-6">
      <PageHeader title="More" />

      <div className="space-y-3">
        {menuItems.map(item => (
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
