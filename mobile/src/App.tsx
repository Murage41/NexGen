import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import BottomNav from './components/BottomNav';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Shifts from './pages/Shifts';
import ShiftDetail from './pages/ShiftDetail';
import ShiftRecord from './pages/ShiftRecord';
import MyShift from './pages/MyShift';
import Expenses from './pages/Expenses';
import Credits from './pages/Credits';
import FuelPricing from './pages/FuelPricing';
import Employees from './pages/Employees';
import Pumps from './pages/Pumps';
import Tanks from './pages/Tanks';
import TankDips from './pages/TankDips';
import FuelDeliveries from './pages/FuelDeliveries';
import Reports from './pages/Reports';
import More from './pages/More';

export default function App() {
  const { user, isAdmin } = useAuth();

  if (!user) return <Login />;

  return (
    <div className="min-h-screen bg-gray-50 pb-safe">
      <div className="px-4 pt-4 pb-28">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {isAdmin ? (
            <>
              <Route path="/shifts" element={<Shifts />} />
              <Route path="/shifts/:id" element={<ShiftDetail />} />
              <Route path="/shifts/:id/record" element={<ShiftRecord />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/credits" element={<Credits />} />
              <Route path="/more" element={<More />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/pumps" element={<Pumps />} />
              <Route path="/tanks" element={<Tanks />} />
              <Route path="/tanks/:id/dips" element={<TankDips />} />
              <Route path="/deliveries" element={<FuelDeliveries />} />
              <Route path="/prices" element={<FuelPricing />} />
              <Route path="/reports" element={<Reports />} />
            </>
          ) : (
            <>
              <Route path="/my-shift" element={<MyShift />} />
              <Route path="/prices" element={<FuelPricing />} />
              <Route path="/shifts/:id" element={<ShiftDetail />} />
              <Route path="/shifts/:id/record" element={<ShiftRecord />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <BottomNav />
    </div>
  );
}
