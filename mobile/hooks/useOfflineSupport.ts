import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { offlineSyncManager, SyncQueueState } from '../services/offline-sync';

type CachedOfflineData<T> = {
  data: T;
  timestamp: number;
};

function parseCachedOfflineData<T>(cached: string): CachedOfflineData<T> | null {
  const parsed: unknown = JSON.parse(cached);

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as Partial<CachedOfflineData<T>>;
  if (typeof candidate.timestamp !== 'number' || !('data' in candidate)) {
    return null;
  }

  return {
    data: candidate.data as T,
    timestamp: candidate.timestamp,
  };
}

/**
 * useOnlineStatus
 * 
 * Hook to detect and track network connectivity status.
 * Returns current online status and connection type.
 * 
 * Usage:
 *   const { isOnline, connectionType } = useOnlineStatus();
 *   
 *   return (
 *     <View>
 *       {!isOnline && <OfflineBanner />}
 *     </View>
 *   );
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [connectionType, setConnectionType] = useState<string>('unknown');

  useEffect(() => {
    // Check initial status
    const checkStatus = async () => {
      try {
        const state = await NetInfo.fetch();
        setIsOnline(state.isConnected ?? true);
        setConnectionType(state.type);
      } catch (error) {
        console.error('Failed to check network status:', error);
        setIsOnline(true); // Assume online on error
      }
    };

    checkStatus();

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? true;
      setIsOnline(connected);
      setConnectionType(state.type);

      console.log(
        `[Network] ${connected ? '🟢 Online' : '🔴 Offline'} (${state.type})`
      );

      // Trigger sync when going online
      if (connected) {
        handleNetworkRestored();
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return { isOnline, connectionType };
}

/**
 * useSyncQueue
 * 
 * Hook to manage offline sync queue state and operations.
 * Tracks pending requests and sync progress.
 * 
 * Usage:
 *   const { queue, syncing, syncNow } = useSyncQueue();
 *   
 *   return (
 *     <View>
 *       <Text>{queue.length} pending requests</Text>
 *       {syncing && <ActivityIndicator />}
 *     </View>
 *   );
 */
export function useSyncQueue() {
  const [queueState, setQueueState] = useState<SyncQueueState>(
    offlineSyncManager.getQueueState()
  );
  const [syncing, setSyncing] = useState(false);

  const updateQueueState = useCallback(() => {
    setQueueState(offlineSyncManager.getQueueState());
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      // This would be called with actual API implementation
      // For now, just update state
      await new Promise((resolve) => setTimeout(resolve, 500));
      updateQueueState();
    } finally {
      setSyncing(false);
    }
  }, [updateQueueState]);

  return {
    queue: queueState.items,
    queueSize: queueState.items.length,
    syncing: syncing || queueState.isSyncing,
    syncedCount: queueState.syncedCount,
    failedCount: queueState.failedCount,
    lastSyncTime: queueState.lastSyncTime,
    syncNow,
    updateQueueState,
  };
}

/**
 * useOfflineData
 * 
 * Hook to manage offline data reading and caching.
 * Transparently falls back to cached data when offline.
 * 
 * Usage:
 *   const { data, isFromCache } = useOfflineData(async () => {
 *     return await api.getBookings();
 *   });
 */
export function useOfflineData<T>(
  fetchFn: () => Promise<T>,
  cacheKey: string,
  options: { ttlSeconds?: number } = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isOnline } = useOnlineStatus();

  const ttlSeconds = options.ttlSeconds || 3600; // 1 hour default

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (isOnline) {
        // Online: fetch fresh data
        const result = await fetchFn();
        setData(result);
        setIsFromCache(false);

        // Cache the result
        const cacheData = {
          data: result,
          timestamp: Date.now(),
        };
        await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheData));

        console.log(`[OfflineData] ✓ Fresh data: ${cacheKey}`);
      } else {
        // Offline: try to use cached data
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsedCache = parseCachedOfflineData<T>(cached);

            if (!parsedCache) {
              setError('Cached data is invalid');
              console.warn(`[OfflineData] Invalid cache: ${cacheKey}`);
              return;
            }

            const { data: cachedData, timestamp } = parsedCache;
            const isExpired = Date.now() - timestamp > ttlSeconds * 1000;

            if (!isExpired) {
              setData(cachedData);
              setIsFromCache(true);
              console.log(`[OfflineData] ✓ Cache hit: ${cacheKey}`);
            } else {
              setError('Cached data is stale');
              console.warn(`[OfflineData] Cache expired: ${cacheKey}`);
            }
          } catch (parseError) {
            setError('Failed to parse cached data');
            console.error('[OfflineData] Parse error:', parseError);
          }
        } else {
          setError('No cached data available while offline');
          console.warn(`[OfflineData] No cache: ${cacheKey}`);
        }
      }
    } catch (err) {
      if (isOnline) {
        setError(err instanceof Error ? err.message : 'Network error');
        console.error('[OfflineData] Fetch error:', err);
      } else {
        // If we fail while online and have cache, use it
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsedCache = parseCachedOfflineData<T>(cached);

            if (parsedCache) {
              setData(parsedCache.data);
              setIsFromCache(true);
              console.log('[OfflineData] Fallback to cache after network error');
            } else {
              setError('Network error and cached data is invalid');
            }
          } catch {
            setError('Network error and no cache available');
          }
        } else {
          setError('Network error and no cache available');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [fetchFn, cacheKey, isOnline, ttlSeconds]);

  useEffect(() => {
    fetchData();
  }, [fetchData, isOnline]);

  return {
    data,
    loading,
    error,
    isFromCache,
    refetch: fetchData,
  };
}

/**
 * Network state change handler
 * Exported for use in app initialization
 */
export async function handleNetworkRestored(): Promise<void> {
  console.log('[Network] Connection restored, attempting sync...');
  // Would be called from app-level connection listener
  // Actual sync implementation depends on API service integration
}

/**
 * Initialize offline support on app start
 * Call this in your root component or app.ts
 */
export function initializeOfflineSupport(): void {
  // Initialize sync manager
  offlineSyncManager.initialize().catch((err) => {
    console.error('[OfflineSupport] Failed to initialize sync manager:', err);
  });

  console.log('[OfflineSupport] Initialized');
}
