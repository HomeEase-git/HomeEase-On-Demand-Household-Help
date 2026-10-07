import axios, { AxiosRequestConfig, isAxiosError } from 'axios';
import { router } from 'expo-router';
import { config } from '../constants/config';
import { authStorage } from '../utils/storage';
import { AbortableRequest } from '../utils/apiErrorHandling';
import { KycDocumentKey } from '../utils/kycDocumentConfig';
import { mapKycDocumentType } from '../utils/kycDocumentTypeMap';
import { LEGAL_VERSIONS, type LegalDocumentType } from '../constants/legalDocuments';
import type { WorkerDetail, WorkerDigitalId, ParsedResume } from "../types/api.types";
import type {
  CreateBookingPayload,
  CreateBookingResponse,
  WorkerCard,
} from "../types/booking4step.types";

type NormalizedWorkerListItem = {
  id: string;
  name: string;
  service: string;
  serviceTypeNames: string[];
  rating: number;
  reviews: number;
  basePrice: number | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  status: string;
  avatar: string | null;
  activeJobCount: number | null;
  maxConcurrentJobs: number | null;
};

// ============================================================================
// API CLIENT SETUP
// ============================================================================

// The response interceptor below unwraps `response.data.data` (or `response.data`),
// so every call actually resolves with the unwrapped payload (T), not an
// AxiosResponse<T>. This interface reflects that real runtime behavior so
// callers get correct typing instead of "Property X does not exist on AxiosResponse".
interface ApiClient {
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
}

// Access tokens last minutes (server JWT_EXPIRY); this swaps the stored
// refresh token for a fresh pair. Concurrent callers share one request —
// the server treats a second use of the same refresh token as theft and
// ends the session. Resolves the new access token, or null when the server
// refused (session over). Throws when the server couldn't be reached, so
// callers can keep the session instead of logging out on a network blip.
let refreshInFlight: Promise<string | null> | null = null;

export function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await authStorage.getRefreshToken();
      if (!refreshToken) return null;
      try {
        const { data } = await axios.post(
          `${config.API_URL}/api/auth/refresh`,
          { refreshToken },
          { timeout: config.API_TIMEOUT_MS },
        );
        const next = data?.data;
        if (!next?.token || !next?.refreshToken) return null;
        await authStorage.saveRefreshToken(next.refreshToken);
        await authStorage.saveToken(next.token);
        // Dynamic import: see the note in the 401 handler below.
        const { useAuthStore } = await import('../store/authStore');
        if (useAuthStore.getState().isAuthenticated) {
          useAuthStore.setState({ token: next.token });
        }
        return next.token as string;
      } catch (error) {
        // REFRESH_RACE: the token was rotated a moment ago by another
        // request — transient, so keep the session like a network error.
        if (isAxiosError(error) && error.response && error.response.data?.code !== 'REFRESH_RACE') return null;
        throw error;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

const createApiClient = (): ApiClient => {

  console.log('[API] baseURL configured as:', `${config.API_URL}/api`);

  // eslint-disable-next-line import/no-named-as-default-member
  const client = axios.create({
    baseURL: `${config.API_URL}/api`,
    timeout: config.API_TIMEOUT_MS,
  });

  // Add auth token to all requests
  client.interceptors.request.use(async (request) => {
    const token = await authStorage.getToken();
    if (token) {
      request.headers.Authorization = `Bearer ${token}`;
    }

    if (__DEV__) {
      console.log('[API →]', request.method?.toUpperCase(), (request.baseURL || '') + request.url);
    }

    return request;
  });

  // Unwrap response.data.data structure
  client.interceptors.response.use((response) => {
    return response.data?.data ?? response.data;
  });

  // Global response error handler: a 401 clears local auth. A 403 does not —
  // the backend only sends 401 for a dead session (bad/expired/revoked token)
  // and uses 403 for ordinary business rules (WORKER_SETUP_INCOMPLETE, not
  // your booking, wrong role), which the calling screen shows as an error.
  client.interceptors.response.use(
    undefined,
    async (error) => {

      console.log('[API ←] ERROR message:', error.message);
      console.log('[API ←] ERROR code:', error.code);
      console.log('[API ←] ERROR url:', (error.config?.baseURL || '') + (error.config?.url || ''));
      console.log('[API ←] has response:', !!error.response);
      console.log('[API ←] has request:', !!error.request);
      console.log('[API ←] ERROR response data:', JSON.stringify(error.response?.data));

      // Expired access token: refresh once and replay the request. Only for
      // requests that carried a session — a 401 from a wrong password on
      // the login screen has nothing to refresh.
      let keepSession = false;
      const original = isAxiosError(error) ? (error.config as (typeof error.config & { _retried?: boolean }) | undefined) : undefined;
      if (
        isAxiosError(error) &&
        error.response?.status === 401 &&
        original &&
        !original._retried &&
        original.headers?.Authorization
      ) {
        original._retried = true;
        try {
          const newToken = await refreshSession();
          if (newToken) {
            original.headers.Authorization = `Bearer ${newToken}`;
            return client.request(original);
          }
        } catch {
          // Couldn't reach the server to refresh — don't sign the user out
          // over a network blip; the original error is reported below.
          keepSession = true;
        }
      }

      try {
        if (isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 && !keepSession) {
            // Dynamic import to avoid a circular dependency at module-load
            // time (authStore -> notificationService -> this file). Safe
            // here since it's only ever touched inside this async handler,
            // long after the whole module graph has finished loading.
            const { useAuthStore } = await import('../store/authStore');
            const wasAuthenticated = useAuthStore.getState().isAuthenticated;

            // Clear stored auth (token + user) so app reacts to unauthorized state
            try {
              await authStorage.clearAuth();
            } catch (e) {
              console.error('Error clearing auth on 401:', e);
            }

            // authStorage.clearAuth() only wipes AsyncStorage — without also
            // clearing the live zustand state, every screen keeps reading
            // the old (now-stale) user/token from memory and behaves as if
            // still logged in, while the *next* request has nothing to
            // send and fails with a confusing "No token provided" instead
            // of the real reason (a previous request's token got rejected
            // and the session was silently torn down underneath the UI).
            // Only do this — and only redirect — for a session that was
            // actually logged in; a 401 from a plain failed login attempt
            // has no session to tear down and its own screen already shows
            // the right error.
            if (wasAuthenticated) {
              useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
              router.replace('/landing');
            }
          }

          // Screens read `error.message` directly to show the user what went
          // wrong. Left alone, that's Axios's own generic text ("Request
          // failed with status code 401") instead of the backend's actual
          // reason. Rewrite it here, once, so every caller gets a message a
          // user can act on without each screen having to reach into
          // response.data itself.
          const backendMessage = error.response?.data?.message || error.response?.data?.error;
          if (typeof backendMessage === 'string' && backendMessage.trim()) {
            error.message = backendMessage;
          } else if (!error.response) {
            error.message =
              error.code === 'ECONNABORTED'
                ? 'The request took too long. Please try again.'
                : 'Unable to connect. Please check your internet connection.';
          } else if (status && status >= 500) {
            error.message = 'Something went wrong on our side. Please try again later.';
          } else {
            error.message = 'Something went wrong. Please try again.';
          }
        }
      } catch (e) {
        // swallow any error from the handler to avoid masking original error
        console.error('Error in response interceptor:', e);
      }

      return Promise.reject(error);
    }
  );

  // Cast to ApiClient since the interceptor changes the real return type.
  return client as unknown as ApiClient;
};

const api = createApiClient();

// Re-export AbortableRequest class for callers to create abort controllers
export { AbortableRequest };

// Convenience factory for creating an AbortableRequest instance
export function createAbortableRequest() {
  return new AbortableRequest();
}

// Returns an ApiClient-like wrapper that attaches the provided AbortSignal to requests
export function clientWithSignal(signal?: AbortSignal): ApiClient {
  return {
    get: (url, cfg) => api.get(url, { ...(cfg || {}), signal }),
    post: (url, data, cfg) => api.post(url, data, { ...(cfg || {}), signal }),
    put: (url, data, cfg) => api.put(url, data, { ...(cfg || {}), signal }),
    patch: (url, data, cfg) => api.patch(url, data, { ...(cfg || {}), signal }),
    delete: (url, cfg) => api.delete(url, { ...(cfg || {}), signal }),
  } as ApiClient;
}

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

export async function postSignUp(userData: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: 'client' | 'worker';
  // YYYY-MM-DD, workers only — the backend checks the accepted age range.
  birthDate?: string;
}) {
  try {
    const response = await api.post('/auth/signup', {
      fullName: userData.fullName,
      email: userData.email,
      phone: userData.phone,
      password: userData.password,
      role: userData.role.toUpperCase(),
      birthDate: userData.birthDate,
      // Sign-up can't be submitted without the Privacy Policy checkbox.
      privacyNoticeVersion: LEGAL_VERSIONS.PRIVACY_NOTICE,
    });
    return {
      id: response.id,
      name: response.fullName || response.name,
      email: response.email,
      phone: response.phone,
      role: response.role.toLowerCase(),
      kycStatus: response.kycStatus,
      hasAcceptedTerms: response.hasAcceptedTerms,
      token: response.token,
      refreshToken: response.refreshToken as string | undefined,
    };
  } catch (error) {
    console.error('Signup error:', error);
    throw error;
  }
}

// POST /auth/logout — ends this device's session on the server (refresh
// token and current access token). Best-effort; the caller clears local
// state regardless.
export async function postLogout(): Promise<void> {
  const refreshToken = await authStorage.getRefreshToken();
  await api.post('/auth/logout', refreshToken ? { refreshToken } : {});
}

export async function postLogin(email: string, password: string) {
  try {
    const response = await api.post('/auth/login', {
      email,
      password,
    });

    // MFA-enabled account — no session yet. The caller renders a code-entry
    // step and exchanges this challengeToken via postMfaChallenge below.
    if (response.mfaRequired) {
      return { mfaRequired: true as const, challengeToken: response.challengeToken as string };
    }

    // Two-step sign-in by email/SMS code — same idea: exchange the
    // challengeToken via postLoginCode below.
    if (response.twoFactorRequired) {
      return {
        twoFactorRequired: true as const,
        challengeToken: response.challengeToken as string,
        method: response.method as 'EMAIL' | 'SMS',
        destination: response.destination as string,
      };
    }

    return {
      id: response.id,
      name: response.fullName || response.name,
      email: response.email,
      phone: response.phone,
      role: response.role.toLowerCase(),
      kycStatus: response.kycStatus,
      hasAcceptedTerms: response.hasAcceptedTerms,
      token: response.token,
      refreshToken: response.refreshToken as string | undefined,
    };
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}

// POST /auth/mfa/challenge — exchanges postLogin's mfaRequired challengeToken
// plus a correct TOTP/backup code for a real session. Same response shape
// as postLogin's success path so callers can route identically either way.
export async function postMfaChallenge(challengeToken: string, code: string) {
  try {
    const response = await api.post('/auth/mfa/challenge', { challengeToken, code });
    return {
      id: response.id,
      name: response.fullName || response.name,
      email: response.email,
      phone: response.phone,
      role: response.role.toLowerCase(),
      kycStatus: response.kycStatus,
      hasAcceptedTerms: response.hasAcceptedTerms,
      token: response.token,
      refreshToken: response.refreshToken as string | undefined,
    };
  } catch (error) {
    console.error('MFA challenge error:', error);
    throw error;
  }
}

// POST /auth/2fa/verify — exchanges postLogin's twoFactorRequired
// challengeToken plus the emailed/texted code for a real session.
export async function postLoginCode(challengeToken: string, code: string) {
  const response = await api.post('/auth/2fa/verify', { challengeToken, code });
  return {
    id: response.id,
    name: response.fullName || response.name,
    email: response.email,
    phone: response.phone,
    role: response.role.toLowerCase(),
    kycStatus: response.kycStatus,
    hasAcceptedTerms: response.hasAcceptedTerms,
    token: response.token,
    refreshToken: response.refreshToken as string | undefined,
  };
}

export async function resendLoginCode(challengeToken: string): Promise<{ method: 'EMAIL' | 'SMS'; destination: string }> {
  return api.post('/auth/2fa/resend', { challengeToken });
}

// ============================================================================
// TWO-STEP SIGN-IN (email/SMS code) — opt-in for client/worker accounts from
// Profile > Two-Step Sign-In. Admins use an authenticator app on the web
// panel instead. A few older accounts still have an authenticator set up;
// they can sign in with it (postMfaChallenge) and turn it off (disableMfa).
// ============================================================================

export type TwoFactorMethod = 'EMAIL' | 'SMS';

/** Sends a confirmation code: to `method` when turning it on, to the current channel when turning it off. */
export async function sendTwoFactorCode(method?: TwoFactorMethod): Promise<{ method: TwoFactorMethod; destination: string }> {
  return api.post('/auth/2fa/code', method ? { method } : {});
}

export async function enableTwoFactor(method: TwoFactorMethod, code: string): Promise<{ twoFactorMethod: TwoFactorMethod }> {
  return api.post('/auth/2fa/enable', { method, code });
}

export async function disableTwoFactor(password: string, code: string): Promise<{ twoFactorMethod: null }> {
  return api.post('/auth/2fa/disable', { password, code });
}

export async function disableMfa(password: string, code: string): Promise<{ success: boolean; message: string }> {
  return api.post('/auth/mfa/disable', { password, code });
}

// POST /auth/reactivate — a deactivated worker turns their account back on,
// then signs in as usual.
export async function reactivateAccount(email: string, password: string): Promise<{ message?: string }> {
  return api.post('/auth/reactivate', { email, password });
}

// GET /auth/me — lighter than getUserProfile()'s /users/me (no
// notification prefs, addresses, etc.), used where only the sign-in
// security settings matter.
export async function fetchCurrentUser(): Promise<{
  id: string;
  role: string;
  phone: string | null;
  mfaEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
}> {
  return api.get('/auth/me');
}

export async function sendPasswordResetEmail(email: string) {
  try {
    const response = await api.post('/auth/forgot-password', { email });
    return {
      success: true,
      message: response.message || "Password reset email sent",
    };
  } catch (error) {
    console.error('Send password reset error:', error);
    throw error;
  }
}

export async function resetPassword(email: string, otp: string, newPassword: string) {
  try {
    const response = await api.post('/auth/reset-password', {
      email,
      otp,
      newPassword,
    });
    return {
      success: true,
      message: response.message || "Password reset successfully",
    };
  } catch (error) {
    console.error('Reset password error:', error);
    throw error;
  }
}

export async function sendOtpEmail(email: string) {
  try {
    const response = await api.post('/auth/send-otp', { email });
    return {
      success: true,
      message: response.message || "OTP sent to email",
    };
  } catch (error) {
    console.error('Send OTP error:', error);
    throw error;
  }
}

export async function verifyOtp(email: string, otp: string) {
  try {
    const response = await api.post('/auth/verify-otp', {
      email,
      otp,
    });
    return {
      success: true,
      message: response.message || "Email verified",
      token: response.token,
    };
  } catch (error) {
    console.error('Verify OTP error:', error);
    throw error;
  }
}

export async function verifyEmail(email: string, token: string) {
  try {
    const response = await api.post('/auth/verify-otp', {
      email,
      otp: token,
    });
    return {
      success: true,
      message: response.message || "Email verified successfully",
    };
  } catch (error) {
    console.error('Verify email error:', error);
    throw error;
  }
}

export async function validateEmail(email: string) {
  try {
    const response = await api.post('/auth/validate-email', { email });
    return response;
  } catch (error) {
    console.error('Validate email error:', error);
    throw error;
  }
}

// ============================================================================
// BOOKING ENDPOINTS - CLIENT
// ============================================================================

export async function getBookings(status?: string) {
  try {
    const response = await api.get('/bookings', {
      params: status ? { status } : {},
    });
    return response.bookings ? response.bookings : [];
  } catch (error) {
    console.error('Get bookings error:', error);
    throw error;
  }
}

export async function getBookingDetail(bookingId: string) {
  try {
    const response = await api.get(`/bookings/${bookingId}`);
    return response;
  } catch (error) {
    console.error('Get booking detail error:', error);
    throw error;
  }
}

export async function createBooking(details: CreateBookingPayload): Promise<CreateBookingResponse> {
  try {
    const response = await api.post('/bookings', {
      workerId: details.workerId ?? undefined,
      serviceType: details.serviceType,
      serviceTaskId: details.serviceTaskId ?? undefined,
      description: details.description || '',
      address: details.address,
      city: details.city || '',
      lat: details.lat,
      lng: details.lng,
      date: details.date,
      time: details.time,
      parentBookingId: details.parentBookingId ?? undefined,
      addOns: details.addOns || [],
      packageIds: details.packageIds || [],
      priorities: details.priorities ?? [],
      tip: details.tip || 0,
      notes: details.notes || '',
      paymentMethodType: details.paymentMethodType,
      paymentAccountIdentifier: details.paymentAccountIdentifier,
      scopeAnswers: details.scopeAnswers ?? undefined,
      issuePhotoUrls: details.issuePhotoUrls ?? [],
      idempotencyKey: details.idempotencyKey ?? undefined,
    });
    return response;
  } catch (error) {
    console.error('Create booking error:', error);
    throw error;
  }
}

export async function updateBookingStatus(bookingId: string, status: string) {
  try {
    // Map status names if needed
    let endpoint = `/bookings/${bookingId}/accept`;
    if (status.toLowerCase() === 'cancelled') {
      endpoint = `/bookings/${bookingId}/cancel`;
    } else if (status.toLowerCase() === 'in_progress' || status.toLowerCase() === 'in-progress') {
      endpoint = `/bookings/${bookingId}/start`;
    }

    const response = await api.patch(endpoint);
    return response;
  } catch (error) {
    console.error('Update booking status error:', error);
    throw error;
  }
}

// workerCancellationReason is required by the backend when the caller is a
// worker who hasn't arrived yet (one of 'WORKER_FAULT' | 'CLIENT_NO_SHOW' |
// 'OTHER') — omit it entirely for a client's own cancellation. After
// arriving, a worker instead sends `fault` ('CLIENT' | 'WORKER') plus 1-5
// proof photos (uploadJobPhoto).
export async function cancelBooking(
  bookingId: string,
  reason?: string,
  workerCancellationReason?: string,
  afterArrival?: { fault: 'CLIENT' | 'WORKER'; proofUrls: string[] },
): Promise<{ id: string; status: string; penaltyAmount?: number | null; compensationStatus?: string }> {
  try {
    const response = await api.patch(`/bookings/${bookingId}/cancel`, {
      reason,
      workerCancellationReason: afterArrival ? undefined : workerCancellationReason,
      ...(afterArrival ?? {}),
    });
    return response;
  } catch (error) {
    console.error('Cancel booking error:', error);
    throw error;
  }
}

// `revision` is the quote revision the client reviewed; the server refuses the
// approval if the worker has since reopened and resubmitted.
export async function approveQuote(bookingId: string, revision: number) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/quote/approve`, { revision });
    return response;
  } catch (error) {
    console.error('Approve quote error:', error);
    throw error;
  }
}

// Client refuses a quote (e.g. it doesn't match the receipt) — it goes back
// to the worker to revise and resubmit.
export async function rejectQuote(bookingId: string, reason: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/quote/reject`, { reason });
    return response;
  } catch (error) {
    console.error('Reject quote error:', error);
    throw error;
  }
}

export async function disputeQuote(bookingId: string, reason: string, evidenceUrls?: string[]) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/quote/dispute`, { reason, evidenceUrls });
    return response;
  } catch (error) {
    console.error('Dispute quote error:', error);
    throw error;
  }
}

// ============================================================================
// WORKER DISCOVERY & PROFILES - CLIENT
// ============================================================================

export async function getWorkers(filters?: {
  category?: string;
  minRating?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
}) {
  try {
    const params: Record<string, string | number> = {};

    if (filters?.category) params.category = filters.category;
    if (filters?.minRating !== undefined) params.minRating = filters.minRating;
    if (filters?.maxPrice !== undefined) params.maxPrice = filters.maxPrice;
    if (filters?.page) params.page = filters.page;
    if (filters?.limit) params.limit = filters.limit;

    const response = await api.get('/workers', { params });

    const workers = Array.isArray(response?.workers) ? response.workers : [];
    const normalized = workers.map(normalizeWorkerListItem);

    return {
      data: normalized,
      total: response?.pagination?.total ?? normalized.length,
      page: response?.pagination?.page ?? filters?.page ?? 1,
      limit: response?.pagination?.limit ?? filters?.limit ?? 10,
    };
  } catch (error) {
    console.error("Get workers error:", error);
    throw error;
  }
}

export interface DiscoverWorkersFilters {
  serviceType?: string;
  date?: string; // YYYY-MM-DD
  // Answers to the selected category's scope fields, keyed by field label —
  // only fields the admin flagged "use to match workers" actually filter
  // candidates server-side (see matchingService.buildCapabilityFilters).
  scopeAnswers?: Record<string, string | string[]>;
  hasPets?: boolean;
  serviceTaskId?: string;
  lat?: number;
  lng?: number;
  // Scopes results to a single worker — used to check whether a specific
  // (e.g. profile-locked) worker works on a date rather than discovering a list.
  workerId?: string;
  page?: number;
  limit?: number;
}

export interface DiscoverWorkersResult {
  workers: WorkerCard[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * GET /workers with the Phase 2 discovery contract (scope + date filters,
 * server-side KYC/availability filtering, sorted rating desc). Used by
 * Step 2 (live pro count for the date) and Step 3 (full worker card list)
 * — unlike the legacy `getWorkers`/`searchWorkers` above, filtering/
 * sorting/pagination all happen server-side here.
 */
export async function discoverWorkers(filters: DiscoverWorkersFilters): Promise<DiscoverWorkersResult> {
  try {
    const params: Record<string, string | number> = {};
    if (filters.serviceType) params.serviceType = filters.serviceType;
    if (filters.date) params.date = filters.date;
    if (filters.scopeAnswers && Object.keys(filters.scopeAnswers).length > 0) {
      params.scopeAnswers = JSON.stringify(filters.scopeAnswers);
    }
    if (filters.hasPets) params.hasPets = 'true';
    if (filters.serviceTaskId) params.serviceTaskId = filters.serviceTaskId;
    if (filters.lat != null) params.lat = filters.lat;
    if (filters.lng != null) params.lng = filters.lng;
    if (filters.workerId) params.workerId = filters.workerId;
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;

    const response = await api.get('/workers', { params });

    return {
      workers: Array.isArray(response?.workers) ? response.workers : [],
      pagination: response?.pagination ?? { page: 1, limit: 10, total: 0, pages: 0 },
    };
  } catch (error) {
    console.error('Discover workers error:', error);
    throw error;
  }
}

/**
 * GET /workers/:id/blocked-dates — dates in the booking window this worker
 * doesn't work (weekly schedule + days they closed). The booking calendar
 * greys them out for a profile-picked worker.
 */
export async function getWorkerUnavailableDates(workerId: string): Promise<string[]> {
  const response = await api.get(`/workers/${workerId}/blocked-dates`);
  return Array.isArray(response?.dates) ? response.dates : [];
}

/**
 * GET /workers/:id/availability?date= — whether the worker works that day
 * and the start times of the jobs they already have on it (a hint only —
 * workers can take several jobs a day).
 */
export async function getWorkerDayAvailability(workerId: string, date: string): Promise<{ available: boolean; occupied: string[] }> {
  const response = await api.get(`/workers/${workerId}/availability`, { params: { date } });
  return { available: Boolean(response?.available), occupied: Array.isArray(response?.occupied) ? response.occupied : [] };
}

function normalizeWorkerListItem(worker: any): NormalizedWorkerListItem {
  const rawStatus = String(worker.status ?? "available").toLowerCase();
  const normalizedStatus =
    rawStatus === "busy" || rawStatus === "unavailable"
      ? "unavailable"
      : "available";

  return {
    id: worker.id ?? worker.userId ?? "",
    name: worker.name ?? worker.fullName ?? worker.user?.fullName ?? "Unnamed worker",
    service:
      worker.service ??
      worker.serviceType ??
      worker.serviceTypes?.[0]?.name ??
      "General service",
    serviceTypeNames: Array.isArray(worker.serviceTypeNames)
      ? worker.serviceTypeNames
      : [],
    rating: Number(worker.rating ?? 0),
    reviews: Number(worker.reviews ?? worker.reviewCount ?? 0),
    basePrice:
      typeof worker.basePrice === "number"
        ? worker.basePrice
        : typeof worker.rate === "number"
          ? worker.rate
          : typeof worker.estimatedTotal === "number"
            ? worker.estimatedTotal
            : null,
    priceRangeMin: typeof worker.priceRangeMin === "number" ? worker.priceRangeMin : null,
    priceRangeMax: typeof worker.priceRangeMax === "number" ? worker.priceRangeMax : null,
    status: normalizedStatus,
    avatar: worker.avatar ?? worker.user?.avatar ?? null,
    activeJobCount: typeof worker.activeJobCount === "number" ? worker.activeJobCount : null,
    maxConcurrentJobs: typeof worker.maxConcurrentJobs === "number" ? worker.maxConcurrentJobs : null,
  };
}

export async function getWorkerDetail(workerId: string): Promise<WorkerDetail | null> {
  try {
    const response = await api.get(`/workers/${workerId}`);
    const services: { id: string; name: string; basePrice: number; priceRangeMin: number; priceRangeMax: number }[] =
      Array.isArray(response.services)
        ? response.services.map((s: any) => ({
            id: s.id,
            name: s.name,
            basePrice: s.basePrice,
            priceRangeMin: s.priceRangeMin,
            priceRangeMax: s.priceRangeMax,
          }))
        : [];
    const service = services[0]?.name ?? "General service";
    const skills = response.resumeParseResult?.parsedSkills?.length
      ? response.resumeParseResult.parsedSkills
      : [service];

    return {
      id: response.id,
      name: response.name,
      service,
      services,
      tier: response.tier ?? undefined,
      rating: Number(response.rating ?? 0),
      reviews: Number(response.reviewCount ?? 0),
      priceRangeMin: typeof response.priceRangeMin === "number" ? response.priceRangeMin : null,
      priceRangeMax: typeof response.priceRangeMax === "number" ? response.priceRangeMax : null,
      status: response.isAvailable ? "available" : "busy",
      avatar: response.avatar ?? undefined,
      bio: response.bio ?? "",
      serviceAreaRadius: response.serviceAreaRadius ?? 0,
      certifications: response.certifications ?? [],
      resumeParseResult: response.resumeParseResult ?? null,
      skills,
      activeJobCount: Number(response.activeJobCount ?? 0),
      verificationStatus: response.verificationStatus ?? "PENDING",
      isAvailable: Boolean(response.isAvailable),
      availableDays: Array.isArray(response.availableDays) ? response.availableDays : [],
      maxConcurrentJobs: Number(response.maxConcurrentJobs ?? 0),
    };
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    console.error('Get worker detail error:', error);
    throw error;
  }
}

export async function getMyDigitalId(): Promise<WorkerDigitalId> {
  try {
    const response = await api.get('/workers/me/digital-id');
    return response;
  } catch (error) {
    console.error('Get digital ID error:', error);
    throw error;
  }
}

/**
 * Runs (or, with force=true, re-runs) AI resume parsing against the
 * worker's already-uploaded resume and returns the extracted result.
 * Returns a cached result without re-calling the AI unless force is set.
 */
export async function parseMyResume(force = false): Promise<ParsedResume> {
  try {
    const response = await api.post('/workers/me/resume/parse', { force });
    return response;
  } catch (error) {
    console.error('Parse resume error:', error);
    throw error;
  }
}

export async function searchWorkers(filters: {
  query?: string;
  categoryId?: string;
  minRating?: number;
  availableOnly?: boolean;
  sortBy?: "rating" | "priceLow" | "priceHigh";
  page?: number;
  // How many raw candidates to fetch from the server before client-side
  // filter/sort/paginate. Defaults to 50 for the full discovery/search
  // screens; callers that only show a short preview (e.g. the home screen's
  // "Available Workers" section) can pass a much smaller number instead of
  // downloading 50 full worker records just to display 3.
  fetchLimit?: number;
}) {
  try {
    const params: Record<string, string | number> = { limit: filters.fetchLimit ?? 50 };
    if (filters.categoryId) params.category = filters.categoryId;
    if (filters.minRating !== undefined) params.minRating = filters.minRating;

    const response = await api.get('/workers', { params });
    const rawWorkers: any[] = Array.isArray(response?.workers) ? response.workers : [];

    let results: Array<NormalizedWorkerListItem & { rate: number }> = rawWorkers.map((w: any) => {
      const item = normalizeWorkerListItem(w);
      return { ...item, rate: item.basePrice ?? 0 };
    });

    const q = filters.query?.toLowerCase().trim();
    if (q) {
      results = results.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          w.service.toLowerCase().includes(q) ||
          w.serviceTypeNames.some((s) => s.toLowerCase().includes(q))
      );
    }

    if (filters.availableOnly) {
      results = results.filter((w) => w.status === "available");
    }

    if (filters.sortBy === "priceLow") {
      results = [...results].sort((a, b) => a.rate - b.rate);
    } else if (filters.sortBy === "priceHigh") {
      results = [...results].sort((a, b) => b.rate - a.rate);
    } else {
      results = [...results].sort((a, b) => b.rating - a.rating);
    }

    const page = filters.page || 1;
    const limit = 10;
    const start = (page - 1) * limit;

    return {
      data: results.slice(start, start + limit),
      total: results.length,
      page,
    };
  } catch (error) {
    console.error("Search workers error:", error);
    throw error;
  }
}

export async function getWorkerReviews(workerId: string, limit = 50) {
  try {
    const response = await api.get(`/workers/${workerId}/reviews`, { params: { limit } });
    const reviews = (response.reviews ?? []).map((r: any) => ({
      id: r.id,
      clientName: r.reviewer?.name ?? "Client",
      clientAvatar: r.reviewer?.avatar ?? null,
      rating: Number(r.rating ?? 0),
      comment: r.comment ?? "",
      date: r.createdAt,
      bookingId: r.bookingId,
      workerResponse: r.workerResponse ?? null,
      photoUrls: Array.isArray(r.photoUrls) ? (r.photoUrls as string[]) : [],
    }));

    // Star distribution isn't provided by the backend — approximated from
    // the fetched page of reviews, not an exact server-side aggregate.
    const counts = [0, 0, 0, 0, 0]; // counts[0] = 1-star ... counts[4] = 5-star
    reviews.forEach((r: { rating: number }) => {
      const idx = Math.min(5, Math.max(1, Math.round(r.rating))) - 1;
      counts[idx] += 1;
    });
    const total = reviews.length || 1;
    const distribution: Record<number, number> = {
      5: Math.round((counts[4] / total) * 100),
      4: Math.round((counts[3] / total) * 100),
      3: Math.round((counts[2] / total) * 100),
      2: Math.round((counts[1] / total) * 100),
      1: Math.round((counts[0] / total) * 100),
    };

    return {
      reviews,
      pagination: response.pagination,
      distribution,
    };
  } catch (error) {
    console.error('Get worker reviews error:', error);
    throw error;
  }
}

export async function respondToReview(reviewId: string, response: string) {
  try {
    return await api.post(`/workers/me/reviews/${reviewId}/response`, { response });
  } catch (error) {
    console.error('Respond to review error:', error);
    throw error;
  }
}

// ============================================================================
// PAYMENT METHODS - CLIENT
// ============================================================================

export const paymentMethodTypeMap: Record<string, string> = {
  gcash: 'GCASH',
  maya: 'MAYA',
  cash: 'CASH',
};

export async function getPaymentMethods() {
  try {
    const response = await api.get('/users/me/payment-methods');
    return Array.isArray(response) ? response : [];
  } catch (error) {
    console.error('Get payment methods error:', error);
    throw error;
  }
}

export async function addPaymentMethod(data: {
  type: string;
  accountIdentifier: string;
  label?: string;
}) {
  try {
    const normalizedType = paymentMethodTypeMap[data.type.toLowerCase()] ?? data.type.toUpperCase();

    const response = await api.post('/users/me/payment-methods', {
      type: normalizedType,
      accountIdentifier: data.accountIdentifier,
      label: data.label,
    });
    return response;
  } catch (error) {
    console.error('Add payment method error:', error);
    throw error;
  }
}

export async function updatePaymentMethod(methodId: string, data: { label: string }) {
  try {
    const response = await api.patch(`/users/me/payment-methods/${methodId}`, data);
    return response;
  } catch (error) {
    console.error('Update payment method error:', error);
    throw error;
  }
}

export async function deletePaymentMethod(methodId: string) {
  try {
    const response = await api.delete(`/users/me/payment-methods/${methodId}`);
    return {
      success: true,
      message: response.message || "Payment method deleted successfully",
    };
  } catch (error) {
    console.error('Delete payment method error:', error);
    throw error;
  }
}

export async function setDefaultPaymentMethod(methodId: string) {
  try {
    const response = await api.patch(`/users/me/payment-methods/${methodId}/set-default`);
    return {
      success: true,
      message: response.message || "Default payment method updated",
      methodId,
    };
  } catch (error) {
    console.error('Set default payment method error:', error);
    throw error;
  }
}

// ============================================================================
// ADDRESSES - CLIENT
// ============================================================================

export type GoogleGeocodeResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
  locationType: string;
  partialMatch: boolean;
  components: {
    houseNumber?: string;
    street?: string;
    barangay?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
};

// Backend-proxied Google Places API (New) — the server-side API key never
// ships to the mobile bundle. Resolves to `null`/`[]` (never throws) whenever
// Google isn't configured server-side, the address genuinely doesn't resolve,
// or the request fails — callers (utils/geo.ts) treat all three the same way.
// Reverse geocoding ("use my current location") is NOT proxied: it runs
// on-device via expo-location, see utils/geo.ts reverseGeocodeDetailed.
export async function geocodeAddressGoogle(address: string): Promise<GoogleGeocodeResult | null> {
  try {
    return await api.post('/geo/geocode', { address });
  } catch (error) {
    console.error('Google geocode proxy error:', error);
    return null;
  }
}

export type GoogleAutocompleteSuggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

export async function autocompleteAddressesGoogle(
  input: string,
  sessionToken: string,
  near?: { lat: number; lng: number },
): Promise<GoogleAutocompleteSuggestion[]> {
  try {
    return await api.post('/geo/autocomplete', { input, sessionToken, near });
  } catch (error) {
    console.error('Google autocomplete proxy error:', error);
    return [];
  }
}

export async function getPlaceDetailsGoogle(placeId: string, sessionToken?: string): Promise<GoogleGeocodeResult | null> {
  try {
    return await api.post('/geo/place-details', { placeId, sessionToken });
  } catch (error) {
    console.error('Google place details proxy error:', error);
    return null;
  }
}

export type GoogleDirectionsResult = {
  coordinates: { lat: number; lng: number }[];
  distanceKm: number;
  durationMin: number;
};

export async function getDirectionsGoogle(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<GoogleDirectionsResult | null> {
  try {
    return await api.post('/geo/directions', { origin, destination });
  } catch (error) {
    console.error('Google directions proxy error:', error);
    return null;
  }
}

export async function getAddresses() {
  try {
    const response = await api.get('/users/me/addresses');
    return Array.isArray(response) ? response : [];
  } catch (error) {
    console.error('Get addresses error:', error);
    throw error;
  }
}

export async function addAddress(data: {
  label: string;
  // One free-text line shown to client and worker; the pin (lat/lng) is the
  // location. The split fields below are Google's parts for the pin, if any.
  fullAddress: string;
  lat: number;
  lng: number;
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  houseNumber?: string;
  barangay?: string;
  landmark?: string;
  geocodeAccuracy?: number;
}) {
  try {
    const response = await api.post('/users/me/addresses', data);
    return response;
  } catch (error) {
    console.error('Add address error:', error);
    throw error;
  }
}

export async function updateAddress(addressId: string, data: {
  label?: string;
  fullAddress?: string;
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  houseNumber?: string;
  barangay?: string;
  landmark?: string;
  lat?: number;
  lng?: number;
  geocodeAccuracy?: number;
}) {
  try {
    const response = await api.patch(`/users/me/addresses/${addressId}`, data);
    return response;
  } catch (error) {
    console.error('Update address error:', error);
    throw error;
  }
}

export async function deleteAddress(addressId: string) {
  try {
    const response = await api.delete(`/users/me/addresses/${addressId}`);
    return {
      success: true,
      message: response.message || "Address deleted successfully",
    };
  } catch (error) {
    console.error('Delete address error:', error);
    throw error;
  }
}

export async function setDefaultAddress(addressId: string) {
  try {
    const response = await api.patch(`/users/me/addresses/${addressId}/set-default`);
    return {
      success: true,
      message: response.message || "Default address set successfully",
      data: response,
    };
  } catch (error) {
    console.error('Set default address error:', error);
    throw error;
  }
}

// ============================================================================
// TRANSACTIONS - CLIENT
// ============================================================================

function titleCaseStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export async function getTransactions(page?: number, status?: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED') {
  try {
    const params: Record<string, string | number> = {};
    if (page) params.page = page;
    if (status) params.status = status;
    const response = await api.get('/payments', { params });
    const payments = response.payments ?? [];
    return {
      data: payments.map((p: any) => ({
        id: p.id,
        bookingId: p.bookingId,
        amount: p.amount,
        method: p.methodType,
        status: titleCaseStatus(p.status ?? "Pending"),
        date: p.createdAt,
        // Worker-only — the actual Xendit payout status, separate from
        // `status` above (which only reflects the client's payment/escrow).
        payoutStatus: p.payoutStatus ?? null,
        payoutFailureReason: p.payoutFailureReason ?? null,
      })),
      total: response.pagination?.total ?? payments.length,
      page: response.pagination?.page ?? page ?? 1,
    };
  } catch (error) {
    console.error('Get transactions error:', error);
    throw error;
  }
}

export async function getTransactionDetail(bookingId: string) {
  try {
    const response = await api.get(`/payments/${bookingId}`);
    return {
      id: response.id,
      bookingId: response.bookingId,
      clientName: response.clientName,
      workerName: response.workerName,
      serviceName: response.serviceName,
      status: titleCaseStatus(response.status ?? "Pending"),
      escrowStatus: response.escrowStatus,
      method: response.methodType,
      amount: response.priceBreakdown?.total,
      breakdown: response.priceBreakdown,
      date: response.createdAt,
      transactionId: response.transactionId,
      failureMessage: response.failureMessage,
    };
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    console.error('Get transaction detail error:', error);
    throw error;
  }
}

// Resume the Xendit checkout for a GCash/Maya booking that is AWAITING_PAYMENT
// (client abandoned or failed an earlier attempt). Returns the live hosted
// invoice URL, minting a fresh one server-side if the previous invoice expired.
export async function createXenditCheckout(bookingId: string) {
  try {
    const response = await api.post(`/payments/${bookingId}/xendit/checkout`);
    // alreadyPaid: true means the server found this already PAID on Xendit's
    // side (webhook was missed/delayed) and self-healed it — no checkout to open.
    return response as
      | { checkoutUrl: string; invoiceId: string; amount: number; alreadyPaid?: undefined }
      | { alreadyPaid: true; checkoutUrl?: undefined };
  } catch (error) {
    console.error('Create Xendit checkout error:', error);
    throw error;
  }
}

// ============================================================================
// REVIEWS - CLIENT
// ============================================================================

export async function submitReview(
  bookingId: string,
  rating: number,
  comment: string,
  photoUrls?: string[],
) {
  try {
    const response = await api.post(`/bookings/${bookingId}/review`, {
      rating,
      comment,
      ...(photoUrls && photoUrls.length > 0 ? { photoUrls } : {}),
    });
    return response;
  } catch (error) {
    console.error('Submit review error:', error);
    throw error;
  }
}

export async function getMyReviews(page?: number) {
  try {
    const response = await api.get('/users/me/reviews', {
      params: page ? { page } : {},
    });
    const reviews = response.reviews ?? [];
    return {
      data: reviews.map((r: any) => ({
        id: r.id,
        workerName: r.workerName,
        workerAvatar: r.workerAvatar ?? null,
        workerId: r.workerId,
        rating: r.rating,
        comment: r.comment ?? "",
        bookingId: r.bookingId,
        date: r.createdAt,
      })),
      total: response.pagination?.total ?? reviews.length,
      page: response.pagination?.page ?? page ?? 1,
    };
  } catch (error) {
    console.error('Get my reviews error:', error);
    throw error;
  }
}

// ============================================================================
// MESSAGING
// ============================================================================

export async function getConversations() {
  try {
    const response = await api.get('/messages/conversations');
    const conversations = response.conversations ?? [];
    return conversations.map((c: any) => ({
      userId: c.userId,
      name: c.userName,
      avatar: c.userImage ?? null,
      phone: c.userPhone ?? null,
      lastMessage: c.lastMessage,
      lastMessageTime: c.lastMessageTime,
      unread: c.unreadCount ?? 0,
    }));
  } catch (error) {
    console.error('Get conversations error:', error);
    throw error;
  }
}

export async function getConversationThread(userId: string, page?: number) {
  try {
    const response = await api.get(`/messages/conversations/${userId}`, {
      params: page ? { page } : {},
    });
    return response.messages ?? [];
  } catch (error) {
    console.error('Get conversation thread error:', error);
    throw error;
  }
}

export async function sendMessage(receiverId: string, content: string, imageUrl?: string) {
  try {
    const response = await api.post('/messages', { receiverId, content, imageUrl });
    return response;
  } catch (error) {
    console.error('Send message error:', error);
    throw error;
  }
}

export async function markMessagesAsRead(userId: string) {
  try {
    const response = await api.patch(`/messages/conversations/${userId}/read`);
    return { success: true, updatedCount: response.updatedCount };
  } catch (error) {
    console.error('Mark messages as read error:', error);
    throw error;
  }
}

export async function uploadChatImage(uri: string): Promise<{ url: string }> {
  try {
    const filename = uri.split('/').pop() ?? `chat-${Date.now()}.jpg`;
    const match = /\.(\w+)$/.exec(filename);
    const ext = match ? match[1].toLowerCase() : 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    const formData = new FormData();
    formData.append('image', {
      uri,
      name: filename,
      type: mimeType,
    } as any);

    const response = await api.post('/messages/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response;
  } catch (error) {
    console.error('Upload chat image error:', error);
    throw error;
  }
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export async function getNotifications(page?: number) {
  try {
    const response = await api.get('/notifications', {
      params: page ? { page } : {},
    });
    return response.notifications ?? [];
  } catch (error) {
    console.error('Get notifications error:', error);
    throw error;
  }
}

export async function markNotificationRead(id: string) {
  try {
    const response = await api.patch(`/notifications/${id}/read`);
    return response;
  } catch (error) {
    console.error('Mark notification read error:', error);
    throw error;
  }
}

export async function markAllNotificationsRead() {
  try {
    const response = await api.patch('/notifications/read-all');
    return { success: true, updatedCount: response.updatedCount };
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    throw error;
  }
}

export async function getUnreadNotificationCount() {
  try {
    const response = await api.get('/notifications/unread-count');
    return response.unreadCount ?? 0;
  } catch (error) {
    console.error('Get unread notification count error:', error);
    throw error;
  }
}

export async function updatePushToken(token: string) {
  try {
    const response = await api.post('/notifications/push-token', { token });
    return response;
  } catch (error) {
    console.error('Update push token error:', error);
    throw error;
  }
}

export async function removePushToken() {
  try {
    const response = await api.delete('/notifications/push-token');
    return response;
  } catch (error) {
    console.error('Remove push token error:', error);
    throw error;
  }
}

// ============================================================================
// WORKER ENDPOINTS
// ============================================================================

// confirmFollowUp: a follow-up job (after the worker's own inspection) needs
// the worker's explicit second confirmation — see the request screen.
export async function acceptBooking(bookingId: string, options?: { confirmFollowUp?: boolean }) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/accept`, options ?? {});
    return response;
  } catch (error) {
    console.error('Accept booking error:', error);
    throw error;
  }
}

export async function declineBooking(bookingId: string, reason?: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/decline`, { reason });
    return response;
  } catch (error) {
    console.error('Decline booking error:', error);
    throw error;
  }
}

export async function startBooking(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/start`);
    return response;
  } catch (error) {
    console.error('Start booking error:', error);
    throw error;
  }
}

export interface BookingVisit {
  id: string;
  scheduledDate: string;
  scheduledTime: string;
  notes: string | null;
  status: 'SCHEDULED' | 'DONE' | 'CANCELLED';
}

/**
 * POST /bookings/:id/visits — "Follow Up Date": the worker schedules another
 * visit when the job needs more than one day. nearbyJobs lists their other
 * jobs starting close to it (a heads-up, never a block).
 */
export async function scheduleFollowUpVisit(
  bookingId: string,
  date: string,
  time: string,
  notes?: string,
): Promise<{ visit: BookingVisit; nearbyJobs: { bookingId: string; time: string; service: string }[] }> {
  return api.post(`/bookings/${bookingId}/visits`, { date, time, notes });
}

export async function cancelFollowUpVisit(bookingId: string, visitId: string): Promise<BookingVisit> {
  return api.patch(`/bookings/${bookingId}/visits/${visitId}/cancel`);
}

/** PATCH /bookings/:id/acknowledge-reschedule — client keeps the new date. */
export async function acknowledgeReschedule(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/acknowledge-reschedule`);
    return response;
  } catch (error) {
    console.error('Acknowledge reschedule error:', error);
    throw error;
  }
}

/**
 * PATCH /bookings/:id/request-reschedule — the client OR the worker proposes
 * a new date + start time for an ACCEPTED booking; the other side accepts or
 * declines (respondToRescheduleRequest).
 */
export async function requestReschedule(bookingId: string, date: string, time: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/request-reschedule`, { date, time });
    return response;
  } catch (error) {
    console.error('Request reschedule error:', error);
    throw error;
  }
}

/** PATCH /bookings/:id/reschedule-request/withdraw — the side that asked backs out of its own pending request. */
export async function withdrawRescheduleRequest(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/reschedule-request/withdraw`);
    return response;
  } catch (error) {
    console.error('Withdraw reschedule request error:', error);
    throw error;
  }
}

/** PATCH /bookings/:id/reschedule-request/respond — the other side accepts or declines the proposed date. */
export async function respondToRescheduleRequest(bookingId: string, accept: boolean) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/reschedule-request/respond`, { accept });
    return response;
  } catch (error) {
    console.error('Respond to reschedule request error:', error);
    throw error;
  }
}

export interface ArrivalVerificationResult {
  id: string;
  workerArrivedAt: string;
  arrivalVerification: {
    id: string;
    distanceMeters: number;
    isVerified: boolean;
    createdAt: string;
  };
}

/**
 * PATCH /bookings/:id/arrive — worker checks in at the job site. The
 * backend enforces the <=100m geofence server-side (against the client's
 * booked lat/lng) and rejects with a 409 if the worker is too far; this
 * wrapper just forwards the device's current GPS reading.
 */
export async function arriveBooking(
  bookingId: string,
  lat: number,
  lng: number,
  accuracy?: number | null,
  mocked?: boolean | null,
): Promise<ArrivalVerificationResult> {
  try {
    const response = await api.patch(`/bookings/${bookingId}/arrive`, { lat, lng, accuracy, mocked });
    return response;
  } catch (error) {
    console.error('Arrive booking error:', error);
    throw error;
  }
}

// Fire-and-forget-ish: called every few seconds by the worker's foreground
// GPS watch while en route. Callers should swallow failures (a dropped ping
// isn't worth surfacing an error to the worker) rather than retry-storm.
export async function updateWorkerLiveLocation(bookingId: string, lat: number, lng: number, accuracy?: number | null) {
  const response = await api.patch(`/bookings/${bookingId}/live-location`, { lat, lng, accuracy });
  return response;
}

export type QuoteItemPayload = {
  name: string;
  price: number;
  receiptUrls: string[];
  proofOfUseUrls: string[];
};

// Each item needs its own receipt photos and photos of it in use (uploadJobPhoto).
// The items replace any earlier set, so editing or deleting one is a resubmit.
// laborCost only for a custom-quote job.
export async function submitQuote(
  bookingId: string,
  data: {
    items: QuoteItemPayload[];
    laborCost?: number;
    notes?: string;
  },
) {
  try {
    const response = await api.post(`/bookings/${bookingId}/quote`, data);
    return response;
  } catch (error) {
    console.error('Submit quote error:', error);
    throw error;
  }
}

// Takes a submitted/approved quote back to IN_PROGRESS so its items can be
// edited; the client approves the new total after the worker resubmits.
export async function reopenQuote(bookingId: string) {
  try {
    const response = await api.post(`/bookings/${bookingId}/quote/reopen`);
    return response;
  } catch (error) {
    console.error('Reopen quote error:', error);
    throw error;
  }
}

// Client approves or rejects a legacy pending addon.
export async function respondToBookingAddOn(bookingId: string, addonId: string, approve: boolean) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/addons/${addonId}/respond`, { approve });
    return response;
  } catch (error) {
    console.error('Respond to booking addon error:', error);
    throw error;
  }
}

export async function uploadBookingCompletionPhoto(
  bookingId: string,
  uri: string,
  mimeType?: string | null,
): Promise<{ url: string }> {
  try {
    const filename = uri.split('/').pop() ?? `completion-${Date.now()}.jpg`;
    const resolvedMimeType = mimeType || 'image/jpeg';

    const formData = new FormData();
    formData.append('photo', {
      uri,
      name: filename,
      type: resolvedMimeType,
    } as any);

    const response = await api.post(`/bookings/${bookingId}/completion-photo/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response;
  } catch (error) {
    console.error('Upload completion photo error:', error);
    throw error;
  }
}

// The worker's other job photos — quote receipts, materials in use, proof for
// a cancellation after arriving. Same storage as the completion photo.
export async function uploadJobPhoto(bookingId: string, uri: string, mimeType?: string | null): Promise<{ url: string }> {
  const filename = uri.split('/').pop() ?? `job-${Date.now()}.jpg`;
  const formData = new FormData();
  formData.append('photo', { uri, name: filename, type: mimeType || 'image/jpeg' } as any);
  return api.post(`/bookings/${bookingId}/job-photo/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function uploadIssuePhoto(uri: string, mimeType?: string | null): Promise<{ url: string }> {
  try {
    const filename = uri.split('/').pop() ?? `issue-${Date.now()}.jpg`;
    const resolvedMimeType = mimeType || 'image/jpeg';

    const formData = new FormData();
    formData.append('photo', {
      uri,
      name: filename,
      type: resolvedMimeType,
    } as any);

    const response = await api.post('/bookings/issue-photo/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response;
  } catch (error) {
    console.error('Upload issue photo error:', error);
    throw error;
  }
}

export async function uploadReviewPhoto(
  bookingId: string,
  uri: string,
  mimeType?: string | null,
): Promise<{ url: string }> {
  try {
    const filename = uri.split('/').pop() ?? `review-${Date.now()}.jpg`;
    const resolvedMimeType = mimeType || 'image/jpeg';

    const formData = new FormData();
    formData.append('photo', {
      uri,
      name: filename,
      type: resolvedMimeType,
    } as any);

    const response = await api.post(`/bookings/${bookingId}/review-photo/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response;
  } catch (error) {
    console.error('Upload review photo error:', error);
    throw error;
  }
}

export async function completeBooking(bookingId: string, completionPhotoUrl: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/complete`, { completionPhotoUrl });
    return response;
  } catch (error) {
    console.error('Complete booking error:', error);
    throw error;
  }
}

export type ConfirmCompletionResult =
  | { status: 'COMPLETED'; finalPrice?: number; completedAt?: string; payment?: unknown }
  | { status: 'AWAITING_PAYMENT'; checkoutUrl: string; invoiceId: string; amount: number };

// CASH -> resolves { status: 'COMPLETED' }.
// GCASH/MAYA -> resolves { status: 'AWAITING_PAYMENT', checkoutUrl, ... }; open
// the checkout URL and poll the transaction detail for the final outcome.
export async function confirmBookingCompletion(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/confirm-completion`);
    return response as ConfirmCompletionResult;
  } catch (error) {
    console.error('Confirm booking completion error:', error);
    throw error;
  }
}

export async function updateAvailability(isAvailable?: boolean, availableDays?: string[]) {
  try {
    const response = await api.patch('/workers/me/availability', {
      isAvailable,
      availableDays,
    });
    return response;
  } catch (error) {
    console.error('Update availability error:', error);
    throw error;
  }
}

export interface CalendarJob {
  bookingId: string;
  time: string;
  service: string;
  kind: 'JOB' | 'VISIT';
  status: string;
}

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  available: boolean;
  // true when the worker changed this date from their weekly schedule
  overridden: boolean;
  jobCount: number;
  jobs: CalendarJob[];
}

export interface WorkerCalendar {
  availableDays: number[]; // 0=Sun ... 6=Sat
  isAvailable: boolean;
  today: string;
  days: CalendarDay[];
}

/** GET /workers/me/calendar — availability plus accepted jobs/visits per day (inclusive range). */
export async function getMyCalendar(from: string, to: string): Promise<WorkerCalendar> {
  return api.get('/workers/me/calendar', { params: { from, to } });
}

/** PUT /workers/me/weekly-schedule — the weekdays the worker normally works. */
export async function updateWeeklySchedule(availableDays: number[]): Promise<{ availableDays: number[] }> {
  return api.put('/workers/me/weekly-schedule', { availableDays });
}

/**
 * PUT /workers/me/date-overrides — open (true) or close (false) specific
 * dates; null puts them back on the weekly schedule. Rejected (409) when a
 * date being closed has an accepted job.
 */
export async function updateDateOverrides(dates: string[], isAvailable: boolean | null): Promise<void> {
  await api.put('/workers/me/date-overrides', { dates, isAvailable });
}

export interface MyWorkerProfileDetails {
  bio: string | null;
  serviceAreaRadius: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  addressLat: number | null;
  addressLng: number | null;
  resumeUrl: string | null;
  digitalIdTrade: string | null;
  digitalIdServiceArea: string | null;
  licenseNumber: string | null;
  birthDate: string | null;
  // Years in the trade (incl. outside HomeEase) — set during KYC, confirmed
  // by the admin, then locked. One of the expertise-tier requirements.
  yearsExperience: number | null;
  availableDays: number[];
  kycStatus: string;
  kycSubmittedAt: string | null;
  kycApprovedAt: string | null;
}

// Self-service read, distinct from getWorkerDetail(workerId) (the public
// profile view) — this is the only place addressLat/addressLng (precise
// home/service coordinates) are exposed, since that endpoint is public.
export async function getMyWorkerProfileDetails(): Promise<MyWorkerProfileDetails> {
  try {
    const response = await api.get('/workers/me/profile');
    return response;
  } catch (error) {
    console.error('Get my worker profile error:', error);
    throw error;
  }
}

export async function updateWorkerProfileDetails(data: {
  // YYYY-MM-DD; the backend checks the accepted age range. Locked after KYC approval.
  birthDate?: string;
  // Locked after KYC approval, like birthDate.
  yearsExperience?: number;
  bio?: string;
  serviceAreaRadius?: number;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  // null (not just omitted) is a valid, meaningful value here — it tells the
  // backend to clear a now-stale addressLat/Lng (e.g. the address text
  // changed but re-geocoding it failed), as opposed to omitting the field
  // entirely to leave whatever's already stored untouched.
  addressLat?: number | null;
  addressLng?: number | null;
  resumeUrl?: string;
  digitalIdTrade?: string;
  digitalIdServiceArea?: string;
  licenseNumber?: string;
}) {
  try {
    const response = await api.patch('/workers/me/profile', data);
    return response;
  } catch (error) {
    console.error('Update worker profile error:', error);
    throw error;
  }
}

/**
 * Which specific ServiceScopeFieldOption ids this worker has declared they
 * handle (e.g. "Air Conditioner" under a category's "Appliance Type"
 * field) — replaces the old free-text Skill list. Nothing here is typed by
 * the worker; every id traces back to a real admin-defined option, fetched
 * from getServiceTypes()'s scopeFields for the categories this worker
 * offers. Used by discovery (see matchingService.buildCapabilityFilters) to
 * only show/match workers who've declared the option the client asked for.
 */
export async function getMyCapabilities(): Promise<string[]> {
  try {
    const response = await api.get('/workers/me/capabilities');
    return response.optionIds ?? [];
  } catch (error) {
    console.error('Get capabilities error:', error);
    throw error;
  }
}

/** Replace-all — pass every option id this worker currently declares. */
export async function replaceMyCapabilities(optionIds: string[]): Promise<string[]> {
  try {
    const response = await api.put('/workers/me/capabilities', { optionIds });
    return response.optionIds ?? [];
  } catch (error) {
    console.error('Update capabilities error:', error);
    throw error;
  }
}

export type WorkerServiceType = {
  id: string;
  name: string;
  description?: string | null;
  basePrice: number;
  icon?: string | null;
  requiresCertification?: boolean;
};

export type WorkerServiceCategoryStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED';

export type WorkerServiceCategory = {
  id: string;
  serviceTypeId: string;
  serviceType: WorkerServiceType;
  status: WorkerServiceCategoryStatus;
  gatingCertificationId: string | null;
  verifiedAt: string | null;
  rejectedAt: string | null;
};

/** Every category the worker has any connection to — including ones still PENDING_VERIFICATION or REJECTED. */
export async function getMyServiceTypes(): Promise<WorkerServiceCategory[]> {
  try {
    const response = await api.get('/workers/me/service-types');
    return response.serviceCategories ?? [];
  } catch (error) {
    console.error('Get my service categories error:', error);
    throw error;
  }
}

export type CertificationGateInput = {
  title: string;
  issuer: string;
  issueDate: string;
  expiryDate?: string;
  documentUrl: string;
};

/**
 * Request a service. The documents are what the admin reviews; the request
 * usually comes back PENDING_VERIFICATION (a worker's very first service is
 * approved straight away unless it requires a certification).
 */
export async function addServiceCategory(
  serviceTypeId: string,
  gate?: { certificationId?: string; certifications?: CertificationGateInput[] }
): Promise<WorkerServiceCategory> {
  try {
    const response = await api.post('/workers/me/service-types', { serviceTypeId, ...gate });
    return response.serviceCategory;
  } catch (error) {
    console.error('Add service category error:', error);
    throw error;
  }
}

export async function removeServiceType(serviceTypeId: string) {
  try {
    await api.delete(`/workers/me/service-types/${serviceTypeId}`);
    return true;
  } catch (error) {
    console.error('Remove service type error:', error);
    throw error;
  }
}

export type WorkerTaskSelection = { id: string; serviceTaskId: string; isActive: boolean };

export type TaskCatalogEntry = {
  serviceType: WorkerServiceType;
  categoryStatus: WorkerServiceCategoryStatus | null;
  gatingCertificationId: string | null;
  rejectionReason: string | null;
  requestedAt: string | null;
  tasks: Array<{
    task: {
      id: string;
      name: string;
      description?: string | null;
      pricingModel: TaskPricingModel;
      // The admin's price (read-only for workers); null for custom-quote jobs.
      price: number | null;
      unitLabel: string | null;
    };
    mySelection: WorkerTaskSelection | null;
  }>;
};

/**
 * One consolidated read for the "Skills & Services" screen: every service
 * with the worker's registration status and ticked tasks.
 */
export async function getMyTaskCatalog(): Promise<TaskCatalogEntry[]> {
  try {
    const response = await api.get('/workers/me/task-catalog');
    return response.categories ?? [];
  } catch (error) {
    console.error('Get task catalog error:', error);
    throw error;
  }
}

/** "I do this task" — only under a service the worker is approved for. */
export async function selectTask(
  serviceTaskId: string
): Promise<{ taskSelection: WorkerTaskSelection; category: WorkerServiceCategory }> {
  try {
    const response = await api.put(`/workers/me/task-selections/${serviceTaskId}`, {});
    return response;
  } catch (error) {
    console.error('Select task error:', error);
    throw error;
  }
}

export async function deselectTask(serviceTaskId: string) {
  try {
    await api.delete(`/workers/me/task-selections/${serviceTaskId}`);
    return true;
  } catch (error) {
    console.error('Deselect task error:', error);
    throw error;
  }
}

export type PackageReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type WorkerPackage = {
  id: string;
  serviceTypeId: string;
  serviceType?: { id: string; name: string };
  name: string;
  description?: string | null;
  price: number;
  isActive: boolean;
  // Clients only see APPROVED packages. Editing one sends it back to PENDING.
  status: PackageReviewStatus;
  rejectionReason?: string | null;
};

export type WorkerSetupItemKey = 'PROFILE_PHOTO' | 'PAYOUT_METHOD' | 'ADDRESS' | 'AVAILABILITY' | 'SERVICES';

export type WorkerSetupStatus = {
  complete: boolean;
  items: { key: WorkerSetupItemKey; label: string; done: boolean }[];
  missing: WorkerSetupItemKey[];
};

/** Until complete, the worker is hidden from clients and can't accept requests. */
export async function getMySetupStatus(): Promise<WorkerSetupStatus> {
  try {
    const response = await api.get('/workers/me/setup-status');
    return response;
  } catch (error) {
    console.error('Get setup status error:', error);
    throw error;
  }
}

export async function getMyPackages(): Promise<WorkerPackage[]> {
  try {
    const response = await api.get('/workers/me/packages');
    return response.packages ?? [];
  } catch (error) {
    console.error('Get packages error:', error);
    throw error;
  }
}

export async function createPackage(data: {
  serviceTypeId: string;
  name: string;
  description?: string;
  price: number;
}): Promise<WorkerPackage> {
  try {
    const response = await api.post('/workers/me/packages', data);
    return response;
  } catch (error) {
    console.error('Create package error:', error);
    throw error;
  }
}

export async function updatePackage(
  packageId: string,
  data: Partial<{ serviceTypeId: string; name: string; description: string; price: number; isActive: boolean }>,
): Promise<WorkerPackage> {
  try {
    const response = await api.patch(`/workers/me/packages/${packageId}`, data);
    return response;
  } catch (error) {
    console.error('Update package error:', error);
    throw error;
  }
}

export async function deletePackage(packageId: string) {
  try {
    await api.delete(`/workers/me/packages/${packageId}`);
    return true;
  } catch (error) {
    console.error('Delete package error:', error);
    throw error;
  }
}

/** Public — a client viewing/booking a worker fetches that worker's active, admin-approved packages, optionally scoped to a service type. */
export async function getWorkerPackages(workerId: string, serviceTypeId?: string): Promise<WorkerPackage[]> {
  try {
    const query = serviceTypeId ? `?serviceTypeId=${encodeURIComponent(serviceTypeId)}` : '';
    const response = await api.get(`/workers/${workerId}/packages${query}`);
    return response.packages ?? [];
  } catch (error) {
    console.error('Get worker packages error:', error);
    throw error;
  }
}

export type TaskPricingModel = 'FIXED' | 'PER_UNIT' | 'TIERED' | 'CUSTOM_QUOTE';

export type VatSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  // Manila dates with the real last day ("Jul 1, 2026 to Sep 30, 2026").
  periodLabel?: string;
  totalVatCollected: number;
};

// Informational only — for the worker's own 2550Q/2551Q filing, never
// remitted by the platform (see VatCollectionSummary's backend comment).
export async function getMyVatSummary(): Promise<VatSummary[]> {
  try {
    const response = await api.get('/workers/me/vat-summary');
    return Array.isArray(response) ? response : [];
  } catch (error) {
    console.error('Get VAT summary error:', error);
    throw error;
  }
}

export type Certification = {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string | null;
  documentUrl: string;
  status: string;
  rejectionReason: string | null;
  serviceTypeId: string | null;
  visibleToClients: boolean;
};

export async function getMyCertifications(): Promise<Certification[]> {
  try {
    const response = await api.get('/workers/me/certifications');
    return response.certifications ?? [];
  } catch (error) {
    console.error('Get certifications error:', error);
    throw error;
  }
}

export async function getCertificationDetail(certId: string): Promise<Certification> {
  try {
    const response = await api.get(`/workers/me/certifications/${certId}`);
    return response.certification;
  } catch (error) {
    console.error('Get certification error:', error);
    throw error;
  }
}

export async function uploadCertificationFile(
  uri: string,
  mimeType?: string | null,
): Promise<{ url: string }> {
  return uploadKycFile('certification', uri, mimeType);
}

export async function addCertification(data: {
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate?: string | null;
  documentUrl: string;
  serviceTypeId?: string | null;
  visibleToClients?: boolean;
}): Promise<Certification> {
  try {
    const response = await api.post('/workers/me/certifications', data);
    return response.certification;
  } catch (error) {
    console.error('Add certification error:', error);
    throw error;
  }
}

export async function updateCertification(
  certId: string,
  data: {
    name: string;
    issuer: string;
    issueDate: string;
    expiryDate?: string | null;
    documentUrl?: string;
    serviceTypeId?: string | null;
    visibleToClients?: boolean;
  },
): Promise<Certification> {
  try {
    const response = await api.patch(`/workers/me/certifications/${certId}`, data);
    return response.certification;
  } catch (error) {
    console.error('Update certification error:', error);
    throw error;
  }
}

// Dedicated toggle, kept separate from updateCertification — flipping this
// is a display preference, not an edit to the underlying claim, so it must
// NOT reset the certification's verificationStatus back to PENDING the way
// a full edit does.
export async function updateCertificationVisibility(
  certId: string,
  visibleToClients: boolean,
): Promise<Certification> {
  try {
    const response = await api.patch(`/workers/me/certifications/${certId}/visibility`, { visibleToClients });
    return response.certification;
  } catch (error) {
    console.error('Update certification visibility error:', error);
    throw error;
  }
}

export async function deleteCertification(certId: string) {
  try {
    await api.delete(`/workers/me/certifications/${certId}`);
    return true;
  } catch (error) {
    console.error('Delete certification error:', error);
    throw error;
  }
}

export type PayoutMethod = {
  payoutMethod: 'GCASH' | 'MAYA' | null;
  payoutAccountName: string | null;
  payoutAccountNumber: string | null;
};

export async function getPayoutMethod(): Promise<PayoutMethod> {
  try {
    const response = await api.get('/workers/me/payout');
    return response;
  } catch (error) {
    console.error('Get payout method error:', error);
    throw error;
  }
}

export async function updatePayoutMethod(data: {
  payoutMethod: 'GCASH' | 'MAYA';
  payoutAccountName?: string;
  payoutAccountNumber?: string;
  password: string;
}): Promise<PayoutMethod> {
  try {
    const response = await api.patch('/workers/me/payout', data);
    return response;
  } catch (error) {
    console.error('Update payout method error:', error);
    throw error;
  }
}

export type TaxInfo = {
  tinOnFile: boolean;
  maskedTin: string | null;
  tinVerifiedAt: string | null;
};

export async function getTaxInfo(): Promise<TaxInfo> {
  try {
    const response = await api.get('/workers/me/tax-info');
    return response;
  } catch (error) {
    console.error('Get tax info error:', error);
    throw error;
  }
}

export async function updateTaxInfo(tin: string): Promise<TaxInfo> {
  try {
    const response = await api.patch('/workers/me/tax-info', { tin });
    return response;
  } catch (error) {
    console.error('Update tax info error:', error);
    throw error;
  }
}

export type VatVerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type VatRegistration = {
  vatRegistered: boolean;
  vatDocumentUrl: string | null;
  vatVerificationStatus: VatVerificationStatus | null;
  vatRejectionReason: string | null;
  vatSubmittedAt: string | null;
  vatReviewedAt: string | null;
};

export async function getMyVatRegistration(): Promise<VatRegistration> {
  try {
    const response = await api.get('/workers/me/vat-registration');
    return response;
  } catch (error) {
    console.error('Get VAT registration error:', error);
    throw error;
  }
}

export async function submitVatRegistration(documentUrl: string): Promise<VatRegistration> {
  try {
    const response = await api.post('/workers/me/vat-registration', { documentUrl });
    return response;
  } catch (error) {
    console.error('Submit VAT registration error:', error);
    throw error;
  }
}

// Not part of the onboarding KYC-document flow (submitted any time, not
// during onboarding) — posts straight to the same upload endpoint/bucket
// with a hardcoded documentType, bypassing the KycDocumentKey mapping layer
// that flow uses, since VAT_REGISTRATION deliberately isn't a member of it.
export async function uploadVatDocument(uri: string, mimeType?: string | null): Promise<{ url: string }> {
  try {
    const filename = uri.split('/').pop() ?? `vat-registration-${Date.now()}`;
    const resolvedMimeType =
      mimeType || (filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

    const formData = new FormData();
    formData.append('file', { uri, name: filename, type: resolvedMimeType } as any);
    formData.append('documentType', 'VAT_REGISTRATION');

    const response = await api.post('/users/me/kyc-documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response;
  } catch (error) {
    console.error('Upload VAT document error:', error);
    throw error;
  }
}

export type TaxCertificate = {
  id: string;
  periodStart: string;
  periodEnd: string;
  periodLabel?: string;
  monthlyBreakdown?: Array<{ month: string; incomePayments: number; taxWithheld: number }> | null;
  totalIncomePayments: number;
  totalTaxWithheld: number;
  issuedAt: string;
  downloadUrl: string | null;
};

export async function getMyTaxCertificates(): Promise<TaxCertificate[]> {
  try {
    const response = await api.get('/workers/me/tax-certificates');
    return response ?? [];
  } catch (error) {
    console.error('Get tax certificates error:', error);
    throw error;
  }
}

// ============================================================================
// PROFILE ENDPOINTS
// ============================================================================

export async function updateUserProfile(data: {
  fullName?: string;
  phone?: string;
  avatar?: string;
  bio?: string;
  yearsOfExperience?: number;
  serviceArea?: string;
}) {
  try {
    const payload: any = {};
    if (data.fullName) payload.fullName = data.fullName;
    if (data.phone) payload.phone = data.phone;
    if (data.avatar) payload.avatar = data.avatar;
    if (data.bio) payload.bio = data.bio;
    if (data.yearsOfExperience) payload.yearsOfExperience = data.yearsOfExperience;
    if (data.serviceArea) payload.serviceArea = data.serviceArea;

    const response = await api.patch('/users/me', payload);
    return {
      id: response.id,
      name: response.fullName || response.name,
      fullName: response.fullName,
      email: response.email,
      phone: response.phone,
      avatar: response.avatar,
      role: response.role?.toLowerCase() || 'client',
      bio: response.bio,
      yearsOfExperience: response.yearsOfExperience,
      serviceArea: response.serviceArea,
    };
  } catch (error) {
    console.error('Update user profile error:', error);
    throw error;
  }
}

export async function uploadAvatar(uri: string): Promise<{ url: string }> {
  try {
    const filename = uri.split('/').pop() ?? `avatar-${Date.now()}.jpg`;
    const match = /\.(\w+)$/.exec(filename);
    const ext = match ? match[1].toLowerCase() : 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    const formData = new FormData();
    formData.append('avatar', {
      uri,
      name: filename,
      type: mimeType,
    } as any);

    const response = await api.post('/users/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response;
  } catch (error) {
    console.error('Upload avatar error:', error);
    throw error;
  }
}

export async function uploadKycFile(
  documentKey: KycDocumentKey,
  uri: string,
  mimeType?: string | null,
): Promise<{ url: string }> {
  try {
    const filename = uri.split('/').pop() ?? `${documentKey}-${Date.now()}`;
    const resolvedMimeType =
      mimeType || (filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

    const formData = new FormData();
    formData.append('file', {
      uri,
      name: filename,
      type: resolvedMimeType,
    } as any);
    formData.append('documentType', mapKycDocumentType(documentKey));

    const response = await api.post('/users/me/kyc-documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response;
  } catch (error) {
    console.error('Upload KYC file error:', error);
    throw error;
  }
}

export async function submitKycDocument(documentKey: KycDocumentKey, documentUrl: string) {
  try {
    const response = await api.post('/users/me/kyc-documents', {
      documentType: mapKycDocumentType(documentKey),
      documentUrl,
    });
    return response;
  } catch (error) {
    console.error('Submit KYC document error:', error);
    throw error;
  }
}

export type KycDocumentRecord = {
  id: string;
  documentType: string;
  originalName: string | null;
  fileUrl: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export async function getKycDocuments(): Promise<KycDocumentRecord[]> {
  try {
    const response = await api.get('/users/me/kyc-documents');
    return Array.isArray(response) ? response : [];
  } catch (error) {
    console.error('Get KYC documents error:', error);
    throw error;
  }
}

export async function acceptContract(contractType: LegalDocumentType) {
  try {
    // The server records its own timestamp, IP and device; the app only
    // says which document and which version was shown.
    const response = await api.post('/users/me/contract-acceptance', {
      contractType,
      contractVersion: LEGAL_VERSIONS[contractType],
    });
    return response;
  } catch (error) {
    console.error('Accept contract error:', error);
    throw error;
  }
}

// Unauthenticated: a suspended/banned user can't log in, so they prove it's
// their account with email + password instead (see authController).
export async function requestSuspensionReview(email: string, password: string, message: string) {
  return api.post('/auth/suspension-review', { email, password, message });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  try {
    const response = await api.post('/users/me/change-password', {
      currentPassword,
      newPassword,
    });
    return {
      success: true,
      message: response.message || "Password changed successfully",
    };
  } catch (error) {
    console.error('Change password error:', error);
    throw error;
  }
}

/** How many devices are signed in — "Log out other devices" only shows when there's more than one. */
export async function getActiveSessionCount(): Promise<number> {
  const response = await api.get('/users/me/sessions');
  return response.activeSessions ?? 1;
}

// Signs out every OTHER device (this one stays signed in). signedOutCurrent
// is true only for a session from before per-device sessions existed, in
// which case this device was signed out too.
export async function logoutAllSessions(): Promise<{ success: true; message: string; signedOutCurrent: boolean }> {
  try {
    const response = await api.post('/users/me/logout-all', {});
    return {
      success: true,
      message: response.message || "Logged out of your other devices",
      signedOutCurrent: Boolean(response.signedOutCurrent),
    };
  } catch (error) {
    console.error('Logout all sessions error:', error);
    throw error;
  }
}

// Worker only — takes them off HomeEase without deleting anything; signing
// in again offers to reactivate.
export async function deactivateAccount(password: string, reason?: string): Promise<{ message?: string }> {
  return api.post('/users/me/deactivate', { password, reason });
}

export async function getUserProfile() {
  try {
    const response = await api.get('/users/me');
    return {
      id: response.id,
      name: response.fullName || response.name,
      fullName: response.fullName,
      email: response.email,
      phone: response.phone,
      role: response.role?.toLowerCase() || 'client',
      kycStatus: response.kycStatus,
      kycRejectionReason: response.kycRejectionReason,
      hasAcceptedTerms: response.hasAcceptedTerms,
      declineCooldownUntil: response.declineCooldownUntil,
      // Set (non-null) only for a worker whose account is on hold for
      // outstanding platform dues — see debtLedgerService.ts on the backend.
      accountHold: response.accountHold as { since: string; amountOwed: number } | null | undefined,
      bio: response.bio,
      yearsOfExperience: response.yearsOfExperience,
      serviceArea: response.serviceArea,
      notificationPreferences: response.notificationPreferences || null,
    };
  } catch (error) {
    console.error('Get user profile error:', error);
    throw error;
  }
}

export async function updateNotificationPreferences(preferences: {
  bookingUpdates?: boolean;
  messages?: boolean;
  promotions?: boolean;
  systemNotifications?: boolean;
}) {
  try {
    const response = await api.patch('/users/me/notification-preferences', preferences);
    return {
      success: true,
      preferences: response,
      message: "Notification preferences updated",
    };
  } catch (error) {
    console.error('Update notification preferences error:', error);
    throw error;
  }
}

// Step 2 of deleting the account: rejected (409, with `blockers`) while
// something still ties the account down; otherwise emails a code.
export async function requestAccountDeletionCode(): Promise<void> {
  await api.post('/users/me/delete-code', {});
}

// Final step: password, the emailed code and the typed confirmation phrase.
export async function deleteAccount(data: { password: string; code: string; confirmText: string; reason?: string }) {
  try {
    const response = await api.delete('/users/me', { data });
    return {
      success: true,
      message: response.message || "Account deleted successfully",
    };
  } catch (error) {
    console.error('Delete account error:', error);
    throw error;
  }
}

// ============================================================================
// UTILITY FUNCTION
// ============================================================================

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Service catalog is admin-managed (name/price/icon/etc. can change at any
// time from the web admin), but was being independently re-fetched with its
// own loading spinner in 5 different screens/components. Cache it in memory
// for a short TTL rather than the whole app session — long enough to still
// dedupe the repeat fetches those screens were doing, short enough that an
// admin edit (e.g. changing a category's icon) shows up on next navigation
// instead of only after a full app restart. `servicesPromise` also dedupes
// concurrent calls if two screens mount at once on first load, so they share
// one in-flight request instead of firing two.
const SERVICE_TYPES_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedServiceTypes: any[] | null = null;
let cachedServiceTypesAt = 0;
let servicesPromise: Promise<any[]> | null = null;

export async function getServiceTypes() {
  if (cachedServiceTypes && Date.now() - cachedServiceTypesAt < SERVICE_TYPES_TTL_MS) {
    return cachedServiceTypes;
  }
  if (servicesPromise) return servicesPromise;

  servicesPromise = (async () => {
    try {
      const response = await api.get('/services');
      cachedServiceTypes = Array.isArray(response) ? response : [];
      cachedServiceTypesAt = Date.now();
      return cachedServiceTypes;
    } catch (error) {
      console.error('Get service types error:', error);
      throw error;
    } finally {
      servicesPromise = null;
    }
  })();

  return servicesPromise;
}
export type PromoBannerItem = {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  /** Service category to open when tapped, or null for display-only. */
  linkServiceTypeId: string | null;
};

/** Live home-screen banners, managed by admins (Catalog & Pricing → Promo Banners). */
export async function getPromoBanners(): Promise<PromoBannerItem[]> {
  const response = await api.get('/promo-banners');
  return Array.isArray(response) ? (response as PromoBannerItem[]) : [];
}
