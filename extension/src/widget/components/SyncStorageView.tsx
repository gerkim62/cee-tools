import React, { useState, useEffect } from 'react';
import { AlertCircle, ShieldCheck, ExternalLink } from 'lucide-react';
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

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const backendUrl = await getBackendUrl();
      const res = await bgFetch(`${backendUrl}/sync-status`);
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
    if (!isoString) return 'Never';
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
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            color: '#f87171',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <AlertCircle size={16} />
            <span>Sync Service Unavailable</span>
          </div>
          <p style={{ color: '#fca5a5', lineHeight: 1.4 }}>
            Unable to check knowledge base sync status right now.
          </p>
          <details style={{ fontSize: '11px', color: '#94a3b8' }}>
            <summary style={{ cursor: 'pointer' }}>Technical details</summary>
            <div style={{ marginTop: '4px', fontFamily: 'monospace', color: '#cbd5e1', background: 'rgba(0,0,0,0.25)', padding: '4px 8px', borderRadius: '4px', wordBreak: 'break-all' }}>
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
      {!isSyncing && syncProgress?.stage === 'error' && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#fca5a5',
            fontSize: '12px',
          }}
        >
          <AlertCircle size={15} color="#ef4444" style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            Unable to fetch online updates right now. Existing knowledge base remains active and verified.
          </span>
        </div>
      )}

      {/* Single Unified Sync Status Card (Minimalist percentage pill, no refresh icons!) */}
      <div
        className="saka-stats-card"
        style={{
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          border: isSyncing ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
            {isSyncing ? 'Synchronizing Knowledge Base' : 'Knowledge Base Synchronized'}
          </span>
          {isSyncing ? (
            <span className="saka-percentage-pill">{pct}%</span>
          ) : (
            <span
              style={{
                fontSize: '11px',
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.15)',
                padding: '2px 8px',
                borderRadius: '10px',
                fontWeight: 600,
              }}
            >
              Ready
            </span>
          )}
        </div>

        {isSyncing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
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
        <div className="saka-stats-card" style={{ padding: '14px', textAlign: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Indexed Articles
          </span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#10b981' }}>
            {status?.totalIndexed ?? (loading ? '...' : '0')}
          </span>
        </div>

        <div className="saka-stats-card" style={{ padding: '14px', textAlign: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Last Synced
          </span>
          <span style={{ fontSize: '14.5px', fontWeight: 600, color: '#f1f5f9', marginTop: '6px' }}>
            {formatRelativeTime(lastSyncedAt)}
          </span>
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
