import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePolling } from './usePolling';

// Module-level, in-memory, cleared on a full page reload. Keyed by route +
// params so navigating away and back shows the last-known data instantly
// instead of a blank spinner, while a fresh fetch quietly runs behind it
// (stale-while-revalidate) — every `load()` still hits the network, this
// only changes whether the UI blocks on that round-trip.
const listCache = new Map();
const detailCache = new Map();

const DEFAULT_META = { page: 1, total: 0, totalPages: 1, hasPrev: false, hasNext: false };

export function useListQuery(fetchFn, { initialParams = {}, deps = [], pollIntervalMs = null } = {}) {
  const { pathname } = useLocation();
  const [params, setParams] = useState(initialParams);
  const cacheKey = `${pathname}?${JSON.stringify(params)}`;

  const cachedEntry = listCache.get(cacheKey);
  const [data, setData] = useState(cachedEntry?.data ?? []);
  const [meta, setMeta] = useState(cachedEntry?.meta ?? DEFAULT_META);
  const [loading, setLoading] = useState(!cachedEntry);
  const [error, setError] = useState(null);

  // `silent` skips the loading flag so a background poll refresh doesn't
  // flash the loading state over an already-rendered table. Cached data (if
  // any, for the current cacheKey) shows immediately either way.
  const load = useCallback(async (silent = false) => {
    const cached = listCache.get(cacheKey);
    if (cached) {
      setData(cached.data);
      if (cached.meta) setMeta(cached.meta);
    }

    const showSpinner = !silent && !cached;
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const result = await fetchFn(params);
      const nextData = result.data ?? result;
      setData(nextData);
      if (result.meta) setMeta(result.meta);
      listCache.set(cacheKey, { data: nextData, meta: result.meta });
    } catch (err) {
      if (!silent) {
        setError(err.message || 'Failed to load data');
        if (!cached) setData([]);
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [fetchFn, params, cacheKey]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  usePolling(() => load(true), pollIntervalMs || 0, { paused: !pollIntervalMs });

  const setSearch = (search) => setParams((prev) => ({ ...prev, search, page: 1 }));
  const setFilter = (key, value) => setParams((prev) => ({ ...prev, [key]: value, page: 1 }));
  const goToPage = (page) => setParams((prev) => ({ ...prev, page }));

  return {
    data,
    meta,
    params,
    loading,
    error,
    reload: load,
    setSearch,
    setFilter,
    goToPage,
  };
}

export function useDetailQuery(fetchFn, id) {
  const { pathname } = useLocation();
  const cacheKey = `${pathname}:${id}`;

  const cachedEntry = detailCache.get(cacheKey);
  const [data, setData] = useState(cachedEntry ?? null);
  const [loading, setLoading] = useState(!cachedEntry);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (silent = false) => {
      if (!id) return;
      const cached = detailCache.get(cacheKey);
      if (cached) setData(cached);

      const showSpinner = !silent && !cached;
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const result = await fetchFn(id);
        setData(result);
        detailCache.set(cacheKey, result);
      } catch (err) {
        if (!silent) {
          setError(err.message || 'Failed to load details');
          if (!cached) setData(null);
        }
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [fetchFn, id, cacheKey]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, loading, error, reload: load };
}
