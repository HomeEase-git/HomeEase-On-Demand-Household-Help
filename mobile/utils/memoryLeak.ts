/**
 * Memory Leak Prevention & Resource Cleanup
 * 
 * Utilities to prevent common memory leaks in React Native
 */

import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Hook to safely manage subscriptions and cleanup
 */
export function useSubscription<T>(
  subscribe: (listener: (value: T) => void) => () => void
): T | undefined {
  const [state, setState] = useState<T | undefined>();
  
  useEffect(() => {
    const unsubscribe = subscribe((value) => {
      setState(value);
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  return state;
}

/**
 * Hook to prevent memory leaks from async operations
 */
export function useAsync<T>(
  asyncFn: () => Promise<T>,
  onSuccess?: (data: T) => void
) {
  const [state, setState] = useState<{
    loading: boolean;
    data?: T;
    error?: Error;
  }>({
    loading: true,
  });

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    asyncFn()
      .then((data) => {
        if (!cancelled && isMountedRef.current) {
          setState({ loading: false, data });
          onSuccess?.(data);
        }
      })
      .catch((error) => {
        if (!cancelled && isMountedRef.current) {
          setState({ loading: false, error });
        }
      });

    return () => {
      cancelled = true;
      isMountedRef.current = false;
    };
  }, [asyncFn, onSuccess]);

  return state;
}

/**
 * Hook to safely manage timers
 */
export function useTimeout(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;

    const timeoutId = setTimeout(() => {
      savedCallback.current();
    }, delay);

    return () => clearTimeout(timeoutId);
  }, [delay]);
}

/**
 * Hook to safely manage intervals
 */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;

    const id = setInterval(() => {
      savedCallback.current();
    }, delay);

    return () => clearInterval(id);
  }, [delay]);
}

/**
 * Hook to manage event listeners safely
 */
export function useEventListener<K extends keyof any>(
  eventName: K,
  handler: (event: any) => void,
  element: any = null
) {
  const savedHandler = useRef(handler);

  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    const target = element || (typeof window !== 'undefined' ? window : null);
    if (!target?.addEventListener) return;

    const eventListener = (event: any) => savedHandler.current(event);
    target.addEventListener(eventName as any, eventListener);

    return () => {
      target.removeEventListener(eventName as any, eventListener);
    };
  }, [eventName, element]);
}

/**
 * Resource cleanup manager
 */
export class ResourceCleanupManager {
  private cleanupFns: (() => void)[] = [];

  add(fn: () => void): void {
    this.cleanupFns.push(fn);
  }

  cleanup(): void {
    // Run in reverse order (LIFO - Last In First Out)
    for (let i = this.cleanupFns.length - 1; i >= 0; i--) {
      try {
        this.cleanupFns[i]();
      } catch (error) {
        console.error('[ResourceCleanup] Cleanup error:', error);
      }
    }
    this.cleanupFns = [];
  }

  size(): number {
    return this.cleanupFns.length;
  }
}

/**
 * Hook for resource cleanup
 */
export function useCleanup() {
  const managerRef = useRef(new ResourceCleanupManager());
  const cleanupManagerRef = managerRef.current;

  useEffect(() => {
    return () => {
      cleanupManagerRef.cleanup();
    };
  }, [cleanupManagerRef]);

  return managerRef.current;
}

/**
 * Prevent memory leaks from callbacks
 */
export function useSafeCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const savedCallbackRef = useRef<T | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    savedCallbackRef.current = callback;

    return () => {
      isMountedRef.current = false;
    };
  }, [callback]);

  return useCallback(
    (...args: any[]) => {
      if (isMountedRef.current && savedCallbackRef.current) {
        return savedCallbackRef.current(...args);
      }
    },
    []
  ) as T;
}

/**
 * Prevent memory leaks from subscriptions
 */
export class SafeSubscription<T> {
  private listeners: Set<(value: T) => void> = new Set();
  private unsubscribes: Set<() => void> = new Set();

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);

    const unsubscribe = () => {
      this.listeners.delete(listener);
    };

    this.unsubscribes.add(unsubscribe);
    return unsubscribe;
  }

  emit(value: T): void {
    this.listeners.forEach((listener) => {
      try {
        listener(value);
      } catch (error) {
        console.error('[SafeSubscription] Listener error:', error);
      }
    });
  }

  unsubscribeAll(): void {
    this.listeners.clear();
    this.unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.unsubscribes.clear();
  }

  size(): number {
    return this.listeners.size;
  }
}
