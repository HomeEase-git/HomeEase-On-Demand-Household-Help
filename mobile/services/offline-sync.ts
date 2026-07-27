import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Type definitions for sync queue management
 */

export type SyncQueueItem = {
  id: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  payload?: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
};

export type SyncQueueState = {
  items: SyncQueueItem[];
  isSyncing: boolean;
  lastSyncTime?: number;
  syncedCount: number;
  failedCount: number;
};

const SYNC_QUEUE_KEY = '@homeease_sync_queue';

const isSyncQueueItem = (value: unknown): value is SyncQueueItem => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<SyncQueueItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.endpoint === 'string' &&
    typeof item.method === 'string' &&
    typeof item.timestamp === 'number' &&
    typeof item.retryCount === 'number' &&
    typeof item.maxRetries === 'number'
  );
};

/**
 * OfflineSyncManager
 * 
 * Handles queueing failed requests and retrying them when network is restored.
 * Features:
 * - Queue management (add, remove, clear)
 * - Exponential backoff retry logic
 * - Conflict resolution (backend-wins strategy)
 * - Persistent queue storage
 */
class OfflineSyncManager {
  private queue: SyncQueueItem[] = [];
  private isSyncing = false;
  private syncState: SyncQueueState = {
    items: [],
    isSyncing: false,
    syncedCount: 0,
    failedCount: 0,
  };

  /**
   * Initialize sync manager - load persisted queue from storage
   */
  async initialize(): Promise<void> {
    try {
      const storedQueue = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
      if (storedQueue) {
        const parsedQueue: unknown = JSON.parse(storedQueue);
        this.queue = Array.isArray(parsedQueue)
          ? parsedQueue.filter(isSyncQueueItem)
          : [];
      }
      console.log(`[OfflineSync] Initialized with ${this.queue.length} pending requests`);
    } catch (error) {
      console.error('[OfflineSync] Failed to initialize:', error);
    }
  }

  /**
   * Add a failed request to the sync queue
   */
  async queueRequest(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    payload?: Record<string, unknown>,
    maxRetries: number = 3
  ): Promise<void> {
    const item: SyncQueueItem = {
      id: `${Date.now()}-${Math.random()}`,
      endpoint,
      method,
      payload,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries,
    };

    this.queue.push(item);
    await this.persistQueue();

    console.log(
      `[OfflineSync] Queued: ${method} ${endpoint} (${this.queue.length} total)`
    );
  }

  /**
   * Get current queue state
   */
  getQueueState(): SyncQueueState {
    return {
      items: [...this.queue],
      isSyncing: this.isSyncing,
      syncedCount: this.syncState.syncedCount,
      failedCount: this.syncState.failedCount,
    };
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get queue items
   */
  getQueueItems(): SyncQueueItem[] {
    return [...this.queue];
  }

  /**
   * Check if sync is in progress
   */
  isSyncInProgress(): boolean {
    return this.isSyncing;
  }

  /**
   * Persist queue to storage
   */
  private async persistQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error('[OfflineSync] Failed to persist queue:', error);
    }
  }

  /**
   * Sync the queue - retry all failed requests
   * 
   * Called when network is restored. Processes queue items in order
   * with exponential backoff retry logic.
   * 
   * @param onSync - Callback to execute actual API call
   * @returns Number of successfully synced items
   */
  async syncQueue(
    onSync: (item: SyncQueueItem) => Promise<boolean>
  ): Promise<number> {
    if (this.isSyncing || this.queue.length === 0) {
      return 0;
    }

    this.isSyncing = true;
    let syncedCount = 0;
    const failedItems: SyncQueueItem[] = [];

    console.log(`[OfflineSync] Starting sync of ${this.queue.length} items`);

    for (const item of this.queue) {
      const shouldRetry = item.retryCount < item.maxRetries;

      if (!shouldRetry) {
        failedItems.push(item);
        this.syncState.failedCount++;
        console.warn(
          `[OfflineSync] Max retries exceeded: ${item.method} ${item.endpoint}`
        );
        continue;
      }

      try {
        // Calculate exponential backoff delay
        const delayMs = this.getBackoffDelay(item.retryCount);
        await this.delay(delayMs);

        // Attempt sync
        const success = await onSync(item);

        if (success) {
          syncedCount++;
          this.syncState.syncedCount++;
          console.log(`[OfflineSync] ✓ Synced: ${item.method} ${item.endpoint}`);
        } else {
          item.retryCount++;
          item.lastError = 'Sync failed';
          failedItems.push(item);
        }
      } catch (error) {
        item.retryCount++;
        item.lastError = error instanceof Error ? error.message : 'Unknown error';
        failedItems.push(item);
        console.error(
          `[OfflineSync] ✗ Failed: ${item.method} ${item.endpoint} - ${item.lastError}`
        );
      }
    }

    // Update queue with remaining failed items
    this.queue = failedItems;
    await this.persistQueue();

    this.isSyncing = false;
    this.syncState.lastSyncTime = Date.now();

    console.log(
      `[OfflineSync] Sync complete: ${syncedCount} synced, ${failedItems.length} remaining`
    );

    return syncedCount;
  }

  /**
   * Clear the entire sync queue
   */
  async clearQueue(): Promise<void> {
    this.queue = [];
    this.syncState = {
      items: [],
      isSyncing: false,
      syncedCount: 0,
      failedCount: 0,
    };
    await this.persistQueue();
    console.log('[OfflineSync] Queue cleared');
  }

  /**
   * Remove a specific item from queue
   */
  async removeItem(id: string): Promise<void> {
    const index = this.queue.findIndex((item) => item.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
      await this.persistQueue();
    }
  }

  /**
   * Calculate exponential backoff delay in milliseconds
   * 
   * Formula: min(2^retryCount * 100, 30000)
   * Results in: 100ms, 200ms, 400ms, 800ms, 1.6s, 3.2s... (capped at 30s)
   */
  private getBackoffDelay(retryCount: number): number {
    const baseDelay = 100; // 100ms
    const delay = Math.pow(2, retryCount) * baseDelay;
    const maxDelay = 30000; // 30 seconds
    return Math.min(delay, maxDelay);
  }

  /**
   * Utility: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const offlineSyncManager = new OfflineSyncManager();

/**
 * Initialize offline sync manager on app startup
 */
export async function initializeOfflineSync(): Promise<void> {
  await offlineSyncManager.initialize();
}
