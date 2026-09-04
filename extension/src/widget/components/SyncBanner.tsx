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
    const isAuth =
      syncProgress?.message?.includes('log in to SakaHub') ||
      syncProgress?.message?.includes('SAKAHUB_AUTH') ||
      syncProgress?.message?.includes('session expired') ||
      syncProgress?.message?.includes('unauthenticated');

    return (
      <div
        className="saka-sync-banner"
        style={{
          background: isAuth ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          borderBottom: `1px solid ${isAuth ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
        }}
      >
        <div className="saka-sync-banner-row">
          <div className="saka-sync-banner-text" style={{ color: isAuth ? '#fde68a' : '#fca5a5' }}>
            <AlertCircle size={14} color={isAuth ? '#f59e0b' : '#ef4444'} style={{ flexShrink: 0 }} />
            <span>
              {isAuth
                ? 'Please log in to SakaHub to sync knowledge base.'
                : syncProgress?.message &&
                  (syncProgress.message.includes('fetch') ||
                    syncProgress.message.includes('ECONNREFUSED') ||
                    syncProgress.message.includes('localhost'))
                ? 'Knowledge service is temporarily unreachable.'
                : syncProgress?.message || 'Sync could not be completed.'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isAuth ? (
              <a
                href="https://sakahub.safaricom.co.ke"
                target="_blank"
                rel="noopener noreferrer"
                className="saka-btn-primary"
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  borderRadius: '5px',
                  background: '#f59e0b',
                  color: '#0f172a',
                  fontWeight: 600,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                Log In ↗
              </a>
            ) : (
              <button
                type="button"
                className="saka-btn-primary"
                style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '5px', background: '#ef4444' }}
                onClick={onSyncNow}
              >
                Retry
              </button>
            )}
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
