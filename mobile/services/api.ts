import axios, { AxiosRequestConfig, isAxiosError } from 'axios';
import { config } from '../constants/config';
import { authStorage } from '../utils/storage';
import { AbortableRequest } from '../utils/apiErrorHandling';
import { KycDocumentKey } from '../utils/kycDocumentConfig';
import { mapKycDocumentType } from '../utils/kycDocumentTypeMap';
import type { WorkerDetail } from "../types/api.types";
import type { LatLng } from "../utils/geo";

type NormalizedWorkerListItem = {
  id: string;
  name: string;
  service: string;
  rating: number;
  reviews: number;
  basePrice: number | null;
  status: string;
  avatar: string | null;
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

    console.log('[API →]', request.method?.toUpperCase(), (request.baseURL || '') + request.url);

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
            // Clear stored auth (token + user) so app reacts to unauthorized state
            try {
              await authStorage.clearAuth();
            } catch (e) {
              console.error('Error clearing auth on 401/403:', e);
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

export async function createBooking(details: {
  workerId: string;
  serviceTaskId: string;
  location: string;
  city?: string;
  scheduledDate: string;
  scheduledTime?: string;
  description?: string;
  notes?: string;
  estimatedPrice: number;
  tip?: number;
  addOns?: { id?: string; name: string; price: number }[];
  estimatedDurationHours?: number;
  inspectionFeeCharged?: boolean;
  inspectionFeeAmount?: number;
  paymentMethodType?: 'GCASH' | 'MAYA' | 'CARD' | 'BANK_TRANSFER' | 'CASH';
  paymentAccountIdentifier?: string;
}) {
  try {
    const response = await api.post('/bookings', {
      workerId: details.workerId,
      serviceTaskId: details.serviceTaskId,
      location: details.location,
      city: details.city || '',
      scheduledDate: details.scheduledDate,
      scheduledTime: details.scheduledTime || '',
      description: details.description || '',
      notes: details.notes || '',
      estimatedPrice: details.estimatedPrice,
      tip: details.tip || 0,
      addOns: details.addOns || [],
      estimatedDurationHours: details.estimatedDurationHours,
      inspectionFeeCharged: details.inspectionFeeCharged,
      inspectionFeeAmount: details.inspectionFeeAmount,
      paymentMethodType: details.paymentMethodType,
      paymentAccountIdentifier: details.paymentAccountIdentifier,
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

export async function rescheduleBooking(bookingId: string, newDate: string, newTime: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/reschedule`, {
      newDate,
      newTime,
    });
    return response;
  } catch (error) {
    console.error('Reschedule booking error:', error);
    throw error;
  }
}

export async function cancelBooking(bookingId: string, reason?: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/cancel`, { reason });
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
    rating: Number(worker.rating ?? 0),
    reviews: Number(worker.reviews ?? worker.reviewCount ?? 0),
    basePrice:
      typeof worker.basePrice === "number"
        ? worker.basePrice
        : typeof worker.rate === "number"
          ? worker.rate
          : null,
    status: normalizedStatus,
    avatar: worker.avatar ?? worker.user?.avatar ?? null,
  };
}

export async function getWorkerDetail(workerId: string): Promise<WorkerDetail | null> {
  try {
    const response = await api.get(`/workers/${workerId}`);
    const service = response.services?.[0]?.name ?? "General service";
    const skills = response.resumeParseResult?.parsedSkills?.length
      ? response.resumeParseResult.parsedSkills
      : [service];

    return {
      id: response.id,
      name: response.name,
      service,
      rating: Number(response.rating ?? 0),
      reviews: Number(response.reviewCount ?? 0),
      rate: typeof response.services?.[0]?.basePrice === "number" ? response.services[0].basePrice : undefined,
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

export async function searchWorkers(filters: {
  query?: string;
  categoryId?: string;
  minRating?: number;
  availableOnly?: boolean;
  sortBy?: "rating" | "priceLow" | "priceHigh" | "nearest";
  origin?: LatLng;
  radiusKm?: number;
  page?: number;
}) {
  try {
    const params: Record<string, string | number> = { limit: 50 };
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
          w.service.toLowerCase().includes(q)
      );
    }

    if (filters.availableOnly) {
      results = results.filter((w) => w.status === "available");
    }

    // The backend doesn't return worker coordinates, so "nearest" sort and
    // radius filtering aren't possible here — falls back to rating sort.
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
      rating: Number(r.rating ?? 0),
      comment: r.comment ?? "",
      date: r.createdAt,
      bookingId: r.bookingId,
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

// ============================================================================
// PAYMENT METHODS - CLIENT
// ============================================================================

export const paymentMethodTypeMap: Record<string, string> = {
  card: 'CARD',
  gcash: 'GCASH',
  maya: 'MAYA',
  bank: 'BANK_TRANSFER',
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

export async function getTransactions(page?: number) {
  try {
    const response = await api.get('/payments', {
      params: page ? { page } : {},
    });
    const payments = response.payments ?? [];
    return {
      data: payments.map((p: any) => ({
        id: p.id,
        bookingId: p.bookingId,
        amount: p.amount,
        method: p.methodType,
        status: titleCaseStatus(p.status ?? "Pending"),
        date: p.createdAt,
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
    };
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    console.error('Get transaction detail error:', error);
    throw error;
  }
}

export async function createBookingPayment(
  bookingId: string,
  data: { methodType: 'GCASH' | 'MAYA' | 'CARD' | 'BANK_TRANSFER' | 'CASH'; accountIdentifier?: string },
) {
  try {
    const response = await api.post(`/payments/${bookingId}`, data);
    return response;
  } catch (error) {
    console.error('Create payment error:', error);
    throw error;
  }
}

export async function releasePaymentEscrow(paymentId: string) {
  try {
    const response = await api.post(`/payments/${paymentId}/release`);
    return response;
  } catch (error) {
    console.error('Release payment escrow error:', error);
    throw error;
  }
}

export async function downloadReceipt(transactionId: string) {
  await delay(400);
  return {
    success: true,
    url: `https://receipts.homeease.com/${transactionId}.pdf`,
    fileName: `receipt-${transactionId}.pdf`,
  };
}

// ============================================================================
// REVIEWS - CLIENT
// ============================================================================

export async function submitReview(
  bookingId: string,
  rating: number,
  comment: string,
) {
  try {
    const response = await api.post(`/bookings/${bookingId}/review`, { rating, comment });
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

export async function completeBooking(bookingId: string, completionPhotoUrl: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/complete`, { completionPhotoUrl });
    return response;
  } catch (error) {
    console.error('Complete booking error:', error);
    throw error;
  }
}

export async function confirmBookingCompletion(bookingId: string) {
  try {
    const response = await api.patch(`/bookings/${bookingId}/confirm-completion`);
    return response;
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

export async function updateWorkerProfileDetails(data: {
  bio?: string;
  serviceAreaRadius?: number;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  resumeUrl?: string;
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

export type Skill = { id: string; name: string; category: string; rate: number };

export async function getMySkills(): Promise<Skill[]> {
  try {
    const response = await api.get('/workers/me/skills');
    return response.skills ?? [];
  } catch (error) {
    console.error('Get skills error:', error);
    throw error;
  }
}

export async function addSkill(data: { name: string; category: string; rate: number }): Promise<Skill> {
  try {
    const response = await api.post('/workers/me/skills', data);
    return response.skill;
  } catch (error) {
    console.error('Add skill error:', error);
    throw error;
  }
}

export async function deleteSkill(skillId: string) {
  try {
    await api.delete(`/workers/me/skills/${skillId}`);
    return true;
  } catch (error) {
    console.error('Delete skill error:', error);
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
}): Promise<Certification> {
  try {
    const response = await api.post('/workers/me/certifications', data);
    return response.certification;
  } catch (error) {
    console.error('Add certification error:', error);
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
  payoutMethod: 'GCASH' | 'MAYA' | 'BANK_TRANSFER' | null;
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
  payoutMethod: 'GCASH' | 'MAYA' | 'BANK_TRANSFER';
  payoutAccountName?: string;
  payoutAccountNumber?: string;
}): Promise<PayoutMethod> {
  try {
    const response = await api.patch('/workers/me/payout', data);
    return response;
  } catch (error) {
    console.error('Update payout method error:', error);
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

export async function getKycDocuments() {
  try {
    const response = await api.get('/users/me/kyc-documents');
    return Array.isArray(response) ? response : [];
  } catch (error) {
    console.error('Get KYC documents error:', error);
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

export async function getWorkerAvailability(workerId: string, date: string): Promise<{ occupied: string[] }> {
  try {
    const response = await api.get(`/workers/${workerId}/availability`, {
      params: { date },
    });
    return { occupied: response.occupied ?? [] };
  } catch (error) {
    console.error('Get worker availability error:', error);
    throw error;
  }
}

export async function getWorkerBlockedDates(workerId: string) {
  try {
    const response = await api.get(`/workers/${workerId}/blocked-dates`);
    return { dates: response.dates ?? [] };
  } catch (error) {
    console.error('Get worker blocked dates error:', error);
    throw error;
  }
}

export async function getServiceTypes() {
  try {
    const response = await api.get('/services');
    return Array.isArray(response) ? response : [];
  } catch (error) {
    console.error('Get service types error:', error);
    throw error;
  }
}