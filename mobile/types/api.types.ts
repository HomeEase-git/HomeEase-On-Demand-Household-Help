/**
 * API Types & Interfaces
 * 
 * Defines request/response shapes for all HomeEase API endpoints.
 * These types ensure type safety across the frontend and provide
 * a contract that the backend must implement.
 */

// ============================================================================
// COMMON TYPES
// ============================================================================

export interface ApiResponse<T = any> {
  data?: T;
  success?: boolean;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit?: number;
}

// ============================================================================
// AUTH TYPES
// ============================================================================

export interface SignUpRequest {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: 'client' | 'worker';
}

export interface AuthResponse {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'client' | 'worker';
  token: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface ResetPasswordRequest {
  email: string;
  otp: string;
  newPassword: string;
}

export interface OtpVerificationRequest {
  email: string;
  otp: string;
}

// ============================================================================
// BOOKING TYPES
// ============================================================================

export type BookingStatus = 'Pending' | 'Accepted' | 'InProgress' |
                            'QuoteSubmitted' | 'QuoteApproved' | 'Disputed' |
                            'Completed' | 'Cancelled';

export interface Booking {
  id: string;
  service: string;
  worker: string;
  workerId?: string;
  date: string;
  time?: string;
  status: BookingStatus;
  amount: number;
  payment?: {
    methodType?: string;
    accountIdentifier?: string;
    status?: string;
    totalAmount?: number;
  };
  address?: string;
  description?: string;
  notes?: string;
  createdAt?: string;
  completionDate?: string;
}

export interface BookingDetail extends Booking {
  description: string;
  notes?: string;
  createdAt: string;
}

export interface CreateBookingRequest {
  service: string;
  description: string;
  date: string;
  time: string;
  address: string;
  workerId?: string;
  tip?: number;
  estimatedPrice: number;
  estimatedDurationHours?: number;
  inspectionFeeCharged?: boolean;
  inspectionFeeAmount?: number;
}

export interface CancelBookingRequest {
  reason?: string;
}

// ============================================================================
// WORKER DISCOVERY TYPES
// ============================================================================

export interface Worker {
  id: string;
  name: string;
  service: string;
  rating: number;
  reviews: number;
  rate?: number;
  status: 'available' | 'busy';
  avatar?: string;
  activeJobCount?: number | null;
  maxConcurrentJobs?: number | null;
}

export interface Certification {
  id: string;
  title: string;
  issuer: string;
  issueDate: string;
  expiryDate?: string | null;
  documentUrl: string;
  verificationStatus: string;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkerDetail extends Worker {
  bio: string;
  serviceAreaRadius: number;
  certifications: Certification[];
  resumeParseResult: ParsedResume | null;
  skills: string[];
  activeJobCount: number;
  verificationStatus: string;
  isAvailable: boolean;
  availableDays: string[];
  maxConcurrentJobs: number;
  hourlyRate?: number | null;
}

export interface WorkerFilters {
  category?: string;
  minRating?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
}

export interface WorkerSearchRequest {
  query?: string;
  categoryId?: string;
  minRating?: number;
  page?: number;
}

export interface WorkerDigitalId {
  id: string;
  name: string;
  avatar: string | null;
  rating: number;
  totalReviews: number;
  kycStatus: string;
  kycApprovedAt: string | null;
  verified: boolean;
  badgeId: string;
  trade: string | null;
  serviceArea: string | null;
  licenseNumber: string | null;
}

export interface WorkerReview {
  id: string;
  clientName: string;
  clientAvatar?: string | null;
  rating: number;
  comment: string;
  date: string;
  bookingId: string;
}

// ============================================================================
// PAYMENT METHOD TYPES
// ============================================================================

export type PaymentMethodType = 'card' | 'gcash' | 'maya' | 'bank';

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  lastFour: string;
  label?: string;
  isDefault: boolean;
  expiryDate?: string;
  createdAt?: string;
}

export interface AddPaymentMethodRequest {
  type: PaymentMethodType;
  cardNumber?: string;
  expiryDate?: string;
  cvv?: string;
  walletId?: string;
}

// ============================================================================
// ADDRESS TYPES
// ============================================================================

export interface Address {
  id: string;
  label: string;
  address: string;
  isDefault: boolean;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface AddAddressRequest {
  label: string;
  address: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

export interface Transaction {
  id: string;
  bookingId: string;
  amount: number;
  method: string;
  status: 'Pending' | 'Completed' | 'Failed';
  date: string;
}

export interface TransactionDetail extends Transaction {
  breakdown: {
    servicePrice: number;
    tax: number;
    tip: number;
    total: number;
  };
  booking?: Booking;
}

// ============================================================================
// REVIEW TYPES
// ============================================================================

export interface ClientReview {
  id: string;
  bookingId: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface SubmitReviewRequest {
  bookingId: string;
  rating: number;
  comment: string;
}

// ============================================================================
// MESSAGING TYPES
// ============================================================================

export interface Conversation {
  id: string;
  name: string;
  lastMessage: string;
  time: string;
  unread?: number;
}

export interface ConversationDetail {
  id: string;
  participantName: string;
  participantAvatar?: string;
  messages: Message[];
}

export interface Message {
  id: string;
  text: string;
  sender: 'me' | 'other';
  timestamp: string;
  isRead?: boolean;
}

export interface SendMessageRequest {
  conversationId: string;
  text: string;
}

// ============================================================================
// WORKER JOB REQUEST TYPES
// ============================================================================

export type JobRequestStatus = 'Pending' | 'Accepted' | 'Completed' | 'Declined';

export interface JobRequest {
  id: string;
  clientName: string;
  clientRating: number;
  service: string;
  date: string;
  time: string;
  estimatedPrice: number;
  status: JobRequestStatus;
  description: string;
}

export interface JobRequestDetail extends JobRequest {
  clientReviews: number;
  clientAvatar?: string;
  address: string;
}

// ============================================================================
// EARNINGS & PAYOUT TYPES
// ============================================================================

export interface EarningsDetails {
  totalBalance: number;
  availableBalance: number;
  pendingBalance: number;
  monthlyEarnings: number;
  totalEarnings: number;
  completedJobs: number;
}

export interface WorkerTransaction {
  id: string;
  bookingId: string;
  amount: number;
  method: string;
  status: 'Pending' | 'Completed' | 'Failed';
  date: string;
}

export interface WithdrawalRequest {
  amount: number;
  method: PaymentMethodType;
}

export interface WithdrawalResponse {
  id: string;
  amount: number;
  method: string;
  status: string;
  requestedAt: string;
  expectedDate: string;
  message: string;
}

// ============================================================================
// WORKER SKILL & PROFILE TYPES
// ============================================================================

export interface WorkerSkill {
  id: string;
  name: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
}

export interface UpdateSkillsRequest {
  skills: Array<{
    name: string;
    level: string;
  }>;
}

export interface WorkerReceivedReview {
  id: string;
  clientName: string;
  rating: number;
  comment: string;
  bookingId: string;
  date: string;
}

export interface ParsedResume {
  rawText?: string | null;
  parsedSkills: string[];
  yearsOfExperience?: number | null;
  masteryLevel?: string | null;
  tradeCategory?: string | null;
  summary?: string | null;
  parsedAt?: string;
  modelUsed?: string;
}

// ============================================================================
// PROFILE & SETTINGS TYPES
// ============================================================================

export interface UpdateProfileRequest {
  name?: string;
  phone?: string;
  email?: string;
  bio?: string;
  yearsOfExperience?: number;
  serviceArea?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface NotificationPreferences {
  bookingUpdates: boolean;
  newMessages: boolean;
  promotions: boolean;
  systemAnnouncements: boolean;
}

export interface DeleteAccountRequest {
  password: string;
}
