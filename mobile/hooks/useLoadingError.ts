import { useState, useCallback } from "react";

type LoadingErrorState = {
  loading: boolean;
  error: string | null;
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
  clearError: () => void;
};

/**
 * useLoadingError
 *
 * A lightweight hook that wraps async operations with consistent
 * loading and error state. Use it on any screen that makes API calls.
 *
 * Usage:
 *   const { loading, error, run, clearError } = useLoadingError();
 *
 *   const handleSubmit = () => run(async () => {
 *     const result = await someApiCall();
 *     router.push("/next-screen");
 *   });
 */
export function useLoadingError(): LoadingErrorState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      return result;
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { loading, error, run, clearError };
}