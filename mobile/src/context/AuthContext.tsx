import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';

interface User {
  id: number;
  user_id?: number | null;
  employee_id?: number | null;
  username?: string | null;
  name: string;
  role: 'admin' | 'attendant';
  daily_wage: number;
}

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  setSession: (user: User, token: string, expiresAt: string) => void;
  isAdmin: boolean;
  logout: () => void;
  sessionExpiresAt: string | null;
}

const USER_KEY = 'nexgen_user';
const TOKEN_KEY = 'nexgen_token';
const SESSION_EXPIRES_KEY = 'nexgen_session_expires_at';

function clearStoredSession() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_EXPIRES_KEY);
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const expiryMs = Date.parse(expiresAt);
  return !Number.isFinite(expiryMs) || expiryMs <= Date.now();
}

function loadStoredUser(): User | null {
  const saved = localStorage.getItem(USER_KEY);
  const token = localStorage.getItem(TOKEN_KEY);
  const expiresAt = localStorage.getItem(SESSION_EXPIRES_KEY);
  if (!saved || !token || isExpired(expiresAt)) {
    clearStoredSession();
    return null;
  }

  try {
    return JSON.parse(saved);
  } catch {
    clearStoredSession();
    return null;
  }
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  setSession: () => {},
  isAdmin: false,
  logout: () => {},
  sessionExpiresAt: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => loadStoredUser());
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(() =>
    localStorage.getItem(SESSION_EXPIRES_KEY)
  );

  const logout = useCallback(() => {
    clearStoredSession();
    setSessionExpiresAt(null);
    setUserState(null);
  }, []);

  const setUser = useCallback((nextUser: User | null) => {
    if (!nextUser) {
      logout();
      return;
    }
    setUserState(nextUser);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  }, [logout]);

  const setSession = useCallback((nextUser: User, token: string, expiresAt: string) => {
    if (!token || isExpired(expiresAt)) {
      logout();
      return;
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(SESSION_EXPIRES_KEY, expiresAt);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setSessionExpiresAt(expiresAt);
    setUserState(nextUser);
  }, [logout]);

  useEffect(() => {
    const handleExpired = () => logout();
    window.addEventListener('nexgen:session-expired', handleExpired);
    return () => window.removeEventListener('nexgen:session-expired', handleExpired);
  }, [logout]);

  useEffect(() => {
    const validateSession = () => {
      if (user && isExpired(localStorage.getItem(SESSION_EXPIRES_KEY))) logout();
    };
    document.addEventListener('visibilitychange', validateSession);
    window.addEventListener('focus', validateSession);
    return () => {
      document.removeEventListener('visibilitychange', validateSession);
      window.removeEventListener('focus', validateSession);
    };
  }, [logout, user]);

  useEffect(() => {
    if (!user) return;
    if (isExpired(sessionExpiresAt)) {
      logout();
      return;
    }

    const expiryMs = Date.parse(sessionExpiresAt || '');
    const delay = Math.min(Math.max(expiryMs - Date.now(), 0), 2147483647);
    const timer = window.setTimeout(() => logout(), delay);
    return () => window.clearTimeout(timer);
  }, [logout, sessionExpiresAt, user]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      clearStoredSession();
    }
  }, [user]);

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, setUser, setSession, isAdmin, logout, sessionExpiresAt }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
