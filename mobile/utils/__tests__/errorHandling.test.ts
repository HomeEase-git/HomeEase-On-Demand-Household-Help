/**
 * Error Handling Integration Tests
 */

import {
  normalizeError,
  NetworkError,
  TimeoutError,
  AuthenticationError,
  ValidationError,
  errorLogger,
  withRetry,
} from '../errorHandling';

describe('Error Handling System', () => {
  beforeEach(() => {
    errorLogger.clearLogs();
  });

  describe('Error Normalization', () => {
    test('normalizes NetworkError', () => {
      const error = new NetworkError('Connection failed');
      const result = normalizeError(error);

      expect(result.type).toBe('network');
      expect(result.isRetryable).toBe(true);
      expect(result.userMessage).toContain('internet');
    });

    test('normalizes TimeoutError', () => {
      const error = new TimeoutError('Request took too long');
      const result = normalizeError(error);

      expect(result.type).toBe('timeout');
      expect(result.isRetryable).toBe(true);
    });

    test('normalizes AuthenticationError', () => {
      const error = new AuthenticationError('Invalid token');
      const result = normalizeError(error);

      expect(result.type).toBe('auth');
      expect(result.isRetryable).toBe(false);
    });

    test('normalizes ValidationError', () => {
      const error = new ValidationError('Invalid input', {
        email: 'Invalid email',
        password: 'Too short',
      });
      const result = normalizeError(error);

      expect(result.type).toBe('validation');
      expect(result.message).toContain('Invalid input');
      expect(result.isRetryable).toBe(false);
    });

    test('preserves already-normalized API errors', () => {
      const error = {
        type: 'server' as const,
        message: 'Service unavailable',
        userMessage: 'Please try again later.',
        isRetryable: true,
        statusCode: 503,
      };

      const result = normalizeError(error);

      expect(result).toBe(error);
    });

    test('normalizes plain Error objects', () => {
      const error = new Error('Something went wrong');
      const result = normalizeError(error);

      expect(result.type).toBe('unknown');
      expect(result.message).toBe('Something went wrong');
    });

    test('normalizes string errors', () => {
      const result = normalizeError('An error occurred');

      expect(result.type).toBe('unknown');
      expect(result.message).toBe('An error occurred');
    });
  });

  describe('Error Logging', () => {
    test('logs errors with context', () => {
      const error = {
        type: 'network' as const,
        message: 'Connection failed',
        userMessage: 'Check internet',
        isRetryable: true,
      };

      errorLogger.log(error, { endpoint: '/api/users' });

      const logs = errorLogger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].context?.endpoint).toBe('/api/users');
    });

    test('limits log storage', () => {
      // Log more than max logs
      for (let i = 0; i < 150; i++) {
        const error = {
          type: 'unknown' as const,
          message: `Error ${i}`,
          userMessage: 'Error',
          isRetryable: false,
        };
        errorLogger.log(error);
      }

      const logs = errorLogger.getLogs();
      expect(logs.length).toBeLessThanOrEqual(100);
    });

    test('exports logs as JSON', () => {
      const error = {
        type: 'network' as const,
        message: 'Connection failed',
        userMessage: 'Check internet',
        isRetryable: true,
      };

      errorLogger.log(error);
      const exported = errorLogger.exportLogs();

      expect(typeof exported).toBe('string');
      expect(JSON.parse(exported)).toHaveLength(1);
    });

    test('clears logs', () => {
      const error = {
        type: 'unknown' as const,
        message: 'Error',
        userMessage: 'Error',
        isRetryable: false,
      };

      errorLogger.log(error);
      errorLogger.clearLogs();

      expect(errorLogger.getLogs()).toHaveLength(0);
    });
  });

  describe('Retry Strategy', () => {
    test('retries failed operations', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new NetworkError('Failed');
        }
        return 'success';
      });

      const result = await withRetry(fn, { maxRetries: 3 });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    test('respects maxRetries', async () => {
      const fn = jest.fn(async () => {
        throw new NetworkError('Failed');
      });

      await expect(withRetry(fn, { maxRetries: 2 })).rejects.toMatchObject({
        type: 'network',
        isRetryable: true,
      });
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    test('stops retrying non-retryable errors', async () => {
      const fn = jest.fn(async () => {
        throw new AuthenticationError('Failed');
      });

      await expect(withRetry(fn, { maxRetries: 5 })).rejects.toMatchObject({
        type: 'auth',
        isRetryable: false,
      });
      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });

    test('applies exponential backoff', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new NetworkError('Failed');
        }
        return 'success';
      });

      const result = await withRetry(fn, {
        maxRetries: 1,
        initialDelay: 1,
        backoffMultiplier: 2,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Axios-specific normalization', () => {
  test('classifies axios timeout (ECONNABORTED) as timeout and retryable', () => {
    const axiosLikeError = {
      isAxiosError: true,
      code: 'ECONNABORTED',
      message: 'timeout',
      response: undefined,
    } as unknown;

    const result = normalizeError(axiosLikeError);
    expect(result.type).toBe('timeout');
    expect(result.isRetryable).toBe(true);
  });

  test('classifies axios cancelled (ERR_CANCELED) as timeout and retryable', () => {
    const axiosLikeError = {
      isAxiosError: true,
      code: 'ERR_CANCELED',
      message: 'canceled',
      response: undefined,
    } as unknown;

    const result = normalizeError(axiosLikeError);
    expect(result.type).toBe('timeout');
    expect(result.isRetryable).toBe(true);
  });

  test('classifies axios 500 as server and retryable', () => {
    const axiosLikeError = {
      isAxiosError: true,
      message: 'server error',
      response: { status: 502, data: { message: 'Bad gateway' } },
    } as unknown;

    const result = normalizeError(axiosLikeError);
    expect(result.type).toBe('server');
    expect(result.statusCode).toBe(502);
    expect(result.isRetryable).toBe(true);
  });

  test('classifies axios 401 as auth and not retryable', () => {
    const axiosLikeError = {
      isAxiosError: true,
      message: 'unauthorized',
      response: { status: 401, data: { message: 'Unauthorized' } },
    } as unknown;

    const result = normalizeError(axiosLikeError);
    expect(result.type).toBe('auth');
    expect(result.isRetryable).toBe(false);
  });
});
