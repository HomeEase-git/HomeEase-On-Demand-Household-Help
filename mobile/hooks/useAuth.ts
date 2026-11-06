import { useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import {
  postLogin,
  postMfaChallenge,
  postLoginCode,
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

      if ('mfaRequired' in response && response.mfaRequired) {
        return { success: true, data: response };
      }
      if ('twoFactorRequired' in response && response.twoFactorRequired) {
        return { success: true, data: response };
      }

      store.setUser({
        id: response.id,
        name: response.name,
        email: response.email,
        phone: response.phone ?? undefined,
        role: response.role,
        avatar: response.avatar,
        kycStatus: response.kycStatus,
        hasAcceptedTerms: response.hasAcceptedTerms,
      });
      store.setToken(response.token, response.refreshToken);

      return { success: true, data: response };
    } catch (err) {
      const error = normalizeError(err);
      store.setError(error.message);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  const completeMfaChallenge = useCallback(async (challengeToken: string, code: string) => {
    store.setLoading(true);
    store.setError(null);

    try {
      const response = await postMfaChallenge(challengeToken, code);

      store.setUser({
        id: response.id,
        name: response.name,
        email: response.email,
        phone: response.phone ?? undefined,
        role: response.role,
        avatar: response.avatar,
        kycStatus: response.kycStatus,
        hasAcceptedTerms: response.hasAcceptedTerms,
      });
      store.setToken(response.token, response.refreshToken);

      return { success: true, data: response };
    } catch (err) {
      const error = normalizeError(err);
      store.setError(error.message);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // Second step of an email/SMS two-step sign-in.
  const completeLoginCode = useCallback(async (challengeToken: string, code: string) => {
    store.setLoading(true);
    store.setError(null);

    try {
      const response = await postLoginCode(challengeToken, code);

      store.setUser({
        id: response.id,
        name: response.name,
        email: response.email,
        phone: response.phone ?? undefined,
        role: response.role,
        avatar: response.avatar,
        kycStatus: response.kycStatus,
        hasAcceptedTerms: response.hasAcceptedTerms,
      });
      store.setToken(response.token, response.refreshToken);

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
    birthDate?: string;
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
        avatar: response.avatar,
        kycStatus: response.kycStatus,
        hasAcceptedTerms: response.hasAcceptedTerms,
      });
      store.setToken(response.token, response.refreshToken);

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
    completeMfaChallenge,
    completeLoginCode,
    signup,
    forgotPassword,
    verifyEmailOtp,
    resendOtp,
    logout,
    clearError,
  };
}
