import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import IdleWarningModal from '../components/common/IdleWarningModal';
import { recordActivity, useIdleSignOut } from '../hooks/useIdleSignOut';
import { getStoredToken, getStoredUser } from '../services/apiClient';
import {
  fetchCurrentUser,
  login as loginRequest,
  completeMfaChallenge as completeMfaChallengeRequest,
  logout as logoutRequest,
} from '../services/auth';

const AuthContext = createContext(null);

// Why the last session ended, for the login page to explain ('idle' or
// 'expired'). Per tab, and read once.
const SIGN_OUT_REASON_KEY = 'homeease_signout_reason';

const setSignOutReason = (reason) => {
  try {
    sessionStorage.setItem(SIGN_OUT_REASON_KEY, reason);
  } catch {
    // Storage unavailable — the login page just won't say why.
  }
};

export function takeSignOutReason() {
  try {
    const reason = sessionStorage.getItem(SIGN_OUT_REASON_KEY);
    sessionStorage.removeItem(SIGN_OUT_REASON_KEY);
    return reason;
  } catch {
    return null;
  }
}

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

  // The API client fires this when a refresh is refused (session revoked or
  // expired) — drop to the login screen instead of failing every request.
  useEffect(() => {
    const onSessionExpired = () => {
      setSignOutReason('expired');
      setUser(null);
      setToken(null);
    };
    window.addEventListener('homeease:session-expired', onSessionExpired);
    return () => window.removeEventListener('homeease:session-expired', onSessionExpired);
  }, []);

  // The server refuses admin routes until MFA is set up (ADMIN_MFA_REQUIRED)
  // — e.g. a session that skipped the setup screen. HashRouter, so a hash
  // change is a client-side navigation.
  useEffect(() => {
    const onMfaRequired = () => {
      if (window.location.hash !== '#/mfa-setup') window.location.hash = '#/mfa-setup';
    };
    window.addEventListener('homeease:mfa-required', onMfaRequired);
    return () => window.removeEventListener('homeease:mfa-required', onMfaRequired);
  }, []);

  const login = async (email, password) => {
    const data = await loginRequest(email, password);

    // MFA-enabled admin — no session yet. Return the challenge info as-is
    // so the caller (Login.jsx) can render the code-entry step; user/token
    // stay unset until completeMfaChallenge succeeds.
    if (data.mfaRequired) {
      return data;
    }

    setUser({
      id: data.id,
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
    });
    recordActivity();
    setToken(data.token);
    return data;
  };

  // Second step of admin MFA login — exchanges login's challengeToken plus
  // a TOTP/backup code for the real session.
  const completeMfaChallenge = async (challengeToken, code) => {
    const data = await completeMfaChallengeRequest(challengeToken, code);
    setUser({
      id: data.id,
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
    });
    recordActivity();
    setToken(data.token);
    return data;
  };

  const logout = useCallback(() => {
    logoutRequest();
    setUser(null);
    setToken(null);
  }, []);

  const signOutIdle = useCallback(() => {
    setSignOutReason('idle');
    logout();
  }, [logout]);

  const isAuthenticated = Boolean(user && token);
  const { secondsLeft, stayActive } = useIdleSignOut(isAuthenticated && !isLoading, signOutIdle);

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated,
      isAdmin: user?.role === 'ADMIN',
      login,
      completeMfaChallenge,
      logout,
    }),
    [user, token, isLoading, isAuthenticated, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {secondsLeft !== null && <IdleWarningModal secondsLeft={secondsLeft} onStay={stayActive} onSignOut={logout} />}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
