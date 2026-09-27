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
  // Absent on a normal session token. 'mfa_pending' / 'otp_pending' mark a
  // short-lived challenge token issued mid-login (authenticator app, or an
  // email/SMS code — see authController.login) which authMiddleware must
  // never accept as a real session (see middleware/auth.ts).
  type?: 'mfa_pending' | 'otp_pending';
  // The signed-in device this token belongs to (AuthToken.sessionId). Absent
  // on tokens minted before per-device sessions existed.
  sid?: string;
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