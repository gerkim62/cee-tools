import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
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

      {/* Active Sync Progress Box */}
      {isSyncing && (
        <div
          style={{
            background: 'rgba(59, 130, 246, 0.12)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            borderRadius: '12px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#93c5fd', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RefreshCw size={14} className="spin" style={{ animation: 'spin 1.5s linear infinite' }} />
              Syncing SakaHub...
            </span>
            <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: '12px' }}>
              {syncProgress?.progressPercent || 0}%
            </span>
          </div>

          <p style={{ fontSize: '12px', color: '#cbd5e1' }}>
            {syncProgress?.message || 'Processing articles...'}
          </p>

          <div className="saka-sync-progress-track">
            <div
              className="saka-sync-progress-fill"
              style={{ width: `${Math.max(5, syncProgress?.progressPercent || 0)}%` }}
            />
          </div>
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
          <span style={{ flex: 1 }}>{syncProgress.message}</span>
        </div>
      )}

      {/* Clean 2-Metric Cards (KISS) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="saka-stats-card" style={{ padding: '14px', textAlign: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11.5px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Indexed Articles
          </span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#10b981' }}>
            {status?.totalIndexed ?? (loading ? '...' : '0')}
          </span>
        </div>

        <div className="saka-stats-card" style={{ padding: '14px', textAlign: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11.5px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Last Synced
          </span>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#f1f5f9', marginTop: '6px' }}>
            {formatRelativeTime(lastSyncedAt)}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        <button
          type="button"
          className="saka-btn-primary"
          onClick={() => onTriggerSync('smart')}
          disabled={isSyncing}
          style={{ padding: '12px', fontSize: '13.5px' }}
        >
          <RefreshCw
            size={16}
            className={isSyncing ? 'spin' : ''}
            style={isSyncing ? { animation: 'spin 1.5s linear infinite' } : {}}
          />
          <span>{isSyncing ? 'Synchronizing...' : 'Sync Knowledge Base'}</span>
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
