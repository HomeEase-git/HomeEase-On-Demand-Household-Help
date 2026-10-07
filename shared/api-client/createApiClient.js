export function createApiClient({ getBaseUrl, storage }) {
  const getStoredToken = () => storage.getToken();
  const getStoredUser = () => storage.getUser();
  const setAuthSession = (token, user, refreshToken) => storage.setSession(token, user, refreshToken);
  const clearAuthSession = () => storage.clearSession();
  const baseUrl = () => getBaseUrl().replace(/\/$/, '');

  // Access tokens last minutes; this trades the stored refresh token for a
  // new pair. One request at a time per tab: the server treats a second use
  // of the same refresh token as theft and ends the session. Resolves the
  // new access token, or null if the session is over.
  let refreshInFlight = null;
  const RACE_WAIT_MS = 5000;

  function refreshSession() {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        const refreshToken = storage.getRefreshToken();
        if (!refreshToken) return null;
        const response = await fetch(`${baseUrl()}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) {
          // Another tab rotated the shared token a moment ago — wait for it
          // to store the new pair and use that, rather than signing out.
          const body = await response.json().catch(() => ({}));
          if (body.code !== 'REFRESH_RACE') return null;
          for (let waited = 0; waited < RACE_WAIT_MS; waited += 100) {
            if (storage.getRefreshToken() !== refreshToken) return storage.getToken();
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        }
        const { data } = await response.json();
        storage.setTokens(data.token, data.refreshToken);
        return data.token;
      })().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  // Authenticated fetch that returns the raw Response (for downloads) —
  // refreshes an expired access token once and replays the request.
  async function apiFetch(path, options = {}, isRetry = false) {
    const token = getStoredToken();
    const headers = { ...options.headers };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl()}${path}`, {
      ...options,
      headers,
    });

    // Only for requests that carried a session (a wrong password at login is
    // also a 401).
    if (response.status === 401 && token && !isRetry) {
      let newToken;
      try {
        newToken = await refreshSession();
      } catch {
        // Couldn't reach the server to refresh — keep the session and report
        // the original error.
        return response;
      }
      if (newToken) return apiFetch(path, options, true);
      // Refused: the session is over, unless another tab has signed in again
      // in the meantime.
      if (getStoredToken() === token) {
        clearAuthSession();
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('homeease:session-expired'));
      }
    }

    // An admin without MFA has a session but is refused admin routes until
    // setup is done — let the app route them to the setup screen.
    if (response.status === 403 && typeof window !== 'undefined') {
      const body = await response.clone().json().catch(() => ({}));
      if (body.code === 'ADMIN_MFA_REQUIRED') window.dispatchEvent(new Event('homeease:mfa-required'));
    }

    return response;
  }

  async function apiRequest(path, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

    const headers = {
      ...options.headers,
    };

    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await apiFetch(path, { ...options, headers });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      const message = data.message || `Request failed (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  async function login(email, password) {
    const response = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    const user = response.data;

    // MFA-enabled admin: the backend deliberately withholds a real session
    // here (only { mfaRequired: true, challengeToken }) — there's no token
    // to store yet, so return as-is and let the caller drive the challenge
    // step (see mfaChallenge below) before any session exists.
    if (user && user.mfaRequired) {
      return user;
    }

    setAuthSession(user.token, {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    }, user.refreshToken);

    return user;
  }

  // Exchanges a login-issued challengeToken + TOTP/backup code for a real
  // session — the second step of admin MFA login (see `login` above).
  async function mfaChallenge(challengeToken, code) {
    const response = await apiRequest('/auth/mfa/challenge', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, code }),
    });

    const user = response.data;
    setAuthSession(user.token, {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    }, user.refreshToken);

    return user;
  }

  async function signup(payload) {
    const response = await apiRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const user = response.data;
    setAuthSession(user.token, {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    }, user.refreshToken);

    return user;
  }

  async function fetchCurrentUser() {
    const response = await apiRequest('/auth/me');
    return response.data;
  }

  // Ends the session server-side (refresh token + current access token),
  // then locally. Local state is cleared even if the server call fails.
  async function logout() {
    const token = getStoredToken();
    const refreshToken = storage.getRefreshToken();
    clearAuthSession();
    if (!token) return;
    try {
      await fetch(`${baseUrl()}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
    } catch {
      // Best-effort.
    }
  }

  return {
    apiRequest,
    apiFetch,
    getStoredToken,
    getStoredUser,
    setAuthSession,
    clearAuthSession,
    login,
    mfaChallenge,
    signup,
    fetchCurrentUser,
    logout,
  };
}
