import axios, { AxiosRequestConfig, isAxiosError } from 'axios';
import { config } from '../constants/config';
import { authStorage } from '../utils/storage';
import { AbortableRequest } from '../utils/apiErrorHandling';
import { KycDocumentKey } from '../utils/kycDocumentConfig';
import { mapKycDocumentType } from '../utils/kycDocumentTypeMap';
import type { WorkerDetail } from "../types/api.types";
import {
  bookings as dummyBookings,
  workers as dummyWorkers,
  conversations as dummyConversations,
  transactions as dummyTransactions,
  workerTransactions as dummyWorkerTransactions,
} from "../constants/dummyData";

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
  await delay(350);
  return {
    id: bookingId,
    status: "Cancelled",
    reason: reason || "User requested cancellation",
    refundAmount: 450,
    message: "Booking cancelled. Refund will be processed within 3-5 business days.",
  };
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
    await delay(350);
  const worker = dummyWorkers.find((w) => w.id === workerId);
  if (!worker) return null;

  return {
    ...worker,
    status: worker.status === "available" ? "available" : "busy",
    bio: "Licensed professional with 5+ years of experience in plumbing services. Specializing in residential and commercial work.",
    serviceAreaRadius: 10,
    resumeParseResult: {
      parsedSkills: ["Pipe Repair", "Installation", "Maintenance"],
      yearsOfExperience: 5,
      masteryLevel: "Advanced",
      tradeCategory: "Plumbing",
      summary: "Experienced plumber specializing in residential and commercial work.",
    },
    certifications: [
      {
        id: "cert1",
        title: "Plumbing License",
        issuer: "TESDA",
        issueDate: "2021-01-15",
        expiryDate: null,
        documentUrl: "https://example.com/cert1.pdf",
        verificationStatus: "VERIFIED",
      },
      {
        id: "cert2",
        title: "Safety Training",
        issuer: "DOLE",
        issueDate: "2022-03-10",
        expiryDate: null,
        documentUrl: "https://example.com/cert2.pdf",
        verificationStatus: "VERIFIED",
      },
    ],
    completedJobs: 234,
    joinDate: "2021-03-15",
  };
}

export async function searchWorkers(filters: {
  query?: string;
  categoryId?: string;
  minRating?: number;
  page?: number;
}) {
  await delay(400);
  let results = [...dummyWorkers];

  const q = filters.query?.toLowerCase().trim();
  if (q) {
    results = results.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.service.toLowerCase().includes(q)
    );
  }

  if (filters?.categoryId) {
    results = results.filter((w) => w.service.toLowerCase().includes(filters.categoryId!.toLowerCase()));
  }

  if (filters?.minRating) {
    results = results.filter((w) => w.rating >= filters.minRating!);
  }

  const page = filters?.page || 1;
  const limit = 10;
  const start = (page - 1) * limit;

  return {
    data: results.slice(start, start + limit),
    total: results.length,
    page,
  };
}

export async function getWorkerReviews(workerId: string) {
  void workerId;
  await delay(300);
  return [
    {
      id: "r1",
      clientName: "Maria Santos",
      rating: 5,
      comment: "Excellent service, very professional and on time!",
      date: "2026-02-28",
      bookingId: "BK-001",
    },
    {
      id: "r2",
      clientName: "Juan Dela Cruz",
      rating: 4,
      comment: "Good work, would definitely book again.",
      date: "2026-02-20",
      bookingId: "BK-002",
    },
  ];
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

export async function getTransactions(page?: number) {
  await delay(300);
  const limit = 10;
  const start = ((page || 1) - 1) * limit;
  return {
    data: dummyTransactions.slice(start, start + limit),
    total: dummyTransactions.length,
    page: page || 1,
  };
}

export async function getTransactionDetail(transactionId: string) {
  await delay(250);
  const txn = dummyTransactions.find((t) => t.id === transactionId);
  if (!txn) return null;
  return {
    ...txn,
    breakdown: {
      servicePrice: 600,
      tax: 0,
      tip: 0,
      total: 600,
    },
    booking: dummyBookings.find((b) => b.id === txn.bookingId),
  };
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
  await delay(400);
  return {
    id: "rev-" + Math.random().toString(36).slice(2, 8),
    bookingId,
    rating,
    comment,
    createdAt: new Date().toISOString(),
  };
}

export async function getMyReviews(page?: number) {
  await delay(300);
  return {
    data: [
      {
        id: "rev1",
        workerName: "Juan Dela Cruz",
        workerId: "w1",
        rating: 5,
        comment: "Excellent plumbing work!",
        bookingId: "BK-001",
        date: "2026-02-28",
      },
    ],
    total: 1,
    page: page || 1,
  };
}

// ============================================================================
// MESSAGING
// ============================================================================

export async function getConversations() {
  await delay(300);
  return dummyConversations;
}

export async function getConversationDetail(conversationId: string) {
  await delay(300);
  return {
    id: conversationId,
    participantName: "Juan Dela Cruz",
    participantAvatar: null,
    messages: [
      { id: "m1", text: "Hi, when can you come?", sender: "other", timestamp: "10:30 AM" },
      { id: "m2", text: "I can be there around 2 PM", sender: "me", timestamp: "10:31 AM" },
      { id: "m3", text: "Perfect! See you then", sender: "other", timestamp: "10:32 AM" },
    ],
  };
}

export async function sendMessage(conversationId: string, text: string) {
  await delay(400);
  return {
    id: "msg-" + Date.now(),
    conversationId,
    text,
    sender: "me",
    timestamp: new Date().toISOString(),
  };
}

export async function markMessagesAsRead(conversationId: string) {
  await delay(250);
  return { success: true, conversationId };
}

// ============================================================================
// WORKER ENDPOINTS
// ============================================================================

export async function getJobRequests(status?: string) {
  await delay(350);
  const jobRequests = [
    {
      id: "jr1",
      clientName: "Maria Santos",
      clientRating: 4.8,
      service: "Plumbing Repair",
      date: "2026-03-15",
      time: "2:00 PM",
      estimatedPrice: 500,
      status: "Pending",
      description: "Leaking faucet in kitchen",
    },
    {
      id: "jr2",
      clientName: "Juan Dela Cruz",
      clientRating: 4.5,
      service: "Pipe Installation",
      date: "2026-03-16",
      time: "10:00 AM",
      estimatedPrice: 1500,
      status: "Pending",
      description: "New water line installation",
    },
  ];

  if (!status) return jobRequests;
  return jobRequests.filter((j) => j.status === status);
}

export async function getJobRequestDetail(requestId: string) {
  await delay(300);
  return {
    id: requestId,
    clientName: "Maria Santos",
    clientRating: 4.8,
    clientReviews: 45,
    clientAvatar: null,
    service: "Plumbing Repair",
    date: "2026-03-15",
    time: "2:00 PM",
    estimatedPrice: 500,
    address: "123 Rizal St., Hagonoy, Bulacan",
    description: "Leaking faucet in kitchen. Also check water pressure issues.",
    status: "Pending",
  };
}

export async function acceptJobRequest(requestId: string) {
  await delay(400);
  return {
    success: true,
    message: "Job request accepted",
    requestId,
    bookingId: "BK-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
  };
}

export async function declineJobRequest(requestId: string, reason?: string) {
  void reason;
  await delay(350);
  return {
    success: true,
    message: "Job request declined",
    requestId,
  };
}

export async function markJobComplete(bookingId: string) {
  await delay(400);
  return {
    success: true,
    message: "Job marked as complete",
    bookingId,
  };
}

export async function getEarnings() {
  await delay(300);
  return {
    totalBalance: 15420.50,
    availableBalance: 10240.00,
    pendingBalance: 5180.50,
    monthlyEarnings: 4500.00,
    totalEarnings: 45200.00,
    completedJobs: 234,
  };
}

export async function getWorkerTransactions(page?: number) {
  await delay(300);
  const limit = 10;
  const start = ((page || 1) - 1) * limit;
  return {
    data: dummyWorkerTransactions.slice(start, start + limit),
    total: dummyWorkerTransactions.length,
    page: page || 1,
  };
}

export async function getWorkerRecords(status?: string) {
  await delay(350);
  const records = dummyBookings.map((b) => ({
    ...b,
    clientName: b.worker,
    completionDate: "2026-02-28",
  }));

  if (!status) return records;
  return records.filter((r) => r.status === status);
}

export async function requestWithdrawal(amount: number, method: string) {
  await delay(500);
  return {
    id: "wd-" + Math.random().toString(36).slice(2, 8),
    amount,
    method,
    status: "Pending",
    requestedAt: new Date().toISOString(),
    expectedDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    message: "Withdrawal requested. Funds will be transferred within 3-5 business days.",
  };
}

export async function getWorkerReviewsReceived(page?: number) {
  await delay(300);
  return {
    data: [
      {
        id: "wr1",
        clientName: "Maria Santos",
        rating: 5,
        comment: "Professional and reliable!",
        bookingId: "BK-001",
        date: "2026-02-28",
      },
    ],
    total: 156,
    page: page || 1,
    averageRating: 4.8,
  };
}

export async function updateWorkerSkills(skills: { name: string; level: string }[]) {
  await delay(350);
  return {
    success: true,
    skills,
    message: "Skills updated successfully",
  };
}

export async function getWorkerSkills() {
  await delay(250);
  return [
    { id: "s1", name: "Plumbing", level: "Expert" },
    { id: "s2", name: "Electrical", level: "Intermediate" },
  ];
}

export async function getResumeParsed() {
  await delay(400);
  return {
    skills: ["Plumbing", "Electrical Basics", "Customer Service"],
    yearsOfExperience: 8,
    masteryLevel: "Advanced",
    certifications: ["Plumbing License", "Safety Training"],
    summary: "Experienced plumber with 8 years of hands-on expertise in residential and commercial plumbing work.",
  };
}

// ============================================================================
// PROFILE ENDPOINTS
// ============================================================================

export async function updateProfile(data: {
  name?: string;
  phone?: string;
  email?: string;
  bio?: string;
  yearsOfExperience?: number;
  serviceArea?: string;
}) {
  await delay(400);
  return {
    success: true,
    message: "Profile updated successfully",
    ...data,
  };
}

export async function updateUserProfile(data: {
  fullName?: string;
  phone?: string;
  bio?: string;
  yearsOfExperience?: number;
  serviceArea?: string;
}) {
  try {
    const payload: any = {};
    if (data.fullName) payload.fullName = data.fullName;
    if (data.phone) payload.phone = data.phone;
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
  void currentPassword;
  void newPassword;
  await delay(400);
  return {
    success: true,
    message: "Password changed successfully",
  };
}

export async function updateNotificationPreferences(preferences: Record<string, boolean>) {
  await delay(350);
  return {
    success: true,
    preferences,
    message: "Notification preferences updated",
  };
}

export async function deleteAccount(password: string) {
  void password;
  await delay(500);
  return {
    success: true,
    message: "Account deletion request submitted. You will receive a confirmation email.",
  };
}

// ============================================================================
// UTILITY FUNCTION
// ============================================================================

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getWorkerAvailability(workerId: string, date: string): Promise<{ occupied: string[] }> {
  // Simple mocked availability: map workerId -> worker name then check dummy bookings for that date
  await delay(200);
  const workerRec = dummyWorkers.find((w) => w.id === workerId);
  if (!workerRec) return { occupied: [] };
  const workerName = workerRec.name;
  const workerBookings = dummyBookings.filter((b) => b.worker === workerName && b.date === date);
  const occupied = workerBookings.flatMap((b) => {
    if ('time' in b && typeof b.time === 'string' && b.time) {
      return [b.time];
    }
    return [];
  });
  return { occupied };
}

export async function getWorkerBlockedDates(workerId: string) {
  // Return list of dates where the worker already has any booking
  await delay(200);
  const workerRec = dummyWorkers.find((w) => w.id === workerId);
  if (!workerRec) return { dates: [] };
  const workerName = workerRec.name;
  const dates = dummyBookings.filter((b) => b.worker === workerName).map((b) => b.date);
  // unique
  const unique = Array.from(new Set(dates));
  return { dates: unique };
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