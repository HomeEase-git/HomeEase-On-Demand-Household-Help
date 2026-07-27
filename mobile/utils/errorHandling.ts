/**
 * Comprehensive Error Handling & Logging
 * 
 * Handles:
 * - API error normalization
 * - Network error detection
 * - User-friendly error messages
 * - Error logging and reporting
 * - Retry strategies
 */

import axios from 'axios';

export type ApiErrorType = 'network' | 'validation' | 'server' | 'timeout' | 'unknown' | 'auth';

export type ApiError = {
  type: ApiErrorType;
  message: string;
  statusCode?: number;
  originalError?: Error;
  isRetryable: boolean;
  userMessage: string;
};

const API_ERROR_TYPES: ApiErrorType[] = [
  'network',
  'validation',
  'server',
  'timeout',
  'unknown',
  'auth',
];

/**
 * Normalize any error into a standard ApiError format
 */
export function normalizeError(error: unknown): ApiError {
  if (isNormalizedApiError(error)) {
    return error;
  }

  // Handle specific error types
  if (error instanceof NetworkError) {
    return {
      type: 'network',
      message: 'Network connection failed',
      userMessage: 'Unable to connect. Please check your internet connection.',
      isRetryable: true,
    };
  }

  if (error instanceof TimeoutError) {
    return {
      type: 'timeout',
      message: 'Request timeout',
      userMessage: 'The request took too long. Please try again.',
      isRetryable: true,
    };
  }

  if (error instanceof AuthenticationError) {
    return {
      type: 'auth',
      message: 'Authentication failed',
      userMessage: 'Your session has expired. Please log in again.',
      isRetryable: false,
    };
  }

  if (error instanceof ValidationError) {
    return {
      type: 'validation',
      message: error.message,
      userMessage: error.message || 'Please check your input and try again.',
      isRetryable: false,
    };
  }

  // Handle API error responses
  if (isApiErrorResponse(error)) {
    const statusCode = error.status;

    if (statusCode === 401 || statusCode === 403) {
      return {
        type: 'auth',
        message: error.message,
        statusCode,
        userMessage: 'You are not authorized to perform this action.',
        isRetryable: false,
      };
    }

    if (statusCode >= 500) {
      return {
        type: 'server',
        message: error.message,
        statusCode,
        userMessage: 'Something went wrong on our side. Please try again later.',
        isRetryable: true,
      };
    }

    if (statusCode >= 400) {
      return {
        type: 'validation',
        message: error.message,
        statusCode,
        userMessage: error.message || 'Please check your input and try again.',
        isRetryable: false,
      };
    }
  }

  // Handle axios errors so retry logic can see axios-specific details
  try {
    if (axios.isAxiosError(error)) {
      const axiosErr: any = error;

      // No response -> network or timeout
      if (!axiosErr.response) {
        // Axios uses ECONNABORTED for timeout and ERR_CANCELED for AbortController cancellation
        if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ERR_CANCELED') {
          return {
            type: 'timeout',
            message: axiosErr.message || 'Request timeout',
            originalError: axiosErr,
            userMessage: 'The request took too long. Please try again.',
            isRetryable: true,
          };
        }

        return {
          type: 'network',
          message: axiosErr.message || 'Network error',
          originalError: axiosErr,
          userMessage: 'Unable to connect. Please check your internet connection.',
          isRetryable: true,
        };
      }

      const statusCode = axiosErr.response?.status;
      const respMessage = axiosErr.response?.data?.message || axiosErr.message || 'API error';

      if (statusCode === 401 || statusCode === 403) {
        return {
          type: 'auth',
          message: respMessage,
          statusCode,
          originalError: axiosErr,
          userMessage: 'You are not authorized to perform this action.',
          isRetryable: false,
        };
      }

      if (statusCode >= 500) {
        return {
          type: 'server',
          message: respMessage,
          statusCode,
          originalError: axiosErr,
          userMessage: 'Something went wrong on our side. Please try again later.',
          isRetryable: true,
        };
      }

      if (statusCode >= 400) {
        return {
          type: 'validation',
          message: respMessage,
          statusCode,
          originalError: axiosErr,
          userMessage: respMessage,
          isRetryable: false,
        };
      }

      // Fallback for other statuses
      return {
        type: 'unknown',
        message: respMessage,
        statusCode,
        originalError: axiosErr,
        userMessage: respMessage,
        isRetryable: false,
      };
    }
  } catch (_) {
    // ignore any errors while trying to classify axios errors
  }

  // Handle Error instances
  if (error instanceof Error) {
    return {
      type: 'unknown',
      message: error.message,
      originalError: error,
      userMessage: 'An unexpected error occurred. Please try again.',
      isRetryable: false,
    };
  }

  // Handle string errors
  if (typeof error === 'string') {
    return {
      type: 'unknown',
      message: error,
      userMessage: error,
      isRetryable: false,
    };
  }

  // Default fallback
  return {
    type: 'unknown',
    message: 'An unknown error occurred',
    userMessage: 'An unexpected error occurred. Please try again.',
    isRetryable: false,
  };
}

/**
 * Custom error classes
 */

export class NetworkError extends Error {
  constructor(message: string = 'Network error') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string = 'Request timeout') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends Error {
  public fields: Record<string, string>;

  constructor(message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

/**
 * Type guards
 */

export interface ApiErrorResponse {
  status: number;
  message: string;
  code?: string;
}

export function isApiErrorResponse(error: unknown): error is ApiErrorResponse {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as Partial<ApiErrorResponse>;
  return (
    typeof candidate.status === 'number' &&
    (typeof candidate.message === 'string' || typeof candidate.message === 'undefined')
  );
}

export function isNormalizedApiError(error: unknown): error is ApiError {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as Partial<ApiError>;
  return (
    typeof candidate.type === 'string' &&
    API_ERROR_TYPES.includes(candidate.type as ApiErrorType) &&
    typeof candidate.message === 'string' &&
    typeof candidate.userMessage === 'string' &&
    typeof candidate.isRetryable === 'boolean'
  );
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * Error logging utilities
 */

export type ErrorLog = {
  timestamp: number;
  type: ApiErrorType;
  message: string;
  statusCode?: number;
  context?: Record<string, any>;
  stack?: string;
};

class ErrorLogger {
  private logs: ErrorLog[] = [];
  private maxLogs = 100;

  log(error: ApiError, context?: Record<string, any>): void {
    const log: ErrorLog = {
      timestamp: Date.now(),
      type: error.type,
      message: error.message,
      statusCode: error.statusCode,
      context,
      stack: error.originalError?.stack,
    };

    this.logs.push(log);

    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Log to console in development
    if (__DEV__) {
      console.error(
        `[Error] ${error.type.toUpperCase()}: ${error.message}`,
        context
      );
    }

    // Could send to Sentry or other error reporting service
    // this.reportToErrorService(log);
  }

  getLogs(): ErrorLog[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const errorLogger = new ErrorLogger();

/**
 * Error boundary utilities
 */

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack: string } | null;
}

export function captureErrorBoundary(error: Error, errorInfo: any): ErrorBoundaryState {
  return {
    hasError: true,
    error,
    errorInfo,
  };
}

/**
 * Retry strategy helper
 */

export type RetryOptions = {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: ApiError) => boolean;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 10000,
    backoffMultiplier = 2,
    shouldRetry = (error) => error.isRetryable,
  } = options;

  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = normalizeError(error);

      // Don't retry if not retryable or if we've exhausted retries
      if (!shouldRetry(lastError) || attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );

      console.warn(
        `[Retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms...`,
        lastError.message
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed');
}

/**
 * Global error handler
 */

export function setupGlobalErrorHandler(): void {
  // Handle unhandled promise rejections
  if (typeof global !== 'undefined') {
    const originalWarn = console.warn;
    global.console.warn = (...args: any[]) => {
      if (
        args[0]?.includes?.('Non-serializable values were found')
      ) {
        // Suppress Redux non-serializable warnings
        return;
      }
      originalWarn.apply(console, args);
    };
  }

  console.log('[ErrorHandler] Global error handler initialized');
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: ApiError): string {
  // Prefer user message, fall back to general message
  return error.userMessage || error.message || 'An error occurred. Please try again.';
}
