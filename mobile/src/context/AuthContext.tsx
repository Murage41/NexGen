import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface User {
  id: number;
  name: string;
  role: 'admin' | 'attendant';
  daily_wage: number;
}

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  isAdmin: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  isAdmin: false,
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('nexgen_user');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('nexgen_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('nexgen_user');
    }
  }, [user]);

  const isAdmin = user?.role === 'admin';
  const logout = () => {
    localStorage.removeItem('nexgen_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, isAdmin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
