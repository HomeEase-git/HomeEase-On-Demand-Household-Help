import { useEffect, useRef, useState } from 'react';
import { discoverWorkers, type DiscoverWorkersFilters } from '../services/api';
import type { TimeSlot, WorkerCard } from '../types/booking4step.types';
import { TIME_SLOTS } from '../types/booking4step.types';

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
 * list. Only fires once `serviceType`, `date`, and `timeSlot` are all set
 * (the backend needs all three to filter to genuinely available workers).
 */
export function useWorkerDiscovery(filters: DiscoverWorkersFilters, enabled: boolean): UseWorkerDiscoveryResult {
  const [workers, setWorkers] = useState<WorkerCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
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

export type SlotCounts = Partial<Record<TimeSlot, number>>;

/**
 * Fires one lightweight (limit=1, we only need pagination.total) discovery
 * call per TimeSlot so Step 2 can show "3 pros available" badges on each
 * slot button before the user commits to one.
 */
export function useSlotAvailabilityCounts(
  baseFilters: Omit<DiscoverWorkersFilters, 'timeSlot' | 'limit'>,
  enabled: boolean
): { counts: SlotCounts; loading: boolean } {
  const [counts, setCounts] = useState<SlotCounts>({});
  const [loading, setLoading] = useState(false);
  const key = filtersKey(baseFilters);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const thisRequest = ++requestId.current;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await Promise.all(
          TIME_SLOTS.map(async (slot) => {
            try {
              const result = await discoverWorkers({ ...baseFilters, timeSlot: slot, limit: 1 });
              return [slot, result.pagination.total] as const;
            } catch {
              return [slot, 0] as const;
            }
          })
        );
        if (cancelled || requestId.current !== thisRequest) return;
        setCounts(Object.fromEntries(results));
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

  return { counts: enabled ? counts : {}, loading: enabled && loading };
}
