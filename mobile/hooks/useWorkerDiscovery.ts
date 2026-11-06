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

export function useWorkerDiscovery(filters: DiscoverWorkersFilters, enabled: boolean): UseWorkerDiscoveryResult {
  const [workers, setWorkers] = useState<WorkerCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);
  const key = filtersKey(filters);
  const [settledKey, setSettledKey] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await discoverWorkers(filters);
        if (cancelled) return;
        setWorkers(result.workers);
        setTotal(result.pagination.total);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load available workers.');
        setWorkers([]);
        setTotal(0);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSettledKey(key);
        }
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
    loading: enabled && (loading || settledKey !== key),
    error: enabled ? error : null,
    refetch: () => setRefetchToken((t) => t + 1),
  };
}

export function useDateAvailabilityCount(
  baseFilters: Omit<DiscoverWorkersFilters, 'limit'>,
  enabled: boolean
): { count: number | null; loading: boolean } {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const key = filtersKey(baseFilters);
  const [settledKey, setSettledKey] = useState<string | null>(null);
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
        if (!cancelled && requestId.current === thisRequest) setCount(null); // unknown, not "no workers"
      } finally {
        if (!cancelled && requestId.current === thisRequest) {
          setLoading(false);
          setSettledKey(key);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const settled = settledKey === key;
  return { count: enabled && settled ? count : null, loading: enabled && (loading || !settled) };
}
