import { useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { 
  postLogin, 
  postSignUp, 
  sendPasswordResetEmail, 
  verifyOtp,
  sendOtpEmail 
} from '../services/api';
import { normalizeError } from '../utils/apiErrors';

export function useAuth() {
  const store = useAuthStore();

  const login = useCallback(async (email: string, password: string) => {
    store.setLoading(true);
    store.setError(null);
    
    try {
      const response = await postLogin(email, password);

      store.setUser({
        id: response.id,
        name: response.name,
        email: response.email,
        role: response.role,
        kycStatus: response.kycStatus,
      });
      store.setToken(response.token);
      
      return { success: true, data: response };
    } catch (err) {
      const error = normalizeError(err);
      store.setError(error.message);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  const signup = useCallback(async (userData: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    role: 'client' | 'worker';
  }) => {
    store.setLoading(true);
    store.setError(null);
    
    try {
      const response = await postSignUp(userData);
      
      store.setUser({
        id: response.id,
        name: response.name,
        email: response.email,
        phone: response.phone,
        role: response.role,
        kycStatus: response.kycStatus,
      });
      store.setToken(response.token);

      // Send OTP email for clients
      // if (response.role === 'client') {
      //   await sendOtpEmail(userData.email);
      // }
      
      return { success: true, data: response };
    } catch (err) {
      const error = normalizeError(err);
      store.setError(error.message);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  const forgotPassword = useCallback(async (email: string) => {
    store.setLoading(true);
    store.setError(null);
    
    try {
      const response = await sendPasswordResetEmail(email);
      return { success: true, data: response };
    } catch (err) {
      const error = normalizeError(err);
      store.setError(error.message);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  const verifyEmailOtp = useCallback(async (email: string, otp: string) => {
    store.setLoading(true);
    store.setError(null);
    
    try {
      const response = await verifyOtp(email, otp);
      
      if (response.success && response.token) {
        store.setToken(response.token);
      }
      
      return { success: true, data: response };
    } catch (err) {
      const error = normalizeError(err);
      store.setError(error.message);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  const resendOtp = useCallback(async (email: string) => {
    store.setLoading(true);
    store.setError(null);
    
    try {
      const response = await sendOtpEmail(email);
      return { success: true, data: response };
    } catch (err) {
      const error = normalizeError(err);
      store.setError(error.message);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  const logout = useCallback(() => {
    store.logout();
    store.clearError();
  }, [store]);

  const clearError = useCallback(() => {
    store.clearError();
  }, [store]);

  return {
    // State
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    loading: store.loading,
    error: store.error,
    token: store.token,
    
    // Methods
    login,
    signup,
    forgotPassword,
    verifyEmailOtp,
    resendOtp,
    logout,
    clearError,
  };
}
