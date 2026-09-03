import { useState, useEffect, useCallback } from 'react';
import { SyncProgressUpdate, ExtensionMessage } from '../../types.js';

export function useSyncState() {
  const [syncProgress, setSyncProgress] = useState<SyncProgressUpdate | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [staleReason, setStaleReason] = useState<string>('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: 'CHECK_STALENESS' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.success && response.data) {
          setIsStale(Boolean(response.data.isBehind));
          setStaleReason(response.data.reason || '');
          setIsSyncing(Boolean(response.data.isSyncing));
        }
      });

      chrome.storage.local.get(['syncProgress', 'lastSyncedAt'], (items) => {
        if (items.syncProgress) {
          setSyncProgress(items.syncProgress);
        }
        if (items.lastSyncedAt) {
          setLastSyncedAt(items.lastSyncedAt);
        }
      });
    } catch {}
  }, []);

  useEffect(() => {
    refreshStatus();

    const handleMessage = (msg: ExtensionMessage) => {
      if (msg.type === 'SYNC_PROGRESS') {
        setSyncProgress(msg.progress);
        setIsSyncing(msg.progress.stage !== 'completed' && msg.progress.stage !== 'error' && msg.progress.stage !== 'idle');
        if (msg.progress.stage === 'completed') {
          setIsStale(false);
          setLastSyncedAt(new Date().toISOString());
        }
      } else if (msg.type === 'SYNC_COMPLETED') {
        setIsSyncing(false);
        setIsStale(false);
        setLastSyncedAt(new Date().toISOString());
      } else if (msg.type === 'SYNC_ERROR') {
        setIsSyncing(false);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [refreshStatus]);

  const triggerSync = useCallback((mode: 'smart' | 'deep' = 'smart') => {
    setIsSyncing(true);
    chrome.runtime.sendMessage({ type: 'START_SYNC', mode }, (res) => {
      if (chrome.runtime.lastError || (res && !res.success)) {
        setIsSyncing(false);
      }
    });
  }, []);

  return {
    syncProgress,
    isSyncing,
    isStale,
    staleReason,
    lastSyncedAt,
    triggerSync,
    refreshStatus,
  };
}
