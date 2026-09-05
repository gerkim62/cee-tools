import React, { useState, useEffect } from 'react';
import { AlertCircle, ShieldCheck, ExternalLink, Globe, X, RefreshCw } from 'lucide-react';
import { BackendSyncStatus, SyncProgressUpdate } from '../../types.js';
import { getBackendUrl } from '../../scripts/syncer.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

interface SyncStorageViewProps {
  isSyncing: boolean;
  syncProgress: SyncProgressUpdate | null;
  lastSyncedAt: string | null;
  onTriggerSync: (mode: 'smart' | 'deep') => void;
}

export const SyncStorageView: React.FC<SyncStorageViewProps> = ({
  isSyncing,
  syncProgress,
  lastSyncedAt,
  onTriggerSync,
}) => {
  const [status, setStatus] = useState<BackendSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);

  useEffect(() => {
    if (isSyncing) {
      setDismissedError(false);
    }
  }, [isSyncing]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const backendUrl = await getBackendUrl();
      const res = await bgFetch<BackendSyncStatus>(`${backendUrl}/sync-status`);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      setStatus(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Cannot reach backend: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [isSyncing]);

  const formatRelativeTime = (isoString?: string | null) => {
    if (!isoString || status?.totalIndexed === 0) return 'Never';
    const ms = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const pct = syncProgress?.progressPercent || 0;

  return (
    <div className="saka-view-container">
      <h3 className="saka-view-title">Knowledge Base Sync</h3>

      {/* Error state */}
      {error && (
        <div className="saka-alert-card saka-alert-error">
          <div className="saka-alert-header">
            <AlertCircle size={16} />
            <span>Sync Service Unavailable</span>
          </div>
          <p className="saka-alert-desc">
            Unable to check knowledge base sync status right now.
          </p>
          <details className="saka-alert-details">
            <summary style={{ cursor: 'pointer' }}>Technical details</summary>
            <div className="saka-alert-code">
              {error}
            </div>
          </details>
          <button
            type="button"
            className="saka-btn-secondary"
            style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: '12px', marginTop: '2px' }}
            onClick={fetchStats}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Sync Error Box if sync failed */}
      {!isSyncing && syncProgress?.stage === 'error' && !dismissedError && (() => {
        const isSakaConnection =
          syncProgress.errorCode === 'AUTH_REQUIRED' ||
          syncProgress.errorCode === 'NO_SAKAHUB_TAB';

        if (isSakaConnection) {
          return (
            <div className="saka-alert-card saka-alert-warning">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="saka-alert-header">
                  <Globe size={16} style={{ flexShrink: 0 }} />
                  <span>Open SakaHub to Connect</span>
                </div>
                <button
                  type="button"
                  className="saka-btn-icon"
                  style={{ width: '22px', height: '22px' }}
                  onClick={() => setDismissedError(true)}
                  title="Dismiss"
                >
                  <X size={13} />
                </button>
              </div>

              <p className="saka-alert-desc">
                {syncProgress.message || 'Please open SakaHub in your browser and it will automatically pick up.'}
              </p>

              <a
                href="https://sakahub.safaricom.co.ke"
                target="_blank"
                rel="noopener noreferrer"
                className="saka-btn-primary"
                style={{
                  alignSelf: 'flex-start',
                  padding: '6px 14px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '4px',
                }}
              >
                <span>Open SakaHub</span>
                <ExternalLink size={13} />
              </a>
            </div>
          );
        }

        return (
          <div className="saka-alert-card saka-alert-error">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="saka-alert-header">
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>Sync Failed</span>
              </div>
              <button
                type="button"
                className="saka-btn-icon"
                style={{ width: '22px', height: '22px' }}
                onClick={() => setDismissedError(true)}
                title="Dismiss"
              >
                <X size={13} />
              </button>
            </div>
            <span className="saka-alert-desc">{syncProgress.message}</span>
          </div>
        );
      })()}

      {/* Single Unified Sync Status Card */}
      <div className="saka-stats-card saka-sync-overview-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="saka-sync-status-title">
            {isSyncing
              ? 'Synchronizing Knowledge Base'
              : status?.totalIndexed === 0
                ? 'Knowledge Base Empty'
                : 'Knowledge Base Synchronized'}
          </span>
          {isSyncing ? (
            <span className="saka-percentage-pill">{pct}%</span>
          ) : status?.totalIndexed === 0 ? (
            <span className="saka-status-pill saka-status-warning">
              Not Synced
            </span>
          ) : (
            <span className="saka-status-pill saka-status-ready">
              Ready
            </span>
          )}
        </div>

        {isSyncing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <p className="saka-sync-status-msg">
              {syncProgress?.message || 'Probing SakaHub articles...'}
            </p>
            <div className="saka-sync-progress-track">
              <div
                className="saka-sync-progress-fill"
                style={{ width: `${Math.max(5, pct)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 2-Metric Cards (KISS) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="saka-stats-card saka-stat-metric-card">
          <span className="saka-stat-metric-label">
            Indexed Articles
          </span>
          <span className="saka-stat-metric-val">
            {status?.totalIndexed ?? (loading ? '...' : '0')}
          </span>
        </div>

        <div className="saka-stats-card saka-stat-metric-card">
          <span className="saka-stat-metric-label">
            Last Synced
          </span>
          {(() => {
            const effectiveSyncTime = lastSyncedAt || status?.maxLastUpdated;
            const formatted = formatRelativeTime(effectiveSyncTime);
            if (formatted !== 'Never') {
              return (
                <span className="saka-stat-metric-time">
                  {formatted}
                </span>
              );
            }
            return (
              <button
                type="button"
                className="saka-btn-check-status"
                onClick={fetchStats}
                disabled={loading}
                title="Query server for sync status"
              >
                <RefreshCw size={11} className={loading ? 'saka-spin' : ''} />
                <span>{loading ? 'Checking...' : 'Check Server Status'}</span>
              </button>
            );
          })()}
        </div>
      </div>

      {/* Action Buttons (No refresh icons!) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
        <button
          type="button"
          className="saka-btn-primary"
          onClick={() => onTriggerSync('smart')}
          disabled={isSyncing}
          style={{ padding: '12px', fontSize: '13.5px', opacity: isSyncing ? 0.75 : 1 }}
        >
          <span>{isSyncing ? `Synchronizing (${pct}%)...` : 'Sync Knowledge Base'}</span>
        </button>

        <button
          type="button"
          className="saka-btn-secondary"
          onClick={() => onTriggerSync('deep')}
          disabled={isSyncing}
          style={{ padding: '8px 12px', fontSize: '12px' }}
          title="Reconcile all 7 pages to check for any deleted articles"
        >
          <ShieldCheck size={14} />
          <span>Deep Full Reconciliation</span>
        </button>
      </div>
    </div>
  );
};
