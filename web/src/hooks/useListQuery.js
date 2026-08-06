import { useCallback, useEffect, useState } from 'react';
import { usePolling } from './usePolling';

export function useListQuery(fetchFn, { initialParams = {}, deps = [], pollIntervalMs = null } = {}) {
  const [params, setParams] = useState(initialParams);
  const [data, setData] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0, totalPages: 1, hasPrev: false, hasNext: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // `silent` skips the loading flag so a background poll refresh doesn't
  // flash the loading state over an already-rendered table.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await fetchFn(params);
      setData(result.data ?? result);
      if (result.meta) setMeta(result.meta);
    } catch (err) {
      if (!silent) {
        setError(err.message || 'Failed to load data');
        setData([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fetchFn, params]);

  useEffect(() => {
    load();
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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn(id);
      setData(result);
    } catch (err) {
      setError(err.message || 'Failed to load details');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fetchFn, id]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
