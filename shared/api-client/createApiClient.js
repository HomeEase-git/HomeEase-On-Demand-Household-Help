export function createApiClient({ getBaseUrl, storage }) {
  const getStoredToken = () => storage.getToken();
  const getStoredUser = () => storage.getUser();
  const setAuthSession = (token, user, refreshToken) => storage.setSession(token, user, refreshToken);
  const clearAuthSession = () => storage.clearSession();
  const baseUrl = () => getBaseUrl().replace(/\/$/, '');

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

    if (response.status === 401 && token && !isRetry) {
      let newToken;
      try {
        newToken = await refreshSession();
      } catch {
        return response;
      }
      if (newToken) return apiFetch(path, options, true);
      if (getStoredToken() === token) {
        clearAuthSession();
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('homeease:session-expired'));
      }
    }

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
