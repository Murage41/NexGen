import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, ChevronRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { getSuppliers } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function Suppliers() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSuppliers()
      .then(res => setSuppliers(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (n: any) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  if (loading) return <div className="text-center text-gray-400 mt-20">Loading...</div>;

  return (
    <div className="pb-6">
      <PageHeader
        title="Suppliers"
        back
        right={
          isAdmin ? (
            <button onClick={() => navigate('/suppliers/new')} className="p-2 bg-blue-600 text-white rounded-xl">
              <Plus size={20} />
            </button>
          ) : undefined
        }
      />

      {suppliers.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl shadow-sm">
          <Truck size={36} className="mx-auto text-gray-300 mb-2" />
          <p className="text-gray-400 text-sm">No suppliers added yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {suppliers.map((s: any) => (
            <div
              key={s.id}
              onClick={() => navigate(`/suppliers/${s.id}`)}
              className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between active:bg-gray-50"
            >
              <div className="flex-1">
                <p className="font-semibold text-gray-800">{s.name}</p>
                {s.phone && <p className="text-xs text-gray-500">{s.phone}</p>}
                <p className="text-xs text-gray-400 mt-0.5">
                  {s.payment_terms_days === 0 ? 'COD' : `Net ${s.payment_terms_days} days`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className={`text-sm font-bold ${s.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {fmt(s.outstanding_balance)}
                  </p>
                  <p className="text-[11px] text-gray-400">outstanding</p>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
