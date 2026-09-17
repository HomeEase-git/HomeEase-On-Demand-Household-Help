import axios, { AxiosRequestConfig, isAxiosError } from 'axios';
import { router } from 'expo-router';
import { config } from '../constants/config';
import { authStorage } from '../utils/storage';
import { AbortableRequest } from '../utils/apiErrorHandling';
import { KycDocumentKey } from '../utils/kycDocumentConfig';
import { mapKycDocumentType } from '../utils/kycDocumentTypeMap';
import type { WorkerDetail, WorkerDigitalId, ParsedResume } from "../types/api.types";
import type {
  CreateBookingPayload,
  CreateBookingResponse,
  WorkerCard,
  TimeSlot,
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

  // Global response error handler: handle 401/403 by clearing local auth
  client.interceptors.response.use(
    undefined,
    async (error) => {

      console.log('[API ←] ERROR message:', error.message);
      console.log('[API ←] ERROR code:', error.code);
      console.log('[API ←] ERROR url:', (error.config?.baseURL || '') + (error.config?.url || ''));
      console.log('[API ←] has response:', !!error.response);
      console.log('[API ←] has request:', !!error.request);
      console.log('[API ←] ERROR response data:', JSON.stringify(error.response?.data));

      try {
        if (isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 || status === 403) {
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
              console.error('Error clearing auth on 401/403:', e);
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
}) {
  try {
    const response = await api.post('/auth/signup', {
      fullName: userData.fullName,
      email: userData.email,
      phone: userData.phone,
      password: userData.password,
      role: userData.role.toUpperCase(),
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
    };
  } catch (error) {
    console.error('Signup error:', error);
    throw error;
  }
}

export async function postLogin(email: string, password: string) {
  try {
    const response = await api.post('/auth/login', {
      email,
      password,
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
    };
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
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
      timeSlot: details.timeSlot,
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
// worker (one of 'WORKER_FAULT' | 'CLIENT_NO_SHOW' | 'OTHER') — omit it
// entirely for a client's own cancellation.
export async function cancelBooking(bookingId: string, reason?: string, workerCancellationReason?: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/cancel`, { reason, workerCancellationReason });
    return response;
  } catch (error) {
    console.error('Cancel booking error:', error);
    throw error;
  }
}

export async function approveQuote(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/quote/approve`);
    return response;
  } catch (error) {
    console.error('Approve quote error:', error);
    throw error;
  }
}

export async function disputeQuote(bookingId: string, reason: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/quote/dispute`, { reason });
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
  timeSlot?: TimeSlot;
  // Answers to the selected category's scope fields, keyed by field label —
  // only fields the admin flagged "use to match workers" actually filter
  // candidates server-side (see matchingService.buildCapabilityFilters).
  scopeAnswers?: Record<string, string | string[]>;
  hasPets?: boolean;
  serviceTaskId?: string;
  lat?: number;
  lng?: number;
  // Scopes results to a single worker — used to check a specific (e.g.
  // profile-locked) worker's real open slots rather than discovering a list.
  workerId?: string;
  page?: number;
  limit?: number;
}

export interface DiscoverWorkersResult {
  workers: WorkerCard[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * GET /workers with the Phase 2 discovery contract (scope + time filters,
 * server-side KYC/capacity/slot filtering, sorted rating desc). Used by
 * Step 2 (live pro-count per time slot) and Step 3 (full worker card list)
 * — unlike the legacy `getWorkers`/`searchWorkers` above, filtering/
 * sorting/pagination all happen server-side here.
 */
export async function discoverWorkers(filters: DiscoverWorkersFilters): Promise<DiscoverWorkersResult> {
  try {
    const params: Record<string, string | number> = {};
    if (filters.serviceType) params.serviceType = filters.serviceType;
    if (filters.date) params.date = filters.date;
    if (filters.timeSlot) params.timeSlot = filters.timeSlot;
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

// Backend-proxied Google Geocoding — the API key never ships to the mobile
// bundle. Resolves to `null` (never throws) whenever Google isn't configured
// server-side, the address genuinely doesn't resolve, or the request fails —
// callers (utils/geo.ts) treat all three the same way: fall back to Nominatim.
export async function geocodeAddressGoogle(address: string): Promise<GoogleGeocodeResult | null> {
  try {
    return await api.post('/geo/geocode', { address });
  } catch (error) {
    console.error('Google geocode proxy error:', error);
    return null;
  }
}

export async function reverseGeocodeGoogle(lat: number, lng: number): Promise<GoogleGeocodeResult | null> {
  try {
    return await api.post('/geo/reverse-geocode', { lat, lng });
  } catch (error) {
    console.error('Google reverse geocode proxy error:', error);
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
  street: string;
  city: string;
  state: string;
  zipCode: string;
  houseNumber?: string;
  barangay?: string;
  landmark?: string;
  lat?: number;
  lng?: number;
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

export async function acceptBooking(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/accept`);
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

export interface ExtendBookingResult {
  targetDate: string;
  resolved: number;
  escalated: number;
}

/**
 * PATCH /bookings/:id/extend — worker signals this job is running into a
 * second day. See backend extendBooking's docblock for the full
 * reschedule-on-conflict behavior this triggers on any other booking of
 * theirs that collides with tomorrow.
 */
export async function extendBooking(bookingId: string): Promise<ExtendBookingResult> {
  try {
    const response = await api.patch(`/bookings/${bookingId}/extend`);
    return response;
  } catch (error) {
    console.error('Extend booking error:', error);
    throw error;
  }
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
 * PATCH /bookings/:id/request-reschedule — client proposes a new date/time
 * for an ACCEPTED booking; the assigned worker must accept or decline it.
 * Distinct from extendBooking above (worker/system-triggered, moves a
 * DIFFERENT booking) — this is the client of THIS booking asking for a
 * different date for it.
 */
export async function requestReschedule(bookingId: string, date: string, timeSlot: TimeSlot) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/request-reschedule`, { date, timeSlot });
    return response;
  } catch (error) {
    console.error('Request reschedule error:', error);
    throw error;
  }
}

/** PATCH /bookings/:id/reschedule-request/withdraw — client backs out of their own pending request. */
export async function withdrawRescheduleRequest(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/reschedule-request/withdraw`);
    return response;
  } catch (error) {
    console.error('Withdraw reschedule request error:', error);
    throw error;
  }
}

/** PATCH /bookings/:id/reschedule-request/respond — worker accepts or declines the client's proposed date. */
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
export async function arriveBooking(bookingId: string, lat: number, lng: number): Promise<ArrivalVerificationResult> {
  try {
    const response = await api.patch(`/bookings/${bookingId}/arrive`, { lat, lng });
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

export async function submitQuote(
  bookingId: string,
  data: { materialsCost: number; notes?: string },
) {
  try {
    const response = await api.post(`/bookings/${bookingId}/quote`, data);
    return response;
  } catch (error) {
    console.error('Submit quote error:', error);
    throw error;
  }
}

// Mid-job scope-creep item — worker only, and only while the job is active
// (IN_PROGRESS/QUOTE_SUBMITTED/QUOTE_APPROVED, enforced server-side). Starts
// pending — the client must approve it (see respondToBookingAddOn) before it
// counts toward the price breakdown (see getBookingDetail); it auto-approves
// after 6h of no response, or auto-rejects if the job completes first.
export async function addBookingAddOn(bookingId: string, data: { name: string; price: number }) {
  try {
    const response = await api.post(`/bookings/${bookingId}/addons`, data);
    return response;
  } catch (error) {
    console.error('Add booking addon error:', error);
    throw error;
  }
}

// Client approves or rejects a pending addon (see addBookingAddOn).
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

export interface WorkerAvailabilitySlot {
  id: string;
  workerProfileId: string;
  date: string;
  timeSlot: TimeSlot;
  isBlocked: boolean;
  isBooked: boolean;
}

/**
 * GET /workers/me/availability-slots — the fine-grained per-date/per-slot
 * schedule (distinct from the coarse day-of-week toggle above). Optionally
 * scoped to a single date for a lighter fetch (see AvailabilityCalendar,
 * which fetches the whole visible 7-day window at once by omitting `date`).
 */
export interface WorkerAvailabilitySlotsResponse {
  slots: WorkerAvailabilitySlot[];
  maxSlotsPerDay: number;
}

export async function getMyAvailabilitySlots(date?: string): Promise<WorkerAvailabilitySlotsResponse> {
  try {
    const response = await api.get('/workers/me/availability-slots', { params: date ? { date } : undefined });
    return { slots: response.slots ?? [], maxSlotsPerDay: response.maxSlotsPerDay ?? 2 };
  } catch (error) {
    console.error('Get availability slots error:', error);
    throw error;
  }
}

/**
 * PATCH /workers/me/availability-slots — replaces the worker's open slots
 * for every date present in `slots`. The backend enforces max 2/day and
 * rejects (409) closing a slot that currently has an active booking
 * (isBooked === true); this wrapper just forwards the desired set.
 */
export async function updateAvailabilitySlots(
  slots: Array<{ date: string; timeSlot: TimeSlot }>,
  dates?: string[],
): Promise<WorkerAvailabilitySlot[]> {
  try {
    const response = await api.patch('/workers/me/availability-slots', { slots, dates });
    return response.slots ?? [];
  } catch (error) {
    console.error('Update availability slots error:', error);
    throw error;
  }
}

export interface AvailabilityTemplateDay {
  dayOfWeek: number; // 0=Sun ... 6=Sat
  timeSlot: TimeSlot;
}

/**
 * GET/PUT /workers/me/availability-template — a worker's recurring weekly
 * pattern (see B8), distinct from the concrete per-date slots above. Saving
 * it immediately opens matching slots ~30 days ahead and keeps rolling that
 * window forward daily, so a worker with a stable schedule doesn't have to
 * re-open the same days every week.
 */
export async function getMyAvailabilityTemplate(): Promise<AvailabilityTemplateDay[]> {
  try {
    const response = await api.get('/workers/me/availability-template');
    return response.template ?? [];
  } catch (error) {
    console.error('Get availability template error:', error);
    throw error;
  }
}

export async function updateMyAvailabilityTemplate(days: AvailabilityTemplateDay[]): Promise<void> {
  try {
    await api.put('/workers/me/availability-template', { days });
  } catch (error) {
    console.error('Update availability template error:', error);
    throw error;
  }
}

/**
 * POST /workers/me/availability/unavailable-range — bulk "mark unavailable"
 * for a vacation/leave stretch (see B8). All-or-nothing: rejects (409) if
 * any date/slot in range already has an active booking.
 */
export async function setUnavailableRange(startDate: string, endDate: string): Promise<{ blocked: number }> {
  try {
    const response = await api.post('/workers/me/availability/unavailable-range', { startDate, endDate });
    return { blocked: response.blocked ?? 0 };
  } catch (error) {
    console.error('Set unavailable range error:', error);
    throw error;
  }
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

export async function getWorkerCapacity() {
  try {
    const response = await api.get('/workers/me/capacity');
    return response;
  } catch (error) {
    console.error('Get worker capacity error:', error);
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

export type WorkerServiceType = { id: string; name: string; description?: string | null; basePrice: number };

export async function getMyServiceTypes(): Promise<WorkerServiceType[]> {
  try {
    const response = await api.get('/workers/me/service-types');
    return response.serviceTypes ?? [];
  } catch (error) {
    console.error('Get my service types error:', error);
    throw error;
  }
}

export async function addServiceTypes(serviceTypeIds: string[]): Promise<WorkerServiceType[]> {
  try {
    const response = await api.post('/workers/me/service-types', { serviceTypeIds });
    return response.serviceTypes ?? [];
  } catch (error) {
    console.error('Add service types error:', error);
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

export type WorkerPackage = {
  id: string;
  serviceTypeId: string;
  serviceType?: { id: string; name: string };
  name: string;
  description?: string | null;
  price: number;
  isActive: boolean;
};

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

/** Public — a client viewing/booking a worker fetches that worker's active packages, optionally scoped to a service type. */
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

export type TaskPricingModel = 'FIXED' | 'PER_UNIT' | 'CUSTOM_QUOTE';

export type WorkerTaskPrice = {
  id: string;
  workerProfileId: string;
  serviceTaskId: string;
  price: number | null;
  unitPrice: number | null;
  isActive: boolean;
};

export type MyTaskPriceEntry = {
  task: {
    id: string;
    name: string;
    serviceTypeName: string;
    pricingModel: TaskPricingModel;
    minPrice: number | null;
    maxPrice: number | null;
    unitLabel: string | null;
  };
  myPrice: WorkerTaskPrice | null;
};

export async function getMyTaskPrices(): Promise<MyTaskPriceEntry[]> {
  try {
    const response = await api.get('/workers/me/task-prices');
    return response.taskPrices ?? [];
  } catch (error) {
    console.error('Get task prices error:', error);
    throw error;
  }
}

export async function setMyTaskPrice(
  serviceTaskId: string,
  data: { price?: number; unitPrice?: number },
): Promise<WorkerTaskPrice> {
  try {
    const response = await api.put(`/workers/me/task-prices/${serviceTaskId}`, data);
    return response;
  } catch (error) {
    console.error('Set task price error:', error);
    throw error;
  }
}

export type VatSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
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

export async function deleteMyTaskPrice(serviceTaskId: string) {
  try {
    await api.delete(`/workers/me/task-prices/${serviceTaskId}`);
    return true;
  } catch (error) {
    console.error('Delete task price error:', error);
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

export async function acceptContract(
  contractType: 'WORKER_SERVICE_AGREEMENT' | 'CLIENT_USER_AGREEMENT',
) {
  try {
    const response = await api.post('/users/me/contract-acceptance', {
      contractType,
      acceptedAt: new Date().toISOString(),
    });
    return response;
  } catch (error) {
    console.error('Accept contract error:', error);
    throw error;
  }
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

export async function logoutAllSessions() {
  try {
    const response = await api.post('/users/me/logout-all', {});
    return {
      success: true,
      message: response.message || "Logged out of all devices",
    };
  } catch (error) {
    console.error('Logout all sessions error:', error);
    throw error;
  }
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

export async function deleteAccount(password: string) {
  try {
    const response = await api.delete('/users/me', { data: { password } });
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