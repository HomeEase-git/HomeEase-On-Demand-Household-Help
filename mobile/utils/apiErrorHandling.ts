/**
 * API Error Handling & Recovery Utilities
 * 
 * Enhanced error handling for API calls with recovery strategies
 */

import { useCallback, useState } from 'react';
import axios from 'axios';
import { 
  normalizeError, 
  withRetry, 
  errorLogger, 
  type ApiError,
  type RetryOptions,
  TimeoutError,
} from './errorHandling';

const getResponseMessage = (data: unknown, fallback: string): string => {
  if (!data || typeof data !== 'object') {
    return fallback;
  }

  const message = (data as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : fallback;
};

/**
 * Classify axios errors into standard API errors
 */
export function classifyAxiosError(error: unknown): ApiError {
  // Delegate to the central normalizer so axios handling is consistent
  return normalizeError(error);
}

/**
 * Enhanced API error handler with logging
 */
export function handleApiError(error: unknown, context?: Record<string, any>) {
  const apiError = classifyAxiosError(error);
  errorLogger.log(apiError, context);
  return apiError;
}

/**
 * Safe API call wrapper with automatic error handling
 */
export async function safeApiCall<T>(
  fn: () => Promise<T>,
  options?: RetryOptions & { context?: Record<string, any> }
): Promise<{ data?: T; error?: ApiError }> {
  try {
    const data = await withRetry(fn, options);
    return { data };
  } catch (error) {
    const apiError = handleApiError(error, options?.context);
    return { error: apiError };
  }
}

export function useApiCall<T>(
  defaultRetryOptions?: RetryOptions
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const call = useCallback(
    async (
      fn: () => Promise<T>,
      options?: RetryOptions & { context?: Record<string, any> }
    ) => {
      setLoading(true);
      setError(null);
      try {
        const result = await withRetry(fn, {
          ...defaultRetryOptions,
          ...options,
        });
        setData(result);
        return result;
      } catch (err) {
        const apiError = handleApiError(err, options?.context);
        setError(apiError);
        throw apiError;
      } finally {
        setLoading(false);
      }
    },
    [defaultRetryOptions]
  );

  return { call, data, error, loading };
}

/**
 * Memory leak prevention utilities
 */

export class AbortableRequest {
  private abortController: AbortController | null = null;

  create(): AbortController {
    this.abortController = new AbortController();
    return this.abortController;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  cleanup(): void {
    this.abort();
  }
}

/**
 * API contract validation
 */

export interface ApiContract {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  expectedResponseKeys?: string[];
  requiredParams?: string[];
}

export function validateApiContract(
  response: any,
  contract: ApiContract
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!contract.expectedResponseKeys) {
    return { valid: true, errors };
  }

  if (!response || typeof response !== 'object') {
    errors.push('Response is not an object');
    return { valid: false, errors };
  }

  for (const key of contract.expectedResponseKeys) {
    if (!(key in response)) {
      errors.push(`Missing expected key: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Request timeout wrapper
 */

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 30000
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Batch error handling for multiple requests
 */

export interface BatchResult<T> {
  successes: T[];
  failures: { data?: T; error: ApiError }[];
}

export async function batchApiCalls<T>(
  calls: (() => Promise<T>)[],
  options?: RetryOptions
): Promise<BatchResult<T>> {
  const results = await Promise.allSettled(
    calls.map((call) => safeApiCall(call, options))
  );

  const successes: T[] = [];
  const failures: { data?: T; error: ApiError }[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.error) {
        failures.push({ error: result.value.error });
      } else {
        successes.push(result.value.data as T);
      }
    } else {
      failures.push({
        error: normalizeError(result.reason),
      });
    }
  }

  return { successes, failures };
}
