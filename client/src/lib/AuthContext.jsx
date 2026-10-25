import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getMe, login as apiLogin, register as apiRegister, logout as apiLogout } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await getMe());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    const u = await apiLogin(email, password);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (email, password) => {
    const u = await apiRegister(email, password);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch { /* already logged out server-side */ }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
