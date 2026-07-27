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