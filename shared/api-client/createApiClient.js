export function createApiClient({ getBaseUrl, storage }) {
  const getStoredToken = () => storage.getToken();
  const getStoredUser = () => storage.getUser();
  const setAuthSession = (token, user) => storage.setSession(token, user);
  const clearAuthSession = () => storage.clearSession();

  async function apiRequest(path, options = {}) {
    const token = getStoredToken();
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

    const headers = {
      ...options.headers,
    };

    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const baseUrl = getBaseUrl().replace(/\/$/, '');
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });

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
    });

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
    });

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
    });

    return user;
  }

  async function fetchCurrentUser() {
    const response = await apiRequest('/auth/me');
    return response.data;
  }

  function logout() {
    clearAuthSession();
  }

  return {
    apiRequest,
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
