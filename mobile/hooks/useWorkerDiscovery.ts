import { useEffect, useRef, useState } from 'react';
import { discoverWorkers, type DiscoverWorkersFilters } from '../services/api';
import type { WorkerCard } from '../types/booking4step.types';

const DEBOUNCE_MS = 350;

export interface UseWorkerDiscoveryResult {
  workers: WorkerCard[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function filtersKey(filters: DiscoverWorkersFilters): string {
  return JSON.stringify(filters, Object.keys(filters).sort());
}

/**
 * Debounced GET /workers — used by Step 3 (WHO) for the full worker-card
 * list. Only fires once `serviceType` and `date` are set (the backend needs
 * both to filter to workers who work that day).
 */
export function useWorkerDiscovery(filters: DiscoverWorkersFilters, enabled: boolean): UseWorkerDiscoveryResult {
  const [workers, setWorkers] = useState<WorkerCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true); // true: the first fetch is debounced, so "empty" isn't known yet
  const [error, setError] = useState<string | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);
  const key = filtersKey(filters);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      // Loading/error flip inside this deferred callback rather than
      // synchronously in the effect body, per react-hooks/set-state-in-effect.
      setLoading(true);
      setError(null);
      try {
        const result = await discoverWorkers(filters);
        if (cancelled) return;
        setWorkers(result.workers);
        setTotal(result.pagination.total);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load available pros.');
        setWorkers([]);
        setTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, refetchToken]);

  // Derived instead of reset-via-effect when disabled.
  return {
    workers: enabled ? workers : [],
    total: enabled ? total : 0,
    loading: enabled && loading,
    error: enabled ? error : null,
    refetch: () => setRefetchToken((t) => t + 1),
  };
}

/**
 * One lightweight (limit=1, we only need pagination.total) discovery call so
 * Step 2 can show "3 pros available" for the picked date. Workers take any
 * number of jobs a day, so the start time doesn't change the count.
 */
export function useDateAvailabilityCount(
  baseFilters: Omit<DiscoverWorkersFilters, 'limit'>,
  enabled: boolean
): { count: number | null; loading: boolean } {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true); // true: the first fetch is debounced, so "empty" isn't known yet
  const key = filtersKey(baseFilters);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const thisRequest = ++requestId.current;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await discoverWorkers({ ...baseFilters, limit: 1 });
        if (cancelled || requestId.current !== thisRequest) return;
        setCount(result.pagination.total);
      } catch {
        if (!cancelled && requestId.current === thisRequest) setCount(null); // unknown, not "no pros"
      } finally {
        if (!cancelled && requestId.current === thisRequest) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { count: enabled ? count : null, loading: enabled && loading };
}
