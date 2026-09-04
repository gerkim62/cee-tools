import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { SyncProgressUpdate } from '../../types.js';

interface SyncBannerProps {
  isSyncing: boolean;
  isStale: boolean;
  staleReason: string;
  syncProgress: SyncProgressUpdate | null;
  onSyncNow: () => void;
  onDismissError?: () => void;
}

export const SyncBanner: React.FC<SyncBannerProps> = ({
  isSyncing,
  isStale,
  staleReason,
  syncProgress,
  onSyncNow,
  onDismissError,
}) => {
  const isError = !isSyncing && syncProgress?.stage === 'error';
  if (!isSyncing && !isStale && !isError) return null;

  const pct = syncProgress?.progressPercent ?? (isSyncing ? 5 : 0);

  if (isError) {
    return (
      <div
        className="saka-sync-banner"
        style={{
          background: 'rgba(239, 68, 68, 0.12)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
        }}
      >
        <div className="saka-sync-banner-row">
          <div className="saka-sync-banner-text" style={{ color: '#fca5a5' }}>
            <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
            <span>
              {syncProgress?.message &&
              (syncProgress.message.includes('fetch') ||
                syncProgress.message.includes('ECONNREFUSED') ||
                syncProgress.message.includes('localhost'))
                ? 'Knowledge service is temporarily unreachable.'
                : syncProgress?.message || 'Unable to complete sync. Active knowledge base is in use.'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className="saka-btn-primary"
              style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '5px', background: '#ef4444' }}
              onClick={onSyncNow}
            >
              Retry
            </button>
            {onDismissError && (
              <button
                type="button"
                className="saka-btn-icon"
                style={{ width: '20px', height: '20px' }}
                onClick={onDismissError}
                title="Dismiss"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const message = isSyncing
    ? syncProgress?.message || 'Synchronizing SakaHub...'
    : staleReason || 'New articles detected on SakaHub.';

  return (
    <div className="saka-sync-banner">
      <div className="saka-sync-banner-row">
        <div className="saka-sync-banner-text">
          {isSyncing ? (
            <span className="saka-percentage-pill">{pct}%</span>
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
