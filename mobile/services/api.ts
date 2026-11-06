import axios, { AxiosRequestConfig, isAxiosError } from 'axios';
import { router } from 'expo-router';
import { config } from '../constants/config';
import { authStorage } from '../utils/storage';
import { AbortableRequest } from '../utils/apiErrorHandling';
import { KycDocumentKey } from '../utils/kycDocumentConfig';
import { mapKycDocumentType } from '../utils/kycDocumentTypeMap';
import type { Pagination } from '../utils/pagination';
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

interface ApiClient {
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
}

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
        const { useAuthStore } = await import('../store/authStore');
        if (useAuthStore.getState().isAuthenticated) {
          useAuthStore.setState({ token: next.token });
        }
        return next.token as string;
      } catch (error) {
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

  if (__DEV__) console.log('[API] baseURL configured as:', `${config.API_URL}/api`);

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

  client.interceptors.response.use(
    undefined,
    async (error) => {

      if (__DEV__) {
        console.log('[API ←] ERROR message:', error.message);
        console.log('[API ←] ERROR code:', error.code);
        console.log('[API ←] ERROR url:', (error.config?.baseURL || '') + (error.config?.url || ''));
        console.log('[API ←] has response:', !!error.response);
        console.log('[API ←] has request:', !!error.request);
        console.log('[API ←] ERROR response data:', JSON.stringify(error.response?.data));
      }

      let keepSession = false;
      const original = isAxiosError(error)
        ? (error.config as (typeof error.config & { _retried?: boolean; _refreshed?: boolean }) | undefined)
        : undefined;
      if (original?._refreshed) keepSession = true;
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
            original._refreshed = true;
            return client.request(original);
          }
        } catch {
          keepSession = true;
        }
      }

      try {
        if (isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 && !keepSession) {
            const { useAuthStore } = await import('../store/authStore');
            const wasAuthenticated = useAuthStore.getState().isAuthenticated;

            try {
              await authStorage.clearAuth();
            } catch (e) {
              console.error('Error clearing auth on 401:', e);
            }

            if (wasAuthenticated) {
              useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
              router.replace('/landing');
            }
          }

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
        console.error('Error in response interceptor:', e);
      }

      return Promise.reject(error);
    }
  );

  return client as unknown as ApiClient;
};

const api = createApiClient();

export { AbortableRequest };

export function createAbortableRequest() {
  return new AbortableRequest();
}

export function clientWithSignal(signal?: AbortSignal): ApiClient {
  return {
    get: (url, cfg) => api.get(url, { ...(cfg || {}), signal }),
    post: (url, data, cfg) => api.post(url, data, { ...(cfg || {}), signal }),
    put: (url, data, cfg) => api.put(url, data, { ...(cfg || {}), signal }),
    patch: (url, data, cfg) => api.patch(url, data, { ...(cfg || {}), signal }),
    delete: (url, cfg) => api.delete(url, { ...(cfg || {}), signal }),
  } as ApiClient;
}

export async function postSignUp(userData: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: 'client' | 'worker';
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
      privacyNoticeVersion: LEGAL_VERSIONS.PRIVACY_NOTICE,
    });
    return {
      id: response.id,
      name: response.fullName || response.name,
      email: response.email,
      phone: response.phone,
      role: response.role.toLowerCase(),
      avatar: response.avatar ?? undefined,
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

    if (response.mfaRequired) {
      return { mfaRequired: true as const, challengeToken: response.challengeToken as string };
    }

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
      avatar: response.avatar ?? undefined,
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

export async function postMfaChallenge(challengeToken: string, code: string) {
  try {
    const response = await api.post('/auth/mfa/challenge', { challengeToken, code });
    return {
      id: response.id,
      name: response.fullName || response.name,
      email: response.email,
      phone: response.phone,
      role: response.role.toLowerCase(),
      avatar: response.avatar ?? undefined,
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

export async function postLoginCode(challengeToken: string, code: string) {
  const response = await api.post('/auth/2fa/verify', { challengeToken, code });
  return {
    id: response.id,
    name: response.fullName || response.name,
    email: response.email,
    phone: response.phone,
    role: response.role.toLowerCase(),
    avatar: response.avatar ?? undefined,
    kycStatus: response.kycStatus,
    hasAcceptedTerms: response.hasAcceptedTerms,
    token: response.token,
    refreshToken: response.refreshToken as string | undefined,
  };
}

export async function resendLoginCode(challengeToken: string): Promise<{ method: 'EMAIL' | 'SMS'; destination: string }> {
  return api.post('/auth/2fa/resend', { challengeToken });
}

export type TwoFactorMethod = 'EMAIL' | 'SMS';

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

export async function reactivateAccount(email: string, password: string): Promise<{ message?: string }> {
  return api.post('/auth/reactivate', { email, password });
}

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

export async function getBookingsPage(page: number): Promise<{ bookings: any[]; pagination: Pagination | null }> {
  try {
    const response = await api.get('/bookings', { params: { page, limit: 20 } });
    return { bookings: response.bookings ?? [], pagination: response.pagination ?? null };
  } catch (error) {
    console.error('Get bookings page error:', error);
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
      quantity: details.quantity ?? undefined,
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
  hasPets?: boolean;
  serviceTaskId?: string;
  lat?: number;
  lng?: number;
  workerId?: string;
  page?: number;
  limit?: number;
}

export interface DiscoverWorkersResult {
  workers: WorkerCard[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export async function discoverWorkers(filters: DiscoverWorkersFilters): Promise<DiscoverWorkersResult> {
  try {
    const params: Record<string, string | number> = {};
    if (filters.serviceType) params.serviceType = filters.serviceType;
    if (filters.date) params.date = filters.date;
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

export async function getWorkerUnavailableDates(workerId: string): Promise<string[]> {
  const response = await api.get(`/workers/${workerId}/blocked-dates`);
  return Array.isArray(response?.dates) ? response.dates : [];
}

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
    reviews: Number(worker.reviews ?? worker.reviewCount ?? worker.totalReviews ?? 0),
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

export async function reportReview(bookingId: string, reason: string) {
  try {
    return await api.post(`/bookings/${bookingId}/review/report`, { reason });
  } catch (error) {
    console.error('Report review error:', error);
    throw error;
  }
}

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
        payoutStatus: p.payoutStatus ?? null,
        payoutFailureReason: p.payoutFailureReason ?? null,
      })),
      total: response.pagination?.total ?? payments.length,
      page: response.pagination?.page ?? page ?? 1,
      pagination: (response.pagination ?? null) as Pagination | null,
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

export async function createXenditCheckout(bookingId: string) {
  try {
    const response = await api.post(`/payments/${bookingId}/xendit/checkout`);
    return response as
      | { checkoutUrl: string; invoiceId: string; amount: number; alreadyPaid?: undefined }
      | { alreadyPaid: true; checkoutUrl?: undefined };
  } catch (error) {
    console.error('Create Xendit checkout error:', error);
    throw error;
  }
}

export async function payPlatformDues(amount?: number) {
  const response = await api.post("/payments/dues", amount === undefined ? {} : { amount });
  return response as
    | { checkoutUrl: string; debtPaymentId: string; amount: number; alreadyPaid?: undefined }
    | { alreadyPaid: true; checkoutUrl?: undefined };
}

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
        photoUrls: Array.isArray(r.photoUrls) ? (r.photoUrls as string[]) : [],
      })),
      total: response.pagination?.total ?? reviews.length,
      page: response.pagination?.page ?? page ?? 1,
    };
  } catch (error) {
    console.error('Get my reviews error:', error);
    throw error;
  }
}

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
    return {
      messages: response.messages ?? [],
      pagination: (response.pagination ?? null) as Pagination | null,
      blockedByMe: response.blockedByMe === true,
    };
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

export async function reportMessage(messageId: string, reason: string) {
  try {
    return await api.post(`/messages/${messageId}/report`, { reason });
  } catch (error) {
    console.error('Report message error:', error);
    throw error;
  }
}

export type BlockedUser = { userId: string; name: string; avatar: string | null; blockedAt: string };

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  try {
    const response = await api.get('/blocks');
    return response.blocks ?? [];
  } catch (error) {
    console.error('Get blocked users error:', error);
    throw error;
  }
}

export async function blockUser(userId: string) {
  try {
    return await api.post(`/blocks/${userId}`);
  } catch (error) {
    console.error('Block user error:', error);
    throw error;
  }
}

export async function unblockUser(userId: string) {
  try {
    return await api.delete(`/blocks/${userId}`);
  } catch (error) {
    console.error('Unblock user error:', error);
    throw error;
  }
}

export async function getNotifications(page?: number) {
  try {
    const response = await api.get('/notifications', {
      params: page ? { page } : {},
    });
    return { notifications: response.notifications ?? [], pagination: (response.pagination ?? null) as Pagination | null };
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

export async function addBeforePhotos(bookingId: string, photoUrls: string[]) {
  return api.post(`/bookings/${bookingId}/before-photos`, { photoUrls });
}

export async function addProgressPhotos(bookingId: string, photoUrls: string[]) {
  return api.post(`/bookings/${bookingId}/progress-photos`, { photoUrls });
}

export interface BookingVisit {
  id: string;
  scheduledDate: string;
  scheduledTime: string;
  notes: string | null;
  status: 'SCHEDULED' | 'DONE' | 'CANCELLED';
}

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

export async function acknowledgeReschedule(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/acknowledge-reschedule`);
    return response;
  } catch (error) {
    console.error('Acknowledge reschedule error:', error);
    throw error;
  }
}

export async function requestReschedule(bookingId: string, date: string, time: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/request-reschedule`, { date, time });
    return response;
  } catch (error) {
    console.error('Request reschedule error:', error);
    throw error;
  }
}

export async function withdrawRescheduleRequest(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/reschedule-request/withdraw`);
    return response;
  } catch (error) {
    console.error('Withdraw reschedule request error:', error);
    throw error;
  }
}

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

export async function updateWorkerLiveLocation(bookingId: string, lat: number, lng: number, accuracy?: number | null) {
  const response = await api.patch(`/bookings/${bookingId}/live-location`, { lat, lng, accuracy });
  return response;
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

export type InvoiceItemPayload = {
  kind: 'PART' | 'EXTRA_WORK';
  name: string;
  price: number;
  photoUrls: string[];
};

export async function completeBooking(bookingId: string, completionPhotoUrl: string, items: InvoiceItemPayload[] = []) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/complete`, { completionPhotoUrl, items });
    return response as unknown as { id: string; status: 'COMPLETED' | 'AWAITING_PAYMENT' | 'PENDING_COMPLETION'; total: number };
  } catch (error) {
    console.error('Complete booking error:', error);
    throw error;
  }
}

export async function respondToCancelRequest(bookingId: string, accept: boolean) {
  try {
    return await api.patch(`/bookings/${bookingId}/cancel-request/respond`, { accept });
  } catch (error) {
    console.error('Respond to cancel request error:', error);
    throw error;
  }
}

export async function reportClientNotHere(bookingId: string): Promise<{ clientNotHereAt: string; canCancelAt: string | null }> {
  try {
    return await api.patch(`/bookings/${bookingId}/client-not-here`);
  } catch (error) {
    console.error('Client not here error:', error);
    throw error;
  }
}

export async function reportCashNotPaid(bookingId: string) {
  try {
    return await api.patch(`/bookings/${bookingId}/cash-not-paid`);
  } catch (error) {
    console.error('Cash not paid error:', error);
    throw error;
  }
}

export async function markCashReceived(bookingId: string) {
  try {
    return await api.patch(`/bookings/${bookingId}/cash-received`);
  } catch (error) {
    console.error('Cash received error:', error);
    throw error;
  }
}

export async function reportInvoice(bookingId: string, reason: string, evidenceUrls?: string[]) {
  try {
    return await api.patch(`/bookings/${bookingId}/invoice/report`, { reason, evidenceUrls });
  } catch (error) {
    console.error('Report invoice error:', error);
    throw error;
  }
}

export type ProblemReason = 'WORKER_NOT_HERE' | 'WORKER_STOPPED' | 'NEED_TO_CANCEL' | 'OTHER';

export async function reportBookingProblem(bookingId: string, reason: ProblemReason, note?: string) {
  try {
    const response = await api.post(`/bookings/${bookingId}/problem`, { reason, note });
    return response as unknown as {
      outcome: 'WORKER_PINGED' | 'CANCELLED' | 'CANCEL_REQUESTED' | 'REPORTED';
      autoCancelAt?: string;
    };
  } catch (error) {
    console.error('Report problem error:', error);
    throw error;
  }
}

export type ConfirmCompletionResult =
  | { status: 'COMPLETED'; finalPrice?: number; completedAt?: string; payment?: unknown }
  | { status: 'AWAITING_PAYMENT'; checkoutUrl: string; invoiceId: string; amount: number };

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

export async function getMyCalendar(from: string, to: string): Promise<WorkerCalendar> {
  return api.get('/workers/me/calendar', { params: { from, to } });
}

export async function updateWeeklySchedule(availableDays: number[]): Promise<{ availableDays: number[] }> {
  return api.put('/workers/me/weekly-schedule', { availableDays });
}

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
  yearsExperience: number | null;
  availableDays: number[];
  kycStatus: string;
  kycSubmittedAt: string | null;
  kycApprovedAt: string | null;
}

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
  birthDate?: string;
  // Locked after KYC approval, like birthDate.
  yearsExperience?: number;
  bio?: string;
  serviceAreaRadius?: number;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
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
      price: number | null;
      unitLabel: string | null;
    };
    mySelection: WorkerTaskSelection | null;
  }>;
};

export async function getMyTaskCatalog(): Promise<TaskCatalogEntry[]> {
  try {
    const response = await api.get('/workers/me/task-catalog');
    return response.categories ?? [];
  } catch (error) {
    console.error('Get task catalog error:', error);
    throw error;
  }
}

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
  status: PackageReviewStatus;
  rejectionReason?: string | null;
};

export type WorkerSetupItemKey = 'PROFILE_PHOTO' | 'PAYOUT_METHOD' | 'ADDRESS' | 'AVAILABILITY' | 'SERVICES';

export type WorkerSetupStatus = {
  complete: boolean;
  items: { key: WorkerSetupItemKey; label: string; done: boolean }[];
  missing: WorkerSetupItemKey[];
};

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
      ...(response.role && { role: response.role.toLowerCase() }),
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

export async function getActiveSessionCount(): Promise<number> {
  const response = await api.get('/users/me/sessions');
  return response.activeSessions ?? 1;
}

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
      accountHold: response.accountHold as { since: string; amountOwed: number } | null | undefined,
      platformDues: response.platformDues as number | undefined,
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

export async function requestAccountDeletionCode(): Promise<void> {
  await api.post('/users/me/delete-code', {});
}

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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  linkServiceTypeId: string | null;
  /** Hex like "#FFFFFF"; null = white. */
  textColor?: string | null;
  fontFamily?: string | null;
};

export async function getPromoBanners(): Promise<PromoBannerItem[]> {
  const response = await api.get('/promo-banners');
  return Array.isArray(response) ? (response as PromoBannerItem[]) : [];
}
