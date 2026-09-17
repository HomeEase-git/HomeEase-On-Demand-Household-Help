export interface SignUpRequest {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: 'CLIENT' | 'WORKER';
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  // Absent on a normal session token. 'mfa_pending' marks a short-lived
  // challenge token issued mid-login to an MFA-enabled admin — see
  // authController.login/mfaChallenge — which authMiddleware must never
  // accept as a real session (see middleware/auth.ts).
  type?: 'mfa_pending';
}

export interface AuthResponse {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  token: string;
  refreshToken?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}