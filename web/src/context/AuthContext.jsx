import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getStoredToken, getStoredUser } from '../services/apiClient';
import { fetchCurrentUser, login as loginRequest, logout as logoutRequest } from '../services/auth';

const DUMMY_ADMIN_TOKEN = 'dummy-admin-token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [token, setToken] = useState(() => getStoredToken());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapAuth() {
      const storedToken = getStoredToken();
      const storedUser = getStoredUser();

      if (!storedToken || !storedUser) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      if (storedToken === DUMMY_ADMIN_TOKEN && storedUser.role === 'ADMIN') {
        if (!cancelled) {
          setUser(storedUser);
          setToken(storedToken);
          setIsLoading(false);
        }
        return;
      }

      try {
        const currentUser = await fetchCurrentUser();
        if (currentUser.role !== 'ADMIN') {
          logoutRequest();
          if (!cancelled) {
            setUser(null);
            setToken(null);
          }
          return;
        }

        if (!cancelled) {
          setUser(currentUser);
          setToken(storedToken);
        }
      } catch {
        logoutRequest();
        if (!cancelled) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email, password) => {
    const data = await loginRequest(email, password);
    setUser({
      id: data.id,
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
    });
    setToken(data.token);
    return data;
  };

  const logout = () => {
    logoutRequest();
    setUser(null);
    setToken(null);
  };

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: Boolean(user && token),
      isAdmin: user?.role === 'ADMIN',
      login,
      logout,
    }),
    [user, token, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
