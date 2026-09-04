import { useState, useEffect, useCallback } from 'react';
import { SyncProgressUpdate, ExtensionMessage } from '../../types.js';

export function useSyncState() {
  const [syncProgress, setSyncProgress] = useState<SyncProgressUpdate | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [staleReason, setStaleReason] = useState<string>('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refreshStatus = useCallback((force: boolean = false) => {
    try {
      chrome.runtime.sendMessage({ type: 'CHECK_STALENESS', force }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.success && response.data) {
          setIsStale(Boolean(response.data.isBehind));
          setStaleReason(response.data.reason || '');
          setIsSyncing(Boolean(response.data.isSyncing));
          if (response.data.backendCount === 0) {
            setLastSyncedAt(null);
            chrome.storage.local.remove(['lastSyncedAt']).catch(() => {});
          }
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

  // On initial mount: only load cached local storage.
  // Never send network requests on dormant page load!
  useEffect(() => {
    try {
      chrome.storage.local.get(['syncProgress', 'lastSyncedAt'], (items) => {
        if (items.syncProgress) {
          setSyncProgress(items.syncProgress);
        }
        if (items.lastSyncedAt) {
          setLastSyncedAt(items.lastSyncedAt);
        }
      });
    } catch {}

    const handleMessage = (msg: ExtensionMessage) => {
      if (msg.type === 'SYNC_PROGRESS') {
        setSyncProgress(msg.progress);
        const active =
          msg.progress.stage !== 'completed' &&
          msg.progress.stage !== 'error' &&
          msg.progress.stage !== 'idle';
        setIsSyncing(active);
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
        setSyncProgress({
          stage: 'error',
          message: msg.error || 'Synchronization failed',
          progressPercent: 0,
        });
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const triggerSync = useCallback((mode: 'smart' | 'deep' = 'smart') => {
    setIsSyncing(true);
    setSyncProgress({
      stage: 'locking',
      message: 'Starting sync...',
      progressPercent: 5,
    });

    chrome.runtime.sendMessage({ type: 'START_SYNC', mode }, (res) => {
      const err = chrome.runtime.lastError?.message || (res && !res.success ? res.error : null);
      if (err) {
        setIsSyncing(false);
        setSyncProgress({
          stage: 'error',
          message: err,
          progressPercent: 0,
        });
      }
    });
  }, []);

  const dismissSyncError = useCallback(() => {
    setSyncProgress(null);
  }, []);

  return {
    syncProgress,
    isSyncing,
    isStale,
    staleReason,
    lastSyncedAt,
    triggerSync,
    refreshStatus,
    dismissSyncError,
  };
}
