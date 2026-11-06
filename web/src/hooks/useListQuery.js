import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { usePolling } from './usePolling';

const listCache = new Map();
const detailCache = new Map();

const DEFAULT_META = { page: 1, total: 0, totalPages: 1, hasPrev: false, hasNext: false };

export function useListQuery(
  fetchFn,
  { initialParams = {}, deps = [], pollIntervalMs = null, pausePolling = false } = {}
) {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const syncUrl = Object.keys(initialParams).length > 0;
  const search = syncUrl ? searchParams.toString() : '';
  const params = useMemo(() => {
    const fromUrl = Object.fromEntries(new URLSearchParams(search));
    if (fromUrl.page) fromUrl.page = Number(fromUrl.page) || 1;
    return { ...initialParams, ...fromUrl };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const setParams = (updater) => {
    const next = updater(params);
    const kept = Object.entries(next).filter(
      ([key, value]) => value !== '' && value != null && String(value) !== String(initialParams[key] ?? '')
    );
    setSearchParams(new URLSearchParams(kept.map(([key, value]) => [key, String(value)])), { replace: true });
  };
  const cacheKey = `${pathname}?${JSON.stringify(params)}`;

  const cachedEntry = listCache.get(cacheKey);
  const [data, setDataState] = useState(cachedEntry?.data ?? []);
  const [meta, setMeta] = useState(cachedEntry?.meta ?? DEFAULT_META);
  const [loading, setLoading] = useState(!cachedEntry);
  const [error, setError] = useState(null);

  const load = useCallback(async (silent = false) => {
    const cached = listCache.get(cacheKey);
    if (cached) {
      setDataState(cached.data);
      if (cached.meta) setMeta(cached.meta);
    }

    const showSpinner = !silent && !cached;
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const result = await fetchFn(params);
      const nextData = result.data ?? result;
      setDataState(nextData);
      if (result.meta) setMeta(result.meta);
      listCache.set(cacheKey, { data: nextData, meta: result.meta });
    } catch (err) {
      if (!silent) {
        setError(err.message || 'Failed to load data');
        if (!cached) setDataState([]);
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [fetchFn, params, cacheKey]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  usePolling(() => load(true), pollIntervalMs || 0, { paused: !pollIntervalMs || pausePolling });

  const setSearch = (search) => setParams((prev) => ({ ...prev, search, page: 1 }));
  const setFilter = (key, value) =>
    setParams((prev) => ({ ...prev, ...(typeof key === 'object' ? key : { [key]: value }), page: 1 }));
  const goToPage = (page) => setParams((prev) => ({ ...prev, page }));
  const setSort = (sortBy, firstDir = 'asc') =>
    setParams((prev) => ({
      ...prev,
      sortBy,
      sortDir: prev.sortBy === sortBy ? (prev.sortDir === 'asc' ? 'desc' : 'asc') : firstDir,
      page: 1,
    }));

  const setData = useCallback(
    (updater) => {
      setDataState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        const cached = listCache.get(cacheKey);
        listCache.set(cacheKey, { data: next, meta: cached?.meta });
        return next;
      });
    },
    [cacheKey]
  );

  return {
    data,
    meta,
    params,
    loading,
    error,
    reload: load,
    setData,
    setSearch,
    setFilter,
    goToPage,
    setSort,
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
