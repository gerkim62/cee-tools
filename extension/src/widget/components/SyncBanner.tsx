import React from 'react';
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { SyncProgressUpdate } from '../../types.js';

interface SyncBannerProps {
  isSyncing: boolean;
  isStale: boolean;
  staleReason: string;
  syncProgress: SyncProgressUpdate | null;
  onSyncNow: () => void;
}

export const SyncBanner: React.FC<SyncBannerProps> = ({
  isSyncing,
  isStale,
  staleReason,
  syncProgress,
  onSyncNow,
}) => {
  if (!isSyncing && !isStale) return null;

  const pct = syncProgress?.progressPercent ?? (isSyncing ? 10 : 0);
  const message = isSyncing
    ? syncProgress?.message || 'Syncing SakaHub knowledge base...'
    : staleReason || 'New articles detected on SakaHub.';

  return (
    <div className="saka-sync-banner">
      <div className="saka-sync-banner-row">
        <div className="saka-sync-banner-text">
          {isSyncing ? (
            <RefreshCw size={13} className="spin" style={{ animation: 'spin 1.5s linear infinite' }} />
          ) : (
            <AlertCircle size={13} style={{ color: '#f59e0b' }} />
          )}
          <span>{message}</span>
        </div>

        {!isSyncing && isStale && (
          <button
            type="button"
            className="saka-btn-primary"
            style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '5px' }}
            onClick={onSyncNow}
          >
            Sync Now
          </button>
        )}
      </div>

      {isSyncing && (
        <div className="saka-sync-progress-track">
          <div className="saka-sync-progress-fill" style={{ width: `${Math.max(5, pct)}%` }} />
        </div>
      )}
    </div>
  );
};
